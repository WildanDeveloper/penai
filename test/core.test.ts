import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHtml } from '../report/html.ts';
import { toMarkdown } from '../report/markdown.ts';
import { toSarif } from '../report/sarif.ts';
import { parsePorts, mapLimit, truncate } from '../internal/util.ts';
import { Store } from '../internal/store.ts';
import { truncate } from '../internal/util.ts';
import { ALL_TOOLS } from '../tools/index.ts';
import type { ReportInput } from '../report/shared.ts';

const INPUT: ReportInput = {
  engagement: 'test-engagement',
  tester: 'tester',
  startedAt: '2026-01-01T00:00:00.000Z',
  generatedAt: '2026-01-02T00:00:00.000Z',
  scope: [{ value: '10.0.0.0/24', kind: 'cidr', note: 'lab' }],
  findings: [
    {
      id: 'f1',
      title: 'High severity issue',
      severity: 'high',
      asset: '10.0.0.5',
      description: 'Something is wrong.',
      evidence: 'HTTP 200 with secret',
      reproduction: 'curl http://10.0.0.5',
      remediation: 'Fix it properly.',
      cwe: 'CWE-200',
      owasp: 'A01:2021',
      source: 'auto',
      status: 'open',
      createdAt: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 'f2',
      title: 'Informational note',
      severity: 'info',
      asset: '10.0.0.5',
      description: 'Minor.',
      evidence: '',
      reproduction: '',
      remediation: '',
      source: 'manual',
      status: 'false_positive',
      createdAt: '2026-01-01T11:00:00.000Z',
    },
  ],
  runs: [],
  audit: [],
};

test('markdown report ranks findings by severity and hides false positives', () => {
  const md = toMarkdown(INPUT);
  assert.match(md, /# Penetration Test Report — test-engagement/);
  assert.match(md, /High severity issue/);
  assert.doesNotMatch(md, /### \d+\. Informational note/);
  assert.match(md, /Rejected as false positives/);
  assert.ok(md.indexOf('HIGH findings') < md.indexOf('Appendix A'));
});

test('markdown escapes pipes so tables stay valid', () => {
  const md = toMarkdown({
    ...INPUT,
    runs: [
      {
        id: 'r1',
        at: '2026-01-01T00:00:00.000Z',
        tool: 'nmap',
        args: {},
        command: 'nmap -sV -p 1-100 | tee out.txt',
        ok: true,
        durationMs: 1,
        summary: 'done',
        output: '',
      },
    ],
  });
  assert.match(md, /nmap -sV -p 1-100 \\\| tee out\.txt/);
});

test('html report escapes injected markup', () => {
  const html = toHtml({
    ...INPUT,
    findings: [{ ...INPUT.findings[0]!, title: '<script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<!doctype html>/i);
});

test('sarif output is valid and drops false positives', () => {
  const sarif = JSON.parse(toSarif(INPUT)) as {
    version: string;
    runs: [{ results: unknown[]; tool: { driver: { rules: { id: string }[] } } }];
  };
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0]!.results.length, 1);
  assert.equal(sarif.runs[0]!.tool.driver.rules[0]!.id, 'CWE-200');
});

test('port specs parse ranges, lists and junk', () => {
  assert.deepEqual(parsePorts('80').ports, [80]);
  assert.deepEqual(parsePorts('1-3').ports, [1, 2, 3]);
  assert.deepEqual(parsePorts('80,443,8000-8002').ports, [80, 443, 8000, 8001, 8002]);
  assert.deepEqual(parsePorts('0,70000,-1').ports, []);
  assert.deepEqual(parsePorts('5-1').invalid, ['5-1']);
  assert.deepEqual(parsePorts('80,,443').ports, [80, 443]);
});

test('mapLimit respects concurrency and preserves order', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});

test('truncate marks what it dropped', () => {
  const short = truncate('abc', 10);
  assert.equal(short.truncated, false);
  const long = truncate('abcdefghij', 4);
  assert.equal(long.truncated, true);
  assert.match(long.text, /truncated 6 chars/);
});

test('store round-trips every collection and survives bad lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'penai-test-'));
  const store = new Store(dir);
  store.addTarget('10.0.0.1', 'ip', 'note');
  store.addTarget('10.0.0.1', 'ip');
  assert.equal(store.listTargets().length, 1, 'duplicate targets are not stored twice');

  const finding = store.addFinding({
    title: 't',
    severity: 'low',
    asset: 'a',
    description: '',
    evidence: '',
    reproduction: '',
    remediation: '',
    source: 'manual',
  });
  store.updateFinding(finding.id, { status: 'confirmed' });
  assert.equal(store.listFindings()[0]!.status, 'confirmed');

  store.audit({ actor: 'model', tool: 'x', command: 'x', decision: 'denied', risk: 'safe', reason: 'r' });
  assert.equal(store.listAudit().length, 1);

  store.saveRun({ tool: 't', args: {}, command: 'c', ok: true, durationMs: 1, summary: 's', output: '' });
  assert.equal(store.listRuns().length, 1);

  // Simulate an interrupted write and confirm the reader tolerates it.
  appendFileSync(join(dir, 'audit.ndjson'), '{"broken\n');
  assert.equal(store.listAudit().length, 1);
  assert.ok(readFileSync(join(dir, 'meta.json'), 'utf8').includes('createdAt'));
});
