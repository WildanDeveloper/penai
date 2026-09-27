/**
 * Append-only NDJSON store.
 *
 * Chosen over a database because every record here is an append-mostly
 * artifact (evidence, audit trail, findings) that users want to diff, grep and
 * archive with ordinary shell tools. No native modules, no migrations, works on
 * a fresh Node install.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEntry, Finding, Target, ToolRun, TranscriptItem } from '../model/index.js';

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'engagement'
  );
}

type Collection = 'findings' | 'targets' | 'audit' | 'runs' | 'transcript';

export class Store {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    const meta = join(dir, 'meta.json');
    if (!existsSync(meta)) {
      writeFileSync(meta, JSON.stringify({ createdAt: now() }, null, 2));
    }
  }

  static forEngagement(dataDir: string, engagement: string): Store {
    return new Store(join(dataDir, slug(engagement)));
  }

  private path(collection: Collection): string {
    return join(this.dir, `${collection}.ndjson`);
  }

  private append<T extends object>(collection: Collection, record: T): T {
    appendFileSync(this.path(collection), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  private readAll<T>(collection: Collection): T[] {
    const file = this.path(collection);
    if (!existsSync(file)) return [];
    const out: T[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // Tolerate a torn final line from an interrupted process.
      }
    }
    return out;
  }

  // ---- targets -----------------------------------------------------------

  addTarget(value: string, kind: Target['kind'], note?: string): Target {
    const existing = this.listTargets().find((t) => t.value.toLowerCase() === value.toLowerCase());
    if (existing) return existing;
    return this.append<Target>('targets', {
      id: id('tgt'),
      value,
      kind,
      note,
      addedAt: now(),
    });
  }

  listTargets(): Target[] {
    return this.readAll<Target>('targets');
  }

  removeTarget(targetId: string): void {
    const kept = this.listTargets().filter((t) => t.id !== targetId);
    this.rewrite('targets', kept);
  }

  // ---- findings ----------------------------------------------------------

  addFinding(finding: Omit<Finding, 'id' | 'createdAt' | 'status'> & Partial<Pick<Finding, 'id' | 'createdAt' | 'status'>>): Finding {
    const record: Finding = {
      status: 'open',
      createdAt: now(),
      ...finding,
      id: finding.id ?? id('fnd'),
    };
    return this.append<Finding>('findings', record);
  }

  listFindings(): Finding[] {
    return this.readAll<Finding>('findings');
  }

  updateFinding(findingId: string, patch: Partial<Finding>): Finding | undefined {
    const all = this.listFindings();
    let updated: Finding | undefined;
    const next = all.map((f) => {
      if (f.id !== findingId) return f;
      updated = { ...f, ...patch };
      return updated;
    });
    this.rewrite('findings', next);
    return updated;
  }

  // ---- audit -------------------------------------------------------------

  audit(entry: Omit<AuditEntry, 'id' | 'at'> & Partial<Pick<AuditEntry, 'id' | 'at'>>): AuditEntry {
    return this.append<AuditEntry>('audit', { at: now(), id: id('aud'), ...entry });
  }

  listAudit(limit?: number): AuditEntry[] {
    const all = this.readAll<AuditEntry>('audit');
    return limit ? all.slice(-limit) : all;
  }

  // ---- runs (evidence) ---------------------------------------------------

  saveRun(run: Omit<ToolRun, 'id' | 'at'> & Partial<Pick<ToolRun, 'id' | 'at'>>): ToolRun {
    return this.append<ToolRun>('runs', { at: now(), id: id('run'), ...run });
  }

  listRuns(limit?: number): ToolRun[] {
    const all = this.readAll<ToolRun>('runs');
    return limit ? all.slice(-limit) : all;
  }

  // ---- transcript --------------------------------------------------------

  addTranscript(item: Omit<TranscriptItem, 'id' | 'at'> & Partial<Pick<TranscriptItem, 'id' | 'at'>>): TranscriptItem {
    return this.append<TranscriptItem>('transcript', { at: now(), id: id('msg'), ...item });
  }

  listTranscript(limit?: number): TranscriptItem[] {
    const all = this.readAll<TranscriptItem>('transcript');
    return limit ? all.slice(-limit) : all;
  }

  // ---- maintenance -------------------------------------------------------

  rewrite(collection: Collection, records: unknown[]): void {
    const file = this.path(collection);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, records.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf8');
    renameSync(tmp, file);
  }

  clear(collection: Collection): void {
    writeFileSync(this.path(collection), '', 'utf8');
  }
}
