/**
 * Session helpers shared by the CLI commands.
 */

import { loadConfig } from '../internal/config.js';
import type { AppConfig } from '../model/index.js';
import { Scope } from '../scope/index.js';
import { classifyTarget } from '../scope/index.js';
import { PolicyEngine } from '../policy/index.js';
import { Store } from '../internal/store.js';
import type { ReportInput } from '../report/shared.js';

export function buildScope(store: Store, denyFlag?: string): Scope {
  const targets = store.listTargets().map((t) => ({ value: t.value, kind: t.kind }));
  const deny = (denyFlag ?? process.env.PENAI_DENY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Scope(targets, deny);
}

export function buildPolicy(store: Store, denyFlag?: string): PolicyEngine {
  return new PolicyEngine(buildScope(store, denyFlag), loadConfig().policy);
}

export function addTarget(store: Store, value: string, note?: string): { ok: boolean; id?: string; kind?: string; error?: string } {
  try {
    const parsed = classifyTarget(value);
    const saved = store.addTarget(parsed.normalized, parsed.kind, note);
    return { ok: true, id: saved.id, kind: saved.kind };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function reportInput(store: Store, config: AppConfig): ReportInput {
  return {
    engagement: config.engagement,
    tester: config.tester,
    startedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    scope: store.listTargets().map((t) => ({ value: t.value, kind: t.kind, note: t.note })),
    findings: store.listFindings(),
    runs: store.listRuns(),
    audit: store.listAudit(),
  };
}
