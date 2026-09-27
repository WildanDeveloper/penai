/**
 * Plaintext HTTP check: does the host serve content on port 80, or redirect to
 * HTTPS as it should?
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { mapLimit, normalizeUrl } from '../../internal/util.js';

export const tlsRedirectCheck: BuiltinTool = {
  kind: 'builtin',
  name: 'http_to_https',
  title: 'Plaintext HTTP check',
  category: 'tls',
  risk: 'safe',
  description: 'Check whether http:// serves content directly and whether it redirects to HTTPS.',
  args: [{ name: 'hosts', type: 'list', required: true, description: 'hostnames or URLs' }],
  async run(args, ctx): Promise<ToolResult> {
    const hosts = (Array.isArray(args.hosts) ? (args.hosts as string[]) : [String(args.hosts ?? '')])
      .map((h) => String(h).trim())
      .filter(Boolean);
    if (hosts.length === 0) return { ok: false, summary: 'hosts is required', data: {}, error: 'hosts is required' };

    const results = await mapLimit(
      hosts,
      6,
      async (host) => {
        const url = normalizeUrl(host).replace(/^https:/, 'http:');
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        const location = res.headers.get('location');
        await res.arrayBuffer().catch(() => undefined);
        return {
          url,
          status: res.status,
          location,
          redirects: res.status >= 300 && res.status < 400 && (location ?? '').toLowerCase().startsWith('https://'),
          servesContent: res.status === 200,
        };
      },
      undefined,
    );
    ctx.signal.addEventListener('abort', () => undefined);
    const insecure = results.filter((r) => r.servesContent);
    for (const r of results) {
      ctx.emit(`${r.url}  HTTP ${r.status}  ${r.redirects ? `-> ${r.location}` : r.servesContent ? 'serves plaintext content' : 'no redirect'}`);
    }
    return {
      ok: true,
      summary: `${insecure.length} of ${results.length} serve plaintext HTTP content`,
      data: { results },
      evidence: results.map((r) => `${r.url} -> ${r.status} ${r.location ?? ''}`).join('\n'),
      ...(insecure.length > 0
        ? {
            findings: insecure.map((r) => ({
              title: 'Application served over plaintext HTTP',
              severity: 'low' as const,
              asset: r.url,
              description: 'The host answers on port 80 with real content instead of redirecting to HTTPS, so credentials and session cookies can be captured on the network.',
              evidence: `GET ${r.url} -> HTTP ${r.status}`,
              reproduction: `curl -i '${r.url}'`,
              remediation: 'Redirect port 80 to HTTPS (301) and enable HSTS.',
              cwe: 'CWE-319',
              owasp: 'A02:2021 Cryptographic Failures',
            })),
          }
        : {}),
    };
  },
};
