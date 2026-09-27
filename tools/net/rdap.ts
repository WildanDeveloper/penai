/**
 * Registration data over the public RDAP service.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';

export const rdapLookup: BuiltinTool = {
  kind: 'builtin',
  name: 'rdap_lookup',
  title: 'RDAP registration lookup',
  category: 'recon',
  risk: 'safe',
  description: 'Domain/IP registration data via the public RDAP service. Passive.',
  args: [{ name: 'domain', type: 'string', required: true, description: 'domain or IP to look up', example: 'example.com' }],
  async run(args, ctx): Promise<ToolResult> {
    const domain = String(args.domain ?? '').trim().toLowerCase();
    if (!domain) return { ok: false, summary: 'domain is required', data: {}, error: 'domain is required' };
    const path = /^\d{1,3}(\.\d{1,3}){3}$/.test(domain) ? `ip/${domain}` : `domain/${domain}`;
    try {
      const res = await fetch(`https://rdap.org/${path}`, {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/rdap+json', 'user-agent': 'penai/0.1 (authorized assessment)' },
        redirect: 'follow',
      });
      if (!res.ok) return { ok: false, summary: `rdap.org returned ${res.status}`, data: {}, error: `HTTP ${res.status}` };
      const json = (await res.json()) as Record<string, unknown>;
      const events = (json.events ?? []) as { eventAction?: string; eventDate?: string }[];
      const entities = (json.entities ?? []) as { roles?: string[]; vcardArray?: unknown }[];
      const summary = {
        handle: json.handle,
        name: json.ldhName ?? json.unicodeName,
        type: json.type,
        status: json.status,
        registered: events.find((e) => e.eventAction === 'registration')?.eventDate,
        expires: events.find((e) => e.eventAction === 'expiration')?.eventDate,
        updated: events.find((e) => e.eventAction === 'last changed')?.eventDate,
        nameservers: (((json.nameservers ?? []) as { ldhName?: string }[]) ?? []).map((n) => n.ldhName).filter(Boolean),
        roles: entities.flatMap((e) => e.roles ?? []),
      };
      return { ok: true, summary: `RDAP record for ${domain}`, data: summary, evidence: JSON.stringify(summary, null, 2) };
    } catch (error) {
      return { ok: false, summary: 'rdap lookup failed', data: {}, error: String(error) };
    }
  },
};
