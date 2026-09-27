/**
 * Command patterns refused outright, and patterns that are legitimate but must
 * never be run automatically.
 *
 * Hard denials are unconditional: no mode, no scope entry and no operator
 * approval makes `curl ... | sh` or a packet flood acceptable in an assessment.
 * Manual-only actions are shown to the operator to run themselves.
 */

import type { Risk } from '../model/index.js';

export const HARD_DENY: { re: RegExp; why: string }[] = [
  { re: /\b(hping3?|hping2|goldeneye|slowloris|mdos|loic|ettercap|aircrack-ng|stress-ng|scapy)\b/i, why: 'denial-of-service / packet-flood tooling' },
  { re: /(^|\s)-{1,2}flood(\s|$)/i, why: 'flood attack mode' },
  { re: /(^|\s)-f(\s|$)/, why: 'nmap stealth/flood scan mode (-f)' },
  { re: /(^|\s)-S\s*\d|(--)?spoof(\s|$)|(^|\s)dos(\s|$)/i, why: 'flood / spoofed-source scanning' },
  { re: /\brm\s+-[a-z]*[rf][a-z]*\s/i, why: 'recursive delete' },
  { re: /\b(mkfs(\.\w+)?|fdisk|parted|wipefs)\b/i, why: 'filesystem modification' },
  { re: /\bdd\b[^|;&]*\bof=\/dev\//i, why: 'raw write to a block device' },
  { re: /\/dev\/[sh]d[a-z]/i, why: 'raw disk device access' },
  { re: /\b(shutdown|reboot|halt|poweroff|init 0|init 6)\b/i, why: 'host power/state change' },
  { re: /\bchmod\s+-R\s+777\s+\/(\s|$)/i, why: 'world-writable root' },
  { re: /\buseradd\b|\buserdel\b|\bchpasswd\b|\busermod\b/i, why: 'local account modification' },
  { re: /authorized_keys|\/etc\/sudoers|\bvisudo\b|\bcrontab\b/i, why: 'persistence / privilege modification' },
  { re: /\b(systemctl|service)\s+(enable|start|restart|stop)\b/i, why: 'service state change' },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&.*\}\s*;?\s*:/, why: 'fork bomb' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i, why: 'download-and-execute' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(python3?|perl|ruby|node)\b/i, why: 'download-and-execute' },
  { re: /\bgit\s+clone\b[^|]*\|\s*(ba)?sh\b/i, why: 'download-and-execute' },
  { re: /(^|\s)(eval|exec)\s*\(/i, why: 'dynamic code evaluation' },
  { re: /\bchattr\b.*-i|\bsetcap\b/i, why: 'file attribute / capability manipulation' },
  { re: /\/proc\/self\/mem|\bpkexec\b/i, why: 'local privilege escalation primitive' },
];

/** Not auto-executed, but legitimate in an authorised engagement. */
export const MANUAL_ONLY: { re: RegExp; why: string; risk: Risk }[] = [
  { re: /\bnc\b[^|]*\s-[a-z]*e\b|\/dev\/tcp\/|\bsocat\b[^|]*exec|\bbash\s+-i\b/i, why: 'reverse shell / interactive bind', risk: 'manual' },
  { re: /\bhydra\b|\bmedusa\b|\bhashcat\b|\bjohn\b\s+--|\bncrack\b/i, why: 'credential attack', risk: 'manual' },
  { re: /\bsqlmap\b[^|]*(--dump|--os-shell|--sql-shell|--file-write|-r\s)/i, why: 'database exfiltration / shell via SQLi', risk: 'manual' },
  { re: /\bmimikatz\b|\bpsexec\b|\bpass-the-hash\b/i, why: 'credential material extraction', risk: 'manual' },
  { re: /\bmsfconsole\b|\bmsfvenom\b|\bmeterpreter\b/i, why: 'payload delivery framework', risk: 'manual' },
  { re: /\bnmap\b[^|]*\s(--script(-(vuln|exploit))?|-sC)\b/i, why: 'nmap NSE scripts (may be intrusive)', risk: 'high' },
  { re: /\bnuclei\b[^|]*\s-(?:-severity\s*(critical|high)|-config\s)/i, why: 'intrusive nuclei templates', risk: 'high' },
  { re: /\bnikto\b/i, why: 'nikto is high-volume and noisy', risk: 'high' },
];

/** Binaries the model may shell out to, when shell execution is enabled. */
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
