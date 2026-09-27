/**
 * The core server.
 *
 * The TUI is a separate process (Go, Bubble Tea) and never imports the core;
 * it talks to this over newline-delimited JSON-RPC on stdin/stdout, the same
 * shape a language server uses. That boundary is deliberate: the language of the
 * client is a free choice, and swapping it touches nothing in here.
 *
 * Requests are single-line JSON objects; responses are single-line JSON objects
 * carrying either `result` or `error`. Long-running work (an agent turn) streams
 * `event` notifications before the final response.
 */

import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveProvider, describeConfig } from '../internal/config.js';
import { Store } from '../internal/store.js';
import { Scope } from '../scope/index.js';
import { PolicyEngine } from '../policy/index.js';
import { ALL_TOOLS, execute, externalStatus, getTool } from '../tools/index.js';
import { Agent } from '../ai/agent/loop.js';
import { LlmClient, ProviderError } from '../ai/transport/client.js';
import { buildSources, withLiveModels } from '../ai/sources.js';
import { fetchEndpointModels, modelsForProvider, providerForBaseUrl } from '../ai/catalog.js';
import { render } from '../report/index.js';
import type { ReportFormat } from '../report/index.js';
import { addTarget, buildPolicy, reportInput } from '../cli/context.js';
import type { AppConfig, Finding, Mode, ProviderConfig, Target } from '../model/index.js';

type Params = Record<string, unknown>;

interface Request {
  id: number | string;
  method: string;
  params?: Params;
}

