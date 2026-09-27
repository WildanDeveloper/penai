/**
 * Site crawler producing the attack surface map: pages, forms, parameters,
 * API endpoints, scripts and file-upload points.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK, SENSITIVE_PATHS, resolveWordlists } from '../../internal/wordlist.js';
import { asBool, asInt, clamp, humanBytes, mapLimit, normalizeUrl, sleep, truncate } from '../../internal/util.js';

import { httpRequest } from './http.js';
export const crawl: BuiltinTool = {
  kind: 'builtin',
  name: 'crawl',
  title: 'Site crawler (attack surface map)',
  category: 'web',
  risk: 'safe',
  description: 'Crawl same-origin pages, collecting URLs, forms, parameters, scripts and file upload points.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'start URL' },
    { name: 'maxPages', type: 'number', description: 'page budget', default: 40 },
    { name: 'maxDepth', type: 'number', description: 'max link depth', default: 2 },
    { name: 'includeQuery', type: 'boolean', description: 'follow URLs with query strings', default: true },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const start = normalizeUrl(String(args.url ?? ''));
    if (!start) return { ok: false, summary: 'url is required', data: {}, error: 'url is required' };
    const maxPages = clamp(asInt(args.maxPages, 40), 1, 500);
    const maxDepth = clamp(asInt(args.maxDepth, 2), 0, 6);
    const followQuery = asBool(args.includeQuery, true);
    const origin = new URL(start).origin;

    const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
    const seen = new Set<string>();
    const pages: { url: string; status: number; title?: string }[] = [];
    const forms: { url: string; method: string; action: string; fields: string[] }[] = [];
    const params = new Set<string>();
    const scripts = new Set<string>();
    const endpoints = new Set<string>();
    const uploadPoints: string[] = [];

    while (queue.length > 0 && pages.length < maxPages && !ctx.signal.aborted) {
      const next = queue.shift()!;
      if (seen.has(next.url)) continue;
      seen.add(next.url);

      const r = await httpRequest(next.url, { timeoutMs: 10_000, maxBytes: 256 * 1024 }, ctx.signal);
      if (r.status === 0 || r.status >= 400 || !r.body) continue;
      pages.push({ url: r.finalUrl, status: r.status, title: r.title });
      ctx.emit(`crawled ${pages.length}/${maxPages}  HTTP ${r.status}  ${r.finalUrl}`);

      const body = r.body;
      for (const m of body.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
        const href = m[1];
        if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
        try {
          const abs = new URL(href, r.finalUrl);
          if (abs.origin !== origin) continue;
          if (!followQuery && abs.search) continue;
          if (abs.hash) abs.hash = '';
          if (!seen.has(abs.toString()) && queue.length < maxPages * 4) {
            queue.push({ url: abs.toString(), depth: next.depth + 1 });
          }
        } catch {
          /* ignore malformed href */
        }
      }
      for (const m of body.matchAll(/<form([^>]*)>([\s\S]{0,20000}?)<\/form>/gi)) {
        const attrs = m[1] ?? '';
        const inner = m[2] ?? '';
        const actionMatch = /action=["']([^"']*)["']/i.exec(attrs);
        const methodMatch = /method=["']([^"']*)["']/i.exec(attrs);
        const fields = [...inner.matchAll(/<input[^>]+name=["']([^"']+)["']/gi)].map((f) => f[1] ?? '');
        const action = actionMatch?.[1] ? new URL(actionMatch[1], r.finalUrl).toString() : r.finalUrl;
        forms.push({ url: r.finalUrl, method: (methodMatch?.[1] ?? 'GET').toUpperCase(), action, fields });
        if (/type=["']file["']/i.test(inner)) uploadPoints.push(r.finalUrl);
        ctx.emit(`form  ${(methodMatch?.[1] ?? 'GET').toUpperCase()} ${action}  fields=[${fields.join(', ')}]`);
      }
      for (const m of body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
        try {
          scripts.add(new URL(m[1] ?? '', r.finalUrl).toString());
        } catch {
          /* ignore */
        }
      }
      for (const m of body.matchAll(/(?:href|action|src|fetch\(|url\()\s*=?\s*["']?([^"'\s)]*\/(?:api|graphql|rest|jsonrpc)[^"'\s)]*)/gi)) {
        const value = m[1];
        if (!value) continue;
        try {
          endpoints.add(new URL(value.startsWith('http') ? value : new URL(value, r.finalUrl).toString()).toString());
        } catch {
          /* ignore */
        }
      }
      for (const m of r.finalUrl.matchAll(/[?&]([a-z0-9_.-]{1,40})=/gi)) params.add(`${new URL(r.finalUrl).pathname}?${m[1]}=`);
      await sleep(80, ctx.signal);
    }

    ctx.emit(`done: ${pages.length} pages, ${forms.length} forms, ${endpoints.size} API endpoints`);
    return {
      ok: pages.length > 0,
      summary: `${pages.length} page(s), ${forms.length} form(s), ${endpoints.size} API endpoint(s), ${uploadPoints.length} upload point(s)`,
      data: {
        pages,
        forms,
        endpoints: [...endpoints].slice(0, 100),
        parameters: [...params].slice(0, 200),
        scripts: [...scripts].slice(0, 100),
        uploadPoints,
      },
      evidence: [
        ...pages.map((p) => `PAGE ${p.status} ${p.url}`),
        ...forms.map((f) => `FORM ${f.method} ${f.action} fields=[${f.fields.join(', ')}]`),
        ...[...endpoints].slice(0, 50).map((e) => `API  ${e}`),
        ...[...params].slice(0, 50).map((p) => `PARAM ${p}`),
      ].join('\n'),
    };
  },
};
