/**
 * Sensitive file exposure probe.
 *
 * GETs a curated list of paths that should never be public — dotfiles, backups,
 * debug endpoints — and reports anything that answers.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK, SENSITIVE_PATHS, resolveWordlists } from '../../internal/wordlist.js';
import { asBool, asInt, clamp, humanBytes, mapLimit, normalizeUrl, sleep, truncate } from '../../internal/util.js';

import { httpRequest } from './http.js';
export const exposureCheck: BuiltinTool = {
  kind: 'builtin',
  name: 'exposure_check',
  title: 'Sensitive file exposure probe',
  category: 'web',
  risk: 'low',
  description: 'GET a curated list of files that should never be public (.env, .git/config, backups, debug endpoints).',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'base URLs' },
    { name: 'concurrency', type: 'number', description: 'parallel requests', default: 6 },
    { name: 'delayMs', type: 'number', description: 'delay between requests', default: 120 },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const bases = (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls ?? '')])
      .map((u) => u.trim())
      .filter(Boolean);
    if (bases.length === 0) return { ok: false, summary: 'urls is required', data: {}, error: 'urls is required' };

    const lines: string[] = [];
    const findings: NonNullable<ToolResult['findings']> = [];
    const delay = clamp(asInt(args.delayMs, 120), 0, 2000);

    for (const base of bases) {
      const root = normalizeUrl(base);
      const targets = SENSITIVE_PATHS.map((p) => ({ url: new URL(p.path, root).toString(), note: p.note, path: p.path }));
      const results = await mapLimit(
        targets,
        clamp(asInt(args.concurrency, 6), 1, 16),
        async (t) => {
          const r = await httpRequest(t.url, { method: 'GET', timeoutMs: 8000, maxBytes: 64 * 1024 }, ctx.signal);
          if (delay > 0) await sleep(delay, ctx.signal);
          return { ...t, status: r.status, length: r.length ?? 0, contentType: r.contentType, sample: r.body?.slice(0, 200) };
        },
      );

      for (const r of results) {
        if (r.status === 200 || r.status === 206) {
          lines.push(`EXPOSED  HTTP ${r.status}  ${r.url}  (${r.note}, ${humanBytes(r.length)})`);
          const severity = /\/\.env|\/\.git\/config|id_rsa|credentials|\.aws/i.test(r.path)
            ? 'high'
            : /phpinfo|server-status|swagger|actuator/i.test(r.path)
              ? 'medium'
              : 'medium';
          findings.push({
            title: `Sensitive file reachable: ${r.path}`,
            severity,
            asset: r.url,
            description: `${r.note} is publicly readable. This is a common direct path to credentials and source disclosure.`,
            evidence: `GET ${r.url}\nHTTP ${r.status} ${r.contentType ?? ''}\n${r.sample ?? ''}`,
            reproduction: `curl -i '${r.url}'`,
            remediation: 'Block access to dotfiles and backup files at the web server, remove them from the document root, and rotate any credentials that were exposed.',
            cwe: 'CWE-538',
            owasp: 'A01:2021 Broken Access Control',
          });
        } else if (r.status !== 0 && r.status !== 404 && r.status !== 403) {
          lines.push(`checked  HTTP ${r.status}  ${r.url}`);
        }
      }
      lines.push(`--- ${bases.length} base(s) probed, ${results.filter((r) => r.status === 200).length} readable sensitive file(s)`);
    }

    return {
      ok: true,
      summary: `${findings.length} readable sensitive file(s)`,
      data: { findings: findings.map((f) => f.asset) },
      evidence: lines.join('\n'),
      ...(findings.length > 0 ? { findings } : {}),
    };
  },
};
