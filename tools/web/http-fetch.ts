/**
 * Raw request: custom method, headers and body, with the full response returned.
 *
 * The tool for method handling, header parsing, auth and deserialisation
 * behaviour, hence `low` risk rather than `safe`.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK, SENSITIVE_PATHS, resolveWordlists } from '../../internal/wordlist.js';
import { asBool, asInt, clamp, humanBytes, mapLimit, normalizeUrl, sleep, truncate } from '../../internal/util.js';

import { httpRequest } from './http.js';
export const httpFetch: BuiltinTool = {
  kind: 'builtin',
  name: 'http_fetch',
  title: 'Raw HTTP request',
  category: 'web',
  risk: 'low',
  description:
    'Send a custom request (method, headers, body) and capture the full response. Use for method/header behaviour, auth and deserialisation tests.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'absolute URL' },
    { name: 'method', type: 'string', description: 'method', default: 'GET' },
    { name: 'headers', type: 'list', notTarget: true, description: 'headers as "Name: value" strings (header values are not targets)' },
    { name: 'body', type: 'string', notTarget: true, description: 'request body (payload, not a target)' },
    { name: 'timeoutMs', type: 'number', description: 'timeout', default: 15_000 },
    { name: 'maxBytes', type: 'number', description: 'max body bytes to return', default: 200_000 },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const url = String(args.url ?? '').trim();
    if (!url) return { ok: false, summary: 'url is required', data: {}, error: 'url is required' };

    const headers: Record<string, string> = { 'user-agent': 'penai/0.1 (authorized assessment)' };
    for (const raw of (Array.isArray(args.headers) ? (args.headers as string[]) : [])) {
      const idx = String(raw).indexOf(':');
      if (idx > 0) headers[String(raw).slice(0, idx).trim()] = String(raw).slice(idx + 1).trim();
    }
    const method = String(args.method ?? 'GET').toUpperCase();
    ctx.emit(`${method} ${url}`);
    const res = await httpRequest(
      url,
      {
        method,
        headers,
        body: typeof args.body === 'string' ? args.body : undefined,
        timeoutMs: clamp(asInt(args.timeoutMs, 15_000), 500, 60_000),
        maxBytes: clamp(asInt(args.maxBytes, 200_000), 1024, 2_000_000),
        includeBody: true,
      },
      ctx.signal,
    );

    const head = Object.entries(res.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const evidence = truncate(
      [`> ${method} ${url}`, ...Object.entries(headers).map(([k, v]) => `> ${k}: ${v}`), '', `< HTTP ${res.status} ${res.statusText}`, head, '', res.body ?? ''].join('\n'),
      ctx.evidenceLimit,
    );

    return {
      ok: res.status > 0,
      summary: res.error ? `error: ${res.error}` : `HTTP ${res.status} ${res.statusText} (${humanBytes(res.body?.length ?? 0)})`,
      data: { status: res.status, headers: res.headers, setCookie: res.setCookie, length: res.body?.length },
      evidence: evidence.text,
    };
  },
};
