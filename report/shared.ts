/**
 * Report input and the pieces every format needs.
 *
 * A report is always regenerated from stored evidence, so a report can be
 * rebuilt at any time and will match what is on disk.
 */

import { SEVERITY_ORDER } from '../model/index.js';
import type { AuditEntry, Finding, Severity, ToolRun } from '../model/index.js';

export interface ReportInput {
  engagement: string;
  tester: string;
  startedAt: string;
  generatedAt?: string;
  scope: { value: string; kind: string; note?: string }[];
  findings: Finding[];
  runs: ToolRun[];
  audit: AuditEntry[];
  notes?: string;
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#b91c1c',
  high: '#dc2626',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

export function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const map = new Map<Severity, Finding[]>();
  for (const severity of SEVERITY_ORDER) map.set(severity, []);
  for (const finding of findings) {
    if (finding.status === 'false_positive') continue;
    map.get(finding.severity)?.push(finding);
  }
  return map;
}

export function execSummary(input: ReportInput): string {
  const grouped = groupBySeverity(input.findings);
  const counts = SEVERITY_ORDER.map((s) => `${grouped.get(s)?.length ?? 0} ${s}`).filter((s) => !s.startsWith('0 '));
  const assets = new Set(input.findings.map((f) => f.asset));
  const worst = input.findings
    .filter((f) => f.status !== 'false_positive')
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))[0];

  const lines: string[] = [];
  lines.push(
    `A total of **${input.findings.filter((f) => f.status !== 'false_positive').length} finding(s)** were recorded across **${assets.size} asset(s)**: ${counts.join(', ') || 'none'}.`,
  );
  if (worst) {
    lines.push(
      `The highest-risk issue is **${worst.title}** (${worst.severity}) on \`${worst.asset}\`. ${
        worst.remediation ? `Recommended action: ${firstSentence(worst.remediation)}` : ''
      }`.trim(),
    );
  }
  lines.push(
    `Assessment covered ${input.scope.length} authorised target(s) and executed ${input.runs.length} tool run(s). Each finding below includes the evidence and reproduction steps collected during the engagement.`,
  );
  return lines.join('\n\n');
}

export function firstSentence(text: string): string {
  const idx = text.indexOf('. ');
  return idx === -1 ? text : text.slice(0, idx + 1);
}

export function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

export function fence(text: string | undefined, lang = ''): string {
  if (!text) return '_not captured_';
  const safe = text.replace(/```/g, "''' ");
  return ['```' + lang, safe, '```'].join('\n');
}
