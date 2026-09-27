/**
 * nmap adapter.
 *
 * Full-featured port and service scan. Prefer the built-in tcp_scan for quick checks.
 *
 * The argument list is built here rather than by the model, so an invalid flag
 * cannot be invented, and stdout is summarised before it reaches the model.
 */

import type { ExternalTool } from '../../../model/index.js';
import { asInt, clamp, normalizeUrl, topPorts } from '../../../internal/util.js';
import { lines } from '../exec.js';

export const nmap: ExternalTool = {
  kind: 'external',
  bin: 'nmap',
  name: 'nmap',
  title: 'nmap service/version scan',
  category: 'network',
  risk: 'low',
  description: 'Full-featured port and service scan when nmap is installed. Prefer tcp_scan for quick checks.',
  args: [
    { name: 'targets', type: 'list', required: true, description: 'hosts or CIDRs' },
    { name: 'ports', type: 'string', description: 'port spec', default: topPorts(1000) },
    { name: 'serviceDetection', type: 'boolean', description: '-sV version probing', default: true },
    { name: 'timing', type: 'string', description: '-T template 0-5', default: '3' },
    { name: 'timeoutSec', type: 'number', description: 'overall timeout', default: 300 },
  ],
  build: (args) => {
    const argv = ['-n', '-Pn', '-T', String(args.timing ?? '3')];
    if (args.serviceDetection !== false) argv.push('-sV');
    argv.push('-p', String(args.ports ?? topPorts(1000)));
    argv.push(...(Array.isArray(args.targets) ? (args.targets as string[]) : [String(args.targets)]));
    return argv;
  },
  usage: 'nmap -sV -p 1-1000 <target>  (host/service enumeration; -sC and NSE are blocked by policy)',
  summarize: (stdout) => {
    const hosts = lines(stdout).filter((l) => /^(Nmap scan report|Host is up|Host:)/.test(l));
    const ports = lines(stdout).filter((l) => /^\d+\/tcp|^\d+\/udp/.test(l));
    const extra = lines(stdout).filter((l) => /^(OS details|Service Info|Host script results)/.test(l));
    return {
      summary: `${hosts.length} host line(s), ${ports.length} open port line(s)`,
      data: { hosts, ports, extra: extra.slice(0, 50) },
    };
  },
};
