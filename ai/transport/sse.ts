/**
 * Server-sent event parsing.
 *
 * Split out because framing bugs here are invisible until a model streams: the
 * frame separator is a blank line, and a gateway that closes without a trailing
 * blank line must not lose its last delta.
 */

import { ProviderError } from './errors.js';

interface SseEvent {
  data: string;
}

/**
 * Yield the `data:` payload of each SSE frame.
 *
 * Handles both LF and CRLF framing, and flushes a trailing partial frame when
 * the stream ends without a final blank line.
 */
export async function* sseStream(response: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) throw new ProviderError('provider returned an empty body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = function* (): Generator<SseEvent> {
    for (;;) {
      const sep = /\r?\n\r?\n/.exec(buffer);
      if (!sep) return;
      const frame = buffer.slice(0, sep.index);
      buffer = buffer.slice(sep.index + sep[0].length);
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('data:')) yield { data: line.slice(5).trim() };
      }
    }
  };

  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain();
    }
    // Some gateways close without a trailing blank line.
    buffer += decoder.decode();
    yield* drain();
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('data:')) yield { data: line.slice(5).trim() };
    }
  } finally {
    reader.releaseLock?.();
  }
}
