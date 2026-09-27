/**
 * Security header and cookie-flag audit.
 *
 * Compares the response against a hardening baseline and turns each gap into a
 * finding carrying the evidence needed to reproduce it.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK } from '../../internal/wordlist.js';
import { httpRequest } from './http.js';

export const headerAudit: BuiltinTool = {
  kind: 'builtin',
  name: 'header_audit',
  title: 'Security header audit',
  category: 'web',
  risk: 'safe',
  description: 'Check response headers against a hardening baseline and report each gap as a finding.',
  args: [{ name: 'urls', type: 'list', required: true, description: 'URLs to audit' }],
  async run(args, ctx): Promise<ToolResult> {
    const urls = (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls ?? '')])
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return { ok: false, summary: 'urls is required', data: {}, error: 'urls is required' };

    const report: Record<string, { status: number; present: string[]; missing: string[]; notes: string[] }> = {};
    const lines: string[] = [];
    const findings: NonNullable<ToolResult['findings']> = [];

    for (const url of urls) {
      const r = await httpRequest(url, { timeoutMs: 12_000, maxBytes: 8 * 1024 }, ctx.signal);
      if (r.status === 0) {
        report[url] = { status: 0, present: [], missing: [], notes: [r.error ?? 'unreachable'] };
        continue;
      }
      const present: string[] = [];
      const missing: string[] = [];
      const notes: string[] = [];

      for (const h of HEADERS_TO_CHECK) {
        if (r.headers[h] !== undefined) present.push(h);
      }
      for (const h of ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) {
        if (!present.includes(h)) missing.push(h);
      }

      if (r.server) notes.push(`server banner: ${r.server}`);
      if (r.headers['x-powered-by']) notes.push(`x-powered-by: ${r.headers['x-powered-by']}`);
      if (!r.headers['strict-transport-security'] && r.finalUrl.startsWith('https:')) {
        notes.push('HTTPS without HSTS');
      }
      for (const cookie of r.setCookie) {
        const lower = cookie.toLowerCase();
        if (!lower.includes('secure')) notes.push(`cookie without Secure: ${cookie.slice(0, 80)}`);
        if (!lower.includes('httponly')) notes.push(`cookie without HttpOnly: ${cookie.slice(0, 80)}`);
        if (!lower.includes('samesite')) notes.push(`cookie without SameSite: ${cookie.slice(0, 80)}`);
      }
      if (r.headers['access-control-allow-origin'] === '*') {
        notes.push('Access-Control-Allow-Origin: * (verify credentials not accepted)');
      }

      report[url] = { status: r.status, present, missing, notes };
      lines.push(`${r.finalUrl}  HTTP ${r.status}  missing=[${missing.join(', ')}]`);
      for (const n of notes) lines.push(`   ! ${n}`);

      if (missing.includes('strict-transport-security') && r.finalUrl.startsWith('https:')) {
        findings.push({
          title: 'Missing HSTS (Strict-Transport-Security) header',
          severity: 'low',
          asset: r.finalUrl,
          description: 'The HTTPS response does not send HSTS, so browsers can still be downgraded to plaintext on a first visit.',
          evidence: `HTTP ${r.status} headers: ${Object.keys(r.headers).join(', ') || '(none)'}`,
          reproduction: `curl -sSI ${r.finalUrl} | grep -i strict-transport-security`,
          remediation: 'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` once you are sure every subdomain is HTTPS-ready.',
          cwe: 'CWE-319',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }
      if (missing.includes('content-security-policy')) {
        findings.push({
          title: 'Missing Content-Security-Policy header',
          severity: 'low',
          asset: r.finalUrl,
          description: 'No CSP is set, so there is no browser-side mitigation for content injection issues.',
          evidence: `HTTP ${r.status} response headers contain no content-security-policy`,
          reproduction: `curl -sSI ${r.finalUrl} | grep -i content-security-policy`,
          remediation: 'Deploy a CSP starting from report-only mode, then enforce it.',
          cwe: 'CWE-1021',
          owasp: 'A05:2021 Security Misconfiguration',
        });
      }
      if (missing.includes('x-frame-options') && !(r.headers['content-security-policy'] ?? '').includes('frame-ancestors')) {
        findings.push({
          title: 'Missing clickjacking protection',
          severity: 'low',
          asset: r.finalUrl,
          description: 'Neither X-Frame-Options nor CSP frame-ancestors is set, so the page can be framed by a third party.',
          evidence: `HTTP ${r.status} response headers contain no x-frame-options and no frame-ancestors directive`,
          reproduction: `curl -sSI ${r.finalUrl} | grep -i -E 'x-frame-options|frame-ancestors'`,
          remediation: 'Set `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors \'none\'`.',
          cwe: 'CWE-1021',
          owasp: 'A05:2021 Security Misconfiguration',
        });
      }
      if (missing.includes('x-content-type-options')) {
        findings.push({
          title: 'Missing X-Content-Type-Options header',
          severity: 'info',
          asset: r.finalUrl,
          description: 'Without nosniff the browser may MIME-sniff responses, which can turn an upload into script execution.',
          evidence: `HTTP ${r.status} response headers contain no x-content-type-options`,
          reproduction: `curl -sSI ${r.finalUrl} | grep -i x-content-type-options`,
          remediation: 'Add `X-Content-Type-Options: nosniff` globally.',
          cwe: 'CWE-16',
          owasp: 'A05:2021 Security Misconfiguration',
        });
      }
      for (const cookie of r.setCookie) {
        const lower = cookie.toLowerCase();
        if (lower.includes('httponly') === false) {
          findings.push({
            title: 'Session cookie without HttpOnly',
            severity: 'medium',
            asset: r.finalUrl,
            description: 'A cookie is set without HttpOnly, so client-side script can read it, raising the impact of any XSS.',
            evidence: `Set-Cookie: ${cookie}`,
            reproduction: `curl -sSI ${r.finalUrl} | grep -i set-cookie`,
            remediation: 'Add `HttpOnly; Secure; SameSite=Lax` to session cookies.',
            cwe: 'CWE-1004',
            owasp: 'A05:2021 Security Misconfiguration',
          });
          break;
        }
      }
      if (r.headers['x-powered-by']) {
        findings.push({
          title: 'Technology disclosed via X-Powered-By',
          severity: 'info',
          asset: r.finalUrl,
          description: 'The stack in use is advertised in a response header, which removes guesswork for an attacker.',
          evidence: `X-Powered-By: ${r.headers['x-powered-by']}`,
          reproduction: `curl -sSI ${r.finalUrl} | grep -i x-powered-by`,
          remediation: 'Remove or replace the header at the web server or application layer.',
          cwe: 'CWE-200',
          owasp: 'A05:2021 Security Misconfiguration',
        });
      }
    }

    return {
      ok: true,
      summary: `audited ${Object.keys(report).length} URL(s), ${findings.length} header finding(s)`,
      data: report,
      evidence: lines.join('\n'),
      ...(findings.length > 0 ? { findings } : {}),
    };
  },
};
