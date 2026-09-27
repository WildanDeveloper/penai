/**
 * Recorded output: findings, plus the evidence and audit records that back them.
 *
 * A finding is only worth as much as the evidence attached to it, which is why
 * evidence, reproduction and remediation are required fields rather than
 * optional ones.
 */

import type { Risk } from './policy.js';

/** How much a finding matters to the client, worst first. */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  asset: string;
  description: string;
  evidence: string;
  reproduction: string;
  remediation: string;
  cwe?: string;
  owasp?: string;
  cvss?: string;
  source: 'model' | 'auto' | 'manual';
  runId?: string;
  status: 'open' | 'confirmed' | 'false_positive' | 'fixed';
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: 'user' | 'model';
  tool: string;
  command: string;
  decision: 'allowed' | 'denied' | 'confirmed' | 'manual-only';
  risk: Risk;
  reason: string;
  runId?: string;
  exitCode?: number;
}

export interface ToolRun {
  id: string;
  at: string;
  tool: string;
  args: Record<string, unknown>;
  command: string;
  ok: boolean;
  durationMs: number;
  summary: string;
  output: string;
  truncated?: boolean;
}

export interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  at: string;
  kind?: 'text' | 'stream' | 'command' | 'result' | 'error' | 'notice';
}
