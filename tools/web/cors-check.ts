/**
 * CORS misconfiguration test.
 *
 * Sends a preflight and a credentialed GET with a foreign Origin, then judges
 * whether the response would let any site read authenticated data.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { normalizeUrl, sleep } from '../../internal/util.js';
import { httpRequest } from './http.js';

export const corsCheck: BuiltinTool = {
  kind: 'builtin',
  name: 'cors_check',
  title: 'CORS misconfiguration test',
  category: 'web',
  risk: 'low',
  description: 'Send an OPTIONS preflight and a GET with a foreign Origin, then evaluate the CORS response.',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'URLs to test' },
    { name: 'origin', type: 'string', notTarget: true, description: 'attacker origin to simulate (header value, not a target)', default: 'https://attacker.example' },
    { name: 'path', type: 'string', notTarget: true, description: 'API path to test', default: '/' },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const urls = (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls ?? '')])
      .map((u) => u.trim())
      .filter(Boolean);
    const origin = String(args.origin ?? 'https://attacker.example');
    const path = String(args.path ?? '/');
    type CorsVerdict = { preflightStatus: number; allowOrigin: string | null; allowCredentials: string | null; allowMethods: string | null; simpleGetStatus: number; simpleGetAllowOrigin: string | null; verdict: string };
    const results: Record<string, CorsVerdict> = {};
    const findings: NonNullable<ToolResult['findings']> = [];

    for (const base of urls) {
      const target = new URL(path, normalizeUrl(base)).toString();
      const preflight = await httpRequest(
        target,
        {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
          timeoutMs: 10_000,
        },
        ctx.signal,
      );
      const simple = await httpRequest(target, { headers: { origin }, timeoutMs: 10_000 }, ctx.signal);

      const acao = preflight.headers['access-control-allow-origin'];
      const credentials = preflight.headers['access-control-allow-credentials'];
      const reflected = acao === origin;
      const wildcard = acao === '*';
      const vuln = reflected && credentials?.toLowerCase() === 'true';

      results[target] = {
        preflightStatus: preflight.status,
        allowOrigin: acao ?? null,
        allowCredentials: credentials ?? null,
        allowMethods: preflight.headers['access-control-allow-methods'] ?? null,
        simpleGetStatus: simple.status,
        simpleGetAllowOrigin: simple.headers['access-control-allow-origin'] ?? null,
        verdict: vuln ? 'vulnerable' : wildcard ? 'wildcard' : 'not obviously exploitable',
      };
      ctx.emit(`${target}  ACAO=${acao ?? '-'}  ACAC=${credentials ?? '-'}  verdict=${results[target]?.verdict ?? 'unknown'}`);
      await sleep(100, ctx.signal);

      if (vuln) {
        findings.push({
          title: 'CORS reflects arbitrary origin with credentials allowed',
          severity: 'high',
          asset: target,
          description: `The API reflects the request Origin back in Access-Control-Allow-Origin and sets Access-Control-Allow-Credentials: true. Any website can therefore read authenticated responses for a logged-in user.`,
          evidence: `OPTIONS ${path} with Origin: ${origin}\nAccess-Control-Allow-Origin: ${acao}\nAccess-Control-Allow-Credentials: ${credentials}`,
          reproduction: `curl -i -X OPTIONS '${target}' -H 'Origin: ${origin}' -H 'Access-Control-Request-Method: POST'`,
          remediation: 'Never reflect the Origin value blindly. Maintain an allowlist of trusted origins and only send `Access-Control-Allow-Credentials: true` for those.',
          cwe: 'CWE-942',
          owasp: 'A05:2021 Security Misconfiguration',
        });
      }
    }

    return {
      ok: true,
      summary: `CORS tested on ${urls.length} URL(s), ${findings.length} issue(s)`,
      data: results,
      evidence: JSON.stringify(results, null, 2),
      ...(findings.length > 0 ? { findings } : {}),
    };
  },
};
