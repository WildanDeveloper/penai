/**
 * nikto adapter.
 *
 * Legacy high-volume scanner. Noisy and slow; run dir_fuzz and header_audit first.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const niktoTool: ExternalTool = {
  kind: 'external',
  bin: 'nikto',
  name: 'nikto',
  title: 'nikto web scanner',
  category: 'web',
  risk: 'high',
  description: 'High-volume legacy web scanner. Noisy and slow; use dir_fuzz + header_audit first.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'target URL' },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 900 },
  ],
  build: (args) => ['-host', normalizeUrl(String(args.url ?? '')), '-nointeractive', '-Tuning', '1234bde'],
  usage: 'nikto -host https://target',
  summarize: (stdout) => {
    const rows = lines(stdout).filter((l) => /^\+/.test(l) || /\+ *$/.test(l));
    return { summary: `${rows.length} finding line(s)`, data: { findings: rows.slice(0, 100) } };
  },
};
