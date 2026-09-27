/**
 * Headless command dispatch.
 *
 * Each subcommand is a function over the parsed arguments; the switch below is
 * the only place that knows the command names.
 */

import { writeFileSync } from 'node:fs';
import { loadConfig, describeConfig, configPath, saveProvider } from '../internal/config.js';
import { Store } from '../internal/store.js';
import { ALL_TOOLS, execute, externalStatus, getTool } from '../tools/index.js';
import { LlmClient } from '../ai/transport/client.js';
import { Agent } from '../ai/agent/loop.js';
import { buildSources, maskKey } from '../ai/sources.js';
import { fetchEndpointModels, modelsForProvider, providerForBaseUrl } from '../ai/catalog.js';
import { render } from '../report/index.js';
import type { ReportFormat } from '../report/index.js';
import type { AppConfig, Severity } from '../model/index.js';
import { flag, flagList, parseArgs } from './args.js';
import { addTarget, buildPolicy, reportInput } from './context.js';

export const HELP = `
PENAI - AI penetration testing terminal (authorised engagements only)

USAGE
  penai serve                        serve the core over stdio (used by the TUI)
  penai doctor                       check configuration, tools and scope
  penai scope <add|list|rm>          manage the authorised scope
  penai tools                        list the available tools
  penai run <tool> [--args]          run a single tool, non-interactive
  penai ask "<instruction>"          one agent turn, non-interactive
  penai model <list|refresh|catalog|use>
  penai findings <list|add|status>   manage findings
  penai report [--format] [--out]    export the report

GLOBAL OPTIONS
  -e, --engagement <name>      engagement name (default: untitled-engagement)
      --data-dir <path>        where evidence is stored
      --mode <safe|balanced|full>   execution ceiling
      --deny <list>             comma separated targets that are never allowed

ENVIRONMENT
  PENAI_BASE_URL   OpenAI-compatible API root
  PENAI_API_KEY    key for that endpoint
  PENAI_MODEL      model id
  PENAI_PROVIDER   openai (default) or anthropic
  PENAI_ALLOW_SHELL=1  let the model run allowlisted binaries

EXAMPLES
  penai scope add 10.10.16.0/28 --note "internal lab range"
  penai run tcp_scan --targets 10.10.16.27 --ports 22,80,443
  penai ask "map the surface of the authorised app and report findings"
  penai report --format html --out report.html
`;

export async function run(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);

  const engagement = flag(flags, 'engagement', 'e');
  const dataDir = flag(flags, 'data-dir');
  const mode = flag(flags, 'mode');
  if (dataDir) process.env.PENAI_DATA_DIR = dataDir;
  if (engagement) process.env.PENAI_ENGAGEMENT = engagement;
  if (mode) process.env.PENAI_MODE = mode;

  const config = loadConfig();
  const store = Store.forEngagement(config.dataDir, config.engagement);
  const sub = command[0];

  switch (sub) {
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write('penai 0.1.0\n');
      return 0;

    case 'doctor':
      return doctor(config, store, flags);
    case 'tools':
      return tools();
    case 'scope':
      return scopeCmd(store, command.slice(1), flags);
    case 'run':
      return runTool(store, config, command[1], flags);
    case 'ask':
      return ask(store, config, command.slice(1).join(' ') || flag(flags, 'prompt', 'p') || '', flags);
    case 'model':
      return modelCmd(config, command.slice(1));
    case 'findings':
      return findingsCmd(store, command.slice(1));
    case 'report':
      return reportCmd(store, config, flags);
    case undefined:
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`unknown command: ${sub ?? '(none)'}\n${HELP}`);
      return 1;
  }
}

function doctor(config: AppConfig, store: Store, flags: Map<string, string[]>): number {
  process.stdout.write(`PENAI doctor\n\n${describeConfig(config).join('\n')}\n\nexternal tools:\n`);
  for (const status of externalStatus()) {
    process.stdout.write(`  ${status.available ? 'yes' : ' no'}  ${status.name}\n`);
  }
  const targets = store.listTargets();
  process.stdout.write(`\nscope (${targets.length}):\n`);
  for (const target of targets) {
    process.stdout.write(`  [${target.kind}] ${target.value}\n`);
  }
  if (targets.length === 0) {
    process.stdout.write('  (empty - nothing can be tested until a target is added)\n');
  }
  if (flag(flags, 'deny')) {
    process.stdout.write(`\ndeny list: ${flag(flags, 'deny')}\n`);
  }
  process.stdout.write(`\nengagement dir: ${store.dir}\n`);
  return 0;
}

