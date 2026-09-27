/**
 * What the agent reports back while it works.
 *
 * The agent never touches the UI: it emits these, and the bridge decides how to
 * render them. That indirection is what lets the TUI be replaced (a Go client,
 * for instance) without the agent knowing.
 */

import type { Finding } from '../../model/index.js';

/** A tool call the operator must approve before it runs. */
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
