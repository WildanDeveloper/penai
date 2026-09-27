/**
 * Rule matching.
 *
 *   - ip/cidr rules match IP literals by network containment
 *   - host rules match names: exact, `*.example.com` wildcard, or bare suffix
 *   - url rules match scheme+host+port, and optionally a path prefix
 *   - deny rules always beat allow rules
 *
 * A URL that is not covered by a URL rule falls back to the rules for its host,
 * so a CIDR authorises `http://10.0.0.5:8080` without repeating the scheme.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DOMAIN, intToIpv4, ipv4ToInt } from './classify.js';
import type { MatchResult, ScopeRef, ScopeRule } from './classify.js';

function ipInCidr(ip: string, cidr: string): boolean {
  const [net, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(net ?? '');
  if (ipInt === undefined || netInt === undefined) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (netInt & mask) >>> 0;
}

function hostMatches(name: string, rule: string): boolean {
  const host = name.toLowerCase().replace(/\.$/, '');
  const r = rule.toLowerCase();
  if (r.startsWith('*.')) {
    const suffix = r.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === r;
}

function urlMatches(url: string, rule: string): boolean {
  let target: URL;
  let allowed: URL;
  try {
    target = new URL(url);
    allowed = new URL(rule);
  } catch {
    return false;
  }
  if (target.protocol !== allowed.protocol) return false;
  if (target.host !== allowed.host) return false;
  const prefix = allowed.pathname.replace(/\/$/, '');
  if (prefix === '') return true;
  return target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
}

/** Does one rule cover this hostname, ignoring path/port? */
function entryCoversHost(entry: ScopeRule, host: string): boolean {
  if (entry.kind === 'url') {
    try {
      return new URL(entry.value).hostname === host.toLowerCase();
    } catch {
      return false;
    }
  }
  if (isIP(host)) {
    return (entry.kind === 'cidr' || entry.kind === 'ip') && ipInCidr(host, entry.value);
  }
  return entry.kind === 'host' && hostMatches(host, entry.value);
}

export class Scope {
  readonly allow: ScopeRule[];
  readonly deny: string[];

  constructor(allow: readonly ScopeRule[] = [], deny: string[] = []) {
    this.allow = [...allow];
    this.deny = deny;
  }

  get empty(): boolean {
    return this.allow.length === 0;
  }

  /** Does this rule list contain the given literal (no DNS resolution)? */
  private matchLiteral(target: string): MatchResult {
    const kind: ScopeRef = isIP(target) ? 'ip' : DOMAIN.test(target) ? 'host' : 'host';

    for (const rule of this.deny) {
      if (rule === target || (kind === 'host' && hostMatches(target, rule))) {
        return { ok: false, reason: `explicitly denied by rule "${rule}"`, matchedBy: rule };
      }
      if (kind === 'ip' && /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(rule) && ipInCidr(target, rule)) {
        return { ok: false, reason: `denied by network rule "${rule}"`, matchedBy: rule };
      }
    }

    for (const entry of this.allow) {
      const value = entry.value;
      if (value === target) return { ok: true, reason: `exact match on "${value}"`, matchedBy: value };
      if (urlMatches(target, value)) return { ok: true, reason: `URL rule "${value}"`, matchedBy: value };
      if (kind === 'ip' && (entry.kind === 'cidr' || entry.kind === 'ip') && ipInCidr(target, value)) {
        return { ok: true, reason: `inside network "${value}"`, matchedBy: value };
      }
      if (kind === 'host' && entry.kind === 'host' && hostMatches(target, value)) {
        return { ok: true, reason: `host rule "${value}"`, matchedBy: value };
      }
      if (entry.kind === 'url') {
        try {
          const host = new URL(value).hostname;
          if (kind === 'host' && hostMatches(target, host)) {
            return { ok: true, reason: `host of URL rule "${value}"`, matchedBy: value };
          }
        } catch {
          /* ignore malformed stored rule */
        }
      }
    }
    return { ok: false, reason: `"${target}" is not covered by any authorised scope rule` };
  }

