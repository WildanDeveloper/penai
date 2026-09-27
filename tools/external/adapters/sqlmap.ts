/**
 * sqlmap adapter.
 *
 * SQL injection testing. Detection phase only; exfiltration options are blocked by policy.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const sqlmapTool: ExternalTool = {
  kind: 'external',
  bin: 'sqlmap',
  name: 'sqlmap',
  title: 'sqlmap injection testing',
  category: 'web',
  risk: 'high',
  description: 'sqlmap against an authorised parameter. Detection/risk phase only: --dump and shell options are blocked by policy.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'vulnerable-looking URL with a parameter' },
    { name: 'method', type: 'string', description: 'HTTP method', default: 'GET' },
    { name: 'data', type: 'string', notTarget: true, description: 'POST body' },
    { name: 'level', type: 'number', description: '1-3 test depth', default: 1 },
    { name: 'risk', type: 'number', description: '1-3 risk level', default: 1 },
    { name: 'batch', type: 'boolean', description: 'non-interactive batch mode', default: true },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 600 },
  ],
  build: (args) => {
    const argv = ['-u', normalizeUrl(String(args.url ?? ''))];
    const method = String(args.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && args.data) argv.push('--data', String(args.data));
    if (method !== 'GET') argv.push('--method', method);
    if (args.batch !== false) argv.push('--batch');
    argv.push('--level', String(clamp(asInt(args.level, 1), 1, 5)));
    argv.push('--risk', String(clamp(asInt(args.risk, 1), 1, 3)));
    return argv;
  },
  usage: 'sqlmap -u "https://host/page?id=1" --batch --level 1',
  summarize: (stdout) => {
    const interesting = lines(stdout).filter((l) => /is vulnerable|parameter .* seems|injectable|back-end|DBMS|payload|---\[/i.test(l));
    return { summary: `${interesting.length} significant sqlmap line(s)`, data: { lines: interesting.slice(0, 80) } };
  },
};
