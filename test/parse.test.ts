import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResult, parseModelOutput } from '../ai/protocol/parse.ts';

test('parses a tool call and strips the fence from prose', () => {
  const text = `Let me check that.\n\n\`\`\`penai
{"tool":"http_probe","args":{"urls":["http://10.0.0.5"]}}
\`\`\`\n\nThat is all.`;
  const parsed = parseModelOutput(text);
  assert.equal(parsed.prose.includes('penai'), false);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0]!.tool, 'http_probe');
  assert.deepEqual(parsed.toolCalls[0]!.args.urls, ['http://10.0.0.5']);
  assert.match(parsed.prose, /Let me check that\./);
});

test('parses several calls in one reply', () => {
  const parsed = parseModelOutput(
    '```penai\n{"tool":"a","args":{}}\n```\nsome text\n```penai\n{"tool":"b","args":{"x":1}}\n```',
  );
  assert.deepEqual(parsed.toolCalls.map((c) => c.tool), ['a', 'b']);
});

test('parses a finding with severity coercion', () => {
  const parsed = parseModelOutput(`\`\`\`penai
{"finding":{"title":"XSS","severity":"Severe","asset":"https://a/x","description":"d","evidence":"e","reproduction":"r","remediation":"fix"}}
\`\`\``);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0]!.severity, 'critical');
  assert.equal(parsed.findings[0]!.title, 'XSS');
});

test('unknown severity becomes medium rather than inflating risk', () => {
  const parsed = parseModelOutput('```penai\n{"finding":{"title":"t","severity":"catastrophic-but-unknown"}}\n```');
  assert.equal(parsed.findings[0]!.severity, 'medium');
});

test('finding without a title is rejected and reported', () => {
  const parsed = parseModelOutput('```penai\n{"finding":{"severity":"high","description":"no title"}}\n```');
  assert.equal(parsed.findings.length, 0);
  assert.equal(parsed.errors.length, 1);
});

test('malformed JSON is reported back, not guessed', () => {
  const parsed = parseModelOutput('```penai\n{"tool":"http_probe", args: broken}\n```');
  assert.equal(parsed.toolCalls.length, 0);
  assert.match(parsed.errors[0]!, /could not parse/);
});

test('block without tool or finding key is an error', () => {
  const parsed = parseModelOutput('```penai\n{"hello":"world"}\n```');
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0]!, /did not contain/);
});

test('bash blocks are captured as shell requests, never auto-run', () => {
  const parsed = parseModelOutput('```bash\nnmap -sV 10.0.0.5\n```');
  assert.deepEqual(parsed.shells, ['nmap -sV 10.0.0.5']);
  assert.equal(parsed.toolCalls.length, 0);
});

test('ordinary prose code blocks are ignored', () => {
  const parsed = parseModelOutput('here is an example:\n```js\nconsole.log(1)\n```\ndone');
  assert.equal(parsed.toolCalls.length, 0);
  assert.equal(parsed.shells.length, 0);
  assert.equal(parsed.errors.length, 0);
  assert.match(parsed.prose, /done/);
});

test('arguments alias is accepted', () => {
  const parsed = parseModelOutput('```penai\n{"tool":"nmap","arguments":{"targets":["10.0.0.5"]}}\n```');
  assert.deepEqual(parsed.toolCalls[0]!.args.targets, ['10.0.0.5']);
});

test('tool result formatting is bounded and labelled', () => {
  const rendered = formatToolResult('tcp_scan', true, '2 open', 'x'.repeat(10_000), 100);
  assert.match(rendered, /tool="tcp_scan"/);
  assert.match(rendered, /ok="true"/);
  assert.match(rendered, /more chars stored as evidence/);
  assert.ok(rendered.length < 500);
});
