/**
 * Passive reconnaissance that never touches the target: certificate transparency
 * (crt.sh) and historical URLs (Wayback CDX).
 *
 * One outbound request each, both to third parties, so these are safe to run
 * before anything else.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { asBool, asInt, clamp } from '../../internal/util.js';

export const crtshEnumerate: BuiltinTool = {
  kind: 'builtin',
  name: 'ct_subdomains',
  title: 'Certificate Transparency subdomain enumeration',
  category: 'recon',
  risk: 'safe',
  description:
    'Passive subdomain discovery from crt.sh. One HTTPS request per domain, no traffic to the target.',
  args: [
    { name: 'domain', type: 'string', required: true, description: 'apex domain', example: 'example.com' },
    { name: 'limit', type: 'number', description: 'max subdomains to return', default: 100 },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const domain = String(args.domain ?? '').trim().toLowerCase();
    const limit = clamp(asInt(args.limit, 100), 1, 2000);
    if (!domain) return { ok: false, summary: 'domain is required', data: {}, error: 'domain is required' };

    ctx.emit(`querying crt.sh for %.${domain} (1 passive request)`);
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
    let payload: unknown;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { 'user-agent': 'penai/0.1 (authorized assessment)' } });
      if (!res.ok) return { ok: false, summary: `crt.sh returned ${res.status}`, data: {}, error: `HTTP ${res.status}` };
      payload = await res.json();
    } catch (error) {
      return { ok: false, summary: 'crt.sh unreachable', data: {}, error: String(error) };
    }

    const names = new Set<string>();
    if (Array.isArray(payload)) {
      for (const entry of payload as { name_value?: string }[]) {
        for (const part of (entry.name_value ?? '').split('\n')) {
          const name = part.trim().toLowerCase().replace(/^\*\.?/, '');
          if (name.endsWith(domain)) names.add(name);
        }
      }
    }
    const list = [...names].sort().slice(0, limit);
    ctx.emit(`found ${names.size} unique name(s) in certificate logs`);
    return {
      ok: true,
      summary: `${list.length} subdomain name(s) from certificate transparency logs`,
      data: {
        domain,
        subdomains: list,
        total: names.size,
        note: 'Every name must still pass the scope check before it is probed.',
      },
      evidence: list.join('\n') || 'no names found',
    };
  },
};

export const httpHistory: BuiltinTool = {
  kind: 'builtin',
  name: 'wayback_urls',
  title: 'Historical URL lookup (Wayback CDX)',
  category: 'recon',
  risk: 'safe',
  description: 'Query the Wayback Machine CDX API for previously seen URLs of an authorised host.',
  args: [
    { name: 'domain', type: 'string', required: true, description: 'domain or host' },
    { name: 'limit', type: 'number', description: 'max URLs', default: 60 },
    { name: 'includeQuery', type: 'boolean', description: 'keep URLs with query strings', default: true },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const domain = String(args.domain ?? '').trim().toLowerCase();
    const limit = clamp(asInt(args.limit, 60), 1, 500);
    if (!domain) return { ok: false, summary: 'domain is required', data: {}, error: 'domain is required' };
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*&output=json&collapse=urlkey&limit=${limit}${asBool(args.includeQuery, true) ? '' : '&filter=original:.*[^?]$'}`;
    ctx.emit(`querying wayback CDX for ${domain}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'penai/0.1' } });
      if (!res.ok) return { ok: false, summary: `CDX returned ${res.status}`, data: {}, error: `HTTP ${res.status}` };
      const rows = (await res.json()) as string[][];
      const urls = rows.slice(1).map((r) => r[1]).filter(Boolean);
      const withParams = urls.filter((u): boolean => typeof u === 'string' && u.includes('?'));
      return {
        ok: true,
        summary: `${urls.length} historical URL(s), ${withParams.length} with query parameters`,
        data: { domain, urls: urls.slice(0, limit), withParams: withParams.slice(0, 50) },
        evidence: urls.slice(0, 100).join('\n'),
      };
    } catch (error) {
      return { ok: false, summary: 'wayback lookup failed', data: {}, error: String(error) };
    }
  },
};
