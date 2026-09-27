/**
 * TLS/SSL posture audit: negotiated protocol, cipher and certificate, with every
 * weakness reported as a finding.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { asInt, clamp } from '../../internal/util.js';
import { PROTOCOLS, WEAK_CIPHER, probe } from './probe.js';
import type { TlsResult } from './probe.js';

export const tlsAudit: BuiltinTool = {
  kind: 'builtin',
  name: 'tls_audit',
  title: 'TLS/SSL posture audit',
  category: 'tls',
  risk: 'safe',
  description:
    'Check negotiated protocol, cipher and certificate (expiry, SAN, hostname match) for each host, and report weaknesses as findings.',
  args: [
    { name: 'hosts', type: 'list', required: true, description: 'hostnames or IP:port entries' },
    { name: 'port', type: 'number', description: 'TLS port (default 443)', default: 443 },
    { name: 'checkOldProtocols', type: 'boolean', description: 'also try TLS 1.0/1.1 and SSLv3', default: true },
    { name: 'timeoutMs', type: 'number', description: 'per probe timeout', default: 8000 },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const raw = (Array.isArray(args.hosts) ? (args.hosts as string[]) : [String(args.hosts ?? '')])
      .map((h) => String(h).trim())
      .filter(Boolean);
    if (raw.length === 0) return { ok: false, summary: 'hosts is required', data: {}, error: 'hosts is required' };
    const defaultPort = clamp(asInt(args.port, 443), 1, 65535);
    const timeoutMs = clamp(asInt(args.timeoutMs, 8000), 500, 30_000);
    const checkOld = args.checkOldProtocols !== false;

    const targets = raw.map((entry) => {
      const m = /^(.+):(\d{2,5})$/.exec(entry);
      return m ? { host: m[1]!, port: Number(m[2]) } : { host: entry, port: defaultPort };
    });

    const results: TlsResult[] = [];
    const findings: NonNullable<ToolResult['findings']> = [];
    const lines: string[] = [];

    for (const t of targets) {
      if (ctx.signal.aborted) break;
      const main = await probe(t.host, t.port, timeoutMs);
      results.push(main);

      if (!main.ok) {
        lines.push(`${t.host}:${t.port}  TLS FAILED  ${main.error}`);
        continue;
      }
      const label = `${t.host}:${t.port}`;
      lines.push(
        `${label}  ${main.protocol}  ${main.cipher}  cert CN=${main.cert?.subject?.CN ?? '?'}  expires=${main.cert?.validTo ?? '?'} (${main.daysToExpiry ?? '?'}d)`,
      );
      if (main.authorized === false) {
        lines.push(`   ! hostname/chain verification failed: ${main.authorizationError}`);
        findings.push({
          title: 'TLS certificate fails verification',
          severity: 'medium',
          asset: label,
          description: `The certificate does not validate: ${main.authorizationError}. Visitors are exposed to interception unless they click through a warning.`,
          evidence: `protocol=${main.protocol}\ncipher=${main.cipher}\nsubject=${JSON.stringify(main.cert?.subject ?? {})}\nissuer=${JSON.stringify(main.cert?.issuer ?? {})}\nerror=${main.authorizationError}`,
          reproduction: `openssl s_client -connect ${label} -servername ${t.host} </dev/null`,
          remediation: 'Install a certificate from a trusted CA that covers the exact hostname, with the full intermediate chain served.',
          cwe: 'CWE-295',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }
      if (main.daysToExpiry !== undefined && main.daysToExpiry < 0) {
        findings.push({
          title: 'TLS certificate expired',
          severity: 'high',
          asset: label,
          description: `The certificate expired ${Math.abs(main.daysToExpiry)} day(s) ago.`,
          evidence: `validTo=${main.cert?.validTo}\nCN=${main.cert?.subject?.CN ?? '?'}\nissuer=${main.cert?.issuer?.O ?? '?'}`,
          reproduction: `echo | openssl s_client -connect ${label} 2>/dev/null | openssl x509 -noout -dates`,
          remediation: 'Renew the certificate and automate renewal so this cannot recur.',
          cwe: 'CWE-324',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      } else if (main.daysToExpiry !== undefined && main.daysToExpiry < 21) {
        findings.push({
          title: 'TLS certificate expiring soon',
          severity: 'low',
          asset: label,
          description: `The certificate expires in ${main.daysToExpiry} day(s).`,
          evidence: `validTo=${main.cert?.validTo}`,
          reproduction: `echo | openssl s_client -connect ${label} 2>/dev/null | openssl x509 -noout -dates`,
          remediation: 'Renew before expiry and add automated expiry monitoring.',
          cwe: 'CWE-324',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }
      if (main.cipher && WEAK_CIPHER.test(main.cipher)) {
        findings.push({
          title: 'Weak TLS cipher negotiated',
          severity: 'medium',
          asset: label,
          description: `The server negotiated a cipher that is considered broken: ${main.cipher}.`,
          evidence: `protocol=${main.protocol}\ncipher=${main.cipher}`,
          reproduction: `nmap --script ssl-enum-ciphers -p ${t.port} ${t.host}`,
          remediation: 'Restrict the server to TLS 1.2/1.3 with AEAD suites (ECDHE + AES-GCM/ChaCha20-Poly1305).',
          cwe: 'CWE-327',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }
      if (main.protocol && ['TLSv1', 'TLSv1.1', 'SSLv3'].includes(main.protocol)) {
        findings.push({
          title: `Legacy protocol accepted: ${main.protocol}`,
          severity: 'medium',
          asset: label,
          description: `The server still accepts ${main.protocol}, which has known weaknesses (BEAST/POODLE class attacks).`,
          evidence: `negotiated=${main.protocol}`,
          reproduction: `openssl s_client -connect ${label} -${main.protocol.toLowerCase()} </dev/null`,
          remediation: 'Disable everything below TLS 1.2 (preferably require TLS 1.3).',
          cwe: 'CWE-327',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }
      const san = main.cert?.subjectAltName;
      if (!san) {
        findings.push({
          title: 'Certificate has no Subject Alternative Name',
          severity: 'low',
          asset: label,
          description: 'The certificate carries no SAN extension, so modern clients reject it outright.',
          evidence: `subject=${JSON.stringify(main.cert?.subject ?? {})}`,
          reproduction: `echo | openssl s_client -connect ${label} 2>/dev/null | openssl x509 -noout -ext subjectAltName`,
          remediation: 'Reissue the certificate with SANs for every hostname that must be served.',
          cwe: 'CWE-295',
          owasp: 'A02:2021 Cryptographic Failures',
        });
      }

      if (checkOld) {
        for (const proto of ['TLSv1', 'SSLv3']) {
          if (ctx.signal.aborted) break;
          const old = await probe(t.host, t.port, Math.min(timeoutMs, 5000), proto);
          if (old.ok) {
            lines.push(`   ! accepted legacy protocol ${proto}`);
            findings.push({
              title: `Server accepts ${proto}`,
              severity: proto === 'SSLv3' ? 'high' : 'medium',
              asset: label,
              description: `A handshake completed using ${proto}, which is deprecated and has practical attacks.`,
              evidence: `forced protocol=${proto} -> negotiated=${old.protocol} cipher=${old.cipher}`,
              reproduction: `openssl s_client -connect ${label} -${proto.toLowerCase()} </dev/null`,
              remediation: 'Disable SSLv3 and TLS 1.0/1.1 server-side.',
              cwe: 'CWE-327',
              owasp: 'A02:2021 Cryptographic Failures',
            });
          }
        }
      }
    }

    return {
      ok: results.some((r) => r.ok),
      summary: `${results.filter((r) => r.ok).length}/${results.length} host(s) speak TLS, ${findings.length} issue(s)`,
      data: { results, protocolsSupported: PROTOCOLS },
      evidence: lines.join('\n'),
      ...(findings.length > 0 ? { findings } : {}),
    };
  },
};
