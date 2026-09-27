/**
 * Self-contained HTML report: no external CSS, no scripts, prints cleanly.
 */

import { SEVERITY_ORDER } from '../model/index.js';
import type { Severity } from '../model/index.js';
import type { ReportInput } from './shared.js';
import { SEVERITY_COLOR, execSummary, groupBySeverity } from './shared.js';

const HTML_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font: 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#111827; background:#f9fafb; margin:0; padding:2rem 1rem; }
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size:1.9rem; margin:0 0 .25rem; }
h2 { font-size:1.3rem; margin:2.5rem 0 .75rem; padding-bottom:.35rem; border-bottom:2px solid #e5e7eb; }
h3 { font-size:1.05rem; margin:2rem 0 .5rem; }
.sub { color:#6b7280; margin-bottom:2rem; }
table { border-collapse:collapse; width:100%; margin:1rem 0; font-size:.9rem; background:#fff; }
th,td { border:1px solid #e5e7eb; padding:.5rem .6rem; text-align:left; vertical-align:top; }
th { background:#f3f4f6; font-weight:600; }
code,pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
pre { background:#0f172a; color:#e2e8f0; padding:.8rem; border-radius:6px; overflow-x:auto; }
.badge { display:inline-block; padding:.1rem .5rem; border-radius:4px; color:#fff; font-size:.75rem; font-weight:700; letter-spacing:.03em; }
.finding { background:#fff; border:1px solid #e5e7eb; border-left:4px solid #9ca3af; border-radius:6px; padding:1rem 1.25rem; margin:1rem 0; }
.finding.critical { border-left-color:${SEVERITY_COLOR.critical}; }
.finding.high { border-left-color:${SEVERITY_COLOR.high}; }
.finding.medium { border-left-color:${SEVERITY_COLOR.medium}; }
.finding.low { border-left-color:${SEVERITY_COLOR.low}; }
.finding.info { border-left-color:${SEVERITY_COLOR.info}; }
.kv { display:grid; grid-template-columns:8rem 1fr; gap:.2rem .8rem; font-size:.88rem; margin:.5rem 0; }
.kv dt { color:#6b7280; }
.kv dd { margin:0; }
label { display:inline-block; font-weight:600; margin-top:.6rem; }
`;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function pre(text: string | undefined): string {
  return text ? `<pre>${esc(text)}</pre>` : '<p><em>not captured</em></p>';
}

export function toHtml(input: ReportInput): string {
  const grouped = groupBySeverity(input.findings);
  const meta: [string, string][] = [
    ['Engagement', esc(input.engagement)],
    ['Tester', esc(input.tester)],
    ['Started', esc(input.startedAt)],
    ['Generated', esc(input.generatedAt ?? new Date().toISOString())],
    ['Findings', String(input.findings.filter((f) => f.status !== 'false_positive').length)],
    ['Tool runs', String(input.runs.length)],
  ];

  const body: string[] = [];
  body.push(`<h1>Penetration Test Report</h1><p class="sub">${esc(input.engagement)}</p>`);
  body.push(
    `<dl class="kv">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`,
  );

  body.push('<h2>1. Executive summary</h2>');
  for (const para of execSummary(input).split('\n\n')) body.push(`<p>${esc(para)}</p>`);

  body.push('<h2>2. Scope and authorisation</h2>');
  body.push(
    '<table><tr><th>Type</th><th>Target</th><th>Note</th></tr>' +
      input.scope
        .map((s) => `<tr><td>${esc(s.kind)}</td><td><code>${esc(s.value)}</code></td><td>${esc(s.note ?? '')}</td></tr>`)
        .join('') +
      '</table>',
  );

  body.push('<h2>3. Findings overview</h2>');
  body.push(
    '<table><tr><th>#</th><th>Severity</th><th>Title</th><th>Asset</th><th>CWE</th></tr>' +
      [...input.findings]
        .filter((f) => f.status !== 'false_positive')
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        .map(
          (f, i) =>
            `<tr><td>${i + 1}</td><td><span class="badge" style="background:${SEVERITY_COLOR[f.severity]}">${f.severity.toUpperCase()}</span></td><td>${esc(f.title)}</td><td><code>${esc(f.asset)}</code></td><td>${esc(f.cwe ?? '')}</td></tr>`,
        )
        .join('') +
      '</table>',
  );

  let index = 1;
  for (const severity of SEVERITY_ORDER) {
    const items = grouped.get(severity) ?? [];
    if (items.length === 0) continue;
    body.push(`<h2>4.${SEVERITY_ORDER.indexOf(severity) + 1} ${severity.toUpperCase()} findings</h2>`);
    for (const finding of items) {
      body.push(
        `<div class="finding ${finding.severity}"><h3>${index}. ${esc(finding.title)} <span class="badge" style="background:${SEVERITY_COLOR[finding.severity]}">${finding.severity.toUpperCase()}</span></h3>` +
          `<dl class="kv">` +
          `<dt>Asset</dt><dd><code>${esc(finding.asset)}</code></dd>` +
          `<dt>Status</dt><dd>${esc(finding.status)}</dd>` +
          `<dt>Source</dt><dd>${esc(finding.source)}</dd>` +
          (finding.cwe ? `<dt>CWE</dt><dd>${esc(finding.cwe)}</dd>` : '') +
          (finding.owasp ? `<dt>OWASP</dt><dd>${esc(finding.owasp)}</dd>` : '') +
          `<dt>Observed</dt><dd>${esc(finding.createdAt)}</dd>` +
          `</dl>` +
          (finding.description ? `<label>Description</label><p>${esc(finding.description)}</p>` : '') +
          `<label>Evidence</label>${pre(finding.evidence)}` +
          `<label>Reproduction</label>${pre(finding.reproduction)}` +
          `<label>Remediation</label><p>${esc(finding.remediation || 'no remediation recorded')}</p>` +
          `</div>`,
      );
      index += 1;
    }
  }

  body.push('<h2>Appendix A — Commands executed</h2>');
  body.push(
    '<table><tr><th>When</th><th>Tool</th><th>Command</th><th>Result</th></tr>' +
      input.runs
        .map(
          (r) =>
            `<tr><td>${esc(r.at)}</td><td>${esc(r.tool)}</td><td><code>${esc(r.command.slice(0, 200))}</code></td><td>${r.ok ? 'ok' : `failed: ${esc(r.summary.slice(0, 60))}`}</td></tr>`,
        )
        .join('') +
      '</table>',
  );

  body.push('<h2>Appendix B — Decision log</h2>');
  body.push(
    '<table><tr><th>When</th><th>Actor</th><th>Tool</th><th>Decision</th><th>Risk</th><th>Reason</th></tr>' +
      input.audit
        .map(
          (a) =>
            `<tr><td>${esc(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.tool)}</td><td>${esc(a.decision)}</td><td>${esc(a.risk)}</td><td>${esc(a.reason.slice(0, 160))}</td></tr>`,
        )
        .join('') +
      '</table>',
  );

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Penetration Test Report — ${esc(input.engagement)}</title>
<style>${HTML_CSS}</style>
</head><body><main>
${body.join('\n')}
</main></body></html>
`;
}
