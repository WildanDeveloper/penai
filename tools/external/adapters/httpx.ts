/**
 * httpx adapter.
 *
 * ProjectDiscovery httpx: fast HTTP probing with title, tech and status detection.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const httpxProbe: ExternalTool = {
  kind: 'external',
  bin: 'httpx',
  name: 'httpx',
  title: 'httpx web probing',
  category: 'web',
  risk: 'safe',
  description: 'ProjectDiscovery httpx: fast HTTP probing with title, tech and status detection.',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'URLs or hosts' },
    { name: 'threads', type: 'number', description: 'parallel threads', default: 25 },
    { name: 'probe', type: 'boolean', description: 'probe for live HTTP on bare hosts', default: true },
  ],
  build: (args) => {
    const argv = ['-silent', '-threads', String(clamp(asInt(args.threads, 25), 1, 150)), '-title', '-tech-detect', '-status-code', '-follow-redirects'];
    if (args.probe !== false) argv.push('-probe');
    argv.push('-l', (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls)]).map(normalizeUrl).join('\n'));
    return argv;
  },
  usage: 'httpx -l urls.txt -title -tech-detect -status-code',
  summarize: (stdout) => {
    const rows = lines(stdout);
    return { summary: `${rows.length} live web service(s)`, data: { results: rows.slice(0, 200) } };
  },
};
