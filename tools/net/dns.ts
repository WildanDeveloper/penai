/**
 * DNS record resolution and reverse lookups.
 */

import dns from 'node:dns/promises';
import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { asInt, clamp, sleep } from '../../internal/util.js';

export const dnsResolve: BuiltinTool = {
  kind: 'builtin',
  name: 'dns_resolve',
  title: 'DNS record resolution',
  category: 'recon',
  risk: 'safe',
  description: 'Resolve A/AAAA/MX/NS/TXT/CNAME records for authorised hosts.',
  args: [
    { name: 'hosts', type: 'list', required: true, description: 'hostnames to resolve', example: 'app.example.com' },
    { name: 'types', type: 'list', description: 'record types', default: ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'] },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const hosts = (Array.isArray(args.hosts) ? (args.hosts as string[]) : [String(args.hosts ?? '')])
      .map((h) => h.trim())
      .filter(Boolean);
    const types = (Array.isArray(args.types) ? (args.types as string[]) : ['A']).map((t) => String(t).toUpperCase());
    if (hosts.length === 0) return { ok: false, summary: 'no hosts', data: {}, error: 'hosts is required' };

    const out: Record<string, Record<string, string[]>> = {};
    const lines: string[] = [];
    for (const host of hosts) {
      if (ctx.signal.aborted) break;
      out[host] = {};
      for (const type of types) {
        try {
          let values: string[] = [];
          switch (type) {
            case 'A':
              values = (await dns.resolve4(host)).map((v) => v);
              break;
            case 'AAAA':
              values = (await dns.resolve6(host)).map((v) => v);
              break;
            case 'MX':
              values = (await dns.resolveMx(host)).map((v) => `${v.priority} ${v.exchange}`);
              break;
            case 'NS':
              values = (await dns.resolveNs(host)).map((v) => v);
              break;
            case 'TXT':
              values = (await dns.resolveTxt(host)).map((v) => v.join(''));
              break;
            case 'CNAME':
              values = await dns.resolveCname(host);
              break;
            case 'PTR':
              values = (await dns.reverse(host)).map((v) => v);
              break;
            default:
              continue;
          }
          if (values.length > 0) {
            out[host]![type] = values;
            lines.push(`${host} ${type}: ${values.join(', ').slice(0, 400)}`);
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? '';
          if (code !== 'ENOTFOUND' && code !== 'ENODATA' && code !== 'ESERVFAIL') {
            lines.push(`${host} ${type}: ERROR ${code || String(error)}`);
          }
        }
        await sleep(60, ctx.signal);
      }
    }
    return { ok: true, summary: `resolved ${hosts.length} host(s)`, data: out, evidence: lines.join('\n') || 'no records' };
  },
};
