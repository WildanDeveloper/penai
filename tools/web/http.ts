/**
 * The HTTP client every web tool is built on.
 *
 * One place for timeouts, redirect handling, body limits and technology
 * detection, so "what did the server actually say" is answered consistently
 * across probes, crawls and audits.
 */

import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK, SENSITIVE_PATHS, resolveWordlists } from '../../internal/wordlist.js';
import { asBool, asInt, clamp, humanBytes, mapLimit, normalizeUrl, sleep, truncate } from '../../internal/util.js';

export interface HttpResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  setCookie: string[];
  title?: string;
  server?: string;
  tech: string[];
  contentType?: string;
  length?: number;
  timeMs: number;
  error?: string;
  body?: string;
}

export const TECH_SIGNATURES: [RegExp, string][] = [
  [/wp-content|wp-includes/i, 'WordPress'],
  [/drupal/i, 'Drupal'],
  [/joomla/i, 'Joomla'],
  [/_next\//, 'Next.js'],
  [/__NEXT_DATA__/, 'Next.js'],
  [/nuxt/i, 'Nuxt'],
  [/react|webpack|__webpack/i, 'React/webpack'],
  [/vue\.min\.js|vue-router|data-v-/i, 'Vue.js'],
  [/angular/i, 'Angular'],
  [/laravel/i, 'Laravel'],
  [/csrf-token/i, 'Laravel'],
  [/ASP\.NET|__VIEWSTATE|aspnet/i, 'ASP.NET'],
  [/express/i, 'Express'],
  [/php\s?\d|phpmyadmin/i, 'PHP'],
  [/nginx/i, 'nginx'],
  [/apache/i, 'Apache'],
  [/cloudflare/i, 'Cloudflare'],
  [/x-powered-by:\s*(asp\.net|php)/i, 'Powered-by header'],
];

export function detectTech(headers: Record<string, string>, bodySample: string): string[] {
  const found = new Set<string>();
  for (const [re, label] of TECH_SIGNATURES) {
    if (re.test(bodySample) || re.test(headers['server'] ?? '') || re.test(headers['x-powered-by'] ?? '')) {
      found.add(label);
    }
  }
  return [...found];
}

export function extractTitle(body: string): string | undefined {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(body);
  return m?.[1]?.replace(/\s+/g, ' ').trim();
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  maxBytes?: number;
  includeBody?: boolean;
}

export async function httpRequest(url: string, opts: RequestOptions = {}, signal?: AbortSignal): Promise<HttpResult> {
  const start = Date.now();
  const target = normalizeUrl(url);
  const method = (opts.method ?? 'GET').toUpperCase();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const follow = opts.followRedirects ?? true;
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 512 * 1024;

  let current = target;
  const chain: string[] = [];
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const res = await fetch(current, {
        method: hop === 0 ? method : 'GET',
        headers: opts.headers,
        body: hop === 0 ? opts.body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      if (follow && [301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        chain.push(`${res.status} -> ${location ?? '?'}`);
        if (!location) break;
        current = new URL(location, current).toString();
        continue;
      }

      const contentType = headers['content-type'];
      let bodyText: string | undefined;
      if (opts.includeBody !== false && (contentType?.includes('text') || contentType?.includes('json') || contentType === undefined)) {
        const buffer = Buffer.from(await res.arrayBuffer());
        bodyText = buffer.subarray(0, maxBytes).toString('utf8');
      } else {
        await res.arrayBuffer().catch(() => undefined);
      }

      const lengthHeader = headers['content-length'];
      if (chain.length > 0) headers['x-redirect-chain'] = chain.join(' | ');
      return {
        url: target,
        finalUrl: current,
        status: res.status,
        statusText: res.statusText,
        headers,
        setCookie: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
        title: bodyText ? extractTitle(bodyText) : undefined,
        server: headers['server'],
        tech: detectTech(headers, bodyText?.slice(0, 20_000) ?? ''),
        contentType,
        length: lengthHeader ? Number(lengthHeader) : bodyText ? Buffer.byteLength(bodyText) : undefined,
        timeMs: Date.now() - start,
        ...(bodyText !== undefined ? { body: bodyText } : {}),
      };
    }
    return {
      url: target,
      finalUrl: current,
      status: 0,
      statusText: 'too many redirects',
      headers: {},
      setCookie: [],
      tech: [],
      timeMs: Date.now() - start,
      error: 'redirect limit exceeded',
    };
  } catch (error) {
    return {
      url: target,
      finalUrl: current,
      status: 0,
      statusText: 'error',
      headers: {},
      setCookie: [],
      tech: [],
      timeMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function formatProbe(r: HttpResult): string {
  const bits = [
    r.status ? `HTTP ${r.status} ${r.statusText}` : `ERROR ${r.error ?? 'unknown'}`,
    r.server ? `server=${r.server}` : '',
    r.title ? `title="${r.title.slice(0, 60)}"` : '',
    r.length !== undefined ? `size=${humanBytes(r.length)}` : '',
    r.timeMs !== undefined ? `${r.timeMs}ms` : '',
  ].filter(Boolean);
  return `${r.finalUrl}  ${bits.join('  ')}`;
}