export interface ServerOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class CoreServer {
  private config: AppConfig;
  private store: Store;
  private scope: Scope;
  private policy: PolicyEngine;
  private client: LlmClient;
  private agent: Agent | null = null;
  /** Set once the client has gone, so writes stop instead of throwing. */
  private closed = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.store = Store.forEngagement(config.dataDir, config.engagement);
    this.scope = new Scope(this.store.listTargets().map((t) => ({ value: t.value, kind: t.kind })));
    this.policy = new PolicyEngine(this.scope, config.policy);
    this.client = new LlmClient(config.provider);
  }

  private write(payload: unknown): void {
    if (this.closed) return;
    try {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // The client disconnected. Nothing left to serve.
      this.closed = true;
    }
  }

  private reply(id: Request['id'], result: unknown): void {
    this.write({ id, result });
  }

  private fail(id: Request['id'], message: string, code = -32000): void {
    this.write({ id, error: { code, message } });
  }

  private event(kind: string, data: unknown): void {
    this.write({ event: kind, data });
  }

  /** Read requests until stdin closes. */
  listen(input: NodeJS.ReadableStream = process.stdin): void {
    const reader = createInterface({ input, crlfDelay: Infinity });
    reader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let request: Request;
      try {
        request = JSON.parse(trimmed) as Request;
      } catch {
        this.write({ id: null, error: { code: -32700, message: 'invalid JSON' } });
        return;
      }
      void this.dispatch(request);
    });
    reader.on('close', () => {
      this.closed = true;
      // The client is gone; there is nothing to reply to.
      process.exit(0);
    });
  }

  private async dispatch(request: Request): Promise<void> {
    const { id, method } = request;
    const params = request.params ?? {};
    try {
      switch (method) {
        case 'session.get':
          return this.reply(id, this.session());
        case 'session.setMode':
          return this.reply(id, this.setMode(params));
        case 'scope.add':
          return this.reply(id, this.addTarget(params));
        case 'scope.remove':
          return this.reply(id, this.removeTarget(params));
        case 'tools.list':
          return this.reply(id, this.tools());
        case 'tool.run':
          return await this.runTool(id, params);
        case 'agent.send':
          return await this.sendToAgent(id, params);
        case 'agent.interrupt':
          this.agent?.interrupt();
          return this.reply(id, { ok: true });
        case 'agent.confirm':
          return this.reply(id, this.confirm(params));
        case 'model.sources':
          return await this.modelSources(id, params);
        case 'model.use':
          return this.reply(id, this.useModel(params));
        case 'report.preview':
          return this.reply(id, this.reportPreview(params));
        case 'report.export':
          return this.reply(id, this.reportExport(params));
        case 'findings.update':
          return this.reply(id, this.updateFinding(params));
        case 'findings.add':
          return this.reply(id, this.addFinding(params));
        case 'findings.remove':
          return this.reply(id, this.removeFinding(params));
        default:
          return this.fail(id, `unknown method "${method}"`, -32601);
      }
    } catch (error) {
      if (error instanceof ProviderError) return this.fail(id, error.message);
      return this.fail(id, error instanceof Error ? error.message : String(error));
    }
  }

  private session(): unknown {
    const targets = this.store.listTargets();
    const findings = this.store.listFindings();
    return {
      engagement: this.config.engagement,
      tester: this.config.tester,
      mode: this.config.policy.mode,
      provider: {
        kind: this.config.provider.kind,
        baseUrl: this.config.provider.baseUrl,
        model: this.config.provider.model,
        keyReady: this.client.ready,
        anonymous: this.client.anonymous,
      },
      scope: targets,
      findings,
      audit: this.store.listAudit(200),
      runs: this.store.listRuns(50),
      tools: externalStatus(),
      dataDir: this.store.dir,
      diagnostics: describeConfig(this.config),
    };
  }

  private setMode(params: Params): unknown {
    const mode = String(params.mode ?? '') as Mode;
    if (!['safe', 'balanced', 'full'].includes(mode)) throw new Error('mode must be safe, balanced or full');
    this.policy.setMode(mode);
    this.config = { ...this.config, policy: { ...this.config.policy, mode } };
    return { mode };
  }

  private addTarget(params: Params): unknown {
    const value = String(params.value ?? '');
    const note = params.note ? String(params.note) : undefined;
    const result = addTarget(this.store, value, note);
    if (!result.ok) throw new Error(result.error ?? 'invalid target');
    this.refreshScope();
    return { ...result, targets: this.store.listTargets() };
  }

  private removeTarget(params: Params): unknown {
    const id = String(params.id ?? '');
    this.store.removeTarget(id);
    this.refreshScope();
    return { targets: this.store.listTargets() };
  }

  private refreshScope(): void {
    this.scope = new Scope(this.store.listTargets().map((t) => ({ value: t.value, kind: t.kind })));
    this.policy = new PolicyEngine(this.scope, this.config.policy);
    this.agent?.sync(this.config, this.scope);
  }

  private tools(): unknown {
    return ALL_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      category: tool.category,
      risk: tool.risk,
      kind: tool.kind,
      description: tool.description,
      args: tool.args,
      available: tool.kind === 'builtin' || Boolean(getTool(tool.name)),
    }));
  }

  private async runTool(id: Request['id'], params: Params): Promise<void> {
    const name = String(params.tool ?? '');
    const tool = getTool(name);
    if (!tool) return this.fail(id, `unknown tool "${name}"`);
    const args = (params.args ?? {}) as Record<string, unknown>;

    const started = Date.now();
    const decision = await this.policy.evaluateTool(tool, args, 'user');
    if (decision.action !== 'run') {
      this.event('tool.decision', { tool: name, ...decision });
      return this.reply(id, {
        allowed: false,
        tool: name,
        action: decision.action,
        risk: decision.risk,
        reason: decision.reason,
        durationMs: 0,
      });
    }

    const outcome = await execute({
      tool,
      args,
      actor: 'user',
      policy: this.policy,
      signal: new AbortController().signal,
      onEmit: (text) => this.event('tool.output', { tool: name, text }),
    });

    this.store.audit({
      actor: 'user',
      tool: name,
      command: outcome.command,
      decision: 'allowed',
      risk: decision.risk,
      reason: decision.reason,
    });

    const result = outcome.result;
    let runId: string | undefined;
    if (result) {
      const run = this.store.saveRun({
        tool: name,
        args,
        command: outcome.command,
        ok: result.ok,
        durationMs: outcome.durationMs,
        summary: result.summary,
        output: (result.evidence ?? '').slice(0, this.config.policy.evidenceLimit),
      });
      runId = run.id;
      for (const finding of result.findings ?? []) {
        const saved = this.store.addFinding({ ...finding, source: 'auto', runId: run.id, status: 'open' });
        this.event('finding.created', saved);
      }
    }

    return this.reply(id, {
      allowed: true,
      tool: name,
      command: outcome.command,
      runId,
      durationMs: Date.now() - started,
      ok: result?.ok ?? false,
      summary: result?.summary ?? '',
      evidence: result?.evidence ?? '',
      error: result?.error,
    });
  }

  private async sendToAgent(id: Request['id'], params: Params): Promise<void> {
    const text = String(params.text ?? '').trim();
    if (!text) return this.reply(id, { ok: false, error: 'empty message' });

    if (!this.agent) this.agent = new Agent(this.config, this.store, this.policy, this.scope, this.client);
    if (!this.client.ready) {
      this.event('agent.error', { message: 'no API key configured; set PENAI_API_KEY or pick a source with /model' });
      return this.reply(id, { ok: false, error: 'provider not configured' });
    }

    await this.agent.run(text, {
      onAssistantToken: (token) => this.event('agent.token', { token }),
      onAssistantDone: (full) => this.event('agent.done', { text: full }),
      onToolStart: (tool, args, command) => this.event('agent.tool', { phase: 'start', tool, args, command }),
      onToolEmit: (tool, chunk) => this.event('agent.tool', { phase: 'output', tool, text: chunk }),
      onToolEnd: (tool, ok, summary) => this.event('agent.tool', { phase: 'end', tool, ok, summary }),
      onFinding: (finding) => this.event('finding.created', finding),
      onNotice: (message) => this.event('agent.notice', { message }),
      onStatus: (message) => this.event('agent.status', { message }),
      onConfirm: (request) =>
        new Promise<boolean>((resolve) => {
          this.event('agent.confirm', { request, token: `${Date.now()}` });
          const wait = setInterval(() => undefined, 1 << 30);
          wait.unref?.();
          this.pendingConfirm = { resolve, cleanup: () => clearInterval(wait) };
        }),
    });

    return this.reply(id, { ok: true, findings: this.store.listFindings() });
  }

  private pendingConfirm: { resolve: (ok: boolean) => void; cleanup: () => void } | null = null;

  /**
   * The TUI's answer to an approval request. A request with no pending prompt
   * (a stale dialog, or one that was already answered) is refused rather than
   * guessed at.
   */
  private confirm(params: Params): unknown {
    const approved = params.approved === true;
    if (!this.pendingConfirm) return { ok: false, error: 'nothing is waiting for approval' };
    const pending = this.pendingConfirm;
    this.pendingConfirm = null;
    pending.cleanup();
    pending.resolve(approved);
    return { ok: true, approved };
  }

  private async modelSources(id: Request['id'], params: Params): Promise<void> {
    const sources = buildSources(this.config.provider);
    if (params.live === true) {
      const index = Number(params.index ?? 0);
      const source = sources[index];
      if (!source) return this.fail(id, 'no such source');
      const live = await fetchEndpointModels(source.baseUrl, source.apiKey);
      sources[index] = withLiveModels(source, live);
    }
    return this.reply(id, { sources });
  }

  private useModel(params: Params): unknown {
    const baseUrl = params.baseUrl ? String(params.baseUrl) : this.config.provider.baseUrl;
    const model = String(params.model ?? '');
    const apiKey = params.apiKey ? String(params.apiKey) : this.config.provider.apiKey;
    const kind: ProviderConfig['kind'] = params.kind === 'anthropic' ? 'anthropic' : 'openai';
    if (!model) throw new Error('model is required');

    const provider = { ...this.config.provider, kind, baseUrl, model, apiKey };
    this.config = { ...this.config, provider };
    this.client = new LlmClient(provider);
    this.agent = null;
    saveProvider(provider);
    return { provider: { kind, baseUrl, model, keyReady: this.client.ready } };
  }

  private reportPreview(params: Params): unknown {
    const format = (params.format ?? 'markdown') as ReportFormat;
    const input = reportInput(this.store, this.config);
    return { format, body: render(format, input) };
  }

  /**
   * Render and write the report. Writing happens here because the core owns the
   * engagement directory; the client never touches the filesystem itself.
   */
  private reportExport(params: Params): unknown {
    const format = (params.format ?? 'markdown') as ReportFormat;
    const requested = String(params.path ?? '').trim();
    const input = reportInput(this.store, this.config);
    const body = render(format, input);
    const extension = format === 'markdown' ? 'md' : format;
    const path = requested
      ? requested.endsWith(`.${extension}`) ? requested : `${requested}.${extension}`
      : join(this.store.dir, `report-${input.findings.length}-findings.${extension}`);
    writeFileSync(path, body, 'utf8');
    return { format, path, bytes: body.length, findings: input.findings.length };
  }

  private updateFinding(params: Params): unknown {
    const id = String(params.id ?? '');
    const status = String(params.status ?? '') as Finding['status'];
    const updated = this.store.updateFinding(id, { status });
    if (!updated) throw new Error(`no such finding: ${id}`);
    return { finding: updated };
  }

  private addFinding(params: Params): unknown {
    const saved = this.store.addFinding({
      title: String(params.title ?? 'untitled'),
      severity: (params.severity ?? 'medium') as Finding['severity'],
      asset: String(params.asset ?? 'unspecified'),
      description: String(params.description ?? ''),
      evidence: String(params.evidence ?? ''),
      reproduction: String(params.reproduction ?? ''),
      remediation: String(params.remediation ?? ''),
      cwe: params.cwe ? String(params.cwe) : undefined,
      owasp: params.owasp ? String(params.owasp) : undefined,
      source: 'manual',
      status: 'open',
    });
    return { finding: saved };
  }

  private removeFinding(params: Params): unknown {
    const id = String(params.id ?? '');
    this.store.rewrite(
      'findings',
      this.store.listFindings().filter((f) => f.id !== id),
    );
    return { findings: this.store.listFindings() };
  }
}

export function serve(config = loadConfig()): void {
  const server = new CoreServer(config);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  // A client that quits mid-write closes the pipe; that is normal, not a crash.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') process.exit(0);
  });
  server.listen();
}