function tools(): number {
  process.stdout.write('PENAI tools\n\n');
  for (const tool of ALL_TOOLS) {
    const args = tool.args.map((a) => `${a.name}${a.required ? '*' : ''}`).join(' ');
    process.stdout.write(`${tool.name.padEnd(18)} ${tool.kind.padEnd(9)} risk=${tool.risk.padEnd(6)} args: ${args}\n`);
  }
  return 0;
}

function scopeCmd(store: Store, rest: string[], flags: Map<string, string[]>): number {
  const sub = rest[0] ?? 'list';
  if (sub === 'list') {
    const targets = store.listTargets();
    if (targets.length === 0) {
      process.stdout.write('scope is empty. Add a target:\n  penai scope add 10.0.0.0/24 --note "lab range"\n');
      return 0;
    }
    for (const target of targets) {
      process.stdout.write(`${target.id}  [${target.kind}] ${target.value}${target.note ? `  (${target.note})` : ''}\n`);
    }
    return 0;
  }
  if (sub === 'add') {
    const values = rest.slice(1);
    if (values.length === 0) {
      process.stderr.write('usage: penai scope add <ip|cidr|domain|url> [more...] [--note text]\n');
      return 1;
    }
    const note = flag(flags, 'note');
    for (const value of values) {
      const result = addTarget(store, value, note);
      if (result.ok) {
        process.stdout.write(`added [${result.kind}] ${value}  (${result.id})\n`);
      } else {
        process.stderr.write(`rejected ${value}: ${result.error}\n`);
      }
    }
    return 0;
  }
  if (sub === 'rm') {
    const id = rest[1];
    if (!id) {
      process.stderr.write('usage: penai scope rm <target-id>\n');
      return 1;
    }
    store.removeTarget(id);
    process.stdout.write(`removed ${id}\n`);
    return 0;
  }
  process.stderr.write(`unknown scope command: ${sub}\n`);
  return 1;
}

async function runTool(store: Store, config: AppConfig, name: string | undefined, flags: Map<string, string[]>): Promise<number> {
  if (!name) {
    process.stderr.write(`usage: penai run <tool> [--arg value]\n\ntools: ${ALL_TOOLS.map((t) => t.name).join(', ')}\n`);
    return 1;
  }
  const tool = getTool(name);
  if (!tool) {
    process.stderr.write(`unknown tool "${name}". Available: ${ALL_TOOLS.map((t) => t.name).join(', ')}\n`);
    return 1;
  }

  const args: Record<string, unknown> = {};
  for (const spec of tool.args) {
    const values = flagList(flags, spec.name);
    if (values.length === 0) {
      if (spec.default !== undefined) args[spec.name] = spec.default;
      continue;
    }
    if (spec.type === 'list') args[spec.name] = values;
    else if (spec.type === 'number') args[spec.name] = Number(values[0]);
    else if (spec.type === 'boolean') args[spec.name] = !['0', 'false', 'no'].includes(String(values[0]).toLowerCase());
    // A string arg given several times is one comma-joined value.
    else args[spec.name] = values.join(',');
  }

  const policy = buildPolicy(store, flag(flags, 'deny'));
  const outcome = await execute({
    tool,
    args,
    actor: 'user',
    policy,
    signal: new AbortController().signal,
    onEmit: (text) => process.stdout.write(`  ${text}\n`),
  });

  store.audit({
    actor: 'user',
    tool: name,
    command: outcome.command,
    decision: outcome.decision.action === 'run' ? 'allowed' : outcome.decision.action === 'manual' ? 'manual-only' : 'denied',
    risk: outcome.decision.risk,
    reason: outcome.decision.reason,
  });

  if (outcome.decision.action !== 'run') {
    process.stderr.write(`\n${outcome.decision.action.toUpperCase()}: ${outcome.decision.reason}\n`);
    return outcome.decision.action === 'manual' ? 3 : 2;
  }

  const result = outcome.result!;
  if (result.evidence) process.stdout.write(`\n${result.evidence}\n`);
  process.stdout.write(`\n${result.ok ? 'ok' : 'failed'}: ${result.summary}\n`);
  for (const finding of result.findings ?? []) {
    const saved = store.addFinding({ ...finding, source: 'auto', status: 'open' });
    process.stdout.write(`finding recorded: [${saved.severity}] ${saved.title} (${saved.id})\n`);
  }
  const run = store.saveRun({
    tool: name,
    args,
    command: outcome.command,
    ok: result.ok,
    durationMs: outcome.durationMs,
    summary: result.summary,
    output: (result.evidence ?? '').slice(0, config.policy.evidenceLimit),
  });
  process.stdout.write(`\nevidence: ${run.id} in ${store.dir}\n`);
  return result.ok ? 0 : 1;
}

