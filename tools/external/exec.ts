/**
 * Running an external tool and capturing its output.
 *
 * Every call goes through here so timeouts, cancellation and output capture
 * behave the same for every adapter.
 */

import { spawn } from 'node:child_process';

/** Everything a finished (or killed) tool run produced. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  command: string;
}

export function execCapture(
  command: string,
  argv: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: string[] = [];
    const err: string[] = [];
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ stdout: out.join(''), stderr: err.join(''), code, timedOut, command: `${command} ${argv.join(' ')}`.trim() });
    };
    const onAbort = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => out.push(d.toString()));
    child.stderr.on('data', (d) => err.push(d.toString()));
    child.on('error', (error) => {
      err.push(String(error.message));
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
