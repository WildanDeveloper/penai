/**
 * Content discovery.
 *
 * Request volume scales with the wordlist, which is why this is `medium` risk
 * rather than `low`.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { BuiltinTool, ToolResult } from '../../model/index.js';
import { HEADERS_TO_CHECK, SENSITIVE_PATHS, resolveWordlists } from '../../internal/wordlist.js';
import { asBool, asInt, clamp, humanBytes, mapLimit, normalizeUrl, sleep, truncate } from '../../internal/util.js';

import { httpRequest } from './http.js';
export const dirFuzz: BuiltinTool = {
  kind: 'builtin',
  name: 'dir_fuzz',
  title: 'Content discovery',
  category: 'web',
  risk: 'medium',
  description: 'Request a wordlist of paths and report anything that is not 404. Volume is proportional to the wordlist.',
  args: [
    { name: 'url', type: 'string', required: true, description: 'base URL' },
    { name: 'limit', type: 'number', description: 'max paths to request', default: 200 },
    { name: 'extensions', type: 'list', description: 'extensions to append, e.g. php,html' },
    { name: 'wordlist', type: 'string', notTarget: true, description: '"builtin" or path to a wordlist file', default: 'builtin' },
    { name: 'ignoreStatus', type: 'list', description: 'status codes to ignore', default: [404, 400] },
  ],
  async run(args, ctx): Promise<ToolResult> {
    const base = normalizeUrl(String(args.url ?? ''));
    if (!base) return { ok: false, summary: 'url is required', data: {}, error: 'url is required' };
    const limit = clamp(asInt(args.limit, 200), 1, 5000);
    const wordlistSource = String(args.wordlist ?? 'builtin');
    const { discovery } = resolveWordlists();
    const words = wordlistSource === 'builtin' ? discovery : readList(wordlistSource);
    const extensions = (Array.isArray(args.extensions) ? (args.extensions as string[]) : []).map((e) => String(e).replace(/^\./, ''));
    const ignore = new Set((Array.isArray(args.ignoreStatus) ? (args.ignoreStatus as number[]) : [404, 400]).map(Number));

    const candidates: string[] = [];
    for (const w of words) {
      const clean = w.replace(/^\//, '');
      candidates.push(clean);
      for (const ext of extensions) candidates.push(`${clean}.${ext}`);
      if (candidates.length >= limit) break;
    }
    const selected = candidates.slice(0, limit);
    ctx.emit(`requesting ${selected.length} paths on ${base}`);

    // Baseline size for filtering soft-404 responses.
    const baseline = await httpRequest(new URL('/__penai_missing__', base).toString(), { timeoutMs: 8000, maxBytes: 8 * 1024 }, ctx.signal);
    const baselineSize = baseline.length ?? 0;

    const hits: { url: string; status: number; length: number; title?: string }[] = [];
    await mapLimit(selected, 12, async (word) => {
      if (ctx.signal.aborted) return;
      const target = new URL(word, base.endsWith('/') ? base : `${base}/`).toString();
      const r = await httpRequest(target, { timeoutMs: 8000, maxBytes: 16 * 1024 }, ctx.signal);
      if (r.status === 0 || ignore.has(r.status)) return;
      if (baselineSize > 0 && r.length === baselineSize && r.status === 404) return;
      hits.push({ url: target, status: r.status, length: r.length ?? 0, title: r.title });
      ctx.emit(`hit  HTTP ${r.status}  ${target}  ${humanBytes(r.length ?? 0)}`);
      await sleep(60, ctx.signal);
    });

    hits.sort((a, b) => b.status - a.status || a.url.localeCompare(b.url));
    const notable = hits.filter((h) => /admin|login|config|backup|api|swagger|graphql|console|panel|git|env/i.test(h.url));
    return {
      ok: true,
      summary: `${hits.length} path(s) responded (${notable.length} interesting) of ${selected.length} requested`,
      data: { base, requested: selected.length, hits, notable: notable.map((h) => h.url) },
      evidence: hits.map((h) => `HTTP ${h.status}  ${h.url}  ${humanBytes(h.length)}${h.title ? `  "${h.title}"` : ''}`).join('\n') || 'nothing found',
    };
  },
};

function readList(path: string): string[] {
  const resolved = path.startsWith('~') ? `${process.env.HOME ?? '/root'}${path.slice(1)}` : path;
  if (!existsSync(resolved)) return [];
  try {
    return readFileSync(resolved, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
