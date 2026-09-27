/**
 * The agent loop.
 *
 * user message -> model (streamed) -> parse -> for each tool call:
 *   policy decision -> run -> audit + evidence -> back to the model
 *
 * The model never executes anything itself. It proposes; this module decides.
 * Refusals and out-of-scope attempts are fed back as tool results so the model
 * learns the boundary and adjusts instead of retrying blindly.
 */

import type { AppConfig, Finding, Message, Severity } from '../../model/index.js';
import { execute, getTool, ALL_TOOLS } from '../../tools/index.js';
import type { PolicyEngine } from '../../policy/index.js';
import { Scope } from '../../scope/index.js';
import type { Store } from '../../internal/store.js';
import { LlmClient, ProviderError } from '../transport/client.js';
import { formatToolResult, parseModelOutput } from '../protocol/parse.js';
import type { ParsedFinding } from '../protocol/parse.js';
import { playbookPrompt, systemPrompt } from './prompts.js';
import { sleep } from '../../internal/util.js';

export interface ConfirmRequest {
  tool: string;
  command: string;
  reason: string;
  risk: string;
}

export interface AgentEvents {
  onAssistantToken: (token: string) => void;
  onAssistantDone: (text: string) => void;
  onToolStart: (tool: string, args: Record<string, unknown>, command: string) => void;
  onToolEmit: (tool: string, text: string) => void;
  onToolEnd: (tool: string, ok: boolean, summary: string) => void;
  onFinding: (finding: Finding) => void;
  onNotice: (text: string) => void;
  onStatus: (text: string) => void;
  onConfirm: (request: ConfirmRequest) => Promise<boolean>;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function scopeSummary(scope: Scope, store: Store): string {
  if (scope.empty) {
    return '(empty — the operator has not authorised anything yet. Do not attempt any network activity; tell them to add targets first.)';
  }
  const lines = store.listTargets().map((t) => `- ${t.kind}: ${t.value}${t.note ? ` (${t.note})` : ''}`);
  const denies = scope.deny.length > 0 ? [`\nExplicitly denied: ${scope.deny.join(', ')}`] : [];
  return [...lines, ...denies].join('\n');
}

export class Agent {
  private controller: AbortController | null = null;
  private lastRunAt = 0;
  private history: Message[] = [];
  private usedFindingKeys = new Set<string>();

  constructor(
    private config: AppConfig,
    private readonly store: Store,
    private readonly policy: PolicyEngine,
    private scope: Scope,
    private readonly client: LlmClient,
  ) {}

  get busy(): boolean {
    return this.controller !== null;
  }

