/**
 * CIDR expansion: turns a network into an explicit, auditable host list.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { Scope } from '../../scope/index.js';
import { asInt, clamp } from '../../internal/util.js';

export const expandCidr: BuiltinTool = {
  kind: 'builtin',
  name: 'expand_cidr',
  title: 'Expand CIDR to host list',
  category: 'analysis',
  risk: 'safe',
  description: 'Turn a CIDR into an explicit host list (capped) so results are auditable.',
  args: [
    { name: 'cidr', type: 'string', required: true, description: 'network, e.g. 10.10.16.0/28' },
    { name: 'cap', type: 'number', description: 'max hosts', default: 1024 },
  ],
  async run(args): Promise<ToolResult> {
    const cidr = String(args.cidr ?? '').trim();
    const cap = clamp(asInt(args.cap, 1024), 1, 65536);
    const hosts = Scope.expandCidr(cidr, cap);
    if (hosts.length === 0) {
      return { ok: false, summary: `refusing to expand ${cidr} (too large or invalid)`, data: {}, error: 'invalid or too large' };
    }
    return { ok: true, summary: `${hosts.length} host(s) in ${cidr}`, data: { cidr, hosts }, evidence: hosts.join('\n') };
  },
};
