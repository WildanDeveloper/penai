/**
 * Model catalog.
 *
 * Mirrors the design opencode uses for its /model dialog: a bundled registry of
 * known models grouped by provider, providers ordered by popularity, and the
 * dialog switches provider horizontally with the arrow keys.
 *
 * Generated from the public models.dev catalog. Regenerate with:
 *   node scripts/generate-catalog.mjs > src/ai/catalog.generated.ts
 *
 * For any endpoint that is not in the registry, the dialog can query the
 * provider's own /models endpoint instead (press `r`), so a custom router is not
 * limited to what is bundled here.
 */

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  /** USD per 1M input tokens, when known. */
  costIn?: number;
  costOut?: number;
  /** Context window in tokens, when known. */
  context?: number;
  reasoning?: boolean;
  tools?: boolean;
}

export interface CatalogProvider {
  id: string;
  label: string;
  /** Lower is more popular; matches the order opencode cycles through. */
  popularity: number;
  /** Hostnames that identify this provider, longest suffix wins. */
  hosts: string[];
  /** Default OpenAI-compatible base URL. */
  baseUrl?: string;
  kind: 'openai' | 'anthropic';
}

import { CATALOG_MODELS } from './catalog.generated.js';

/**
 * OpenCode Zen — the gateway opencode ships with, and PENAI's default.
 *
 * It is the default because it is the only endpoint that works with no account
 * at all. Reading the gateway's own behaviour: `/zen/v1/models` answers without
 * any credentials, and a completion sent with the literal bearer token `public`
 * is served from the zero-cost tier. So "no key configured" is not a dead end
 * here, it is the cheapest possible starting point, and there is no credential
 * for anyone to leak.
 *
 * What that tier serves was read off the gateway rather than guessed:
 * `GET /zen/v1/models` with the public token returns 82 model ids, 11 of which
 * carry a `-free` suffix. Those are the list below. They are not interchangeable
 * in practice - the tier is rate limited per model, so several answer
 * `429 FreeUsageLimitError` while another is free - which is why `defaultModel`
 * is the one verified to answer, and why the model dialog can refetch the live
 * list with `r`.
 */
export const ZEN = {
  id: 'opencode',
  label: 'OpenCode Zen',
  baseUrl: 'https://opencode.ai/zen/v1',
  hosts: ['opencode.ai'],
  kind: 'openai' as const,
  /**
   * The bearer token that means "anonymous, zero-cost tier". It is not a secret
   * and is nobody's credential: the gateway publishes it.
   */
  publicKey: 'public',
  /** The free models the gateway advertises, as of the last read. */
  freeModels: [
    'space-bunny-free',
    'deepseek-v4-flash-free',
    'mimo-v2.6-flash-free',
    'mimo-v2.5-free',
    'ling-3.0-flash-fin-free',
    'jev-1.13-free',
    'longcat-2.5-preview-free',
    'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free',
    'muse-spark-1.3-contributor-free',
    'muse-spark-1.2-contributor-free',
  ],
  /**
   * The one verified to answer a real completion on the anonymous tier. The
   * others were rate limited at the time of the check, which is a property of
   * the tier rather than a fault in the model.
   */
  defaultModel: 'space-bunny-free',
} as const;

export const PROVIDERS: CatalogProvider[] = [
  { id: 'opencode', label: 'OpenCode Zen', popularity: 0, hosts: ['opencode.ai'], baseUrl: ZEN.baseUrl, kind: 'openai' },
  { id: 'anthropic', label: 'Anthropic', popularity: 1, hosts: ['api.anthropic.com'], baseUrl: 'https://api.anthropic.com/v1', kind: 'anthropic' },
  { id: 'openai', label: 'OpenAI (paid)', popularity: 2, hosts: ['api.openai.com'], baseUrl: 'https://api.openai.com/v1', kind: 'openai' },
  { id: 'google', label: 'Google', popularity: 3, hosts: ['generativelanguage.googleapis.com'], kind: 'openai' },
  { id: 'groq', label: 'Groq', popularity: 4, hosts: ['api.groq.com'], baseUrl: 'https://api.groq.com/openai/v1', kind: 'openai' },
  { id: 'openrouter', label: 'OpenRouter', popularity: 5, hosts: ['openrouter.ai'], baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai' },
  { id: 'deepseek', label: 'DeepSeek', popularity: 6, hosts: ['api.deepseek.com'], baseUrl: 'https://api.deepseek.com/v1', kind: 'openai' },
  { id: 'xai', label: 'xAI', popularity: 7, hosts: ['api.x.ai'], baseUrl: 'https://api.x.ai/v1', kind: 'openai' },
  { id: 'mistral', label: 'Mistral', popularity: 8, hosts: ['api.mistral.ai'], baseUrl: 'https://api.mistral.ai/v1', kind: 'openai' },
  { id: 'zai', label: 'Z.AI', popularity: 9, hosts: ['api.z.ai'], baseUrl: 'https://api.z.ai/api/paas/v4', kind: 'openai' },
  { id: 'together', label: 'Together', popularity: 10, hosts: ['api.together.xyz', 'api.together.ai'], baseUrl: 'https://api.together.xyz/v1', kind: 'openai' },
  { id: 'fireworks', label: 'Fireworks', popularity: 11, hosts: ['api.fireworks.ai'], baseUrl: 'https://api.fireworks.ai/inference/v1', kind: 'openai' },
  { id: 'ollama', label: 'Ollama (local)', popularity: 12, hosts: ['localhost:11434', '127.0.0.1:11434'], baseUrl: 'http://127.0.0.1:11434/v1', kind: 'openai' },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export const ALL_MODELS: CatalogModel[] = CATALOG_MODELS;

export function modelsForProvider(providerId: string): CatalogModel[] {
  return ALL_MODELS.filter((m) => m.provider === providerId);
}

export function findModel(modelId: string): CatalogModel | undefined {
  return ALL_MODELS.find((m) => m.id === modelId);
}

/** Identify the provider that owns a base URL, if we know it. */
/** Free-to-try Zen models, most capable first. */
export function zenFreeModels(): string[] {
  return [...ZEN.freeModels];
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/** True when the endpoint is OpenCode Zen (the free-model gateway). */
export function isZen(baseUrl: string): boolean {
  return /(^|\.)opencode\.ai$/i.test(safeHost(baseUrl));
}

export function providerForBaseUrl(baseUrl: string): CatalogProvider | undefined {
  let host: string;
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    return undefined;
  }
  return [...PROVIDERS]
    .sort((a, b) => b.hosts.length - a.hosts.length)
    .find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.endsWith(h)));
}

export function providerLabel(providerId: string): string {
  return BY_ID.get(providerId)?.label ?? providerId;
}

/** `/v1/models` for an OpenAI-compatible endpoint, best effort. */
export async function fetchEndpointModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) {
    if (url.includes('anthropic.com')) headers['x-api-key'] = apiKey;
    else headers['authorization'] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
    return (json.data ?? json.models ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort();
  } catch {
    return [];
  }
}
