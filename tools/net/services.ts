/**
 * Service fingerprinting.
 *
 * The port table and the banner heuristics live together so adding a protocol
 * only means touching one file.
 */
import type { BannerResult } from './services-types.js';
export const COMMON_SERVICES: Record<number, string> = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3',
  135: 'msrpc', 139: 'netbios-ssn', 143: 'imap', 443: 'https', 445: 'smb', 587: 'smtp',
  993: 'imaps', 995: 'pop3s', 1433: 'mssql', 1521: 'oracle', 2049: 'nfs', 2375: 'docker-api',
  3000: 'http-alt', 3306: 'mysql', 3389: 'rdp', 4444: 'metasploit', 5000: 'http-alt',
  5432: 'postgres', 5900: 'vnc', 6379: 'redis', 8000: 'http-alt', 8080: 'http-proxy',
  8443: 'https-alt', 8888: 'http-alt', 9000: 'http-alt', 9090: 'http-alt', 9200: 'elasticsearch',
  11211: 'memcached', 27017: 'mongodb',
};

/** Notable exposed management services worth a human look. */
export const RISKY_SERVICES: Record<number, { severity: 'low' | 'medium' | 'high' | 'critical'; note: string }> = {
  21: { severity: 'medium', note: 'FTP exposed — cleartext credentials unless FTPS is enforced' },
  23: { severity: 'high', note: 'Telnet exposed — credentials traverse the network in cleartext' },
  445: { severity: 'high', note: 'SMB exposed to the network — review signing, encryption and share ACLs' },
  1433: { severity: 'medium', note: 'MSSQL reachable — should not be internet facing' },
  3306: { severity: 'medium', note: 'MySQL reachable — should not be internet facing' },
  5432: { severity: 'medium', note: 'PostgreSQL reachable — should not be internet facing' },
  6379: { severity: 'high', note: 'Redis reachable — unauthenticated by default in many deployments' },
  27017: { severity: 'high', note: 'MongoDB reachable — unauthenticated by default in many deployments' },
  9200: { severity: 'high', note: 'Elasticsearch reachable — frequently unauthenticated' },
  2375: { severity: 'critical', note: 'Docker API exposed — equivalent to host root if unauthenticated' },
  11211: { severity: 'high', note: 'Memcached reachable — amplification and cache poisoning risk' },
  5900: { severity: 'medium', note: 'VNC reachable — verify authentication and encryption' },
  3389: { severity: 'medium', note: 'RDP reachable — review NLA and lockout policy' },
  4444: { severity: 'critical', note: 'Metasploit default handler port open — investigate immediately' },
};


export function fingerprint(banner: string | undefined, port: number): string | undefined {
  const service = COMMON_SERVICES[port];
  if (!banner) return service;
  const b = banner.toLowerCase();
  const rules: [RegExp, string][] = [
    [/^ssh-|openssh/, 'ssh (OpenSSH)'],
    [/\bssh-2\.0-/, 'ssh'],
    [/^220[ -].*smtp|^\s*e?smtp/, 'smtp'],
    [/^220[ -].*ftp|^220[ -]/, 'ftp'],
    [/^\* ok|^\+ ok|imap/, 'imap'],
    [/^HTTP\/1\.[01] 200/, 'http'],
    [/^220.*(mysql|mariadb)/, 'mysql'],
    [/^RSPY/, 'ssh (dropbear)'],
    [/^\x00\x00\x00/, 'binary protocol (possible MySQL/Redis)'],
  ];
  for (const [re, label] of rules) {
    if (re.test(b)) return label;
  }
  if (b.includes('redis')) return 'redis';
  if (b.includes('postgresql')) return 'postgres';
  return service;
}
