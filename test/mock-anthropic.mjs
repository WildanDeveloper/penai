/**
 * Minimal Anthropic Messages API mock (SSE) so the non-OpenAI provider path can
 * be exercised without a real account.
 *
 *   node test/mock-anthropic.mjs [port]
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8096);

const REPLY = `Checking the authorised target first.\n\n\`\`\`penai
{"tool":"http_probe","args":{"urls":["http://127.0.0.1:8099"]}}
\`\`\``;

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (!req.url?.endsWith('/messages')) {
      res.writeHead(404).end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', content: [], model: 'claude' } })}\n\n`,
    );
    for (const piece of REPLY.match(/.{1,10}/gs) ?? [REPLY]) {
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } })}\n\n`,
      );
    }
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
  });
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock anthropic provider on http://127.0.0.1:${port}/v1\n`);
});
