/**
 * Locating external security tools.
 *
 * PENAI never installs offensive tooling. It detects what is already on PATH and
 * registers only those adapters, so a missing binary degrades to the built-in
 * equivalent instead of failing.
 */

import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export function which(bin: string): string | undefined {
  const found = join(process.env.PATH ?? '', bin);
  try {
    accessSync(found, constants.X_OK);
    return found;
  } catch {
    /* not on PATH */
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

/** Binaries worth detecting, in the order the UI lists them. */
const CANDIDATES = [
  'nmap', 'httpx', 'nuclei', 'ffuf', 'feroxbuster', 'gobuster', 'katana',
  'sqlmap', 'nikto', 'subfinder', 'amass', 'naabu', 'dnsx', 'openssl', 'curl',
  'nc', 'wafw00f', 'sslscan', 'testssl.sh',
];

export function availableTools(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const name of CANDIDATES) {
    const path = which(name);
    if (path) out.push({ name, path });
  }
  return out;
}
