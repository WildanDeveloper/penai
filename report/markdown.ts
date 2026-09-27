/**
 * Markdown report: the format a consultant pastes into a ticket or a PDF.
 */

import { SEVERITY_ORDER } from '../model/index.js';
import type { ReportInput } from './shared.js';
import { execSummary, firstSentence, fence, groupBySeverity, table } from './shared.js';

export function toMarkdown(input: ReportInput): string {
  const grouped = groupBySeverity(input.findings);
  const bySeverity = [...input.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.createdAt.localeCompare(b.createdAt),
  );
  const out: string[] = [];

  out.push(`# Penetration Test Report — ${input.engagement}`);
  out.push('');
  out.push(
    table(
      ['Field', 'Value'],
      [
        ['Engagement', input.engagement],
        ['Tester', input.tester],
        ['Started', input.startedAt],
        ['Report generated', input.generatedAt ?? new Date().toISOString()],
        ['Findings', String(input.findings.filter((f) => f.status !== 'false_positive').length)],
        ['Tool runs', String(input.runs.length)],
      ],
    ),
  );
  out.push('');

  out.push('## 1. Executive summary');
  out.push('');
  out.push(execSummary(input));
  out.push('');

  out.push('## 2. Scope and authorisation');
  out.push('');
  out.push('Only the following assets were in scope for this engagement:');
  out.push('');
  out.push(table(['Type', 'Target', 'Note'], input.scope.map((s) => [s.kind, `\`${s.value}\``, s.note ?? ''])));
  out.push('');

  out.push('## 3. Findings overview');
  out.push('');
  out.push(
    table(
      ['#', 'Severity', 'Title', 'Asset', 'CWE'],
      bySeverity
        .filter((f) => f.status !== 'false_positive')
        .map((f, i) => [String(i + 1), f.severity.toUpperCase(), f.title, `\`${f.asset}\``, f.cwe ?? '']),
    ),
  );
  out.push('');

  let index = 1;
  for (const severity of SEVERITY_ORDER) {
    const items = grouped.get(severity) ?? [];
    if (items.length === 0) continue;
    out.push(`## 4.x ${severity.toUpperCase()} findings`);
    out.push('');
    for (const finding of items) {
      out.push(`### ${index}. ${finding.title}`);
      out.push('');
      out.push(
        table(
          ['Field', 'Value'],
          [
            ['Severity', finding.severity.toUpperCase()],
            ['Asset', `\`${finding.asset}\``],
            ['Status', finding.status],
            ['Source', finding.source],
            ['CWE', finding.cwe ?? 'n/a'],
            ['OWASP', finding.owasp ?? 'n/a'],
            ['CVSS', finding.cvss ?? 'n/a'],
            ['Observed', finding.createdAt],
          ],
        ),
      );
      out.push('');
      if (finding.description) {
        out.push('**Description**');
        out.push('');
        out.push(finding.description);
        out.push('');
      }
      out.push('**Evidence**');
      out.push('');
      out.push(fence(finding.evidence, 'http'));
      out.push('');
      out.push('**Reproduction**');
      out.push('');
      out.push(fence(finding.reproduction, 'bash'));
      out.push('');
      out.push('**Remediation**');
      out.push('');
      out.push(finding.remediation || '_no remediation recorded_');
      out.push('');
      index += 1;
    }
  }

  const fp = input.findings.filter((f) => f.status === 'false_positive');
  if (fp.length > 0) {
    out.push('## 5. Rejected as false positives');
    out.push('');
    out.push(table(['Title', 'Asset', 'Reason'], fp.map((f) => [f.title, `\`${f.asset}\``, f.remediation.slice(0, 120)])));
    out.push('');
  }

  out.push('## Appendix A — Commands executed');
  out.push('');
  out.push(table(['When', 'Tool', 'Command', 'Result'], input.runs.map((r) => [r.at, r.tool, `\`${r.command.replace(/\|/g, '\\|').slice(0, 160)}\``, r.ok ? 'ok' : `failed: ${r.summary.slice(0, 60)}`])));
  out.push('');

  out.push('## Appendix B — Decision log');
  out.push('');
  out.push(
    table(
      ['When', 'Actor', 'Tool', 'Decision', 'Risk', 'Reason'],
      input.audit.map((a) => [a.at, a.actor, a.tool, a.decision, a.risk, a.reason.slice(0, 120)]),
    ),
  );
  out.push('');

  if (input.notes) {
    out.push('## Appendix C — Operator notes');
    out.push('');
    out.push(input.notes);
    out.push('');
  }

  return out.join('\n');
}
