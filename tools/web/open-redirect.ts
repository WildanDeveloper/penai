/**
 * Open redirect check: one probe against a single redirect parameter.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { httpRequest } from './http.js';

export const openRedirectCheck: BuiltinTool = {
  kind: 'builtin',
  name: 'open_redirect_check',
  title: 'Open redirect check',
  category: 'web',
  risk: 'medium',
  description: 'Test a single URL parameter for unvalidated redirect to an external host. Sends exactly one probe.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'full URL including the redirect parameter' },
    { name: 'param', type: 'string', required: true, description: 'redirect parameter name' },
  ],
  async run(args): Promise<ToolResult> {
    const url = String(args.url ?? '');
    const param = String(args.param ?? '');
    if (!url || !param) return { ok: false, summary: 'url and param are required', data: {}, error: 'missing arguments' };

    const probe = new URL(url);
    probe.searchParams.set(param, 'https://penai-probe.example/');
    const res = await httpRequest(probe.toString(), { followRedirects: false, timeoutMs: 10_000, maxBytes: 8 * 1024 });
    const location = res.headers['location'];
    const vulnerable = res.status >= 300 && res.status < 400 && (location ?? '').includes('penai-probe.example');
    return {
      ok: true,
      summary: vulnerable ? `redirect to external host accepted (HTTP ${res.status})` : `no external redirect (HTTP ${res.status})`,
      data: { status: res.status, location: location ?? null, vulnerable },
      evidence: `GET ${probe.toString()}\nLocation: ${location ?? '(none)'}`,
      ...(vulnerable
        ? {
            findings: [
              {
                title: `Open redirect via ${param}`,
                severity: 'medium' as const,
                asset: probe.origin + probe.pathname,
                description: `The ${param} parameter is reflected into the Location header without validation, so an attacker can build a trusted-looking link that redirects victims off-site.`,
                evidence: `GET ${probe.toString()}\nHTTP ${res.status}\nLocation: ${location}`,
                reproduction: `curl -i '${probe.toString()}'`,
                remediation: 'Allow only relative redirect targets, or validate against a fixed allowlist of destinations.',
                cwe: 'CWE-601',
                owasp: 'A01:2021 Broken Access Control',
              },
            ],
          }
        : {}),
    };
  },
};
