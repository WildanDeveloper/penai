/**
 * Model sources for the /model dialog.
 *
 * Two kinds of source, and only two:
 *
 *   1. **current** — the endpoint this machine is configured with. Whatever the
 *      environment or PENAI's own config file says, and nothing else.
 *   2. **catalog** — vendor endpoints from the bundled model catalog, offered
 *      when a key for that vendor is already exported in the environment.
 *
 * There is deliberately no third kind. An earlier version read the providers
 * out of the operator's opencode config and listed them here, which meant this
 * process opened another program's config file and read its API keys without
 * being asked, then presented endpoints the operator had never given PENAI. It
 * was opt-in, which is better than silent but is still a question every user
 * should not have to answer before a security tool will start. So it is gone:
 * what is in the dialog is what PENAI is configured with, plus catalog vendors
 * whose keys are already in the environment.
 *
 * Every source carries where it came from, and the dialog shows it. A list that
 * cannot explain its own entries is a list nobody should act on.
 */

import { PROVIDERS, ZEN, modelsForProvider, providerForBaseUrl } from './catalog.js';

export interface ModelSource {
  id: string;
  label: string;
  kind: 'openai' | 'anthropic';
  baseUrl: string;
  /** Never printed in full, only reported as present or absent. */
  apiKey: string;
  models: string[];
  /** True once the list came from the provider's own /models endpoint. */
  live: boolean;
  origin: 'current' | 'catalog';
}

export function maskKey(key: string): string {
  if (!key) return 'no key';
  if (key.length <= 10) return 'key set';
  return `key ${key.slice(0, 3)}… (${key.length})`;
}

/**
 * The source list the /model dialog switches through: the endpoint in use
 * first, then every catalog vendor that has a key in the environment.
 */
export function buildSources(config: {
  kind: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}): ModelSource[] {
  const matched = providerForBaseUrl(config.baseUrl);
  const sources: ModelSource[] = [];

  // On the free tier the useful list is the free one. Offering all hundred-odd
  // paid models an operator cannot call would be a list that does not work.
  const onZen = config.baseUrl.includes('opencode.ai');
  const currentModels = onZen
    ? [...ZEN.freeModels]
    : matched
      ? modelsForProvider(matched.id).map((m) => m.id)
      : [];
  if (config.model && !currentModels.includes(config.model)) currentModels.unshift(config.model);
  sources.push({
    id: 'current',
    label: onZen ? `current · ${ZEN.label} free tier` : matched ? `current · ${matched.label}` : 'current endpoint',
    kind: config.kind,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: currentModels,
    live: false,
    origin: 'current',
  });

  const seen = new Set([config.baseUrl.replace(/\/+$/, '')]);
  const keys = {
    openai: process.env.OPENAI_API_KEY ?? process.env.PENAI_API_KEY ?? '',
    anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  };
  for (const provider of PROVIDERS) {
    if (!provider.baseUrl) continue;
    if (seen.has(provider.baseUrl.replace(/\/+$/, ''))) continue;
    const key = provider.kind === 'anthropic' ? keys.anthropic : keys.openai;
    if (!key) continue;
    seen.add(provider.baseUrl.replace(/\/+$/, ''));
    sources.push({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      apiKey: key,
      models: modelsForProvider(provider.id).map((m) => m.id),
      live: false,
      origin: 'catalog',
    });
  }
  return sources;
}

/** Replace a source's model list with one the provider itself returned. */
export function withLiveModels(source: ModelSource, models: string[]): ModelSource {
  if (models.length === 0) return source;
  return { ...source, models, live: true };
}
