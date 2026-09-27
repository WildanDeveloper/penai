/**
 * Execution policy configuration.
 *
 * `Mode` is the ceiling on what the agent may run unattended. An operator-issued
 * action is not bound by it: the human at the keyboard is the approval.
 */

/**
 * How hard an action touches the target, ordered by how much the operator
 * should care before it runs.
 * - safe   : read-only, no side effects (DNS, GET, port connect)
 * - low    : light probing, may appear in target logs
 * - medium : content discovery / fuzzing, higher request volume
 * - high   : intrusive, state-changing or noisy; needs explicit approval
 * - manual : printed for the human, never auto-executed by the agent
 */
export type Risk = 'safe' | 'low' | 'medium' | 'high' | 'manual';

export const RISK_ORDER: Risk[] = ['safe', 'low', 'medium', 'high', 'manual'];

export type Mode = 'safe' | 'balanced' | 'full';

export const MODE_MAX_RISK: Record<Mode, Risk> = {
  safe: 'safe',
  balanced: 'low',
  full: 'medium',
};

export interface PolicyConfig {
  mode: Mode;
  /** Minimum seconds between two automatic tool executions. */
  rateLimitSec: number;
  /** Max agent loop steps per user message. */
  maxSteps: number;
  /** Cap on concurrent sockets/http requests per tool run. */
  concurrency: number;
  requestTimeoutMs: number;
  evidenceLimit: number;
  /** Allow the agent to run shell commands (```bash blocks) at all. */
  allowShell: boolean;
}