async function ask(store: Store, config: AppConfig, prompt: string, flags: Map<string, string[]>): Promise<number> {
  if (!prompt) {
    process.stderr.write('usage: penai ask "instruction"\n');
    return 1;
  }
  const policy = buildPolicy(store, flag(flags, 'deny'));
  const client = new LlmClient(config.provider);
  if (!client.ready) {
    process.stderr.write('no API key configured. Set PENAI_API_KEY (and PENAI_BASE_URL / PENAI_MODEL).\n');
    return 1;
  }
  const scope = policy.scope;
  const agent = new Agent(config, store, policy, scope, client);
  await agent.run(prompt, {
    onAssistantToken: (token) => process.stdout.write(token),
    onAssistantDone: () => undefined,
    onToolStart: (tool, args) => process.stderr.write(`\n[tool] ${tool} ${JSON.stringify(args)}\n`),
    onToolEmit: (_tool, text) => process.stderr.write(`  ${text}\n`),
    onToolEnd: (tool, ok, summary) => process.stderr.write(`[${tool}] ${ok ? 'ok' : 'failed'}: ${summary}\n`),
    onFinding: (finding) => process.stderr.write(`\n[finding:${finding.severity}] ${finding.title} -> ${finding.id}\n`),
    onNotice: (text) => process.stderr.write(`[!] ${text}\n`),
    onStatus: (text) => process.stderr.write(`[..] ${text}\n`),
    onConfirm: async (request) => {
      process.stderr.write(`\n[confirm] ${request.tool} (${request.risk})\n  ${request.command}\n  ${request.reason}\n  type "yes" to approve: `);
      const answer = await readLine();
      return /^y(es)?$/i.test(answer.trim());
    },
  });
  process.stdout.write('\n');
  return 0;
}

async function modelCmd(config: AppConfig, rest: string[]): Promise<number> {
  const sub = rest[0] ?? 'list';
  const sources = buildSources(config.provider);

  if (sub === 'list') {
    process.stdout.write(`penai config: ${configPath()}\n\n`);
    for (const source of sources) {
      const active = source.baseUrl === config.provider.baseUrl;
      process.stdout.write(`${active ? '*' : ' '} ${source.id.padEnd(10)} ${source.label}\n`);
      process.stdout.write(`   ${source.kind}  ${source.baseUrl}  ${maskKey(source.apiKey)}\n`);
      for (const model of source.models.slice(0, 12)) {
        process.stdout.write(`     - ${model}${model === config.provider.model ? '  (active)' : ''}\n`);
      }
      if (source.models.length > 12) {
        process.stdout.write(`     ... ${source.models.length - 12} more (press r in the TUI to fetch the live list)\n`);
      }
      if (source.models.length === 0) {
        process.stdout.write('     - (none - use `penai model refresh` to query the endpoint)\n');
      }
    }
    return 0;
  }

  if (sub === 'refresh') {
    const target = rest[1];
    const source = sources.find((s) => s.id === target) ?? sources[0]!;
    process.stdout.write(`querying ${source.baseUrl}/models ...\n`);
    const live = await fetchEndpointModels(source.baseUrl, source.apiKey);
    if (live.length === 0) {
      process.stderr.write('no model list returned (the endpoint may not implement /models)\n');
      return 1;
    }
    for (const model of live) process.stdout.write(`  ${model}\n`);
    process.stdout.write(`\n${live.length} model(s). Use: penai model use ${source.id} <model>\n`);
    return 0;
  }

  if (sub === 'catalog') {
    const providerId = rest[1] ?? providerForBaseUrl(config.provider.baseUrl)?.id;
    if (!providerId) {
      process.stderr.write('usage: penai model catalog <provider>\n');
      return 1;
    }
    for (const model of modelsForProvider(providerId)) {
      const bits = [
        model.id.padEnd(38),
        model.name.padEnd(30),
        model.context ? `${Math.round(model.context / 1000)}k ctx` : '',
        typeof model.costIn === 'number' ? `$${model.costIn}/M in` : '',
        model.reasoning ? 'reasoning' : '',
        model.tools ? 'tools' : '',
      ].filter(Boolean);
      process.stdout.write(`  ${bits.join('  ')}\n`);
    }
    return 0;
  }

  if (sub === 'use') {
    const [, , sourceId, model] = rest;
    if (!sourceId || !model) {
      process.stderr.write('usage: penai model use <source> <model>\n');
      return 1;
    }
    const source = sources.find((s) => s.id === sourceId);
    if (!source) {
      process.stderr.write(`unknown source "${sourceId}". Available: ${sources.map((s) => s.id).join(', ')}\n`);
      return 1;
    }
    if (!source.apiKey) {
      process.stderr.write(`source "${sourceId}" has no API key - export one first\n`);
      return 1;
    }
    const next: AppConfig['provider'] = {
      ...config.provider,
      kind: source.kind,
      baseUrl: source.baseUrl,
      apiKey: source.apiKey,
      model,
    };
    const path = saveProvider(next);
    process.stdout.write(`saved: ${next.kind} @ ${next.baseUrl} - model ${next.model}\n  -> ${path}\n`);
    return 0;
  }

  process.stderr.write(`unknown model command: ${sub} (list, refresh, catalog, use)\n`);
  return 1;
}

