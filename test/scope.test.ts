import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope, classifyTarget, extractTargets, isPrivateAddress } from '../scope/index.ts';

test('classifyTarget recognises each rule shape', () => {
  assert.deepEqual(classifyTarget('10.0.0.5'), { kind: 'ip', normalized: '10.0.0.5' });
  assert.deepEqual(classifyTarget('10.10.16.16/28'), { kind: 'cidr', normalized: '10.10.16.16/28' });
  assert.equal(classifyTarget('app.example.com').kind, 'host');
  assert.equal(classifyTarget('https://a.example.com/api/').kind, 'url');
  assert.equal(classifyTarget('*.example.com').normalized, '*.example.com');
});

test('classifyTarget refuses dangerous schemes and junk', () => {
  assert.throws(() => classifyTarget('file:///etc/passwd'), /unsupported scheme/);
  assert.throws(() => classifyTarget('gopher://x/'), /unsupported scheme/);
  assert.throws(() => classifyTarget('999.1.1.1'), /invalid IPv4/);
  assert.throws(() => classifyTarget('10.0.0.0/33'), /invalid CIDR/);
  assert.throws(() => classifyTarget('   '), /empty target/);
});

test('CIDR containment decides IP scope', async () => {
  // 10.10.16.16/28 covers .16 - .31; .15 and .32 are outside it.
  const scope = new Scope([{ value: '10.10.16.16/28', kind: 'cidr' }]);
  assert.equal((await scope.check('10.10.16.27')).ok, true);
  assert.equal((await scope.check('10.10.16.31')).ok, true);
  assert.equal((await scope.check('10.10.16.15')).ok, false);
  assert.equal((await scope.check('10.10.16.32')).ok, false);
  assert.equal((await scope.check('8.8.8.8')).ok, false);
});

test('exact IP rule only matches that address', async () => {
  const scope = new Scope([{ value: '192.0.2.10', kind: 'ip' }]);
  assert.equal((await scope.check('192.0.2.10')).ok, true);
  assert.equal((await scope.check('192.0.2.11')).ok, false);
});

test('wildcard host rule does not match the apex', async () => {
  const scope = new Scope([{ value: '*.example.com', kind: 'host' }]);
  assert.equal((await scope.check('api.example.com', { resolve: false })).ok, true);
  assert.equal((await scope.check('deep.api.example.com', { resolve: false })).ok, true);
  assert.equal((await scope.check('example.com', { resolve: false })).ok, false);
  assert.equal((await scope.check('notexample.com', { resolve: false })).ok, false);
});

test('URL rule matches host, port and path prefix', async () => {
  const scope = new Scope([{ value: 'https://shop.example.com/api', kind: 'url' }]);
  assert.equal((await scope.check('https://shop.example.com/api', { resolve: false })).ok, true);
  assert.equal((await scope.check('https://shop.example.com/api/v2', { resolve: false })).ok, true);
  assert.equal((await scope.check('https://shop.example.com/admin', { resolve: false })).ok, false);
  assert.equal((await scope.check('https://shop.example.com:8443/api', { resolve: false })).ok, false);
  assert.equal((await scope.check('http://shop.example.com/api', { resolve: false })).ok, false);
});

test('deny rules beat allow rules', async () => {
  const scope = new Scope([{ value: '10.10.16.0/24', kind: 'cidr' }], ['10.10.16.66']);
  assert.equal((await scope.check('10.10.16.65')).ok, true);
  const denied = await scope.check('10.10.16.66');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /denied/);
});

test('empty scope refuses everything', async () => {
  const scope = new Scope([]);
  assert.equal(scope.empty, true);
  assert.equal((await scope.check('127.0.0.1')).ok, false);
  assert.equal((await scope.checkAll(['127.0.0.1'])).ok, false);
});

test('checkAll reports the first failure', async () => {
  const scope = new Scope([{ value: '10.0.0.0/24', kind: 'cidr' }]);
  const result = await scope.checkAll(['10.0.0.1', '8.8.8.8', '10.0.0.2']);
  assert.equal(result.ok, false);
  assert.match(result.reason, /8\.8\.8\.8/);
});

test('extractTargets pulls routable references out of a shell command', () => {
  const found = extractTargets('nmap -sV -p 1-100 10.0.0.5 example.com http://a.test/x 8.8.8.8/24');
  for (const expected of ['10.0.0.5', 'example.com', 'http://a.test/x', '8.8.8.8/24']) {
    assert.ok(found.includes(expected), `expected ${expected} in ${JSON.stringify(found)}`);
  }
});

test('extractTargets does not invent targets from filenames', () => {
  const found = extractTargets('cat /etc/passwd > report.txt; echo "version 1.0"');
  assert.deepEqual(found, []);
});

test('CIDR expansion is bounded', () => {
  assert.equal(Scope.expandCidr('10.0.0.0/30').length, 4);
  assert.deepEqual(Scope.expandCidr('10.0.0.0/8'), []);
  assert.deepEqual(Scope.expandCidr('nonsense'), []);
});

test('private address detection', () => {
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('not-an-ip'), true);
});

test('a URL rule alone keeps its path and port restrictions', async () => {
  const scope = new Scope([{ value: 'https://shop.example.com/api', kind: 'url' }]);
  assert.equal((await scope.check('https://shop.example.com/api/v2', { resolve: false })).ok, true);
  const deniedPath = await scope.check('https://shop.example.com/admin', { resolve: false });
  assert.equal(deniedPath.ok, false);
  assert.match(deniedPath.reason, /outside the URL scope rules/);
  assert.equal((await scope.check('https://shop.example.com:8443/api', { resolve: false })).ok, false);
});

test('a broader host rule still authorises a host that also has a URL rule', async () => {
  const scope = new Scope([
    { value: 'https://shop.example.com/api', kind: 'url' },
    { value: 'shop.example.com', kind: 'host' },
  ]);
  assert.equal((await scope.check('https://shop.example.com/api', { resolve: false })).ok, true);
  // the operator authorised the whole host, so other paths/ports are covered
  assert.equal((await scope.check('https://shop.example.com/admin', { resolve: false })).ok, true);
  assert.equal((await scope.check('http://shop.example.com/', { resolve: false })).ok, true);
});

test('a URL is authorised by the network rule that contains its host', async () => {
  const scope = new Scope([{ value: '10.10.16.16/28', kind: 'cidr' }]);
  assert.equal((await scope.check('http://10.10.16.27:8080', { resolve: false })).ok, true);
  assert.equal((await scope.check('http://10.10.16.32:8080', { resolve: false })).ok, false); // .32 is outside 16-31
});
