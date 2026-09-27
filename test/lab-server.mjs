/**
 * Intentionally vulnerable local test target for PENAI's own smoke tests.
 * Nothing here is a real target: it binds to 127.0.0.1 only and exists so the
 * built-in tools can be verified end to end.
 *
 *   node test/lab-server.mjs [port]
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);

const PAGES = {
  '/': {
    body: `<!doctype html><html><head><title>Acme Internal Portal</title>
<link rel="stylesheet" href="/css/app.css"><script src="/js/main.js"></script></head>
<body><h1>Acme Internal Portal</h1>
<nav><a href="/login">Login</a> <a href="/admin">Admin</a> <a href="/api/items?id=1">API</a>
<a href="/docs">Docs</a> <a href="https://other.example.net">Partner</a></nav>
<form action="/login" method="POST"><input name="username"><input name="password" type="password">
<input type="hidden" name="csrf" value="abc123"><button>Sign in</button></form></body></html>`,
    headers: { 'content-type': 'text/html' },
  },
  '/login': {
    body: '<!doctype html><title>Login</title><form method="POST" action="/session"><input name="user"><input name="pass" type="password"></form>',
    headers: { 'content-type': 'text/html', 'set-cookie': 'SESSIONID=deadbeef0123; Path=/' },
  },
  '/admin': {
    body: '<!doctype html><title>Admin Console</title><p>restricted area</p>',
    headers: { 'content-type': 'text/html' },
  },
  '/docs': { body: '<!doctype html><title>Docs</title><a href="/docs/api">API</a>', headers: { 'content-type': 'text/html' } },
  '/docs/api': { body: '<!doctype html><title>API docs</title>', headers: { 'content-type': 'text/html' } },
  '/api/items': { json: { items: [{ id: 1, name: 'widget' }] } },
  '/.env': { body: 'DB_PASSWORD=SuperSecret123\nAPI_KEY=sk-live-abcdef0123456789\n' },
  '/.git/config': { body: '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@internal.acme.corp:acme/portal.git\n' },
  '/phpinfo.php': { body: 'PHP Version 7.2.9 | phpinfo()' },
  '/js/main.js': { body: 'fetch("/api/items?id=1");', headers: { 'content-type': 'application/javascript' } },
  '/css/app.css': { body: 'body{font-family:sans-serif}', headers: { 'content-type': 'text/css' } },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const origin = req.headers.origin;

  if (url.pathname === '/api/items' && origin) {
    // Deliberate CORS misconfiguration for the cors_check test.
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
    });
    res.end(JSON.stringify({ items: [{ id: 1, name: 'widget' }] }));
    return;
  }
  if (req.method === 'OPTIONS' && origin) {
    res.writeHead(200, {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE',
      'access-control-allow-headers': 'authorization,content-type',
    });
    res.end();
    return;
  }

  const page = PAGES[url.pathname];
  if (!page) {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>404</title>not found');
    return;
  }
  if (page.json) {
    res.writeHead(200, { 'content-type': 'application/json', server: 'Apache/2.4.29', 'x-powered-by': 'PHP/7.2.9' });
    res.end(JSON.stringify(page.json));
    return;
  }
  // Deliberately weak: version banners, no HSTS/CSP/X-Frame-Options, cookie
  // without HttpOnly — so header_audit has something real to report.
  const pageHeaders = page.headers ?? {};
  res.writeHead(200, {
    'content-type': pageHeaders['content-type'] ?? 'text/html',
    server: 'Apache/2.4.29 (Ubuntu)',
    'x-powered-by': 'PHP/7.2.9',
    ...(pageHeaders['set-cookie'] ? { 'set-cookie': pageHeaders['set-cookie'] } : {}),
  });
  res.end(page.body);
});

server.on('clientError', (_error, socket) => socket.destroy());
process.on('uncaughtException', (error) => {
  process.stderr.write(`lab-server error: ${error.message}\n`);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`lab target listening on http://127.0.0.1:${port}\n`);
});
