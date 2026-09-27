/**
 * Parsing an operator-supplied scope entry into a typed rule.
 *
 * Refuses anything that is not an IP, CIDR, hostname or http(s) URL, so a
 * scheme like file:// or gopher:// can never become an authorised target.
 */

import { isIP } from 'node:net';

export type ScopeRef = 'ip' | 'cidr' | 'host' | 'url';

/** A rule as stored in the engagement (or supplied ad hoc by the CLI). */
export interface ScopeRule {
  value: string;
  kind: ScopeRef;
}

export interface MatchResult {
  ok: boolean;
  reason: string;
  matchedBy?: string;
}

export const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function ipv4ToInt(ip: string): number | undefined {
  const m = IPV4.exec(ip);
  if (!m) return undefined;
  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(m[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** Unpack an integer back into dotted octets. */
export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

/** Classify a user supplied scope entry. Throws on garbage input. */
export function classifyTarget(value: string): { kind: ScopeRef; normalized: string } {
  const raw = value.trim();
  if (!raw) throw new Error('empty target');

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`unsupported scheme "${url.protocol}" — only http/https targets are allowed`);
    }
    return {
      kind: 'url',
      normalized: `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, ''),
    };
  }

  const slash = raw.indexOf('/');
  const head = slash === -1 ? raw : raw.slice(0, slash);

  if (slash !== -1) {
    const prefix = Number(raw.slice(slash + 1));
    if (head.includes(':')) throw new Error(`IPv6 CIDR is not supported: ${raw}`);
    if (!IPV4.test(head) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`invalid CIDR: ${raw}`);
    }
    return { kind: 'cidr', normalized: raw };
  }

  if (isIP(raw) === 4) {
    if (ipv4ToInt(raw) === undefined) throw new Error(`invalid IPv4: ${raw}`);
    return { kind: 'ip', normalized: raw };
  }
  // A dotted quad that is not a valid address gets a specific message rather
  // than the generic "cannot parse" — it is nearly always a typo in a scope.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) throw new Error(`invalid IPv4 address: ${raw}`);
  if (isIP(raw) === 6) return { kind: 'ip', normalized: raw.toLowerCase() };

  if (DOMAIN.test(raw) || raw.startsWith('*.')) {
    return { kind: 'host', normalized: raw.toLowerCase().replace(/^\*\*\./, '*.').replace(/^\*\.?/, '*.').replace(/\.$/, '') };
  }

  throw new Error(`cannot parse target "${raw}" — use an IP, CIDR, domain or http(s) URL`);
}
