/**
 * Shell handling.
 *
 * Shell execution is off by default and, when enabled, restricted to an
 * allowlist of binaries with no shell metacharacters, because one unvalidated
 * string is all it takes to turn "scan this host" into "run whatever the model
 * felt like".
 */

import { classifyTarget } from '../scope/index.js';

/** Binaries the model may shell out to when shell execution is enabled. */
export const ALLOWED_BINARIES = new Set([
  'nmap', 'curl', 'openssl', 'nc', 'dig', 'host', 'whois', 'httpx', 'nuclei',
  'ffuf', 'feroxbuster', 'gobuster', 'dirsearch', 'katana', 'sqlmap', 'nikto',
  'sslscan', 'testssl.sh', 'wafw00f', 'subfinder', 'amass', 'naabu', 'dnsx',
  'python3', 'python', 'jq', 'sed', 'grep', 'awk', 'head', 'tail', 'sort',
  'uniq', 'wc', 'base64', 'xxd', 'strings', 'timeout', 'dig', 'traceroute',
]);

/**
 * Chars that let one "command" become several, or redirect output. Note that
 * `?` is deliberately absent: it is part of ordinary URLs in arguments.
 */
const SHELL_METACHARS = /[;&|<>`${}\n\r\\]/;

export function shellMetachars(): RegExp {
  return SHELL_METACHARS;
}

/** Quote-aware tokenizer: enough to split a command without evaluating it. */
export function splitArgs(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

export function hasShellMetachars(command: string): boolean {
  return SHELL_METACHARS.test(command);
}

/** Does this string parse as something we could connect to? */
export function looksLikeTarget(value: string): boolean {
  try {
    classifyTarget(value);
    return true;
  } catch {
    return false;
  }
}

/** Argument names whose values are things the tool will actually connect to. */
export const TARGET_ARG = /^(target|targets|host|hosts|url|urls|domain|domains|ip|ips|base|baseurl|base_url|subdomain|subdomains|origin_path)$/i;
