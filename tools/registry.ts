/**
 * Tool registry.
 *
 * One place where every capability is registered, described and executed. Both
 * the agent (model-driven) and the TUI (operator-driven) go through `execute`,
 * so they are subject to exactly the same policy and scope checks.
 */

import type { ExternalTool, Tool, ToolContext, ToolResult } from '../model/index.js';
import type { Decision, PolicyEngine } from '../policy/index.js';
import { netTools } from './net/index.js';
import { webTools } from './web/index.js';
import { tlsTools } from './tls/index.js';
import { availableTools, runExternal, which } from './external/index.js';
import { nmap } from './external/adapters/nmap.js';
import { httpxProbe } from './external/adapters/httpx.js';
import { nucleiScan } from './external/adapters/nuclei.js';
import { ffuf } from './external/adapters/ffuf.js';
import { katana } from './external/adapters/katana.js';
import { sqlmapTool } from './external/adapters/sqlmap.js';
import { niktoTool } from './external/adapters/nikto.js';
import { subfinderTool } from './external/adapters/subfinder.js';

const ADAPTERS: Record<string, ExternalTool> = {
  nmap,
  httpx: httpxProbe,
  nuclei: nucleiScan,
  ffuf,
  katana,
  sqlmap: sqlmapTool,
  nikto: niktoTool,
  subfinder: subfinderTool,
};

/** External tools are only registered when they are actually on PATH. */
const EXTERNAL: ExternalTool[] = availableTools()
  .map(({ name }) => ADAPTERS[name])
  .filter((tool): tool is ExternalTool => Boolean(tool));

const BUILTIN: Tool[] = [...netTools, ...webTools, ...tlsTools];

export const ALL_TOOLS: Tool[] = [...BUILTIN, ...EXTERNAL];
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): Tool | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

export function externalStatus(): { name: string; available: boolean }[] {
  return ['nmap', 'httpx', 'nuclei', 'ffuf', 'katana', 'sqlmap', 'nikto', 'subfinder', 'openssl', 'curl', 'nc'].map((name) => ({
    name,
    available: Boolean(which(name)),
  }));
}

export interface ExecuteOutcome {
  decision: Decision;
  command: string;
  result?: ToolResult;
  durationMs: number;
}

export interface ExecuteOptions {
  tool: Tool;
  args: Record<string, unknown>;
  actor: 'user' | 'model';
  policy: PolicyEngine;
  onEmit?: (text: string) => void;
  signal: AbortSignal;
}

/** Execute a tool. Anything other than `run` never touches the network. */
export async function execute(options: ExecuteOptions): Promise<ExecuteOutcome> {
  const { tool, args, actor, policy, signal } = options;
  const start = Date.now();
  const decision = await policy.evaluateTool(tool, args, actor);

  if (decision.action !== 'run') {
    return { decision, command: decision.command, durationMs: Date.now() - start };
  }

  const ctx: ToolContext = {
    emit: options.onEmit ?? (() => undefined),
    signal,
    evidenceLimit: policy.config.evidenceLimit,
  };

  let result: ToolResult;
  let command = decision.command;
  try {
    if (tool.kind === 'builtin') {
      result = await tool.run(args, ctx);
    } else {
      const outcome = await runExternal(tool, args, ctx);
      command = outcome.command;
      result = outcome.result;
    }
  } catch (error) {
    result = {
      ok: false,
      summary: 'tool crashed',
      data: {},
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  return { decision, command, result, durationMs: Date.now() - start };
}

/** Compact catalogue injected into the system prompt. */
export function toolCatalog(): string {
  return ALL_TOOLS.map((t) => {
    const args = t.args.map((a) => `${a.name}${a.required ? '*' : ''}`).join(', ');
    const origin = t.kind === 'external' ? `external binary: ${t.bin}` : 'built-in (no external binary needed)';
    return `- ${t.name} (risk=${t.risk}, ${origin})\n    ${t.description}\n    args: ${args}`;
  }).join('\n');
}
