/**
 * Regenerate src/ai/catalog.generated.ts from the public models.dev catalog.
 *
 *   curl -sS https://models.dev/api.json -o /tmp/models.json
 *   node scripts/generate-catalog.mjs /tmp/models.json > src/ai/catalog.generated.ts
 *
 * Only the providers that ship an OpenAI-compatible (or Anthropic) API are kept,
 * plus a handful of model families per provider, so the bundled file stays small
 * enough to ship with the tool.
 */

import { readFileSync } from 'node:fs';

const PROVIDERS = [
  ['openai', 'OpenAI', 'api.openai.com', 'https://api.openai.com/v1', 'openai'],
  ['anthropic', 'Anthropic', 'api.anthropic.com', 'https://api.anthropic.com/v1', 'anthropic'],
  ['google', 'Google', 'generativelanguage.googleapis.com', '', 'openai'],
  ['groq', 'Groq', 'api.groq.com', 'https://api.groq.com/openai/v1', 'openai'],
  ['openrouter', 'OpenRouter', 'openrouter.ai', 'https://openrouter.ai/api/v1', 'openai'],
  ['deepseek', 'DeepSeek', 'api.deepseek.com', 'https://api.deepseek.com/v1', 'openai'],
  ['xai', 'xAI', 'api.x.ai', 'https://api.x.ai/v1', 'openai'],
  ['mistral', 'Mistral', 'api.mistral.ai', 'https://api.mistral.ai/v1', 'openai'],
  ['zai', 'Z.AI', 'api.z.ai', 'https://api.z.ai/api/paas/v4', 'openai'],
  ['together', 'Together', 'api.together.xyz', 'https://api.together.xyz/v1', 'openai'],
  ['fireworks', 'Fireworks', 'api.fireworks.ai', 'https://api.fireworks.ai/inference/v1', 'openai'],
  ['ollama', 'Ollama', 'localhost:11434', 'http://127.0.0.1:11434/v1', 'openai'],
];

const PER_PROVIDER = 18;

/** Model ids worth listing: skip image/audio-only and local gguf style entries. */
function usable(id) {
  if (/(^|[-/:])(image|audio|whisper|tts|embedding|rerank|moderation|vision-only|ocr)/i.test(id)) return false;
  if (id.endsWith('.gguf')) return false;
  return true;
}

const source = process.argv[2] ?? '/tmp/models.json';
const catalog = JSON.parse(readFileSync(source, 'utf8'));
const rows = [];

for (const [providerId] of PROVIDERS) {
  const entry = catalog[providerId];
  if (!entry?.models) continue;
  const models = Object.entries(entry.models)
    .filter(([id]) => usable(id))
    .slice(0, PER_PROVIDER);
  for (const [id, meta] of models) {
    const m = meta ?? {};
    const cost = m.cost ?? {};
    const limit = m.limit ?? {};
    const modality = m.modalities ?? {};
    rows.push({
      id,
      name: m.name ?? id,
      provider: providerId,
      ...(typeof cost.input === 'number' ? { costIn: cost.input } : {}),
      ...(typeof cost.output === 'number' ? { costOut: cost.output } : {}),
      ...(typeof limit.context === 'number' && limit.context > 0 ? { context: limit.context } : {}),
      ...(m.reasoning === true ? { reasoning: true } : {}),
      ...(modality.input?.includes('tool') || m.tool_call === true ? { tools: true } : {}),
    });
  }
}

rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));

process.stdout.write(
  `/* GENERATED FILE — do not edit by hand.\n * Source: https://models.dev/api.json\n * Regenerate: node scripts/generate-catalog.mjs > src/ai/catalog.generated.ts\n */\n\n` +
    `import type { CatalogModel } from './catalog.js';\n\n` +
    `export const CATALOG_MODELS: CatalogModel[] = ${JSON.stringify(rows, null, 0).replace(/},\{/g, '},\n{')};\n`,
);
