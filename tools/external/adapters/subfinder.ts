/**
 * subfinder adapter.
 *
 * Passive subdomain enumeration from public sources.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const subfinderTool: ExternalTool = {
  kind: 'external',
  bin: 'subfinder',
  name: 'subfinder',
  title: 'subfinder subdomain enumeration',
  category: 'recon',
  risk: 'safe',
  description: 'Passive subdomain enumeration from dozens of public sources.',
  args: [
    { name: 'domain', type: 'string', required: true, description: 'apex domain' },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 300 },
  ],
  build: (args) => ['-d', String(args.domain ?? ''), '-silent', '-all'],
  usage: 'subfinder -d example.com -silent',
  summarize: (stdout) => {
    const rows = lines(stdout);
    return { summary: `${rows.length} subdomain(s)`, data: { subdomains: rows.slice(0, 500) } };
  },
};
