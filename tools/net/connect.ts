/**
 * Raw TCP helpers: a cancellable connect probe and a banner grab.
 *
 * Kept separate from the scanner so other tools can reuse the probe without
 * pulling in port-list handling.
 */

import net from 'node:net';

export function connectBanner(host: string, port: number, timeoutMs: number, probe?: string, signal?: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = new net.Socket();
    const done = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(chunks.length ? Buffer.concat(chunks).toString('utf8').trim() : undefined));
    socket.on('error', () => done(chunks.length ? Buffer.concat(chunks).toString('utf8').trim() : undefined));
    socket.on('data', (data) => {
      chunks.push(data);
      if (Buffer.concat(chunks).length > 8192) done(Buffer.concat(chunks).toString('utf8').trim());
    });
    socket.on('close', () => done(chunks.length ? Buffer.concat(chunks).toString('utf8').trim() : undefined));
    const onAbort = (): void => done(undefined);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.connect(port, host, () => {
      if (probe) socket.write(probe);
    });
  });
}