function findingsCmd(store: Store, rest: string[]): number {
  const sub = rest[0] ?? 'list';

  if (sub === 'list') {
    const findings = store.listFindings();
    if (findings.length === 0) {
      process.stdout.write('no findings recorded yet\n');
      return 0;
    }
    for (const finding of findings) {
      process.stdout.write(`${finding.id}  [${finding.severity.padEnd(8)}] ${finding.status.padEnd(13)} ${finding.title}  [${finding.asset}]\n`);
    }
    return 0;
  }

  if (sub === 'add') {
    const { command, flags } = parseArgs(rest.slice(1));
    // Same shorthand the TUI uses: title|severity|asset|description
    const parts = command.join(' ').split('|').map((p) => p.trim());
    const title = parts[0] ?? '';
    if (!title) {
      process.stderr.write('usage: penai findings add "<title>|<severity>|<asset>|<description>"\n');
      return 1;
    }
    const raw = (flag(flags, 'severity') ?? parts[1] ?? 'medium') as Severity;
    const severity: Severity = (['critical', 'high', 'medium', 'low', 'info'] as Severity[]).includes(raw) ? raw : 'medium';
    const saved = store.addFinding({
      title,
      severity,
      asset: flag(flags, 'asset') ?? (parts[2] || 'unspecified'),
      description: flag(flags, 'description') ?? parts.slice(3).join(' ').trim(),
      evidence: flag(flags, 'evidence') ?? '',
      reproduction: flag(flags, 'reproduction') ?? '',
      remediation: flag(flags, 'remediation') ?? '',
      cwe: flag(flags, 'cwe'),
      owasp: flag(flags, 'owasp'),
      source: 'manual',
      status: 'open',
    });
    process.stdout.write(`recorded ${saved.id}  [${saved.severity}] ${saved.title}  [${saved.asset}]\n`);
    return 0;
  }

  if (sub === 'status') {
    const id = rest[1];
    const status = rest[2] as 'open' | 'confirmed' | 'false_positive' | 'fixed' | undefined;
    if (!id || !status) {
      process.stderr.write('usage: penai findings status <finding-id> <open|confirmed|false_positive|fixed>\n');
      return 1;
    }
    const updated = store.updateFinding(id, { status });
    if (!updated) {
      process.stderr.write(`no such finding: ${id}\n`);
      return 1;
    }
    process.stdout.write(`${id} -> ${updated.status}\n`);
    return 0;
  }

  process.stderr.write(`unknown findings command: ${sub}\n`);
  return 1;
}

function reportCmd(store: Store, config: AppConfig, flags: Map<string, string[]>): number {
  const format = (flag(flags, 'format', 'f') ?? 'markdown') as ReportFormat;
  if (!['markdown', 'html', 'sarif', 'json'].includes(format)) {
    process.stderr.write(`unknown format: ${format} (markdown, html, sarif, json)\n`);
    return 1;
  }
  const input = reportInput(store, config);
  const body = render(format, input);
  const out = flag(flags, 'out', 'o');
  if (out) {
    writeFileSync(out, body, 'utf8');
    process.stdout.write(`wrote ${out} (${input.findings.length} finding(s))\n`);
  } else {
    process.stdout.write(body);
  }
  return 0;
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    const onData = (chunk: Buffer): void => {
      stdin.off('data', onData);
      resolve(chunk.toString('utf8'));
    };
    stdin.on('data', onData);
    stdin.once('end', () => resolve('\n'));
  });
}
