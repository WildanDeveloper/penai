/**
 * ffuf adapter.
 *
 * Content discovery and parameter fuzzing, with more options than the built-in dir_fuzz.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const ffuf: ExternalTool = {
  kind: 'external',
  bin: 'ffuf',
  name: 'ffuf',
  title: 'ffuf web fuzzing',
  category: 'web',
  risk: 'medium',
  description: 'Content discovery and parameter fuzzing with ffuf (more options than the built-in dir_fuzz).',
  args: [
    { name: 'url', type: 'string', required: true, description: 'target URL, use FUZZ where needed', example: 'https://host/FUZZ' },
    { name: 'wordlist', type: 'string', notTarget: true, description: 'wordlist path', default: '/usr/share/seclists/Discovery/Web-Content/common.txt' },
    { name: 'matchStatus', type: 'list', description: 'status codes to report', default: [200, 204, 301, 302, 307, 401, 403, 405, 500] },
    { name: 'rateLimit', type: 'number', description: 'requests per second', default: 20 },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 300 },
  ],
  build: (args) => {
    const argv = ['-w', String(args.wordlist ?? '/usr/share/seclists/Discovery/Web-Content/common.txt'), '-rate', String(clamp(asInt(args.rateLimit, 20), 1, 200)), '-s', '-noninteractive'];
    const match = Array.isArray(args.matchStatus) ? (args.matchStatus as number[]) : [String(args.matchStatus ?? '200')];
    for (const m of match) argv.push('-mc', String(m));
    argv.push('-u', normalizeUrl(String(args.url ?? '')));
    return argv;
  },
  usage: 'ffuf -w common.txt -u https://host/FUZZ -mc 200,301,403 -rate 20',
  summarize: (stdout) => {
    const rows = lines(stdout).filter((l) => /^\s*\S+.*(Status|size|words|lines)/i.test(l) || l.startsWith('/'));
    return { summary: `${rows.length} ffuf result line(s)`, data: { results: rows.slice(0, 200) } };
  },
};
