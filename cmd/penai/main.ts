#!/usr/bin/env node
/**
 * PENAI entry point.
 *
 * With no arguments it serves the core over stdio for the TUI to attach to;
 * every other subcommand is a headless operation an operator can script.
 */

import { ProviderError } from '../../ai/transport/client.js';
import { HELP, run } from '../../cli/run.js';

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ProviderError) {
      process.stderr.write(`penai: ${error.message}\n`);
    } else {
      process.stderr.write(`penai: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
    process.exitCode = 1;
  });

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'serve' || argv.length === 0) {
    const { serve } = await import('../../cli/server.js');
    const { loadConfig } = await import('../../internal/config.js');
    serve(loadConfig());
    // The server owns stdin from here, so the promise never settles.
    return new Promise<number>(() => undefined);
  }
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  return run(argv);
}
