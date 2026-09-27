/**
 * katana adapter.
 *
 * JS-aware crawler that finds endpoints hidden in client-side code.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const katana: ExternalTool = {
  kind: 'external',
  bin: 'katana',
  name: 'katana',
  title: 'katana crawler',
  category: 'web',
  risk: 'safe',
  description: 'Fast JS-aware crawler that finds endpoints hidden in client-side code.',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'targets' },
    { name: 'depth', type: 'number', description: 'crawl depth', default: 3 },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 300 },
  ],
  build: (args) => ['-silent', '-depth', String(clamp(asInt(args.depth, 3), 1, 10)), '-u', (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls)]).map(normalizeUrl).join(',')],
  usage: 'katana -u https://host -depth 3',
  summarize: (stdout) => {
    const rows = lines(stdout);
    const params = rows.filter((l) => l.includes('?') || l.includes('='));
    return { summary: `${rows.length} URL(s), ${params.length} with parameters`, data: { urls: rows.slice(0, 200), withParams: params.slice(0, 100) } };
  },
};
