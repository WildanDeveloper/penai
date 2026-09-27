/**
 * Argument parsing for the CLI.
 *
 * Supports `--flag value`, `--flag=value` and short flags. Repeated flags
 * accumulate, because a list argument like `--ports 80,443 --ports 8000-8010`
 * has to come out the other end as `80,443,8000-8010`.
 */

export interface ParsedArgs {
  command: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string[]>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        push(flags, body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        push(flags, body, next);
        i += 1;
      } else {
        push(flags, body, 'true');
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length === 2) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        push(flags, arg.slice(1), next);
        i += 1;
      } else {
        push(flags, arg.slice(1), 'true');
      }
      continue;
    }

    command.push(arg);
  }

  return { command, flags };
}

function push(flags: Map<string, string[]>, key: string, value: string): void {
  const list = flags.get(key) ?? [];
  list.push(value);
  flags.set(key, list);
}

/** Last occurrence wins, which is what people expect for a scalar flag. */
export function flag(flags: Map<string, string[]>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags.get(name);
    if (value && value.length > 0) return value[value.length - 1];
  }
  return undefined;
}

/** Comma-split every occurrence, for list arguments. */
export function flagList(flags: Map<string, string[]>, ...names: string[]): string[] {
  for (const name of names) {
    const value = flags.get(name);
    if (value && value.length > 0) {
      return value.flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}
