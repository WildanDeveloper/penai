/**
 * TLS handshake probe.
 *
 * `rejectUnauthorized` is off on purpose: the point of the audit is to observe
 * what a client would be told, including when that answer is "do not trust me".
 */

import tls from 'node:tls';
import net from 'node:net';

export const PROTOCOLS = ['TLSv1.3', 'TLSv1.2', 'TLSv1.1', 'TLSv1', 'SSLv3'];

export const WEAK_CIPHER = /(RC4|DES|MD5|EXPORT|NULL|anon|PSK$|IDEA|SEED)/i;

export interface TlsResult {
  host: string;
  port: number;
  ok: boolean;
  protocol?: string;
  cipher?: string;
  authorized?: boolean;
  authorizationError?: string;
  cert?: {
    subject?: Record<string, string>;
    issuer?: Record<string, string>;
    validFrom?: string;
    validTo?: string;
    subjectAltName?: string;
    serialNumber?: string;
    fingerprint256?: string;
  };
  daysToExpiry?: number;
  error?: string;
}

export function probe(host: string, port: number, timeoutMs: number, protocol?: string): Promise<TlsResult> {
  return new Promise((resolve) => {
    const options: tls.ConnectionOptions = {
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      ...(protocol ? { minVersion: protocol as tls.SecureVersion, maxVersion: protocol as tls.SecureVersion } : {}),
    };
    const socket = tls.connect(options, () => {
      const cipher = socket.getCipher();
      const cert = socket.getPeerCertificate(false);
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : undefined;
      const validFrom = cert?.valid_from ? new Date(cert.valid_from) : undefined;
      const result: TlsResult = {
        host,
        port,
        ok: true,
        protocol: socket.getProtocol() ?? undefined,
        cipher: cipher ? `${cipher.name} (${cipher.version})` : undefined,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        ...(cert && Object.keys(cert).length > 0
          ? {
              cert: {
                subject: cert.subject as Record<string, string>,
                issuer: cert.issuer as Record<string, string>,
                validFrom: validFrom?.toISOString(),
                validTo: validTo?.toISOString(),
                subjectAltName: cert.subjectaltname,
                serialNumber: cert.serialNumber,
                fingerprint256: cert.fingerprint256,
              },
            }
          : {}),
        ...(validTo ? { daysToExpiry: Math.round((validTo.getTime() - Date.now()) / 86_400_000) } : {}),
      };
      socket.end();
      resolve(result);
    });
    socket.once('error', (error) => resolve({ host, port, ok: false, error: String(error.message ?? error) }));
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ host, port, ok: false, error: 'timeout' });
    });
  });
}
