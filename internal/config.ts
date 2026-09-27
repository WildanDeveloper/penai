/**
 * Configuration.
 *
 * Deliberately generic and credential-free: PENAI only ever reads its own
 * config file and standard environment variables. It never reads other tools'
 * config (no opencode.json, no ~/.aws, no .netrc), so it stays safe to publish
 * as an open source project.
 *
 * Precedence: env var > config file > built-in default.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, Mode, ProviderConfig, PolicyConfig } from '../model/index.js';
import { ZEN } from '../ai/catalog.js';

const CONFIG_PATHS = [
  process.env.PENAI_CONFIG ?? '',
  join(homedir(), '.config', 'penai', 'config.json'),
  join(homedir(), '.penai', 'config.json'),
].filter(Boolean);

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readConfigFile(): Record<string, unknown> {
  for (const path of CONFIG_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      process.stderr.write(`penai: ignoring unreadable config ${path}: ${String(error)}\n`);
    }
  }
  return {};
}

function section(file: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = file[name];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Config lookup, most specific first.
 *
 * `PENAI_*` always wins. The conventional vendor variables are accepted as a
 * convenience so an existing `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the
 * environment (or a `--env-file` .env) just works — but PENAI never reads any
 * tool's own config files.
 */
function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function loadProviderConfig(file: Record<string, unknown> = readConfigFile()): ProviderConfig {
  const provider = section(file, 'provider');
  const explicitBase = pick('PENAI_BASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'BASE_URL') ?? str(provider.baseUrl as string | undefined, '');
  const explicitKind = pick('PENAI_PROVIDER', 'PROVIDER') ?? str(provider.kind as string | undefined, '');
  // Anthropic is selected explicitly, or implied by an anthropic endpoint, or
  // by having only an ANTHROPIC_API_KEY in the environment.
  const looksAnthropic =
    explicitBase.includes('anthropic.com') ||
    (Boolean(pick('ANTHROPIC_API_KEY', 'API_KEY')) && !pick('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'BASE_URL'));
  const kind: ProviderConfig['kind'] = explicitKind
    ? explicitKind === 'anthropic'
      ? 'anthropic'
      : 'openai'
    : looksAnthropic
      ? 'anthropic'
      : 'openai';
  // Never pair the Anthropic API with the OpenAI host by accident.
  //
  // With nothing configured at all the endpoint is OpenCode Zen, not a paid
  // vendor: it is the one that answers without an account, so a fresh install
  // can actually run a turn instead of reporting a missing key. The literal
  // `public` token is the gateway's own anonymous tier, not a credential of
  // anybody's, and it is only used when no key was given.
  const baseUrl = explicitBase || (kind === 'anthropic' ? 'https://api.anthropic.com/v1' : ZEN.baseUrl);

  const explicitKey =
    pick('PENAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'API_KEY') ??
    str(provider.apiKey as string | undefined, '');
  const onZen = baseUrl.includes('opencode.ai');
  const apiKey = explicitKey || (onZen ? ZEN.publicKey : '');

  return {
    kind,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model:
      pick('PENAI_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'MODEL') ??
      str(provider.model as string | undefined,
        kind === 'anthropic' ? 'claude-sonnet-4-5' : onZen ? ZEN.defaultModel : 'gpt-4o-mini'),
    temperature: num(
      pick('PENAI_TEMPERATURE', 'TEMPERATURE') ?? (provider.temperature as string | undefined),
      typeof provider.temperature === 'number' ? provider.temperature : 0.2,
    ),
    maxTokens: num(
      pick('PENAI_MAX_TOKENS', 'MAX_TOKENS') ?? (provider.maxTokens as string | undefined),
      typeof provider.maxTokens === 'number' ? provider.maxTokens : 4096,
    ),
  };
}

export function loadPolicyConfig(file: Record<string, unknown> = readConfigFile()): PolicyConfig {
  const policy = section(file, 'policy');
  const modeRaw = pick('PENAI_MODE', 'MODE') ?? str(policy.mode as string | undefined, 'balanced');
  const mode: Mode = modeRaw === 'safe' || modeRaw === 'full' ? modeRaw : 'balanced';

  return {
    mode,
    rateLimitSec: num(pick('PENAI_RATE_LIMIT', 'RATE_LIMIT') ?? (policy.rateLimitSec as string | undefined), 1),
    maxSteps: num(pick('PENAI_MAX_STEPS', 'MAX_STEPS') ?? (policy.maxSteps as string | undefined), 8),
    concurrency: num(pick('PENAI_CONCURRENCY', 'CONCURRENCY') ?? (policy.concurrency as string | undefined), 24),
    requestTimeoutMs: num(
      pick('PENAI_TIMEOUT_MS', 'TIMEOUT_MS') ?? (policy.requestTimeoutMs as string | undefined),
      10_000,
    ),
    evidenceLimit: num(
      pick('PENAI_EVIDENCE_LIMIT', 'EVIDENCE_LIMIT') ?? (policy.evidenceLimit as string | undefined),
      200_000,
    ),
    allowShell: bool(pick('PENAI_ALLOW_SHELL', 'ALLOW_SHELL') ?? (policy.allowShell as string | undefined), false),
  };
}

export function defaultDataDir(): string {
  const dir = str(process.env.PENAI_DATA_DIR, join(homedir(), '.local', 'share', 'penai'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function defaultTester(): string {
  try {
    const info = userInfo();
    return info.username || hostname();
  } catch {
    return hostname();
  }
}

export function configPath(): string {
  return process.env.PENAI_CONFIG ?? join(homedir(), '.config', 'penai', 'config.json');
}

/**
 * Persist a provider choice so the next run does not have to be reconfigured.
 *
 * Written 0600 because it may contain a key. Other people's config files are
 * never read for this: the caller decides which source to persist.
 */
export function saveProvider(provider: ProviderConfig, opts: { saveKey: boolean } = { saveKey: true }): string {
  const path = configPath();
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const next: Record<string, unknown> = {
    ...existing,
    provider: {
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
      // The anonymous token is not a secret and does not belong in a file.
      ...(opts.saveKey && provider.apiKey && provider.apiKey !== ZEN.publicKey
        ? { apiKey: provider.apiKey }
        : {}),
    },
  };
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const file = readConfigFile();
  const dataDir = str(process.env.PENAI_DATA_DIR, (file.dataDir as string | undefined) ?? defaultDataDir());
  return {
    provider: loadProviderConfig(file),
    policy: loadPolicyConfig(file),
    dataDir,
    engagement: str(process.env.PENAI_ENGAGEMENT, 'untitled-engagement'),
    tester: str(process.env.PENAI_TESTER, defaultTester()),
    ...overrides,
  };
}

/** Human readable summary, safe to print (never prints the API key). */
export function describeConfig(config: AppConfig): string[] {
  const p = config.provider;
  // The anonymous tier uses the gateway's own literal token, so reporting it as
  // "a key is set" would be a lie about a credential nobody provided - and
  // reporting it as a problem would be worse, because needing no key is the
  // whole reason this endpoint is the default.
  const onPublicTier = p.apiKey === ZEN.publicKey;
  const hasKey = onPublicTier ? 'No Key Needed' : p.apiKey ? 'set' : 'MISSING';
  return [
    `provider : ${p.kind} @ ${p.baseUrl}`,
    `model    : ${p.model}`,
    `api key  : ${hasKey}`,
    `mode     : ${config.policy.mode} (auto-run up to ${config.policy.mode === 'safe' ? 'safe' : config.policy.mode === 'balanced' ? 'low' : 'medium'} risk)`,
    `rate     : ${config.policy.rateLimitSec}s between runs, max ${config.policy.maxSteps} steps/turn`,
    `shell    : ${config.policy.allowShell ? 'enabled' : 'disabled'}`,
    `data dir : ${config.dataDir}`,
  ];
}
