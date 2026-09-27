/**
 * TCP connect port scan.
 *
 * SYN-less on purpose: no raw sockets, no spoofing, and it degrades gracefully
 * where raw packets are not permitted. Slower than a SYN scan, and it appears in
 * target logs.
 */

import net from 'node:net';
import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { classifyTarget } from '../../scope/index.js';
import { Scope } from '../../scope/index.js';
import { asBool, asInt, clamp, mapLimit, parsePorts, topPorts } from '../../internal/util.js';
import { COMMON_SERVICES, RISKY_SERVICES, fingerprint } from './services.js';
import { connectBanner } from './connect.js';
import type { BannerResult } from './services-types.js';

export const tcpScan: BuiltinTool = {
  kind: 'builtin',
  name: 'tcp_scan',
  title: 'TCP connect port scan',
  category: 'network',
  risk: 'low',
  description:
    'Connect to each host:port pair with a plain TCP handshake. Safe (SYN-less, no spoofing), slower than a SYN scan, and visible in target logs.',
  args: [
    { name: 'targets', type: 'list', required: true, description: 'hosts, IPs or CIDRs', example: '10.10.16.27' },
    { name: 'ports', type: 'string', description: 'port spec, e.g. 1-1024,443,8080', default: topPorts(200) },
    { name: 'timeoutMs', type: 'number', description: 'per-connection timeout', default: 1500 },
    { name: 'concurrency', type: 'number', description: 'parallel sockets', default: 100 },
    { name: 'banner', type: 'boolean', description: 'grab service banners on open ports', default: false },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const rawTargets = Array.isArray(args.targets) ? (args.targets as string[]) : [String(args.targets ?? '')];
    const timeoutMs = clamp(asInt(args.timeoutMs, 1500), 100, 30_000);
    const concurrency = clamp(asInt(args.concurrency, 100), 1, 512);
    const wantBanner = asBool(args.banner, false);
    const { ports, invalid } = parsePorts(String(args.ports ?? topPorts(200)));

    if (invalid.length > 0) ctx.emit(`! ignoring invalid port spec(s): ${invalid.join(', ')}`);
    if (ports.length === 0) return { ok: false, summary: 'no valid ports in spec', data: { invalid }, error: 'invalid port spec' };

    const hosts: string[] = [];
    for (const raw of rawTargets) {
      const value = raw.trim();
      if (!value) continue;
      try {
        const parsed = classifyTarget(value);
        if (parsed.kind === 'cidr') {
          const expanded = Scope.expandCidr(value, 4096);
          if (expanded.length === 0) {
            ctx.emit(`! skipping ${value}: range too large (cap 4096 hosts)`);
            continue;
          }
          hosts.push(...expanded);
        } else {
          hosts.push(value);
        }
      } catch (error) {
        ctx.emit(`! skipping "${value}": ${String(error)}`);
      }
    }
    if (hosts.length === 0) return { ok: false, summary: 'no usable targets', data: {}, error: 'no usable targets' };

    const pairs = hosts.flatMap((host) => ports.map((port) => ({ host, port })));
    ctx.emit(`scanning ${hosts.length} host(s) x ${ports.length} port(s) = ${pairs.length} probes (timeout ${timeoutMs}ms)`);

    let openCount = 0;
    const results = await mapLimit(
      pairs,
      concurrency,
      async ({ host, port }) => {
        if (ctx.signal.aborted) return undefined;
        const banner = wantBanner
          ? await connectBanner(host, port, Math.min(timeoutMs, 3000), port === 80 ? 'HEAD / HTTP/1.0\r\n\r\n' : undefined, ctx.signal)
          : undefined;
        if (banner === undefined && !wantBanner) {
          // reachability probe only
          const reachable = await new Promise<boolean>((resolve) => {
            const socket = new net.Socket();
            const finish = (value: boolean): void => {
              socket.destroy();
              resolve(value);
            };
            socket.setTimeout(timeoutMs);
            socket.once('connect', () => finish(true));
            socket.once('timeout', () => finish(false));
            socket.once('error', () => finish(false));
            socket.connect(port, host);
          });
          if (!reachable) return undefined;
        }
        openCount += 1;
        return { host, port, service: fingerprint(banner, port) ?? COMMON_SERVICES[port] ?? 'unknown', banner };
      },
      (done, total) => {
        if (done % 250 === 0 || done === total) ctx.emit(`  ${done}/${total} probes (${openCount} open)`);
      },
    );

    const open = (results.filter(Boolean) ?? []) as (BannerResult & { host: string })[];
    open.sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port);
    const lines = open.map((o) => `${o.host}:${o.port} ${o.service}${o.banner ? ` | ${o.banner.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
    ctx.emit(`done: ${open.length} open of ${pairs.length}`);

    const findings = open
      .filter((o) => RISKY_SERVICES[o.port])
      .map((o) => {
        const info = RISKY_SERVICES[o.port]!;
        return {
          title: `${o.service} service exposed on port ${o.port}`,
          severity: info.severity,
          asset: `${o.host}:${o.port}`,
          description: `${o.service} is reachable from the test position. ${info.note}.`,
          evidence: `tcp connect to ${o.host}:${o.port} succeeded${o.banner ? `\nbanner: ${o.banner.slice(0, 300)}` : ''}`,
          reproduction: `PENAI: tcp_scan targets=${o.host} ports=${o.port}`,
          remediation: 'Restrict access to trusted sources, require strong authentication, and disable the service if it is not required.',
        };
      });

    return {
      ok: true,
      summary: `${open.length} open port(s) across ${hosts.length} host(s)`,
      data: { hosts, portsScanned: ports.length, probes: pairs.length, open },
      evidence: lines.join('\n') || 'no open ports',
      ...(findings.length > 0 ? { findings } : {}),
    };
  },
};