  interrupt(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Re-read scope/config after the operator changes them mid-session. */
  sync(config: AppConfig, scope: Scope): void {
    this.config = config;
    this.scope = scope;
  }

  clearHistory(): void {
    this.history = [];
  }

  private buildSystem(): string {
    return systemPrompt(this.config, scopeSummary(this.scope, this.store));
  }

  private seedHistory(): void {
    if (this.history.length > 0) return;
    for (const item of this.store.listTranscript(40)) {
      if (item.role === 'user') this.history.push({ role: 'user', content: item.text });
      else if (item.role === 'assistant' && item.text.trim()) this.history.push({ role: 'assistant', content: item.text });
    }
    if (this.history.length === 0) {
      this.history.push({
        role: 'user',
        content:
          'Brief me on this engagement: authorised scope, current hypothesis, and the single most useful next check. Ask me if scope is missing.',
      });
    }
  }

  async run(userInput: string, events: AgentEvents): Promise<void> {
    this.seedHistory();
    this.controller = new AbortController();
    const signal = this.controller.signal;

    const prompt = userInput.trim();
    this.history.push({ role: 'user', content: prompt });
    this.store.addTranscript({ role: 'user', text: prompt, kind: 'text' });

    const { policy } = this.config;
    let lastFinding: Finding | null = null;

    try {
      for (let step = 1; step <= policy.maxSteps; step += 1) {
        events.onStatus(`thinking — step ${step}/${policy.maxSteps}`);
        events.onAssistantToken('');

        let full = '';
        const text = await this.client.complete({
          messages: this.trimmedHistory(),
          system: this.buildSystem(),
          signal,
          onToken: (token) => {
            if (token === '') return;
            full += token;
            events.onAssistantToken(token);
          },
        });
        events.onAssistantDone(text);

        const parsed = parseModelOutput(text);
        for (const error of parsed.errors) events.onNotice(`parser: ${error}`);

        for (const finding of parsed.findings) {
          const record = this.recordFinding(finding, step);
          if (record) {
            lastFinding = record;
            events.onFinding(record);
          }
        }

        if (parsed.shells.length > 0) {
          events.onNotice(
            this.policy.config.allowShell
              ? 'shell blocks are handled separately — use tool calls instead'
              : 'shell execution is disabled; ask for a tool call instead',
          );
        }

        if (parsed.toolCalls.length === 0) {
          if (parsed.prose.trim()) {
            this.store.addTranscript({ role: 'assistant', text: parsed.prose, kind: 'text' });
          }
          events.onStatus('idle');
          return;
        }

        this.history.push({ role: 'assistant', content: text.slice(0, 8000) });

        for (const call of parsed.toolCalls) {
          if (signal.aborted) break;
          const outcome = await this.runToolCall(call.tool, call.args, events, step);
          this.history.push({ role: 'user', content: outcome });
        }
        events.onStatus('idle');
      }
      events.onNotice(`step limit reached (${policy.maxSteps}). Ask me to continue if you still need data.`);
    } catch (error) {
      if (signal.aborted) {
        events.onNotice('interrupted by operator');
      } else if (error instanceof ProviderError) {
        events.onNotice(`LLM error: ${error.message}`);
      } else {
        events.onNotice(`agent error: ${error instanceof Error ? error.message : String(error)}`);
      }
      events.onStatus('idle');
    } finally {
      this.controller = null;
      if (lastFinding) {
        events.onStatus(`idle — last finding: ${lastFinding.title}`);
      }
    }
  }

  /** Run a tool the operator selected by hand (Scout view). */
  async runOperatorTool(
    name: string,
    args: Record<string, unknown>,
    events: AgentEvents,
  ): Promise<{ ok: boolean; summary: string; decision: string }> {
    const tool = getTool(name);
    if (!tool) return { ok: false, summary: `unknown tool "${name}"`, decision: 'deny' };
    const outcome = await execute({
      tool,
      args,
      actor: 'user',
      policy: this.policy,
      signal: new AbortController().signal,
      onEmit: (text) => events.onToolEmit(name, text),
    });
    return {
      ok: outcome.result?.ok ?? false,
      summary: outcome.result?.summary ?? outcome.decision.reason,
      decision: outcome.decision.action,
    };
  }

  private trimmedHistory(): Message[] {
    // Keep the conversation bounded; tool evidence lives in the store.
    const max = 16;
    return this.history.slice(-max);
  }

  private recordFinding(parsed: ParsedFinding, step: number): Finding | null {
    const key = `${parsed.title}|${parsed.asset}`.toLowerCase();
    if (this.usedFindingKeys.has(key)) return null;
    this.usedFindingKeys.add(key);
    return this.store.addFinding({
      ...parsed,
      source: 'model',
      status: 'open',
    });
  }

  private async throttle(): Promise<void> {
    const gap = this.config.policy.rateLimitSec * 1000;
    const wait = this.lastRunAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRunAt = Date.now();
  }

  private async runToolCall(
    name: string,
    args: Record<string, unknown>,
    events: AgentEvents,
    step: number,
  ): Promise<string> {
    const tool = getTool(name);
    if (!tool) {
      const list = ALL_TOOLS.map((t) => t.name).join(', ');
      events.onNotice(`unknown tool "${name}". Available: ${list}`);
      return formatToolResult(name, false, `There is no tool named "${name}". Available tools: ${list}`, undefined);
    }

    await this.throttle();
    events.onToolStart(name, args, tool.kind === 'external' ? `${tool.bin} …` : name);

    let decision = await this.policy.evaluateTool(tool, args, 'model');
    if (decision.action === 'confirm') {
      const approved = await events.onConfirm({
        tool: name,
        command: decision.command,
        reason: decision.reason,
        risk: decision.risk,
      });
      this.store.audit({
        actor: 'model',
        tool: name,
        command: decision.command,
        decision: approved ? 'confirmed' : 'denied',
        risk: decision.risk,
        reason: approved ? `operator approved: ${decision.reason}` : 'operator rejected the request',
      });
      if (!approved) {
        events.onNotice(`operator declined ${name}`);
        return formatToolResult(
          name,
          false,
          `The operator declined this request (${decision.reason}). Do not retry it; propose an alternative or ask why.`,
          undefined,
        );
      }
      decision = { ...decision, action: 'run', reason: 'operator approved' };
    } else {
      this.store.audit({
        actor: 'model',
        tool: name,
        command: decision.command,
        decision: decision.action === 'run' ? 'allowed' : decision.action === 'manual' ? 'manual-only' : 'denied',
        risk: decision.risk,
        reason: decision.reason,
      });
    }

    if (decision.action === 'deny') {
      events.onToolEnd(name, false, decision.reason);
      events.onNotice(`blocked ${name}: ${decision.reason}`);
      return formatToolResult(
        name,
        false,
        `REFUSED BY POLICY: ${decision.reason}. Stay inside the authorised scope and choose a lower-impact tool.`,
        undefined,
      );
    }
    if (decision.action === 'manual') {
      events.onToolEnd(name, false, 'manual only');
      events.onNotice(`${name} is manual-only (${decision.reason}) — shown to the operator, not executed.`);
      return formatToolResult(
        name,
        false,
        `Manual-only action (${decision.reason}). It was NOT executed. Tell the operator the exact command to run themselves if they want to proceed.`,
        undefined,
      );
    }

    const outcome = await execute({
      tool,
      args,
      actor: 'model',
      policy: this.policy,
      onEmit: (text) => events.onToolEmit(name, text),
      signal: this.controller?.signal ?? new AbortController().signal,
    });

    const result = outcome.result;
    const ok = result?.ok ?? false;
    const summary = result?.summary ?? 'no result';
    events.onToolEnd(name, ok, summary);

    const run = this.store.saveRun({
      tool: name,
      args,
      command: outcome.command,
      ok,
      durationMs: outcome.durationMs,
      summary,
      output: (result?.evidence ?? '').slice(0, this.config.policy.evidenceLimit),
      ...(outcome.result?.error ? {} : {}),
    });

    for (const finding of result?.findings ?? []) {
      const record = this.store.addFinding({ ...finding, source: 'auto', runId: run.id, status: 'open' });
      events.onFinding(record);
    }

    this.store.audit({
      actor: 'model',
      tool: name,
      command: outcome.command,
      decision: 'allowed',
      risk: decision.risk,
      reason: decision.reason,
      runId: run.id,
    });

    events.onStatus(`idle — step ${step}`);
    return formatToolResult(name, ok, summary, result?.evidence);
  }
}

export { playbookPrompt, SEVERITY_ORDER };
