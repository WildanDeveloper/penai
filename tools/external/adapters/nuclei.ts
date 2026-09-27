/**
 * nuclei adapter.
 *
 * Template-based scanning. High request volume, so severity filters matter.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const nucleiScan: ExternalTool = {
  kind: 'external',
  bin: 'nuclei',
  name: 'nuclei',
  title: 'nuclei template scan',
  category: 'web',
  risk: 'medium',
  description: 'Run ProjectDiscovery nuclei templates. High request volume — use severity filters.',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'targets' },
    { name: 'severity', type: 'list', description: 'severities to run', default: ['info', 'low', 'medium', 'high', 'critical'] },
    { name: 'rateLimit', type: 'number', description: 'requests per second', default: 20 },
    { name: 'templates', type: 'list', notTarget: true, description: 'template paths or tags' },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 600 },
  ],
  build: (args) => {
    const argv = ['-silent', '-rate-limit', String(clamp(asInt(args.rateLimit, 20), 1, 500)), '-jsonl'];
    const sev = Array.isArray(args.severity) ? (args.severity as string[]) : [String(args.severity ?? 'info')];
    for (const s of sev) argv.push('-severity', s);
    for (const t of Array.isArray(args.templates) ? (args.templates as string[]) : []) argv.push('-t', t);
    argv.push('-l', (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls)]).map(normalizeUrl).join('\n'));
    return argv;
  },
  usage: 'nuclei -severity high,critical -l targets.txt',
  summarize: (stdout) => {
    const parsed: unknown[] = [];
    for (const line of lines(stdout)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        /* non-JSON line */
      }
    }
    const bySeverity: Record<string, number> = {};
    for (const item of parsed) {
      const sev = String((item as { info?: { severity?: string } }).info?.severity ?? 'unknown');
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }
    return {
      summary: `${parsed.length} nuclei match(es) ${JSON.stringify(bySeverity)}`,
      data: { bySeverity, matches: parsed.slice(0, 50) },
    };
  },
};
