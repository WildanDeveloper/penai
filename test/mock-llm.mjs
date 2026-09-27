/**
 * Mock OpenAI-compatible provider used to test the agent loop without touching a
 * real model. It streams canned replies in OpenAI SSE format and exercises the
 * paths that matter: a legitimate tool call, an out-of-scope attempt, and a
 * finding block.
 *
 *   node test/mock-llm.mjs [port]
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8098);
let calls = 0;

const REPLIES = [
  // 1) probe the authorised target, then try to leave scope
  `Starting with a liveness check on the authorised target.\n\n\`\`\`penai
{"tool":"http_probe","args":{"urls":["http://127.0.0.1:8099"]}}
\`\`\`

\`\`\`penai
{"tool":"http_probe","args":{"urls":["http://not-in-scope.example.com"]}}
\`\`\``,

  // 2) one of them was refused; now look for exposed files in scope
  `Understood, I will stay on the authorised target. Checking for exposed files there.\n\n\`\`\`penai
{"tool":"exposure_check","args":{"urls":["http://127.0.0.1:8099"]}}
\`\`\``,

  // 3) record a finding and finish
  `Recording the confirmed issue and wrapping up.\n\n\`\`\`penai
{"finding":{"title":"Environment file exposed over HTTP","severity":"high","asset":"http://127.0.0.1:8099/.env","cwe":"CWE-538","owasp":"A01:2021 Broken Access Control","description":"The application serves its .env file, which contains database and API credentials.","evidence":"GET /.env returned HTTP 200 with credentials in the body.","reproduction":"curl -i http://127.0.0.1:8099/.env","remediation":"Remove the file from the document root and rotate every exposed secret."}}
\`\`\`

Assessment complete: one confirmed high severity issue.`,
];

function sse(text) {
  const chunks = text.match(/.{1,12}/gs) ?? [text];
  return chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end('{}');
    return;
  }
  const body = JSON.parse((req.headers['x-llm-body'] ?? '{}') || '{}');
  void body;
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const reply = REPLIES[Math.min(calls, REPLIES.length - 1)];
    calls += 1;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(sse(reply));
    res.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock llm listening on http://127.0.0.1:${port}/v1\n`);
});
