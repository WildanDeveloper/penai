/**
 * Target extraction from free-form text.
 *
 * Used for two jobs: checking that a shell command only touches authorised
 * hosts, and warning when the model mentions an out-of-scope asset.
 */
import { ipv4ToInt } from './classify.js';


const IPV4_ANY = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV4_CIDR = /\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s'"`<>)\]]+/gi;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|co|id|ac|id|edu|gov|mil|info|biz|me|tv|xyz|sh|cloud|online|site|tech|test|local|internal|lan|localhost)\b/gi;
const NOISE_DOMAINS = new Set([
  'version.txt',
  'readme.md',
  'e.g.0',
  'i.e.0',
  'index.html',
  'file.txt',
  'a.txt',
  '1.0.0',
  '0.0.0',
]);

/**
 * Pull every routable-looking reference out of a free-form string. Used for two
 * jobs: checking that a shell command only touches authorised hosts, and
 * warning the operator when the model mentions an out-of-scope asset.
 */
export function extractTargets(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(IPV4_CIDR) ?? []) found.add(m);

  // URLs first, then blank them out so the host inside them is not also
  // reported as a bare domain.
  let rest = text;
  for (const m of text.match(URL_RE) ?? []) {
    const cleaned = m.replace(/[.,;:)]+$/, '');
    found.add(cleaned);
    rest = rest.replaceAll(m, ' ');
  }
  for (const m of rest.match(IPV4_ANY) ?? []) {
    if (ipv4ToInt(m) !== undefined) found.add(m);
  }
  for (const m of rest.match(DOMAIN_RE) ?? []) {
    const lower = m.toLowerCase();
    if (!NOISE_DOMAINS.has(lower)) found.add(lower);
  }
  return [...found];
}

export function isPrivateAddress(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) return true; // unknown format: be conservative
  const first = Math.floor(value / 0x1000000);
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && value >= 0xac100000 && value < 0xac200000) ||
    (first === 192 && value >= 0xc0a80000 && value < 0xc0a90000) ||
    (first === 169 && value >= 0xa9fe0000 && value < 0xa9ff0000) ||
    (first === 100 && value >= 0x64400000 && value < 0x64800000) ||
    (first === 0) ||
    first >= 224
  );
}
