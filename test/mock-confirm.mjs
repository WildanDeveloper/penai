/**
 * Mock provider that always proposes a medium-risk tool (dir_fuzz), so the
 * approval modal can be exercised in a PTY without a real model.
 *
 *   node test/mock-confirm.mjs [port]
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8097);

const REPLY = `Let me fuzz the content paths on the authorised target.\n\n\`\`\`penai
{"tool":"dir_fuzz","args":{"url":"http://127.0.0.1:8099","limit":40}}
\`\`\``;

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const chunks = REPLY.match(/.{1,14}/gs) ?? [REPLY];
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(
      chunks
        .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
        .join('') + 'data: [DONE]\n\n',
    );
    res.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock confirm-provider on http://127.0.0.1:${port}/v1\n`);
});