  /**
   * Authorisation check. Hostnames that are not covered by a host rule are
   * resolved and retried against IP/CIDR rules, so `10.0.0.5` in scope also
   * authorises `internal.lab` when it points there.
   */
  async check(target: string, opts: { resolve?: boolean } = {}): Promise<MatchResult> {
    const value = target.trim();
    if (!value) return { ok: false, reason: 'empty target' };

    if (isIP(value)) return this.matchLiteral(value);

    // A URL is authorised by either a URL-prefix rule (which also constrains the
    // path) or by a rule that covers its host — an IP, CIDR or hostname.
    if (/^https?:\/\//i.test(value)) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return { ok: false, reason: `not a valid URL: ${value}` };
      }
      for (const entry of this.allow) {
        if (entry.kind === 'url' && urlMatches(value, entry.value)) {
          return { ok: true, reason: `URL rule "${entry.value}"`, matchedBy: entry.value };
        }
      }
      // If the operator scoped this hostname *only* with URL rules, those rules
      // are the only thing that can authorise it — otherwise a path/port
      // restriction could be side-stepped by matching the bare host. A broader
      // IP/CIDR/host rule for the same host does still apply, because then the
      // operator authorised that host outright.
      const hostRules = this.allow.filter((entry) => entry.kind === 'url' && entryCoversHost(entry, url.hostname));
      if (hostRules.length > 0) {
        const broader = this.allow.some((entry) => entry.kind !== 'url' && entryCoversHost(entry, url.hostname));
        if (!broader) {
          return {
            ok: false,
            reason: `"${value}" is outside the URL scope rules for ${url.hostname} (${hostRules.map((r) => r.value).join(', ')})`,
          };
        }
      }
      const hostResult = await this.checkHost(url.hostname, opts);
      if (!hostResult.ok) return hostResult;
      return { ...hostResult, reason: `${hostResult.reason} (host of ${value})` };
    }

    return this.checkHost(value, opts);
  }

  private async checkHost(host: string, opts: { resolve?: boolean }): Promise<MatchResult> {
    const direct = this.matchLiteral(host);
    if (direct.ok) return direct;
    if (opts.resolve === false) return direct;

    let addresses: string[] = [];
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return { ...direct, reason: `${direct.reason} (and "${host}" does not resolve)` };
    }
    if (addresses.length === 0) return { ...direct, reason: `${direct.reason} (no addresses)` };

    for (const address of addresses) {
      const result = this.matchLiteral(address);
      if (!result.ok) {
        return { ok: false, reason: `resolves to out-of-scope ${address}: ${result.reason}` };
      }
    }
    return { ok: true, reason: `resolves to in-scope ${addresses.join(', ')}`, matchedBy: addresses[0] };
  }

  /** Check every value; returns the first failure, or a summary on success. */
  async checkAll(values: string[]): Promise<MatchResult> {
    if (values.length === 0) return { ok: false, reason: 'no target supplied' };
    const seen: string[] = [];
    for (const value of values) {
      const result = await this.check(value);
      if (!result.ok) return result;
      seen.push(result.reason);
    }
    return { ok: true, reason: seen.join('; ') };
  }

  /** CIDR expansion helper for scanners, capped for safety. */
  static expandCidr(cidr: string, cap = 65536): string[] {
    const [net, prefixRaw] = cidr.split('/');
    const prefix = Number(prefixRaw);
    const netInt = ipv4ToInt(net ?? '');
    if (netInt === undefined || !Number.isInteger(prefix)) return [];
    if (prefix < 16) return []; // refuse to enumerate /8-style ranges
    const size = 2 ** (32 - prefix);
    if (size > cap) return [];
    const out: string[] = [];
    for (let i = 0; i < size; i += 1) out.push(intToIpv4((netInt + i) >>> 0));
    return out;
  }
}
