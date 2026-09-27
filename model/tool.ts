/**
 * Tool contracts.
 *
 * A tool is either built in (pure Node, no external binary required) or an
 * adapter for a binary already on PATH. Both expose the same argument schema,
 * because the model is only ever allowed to use the schema — never a raw
 * command line.
 */

import type { Finding } from './finding.js';
import type { Risk } from './policy.js';

export type ArgType = 'string' | 'number' | 'boolean' | 'list';

export interface ArgSpec {
  name: string;
  type: ArgType;
  description: string;
  required?: boolean;
  default?: string | number | boolean | Array<string | number>;
  example?: string;
  /**
   * Set when the value is a payload or header rather than something we connect
   * to (e.g. the attacker Origin used by cors_check). Such values are never
   * scope-checked, otherwise a test would refuse to send its own probe string.
   */
  notTarget?: boolean;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data: unknown;
  evidence?: string;
  findings?: Omit<Finding, 'id' | 'createdAt' | 'status' | 'source'>[];
  error?: string;
}

export interface ToolContext {
  /** Stream progress to the UI. */
  emit: (text: string) => void;
  signal: AbortSignal;
  /** Max characters of raw tool output retained as evidence. */
  evidenceLimit: number;
}

export interface BuiltinTool {
  kind: 'builtin';
  name: string;
  title: string;
  category: 'recon' | 'network' | 'web' | 'tls' | 'analysis';
  risk: Risk;
  description: string;
  args: ArgSpec[];
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ExternalTool {
  kind: 'external';
  name: string;
  title: string;
  category: 'recon' | 'network' | 'web' | 'tls' | 'analysis';
  risk: Risk;
  description: string;
  args: ArgSpec[];
  /** Executable looked up on PATH. */
  bin: string;
  /** Build argv from validated args. */
  build: (args: Record<string, unknown>) => string[];
  /** Reduce raw stdout to something an LLM can reason about. */
  summarize: (stdout: string) => { summary: string; data: unknown };
  /** Extra guidance injected into the system prompt. */
  usage?: string;
}

export type Tool = BuiltinTool | ExternalTool;
