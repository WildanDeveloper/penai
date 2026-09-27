/**
 * Liveness probe: one request per URL, reporting status, title, server and stack.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { asBool, asInt, clamp, mapLimit } from '../../internal/util.js';
import { formatProbe, httpRequest } from './http.js';

export const httpProbe: BuiltinTool = {
  kind: 'builtin',
  name: 'http_probe',
  title: 'HTTP probe / liveness check',
  category: 'web',
  risk: 'safe',
  description: 'Send a single GET per URL and report status, title, server, technology and size.',
  args: [
    { name: 'urls', type: 'list', required: true, description: 'base URLs', example: 'http://127.0.0.1:8099' },
    { name: 'method', type: 'string', description: 'HTTP method', default: 'GET' },
    { name: 'followRedirects', type: 'boolean', description: 'follow 3xx', default: true },
    { name: 'timeoutMs', type: 'number', description: 'per request timeout', default: 10_000 },
    { name: 'concurrency', type: 'number', description: 'parallel requests', default: 8 },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const urls = (Array.isArray(args.urls) ? (args.urls as string[]) : [String(args.urls ?? '')])
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return { ok: false, summary: 'urls is required', data: {}, error: 'urls is required' };

    const results = await mapLimit(
      urls,
      clamp(asInt(args.concurrency, 8), 1, 64),
      async (url) => {
        const r = await httpRequest(
          url,
          {
            method: String(args.method ?? 'GET'),
            followRedirects: asBool(args.followRedirects, true),
            timeoutMs: clamp(asInt(args.timeoutMs, 10_000), 500, 60_000),
            maxBytes: 64 * 1024,
          },
          ctx.signal,
        );
        ctx.emit(formatProbe(r));
        return r;
      },
    );

    const alive = results.filter((r) => r.status > 0);
    const dead = results.filter((r) => r.status === 0);
    const techs = new Set(alive.flatMap((r) => r.tech));
    return {
      ok: alive.length > 0,
      summary: `${alive.length} responsive / ${dead.length} unreachable of ${urls.length}`,
      data: { results: results.map(({ body, ...rest }) => rest) },
      evidence: [
        ...alive.map(formatProbe),
        ...dead.map((r) => `${r.url}  ERROR ${r.error}`),
        techs.size > 0 ? `tech: ${[...techs].join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  },
};
