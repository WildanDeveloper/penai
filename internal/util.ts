/** Small async primitives: clamping, cancellable sleep, bounded concurrency. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/** Run `worker` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;
  const width = clamp(limit, 1, 512);
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
      done += 1;
      onSettled?.(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}
/** Port specification parsing and the default scan sets. */

export interface PortListResult {
  ports: number[];
  invalid: string[];
}

/** Accepts "80", "1-1024", "80,443,8080", "1-100,443,8000-8010". */
export function parsePorts(spec: string, max = 65535): PortListResult {
  const ports = new Set<number>();
  const invalid: string[] = [];
  for (const rawChunk of spec.split(',')) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(chunk);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > 65535) {
        invalid.push(chunk);
        continue;
      }
      for (let p = from; p <= to; p += 1) ports.add(p);
      continue;
    }
    const single = Number(chunk);
    if (Number.isInteger(single) && single > 0 && single <= max) ports.add(single);
    else invalid.push(chunk);
  }
  return { ports: [...ports].sort((a, b) => a - b), invalid };
}

export function topPorts(count = 1000): string {
  const common = [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 2049, 2375, 3000, 3306, 3389, 5000, 5432, 5900, 6379, 8000, 8080, 8443, 8888, 9000, 9090, 9200, 27017, 11211];
  if (count <= common.length) return common.slice(0, count).join(',');
  const extra = Array.from({ length: count - common.length }, (_, i) => 10000 + i);
  return [...common, ...extra].join(',');
}
/** Text and number formatting shared by tools and the UI. */

export function truncate(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`, truncated: true };
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** Lenient coercion of unknown JSON into typed arguments. */

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return fallback;
}

export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return `http://${value}`;
  return value;
}
