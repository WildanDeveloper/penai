/** Built-in path and hostname wordlists, plus SecLists discovery. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PATHS = [
  'admin', 'administrator', 'api', 'api/v1', 'api/v2', 'app', 'assets', 'backup',
  'backup.zip', 'backup.sql', 'bin', 'build', 'cgi-bin', 'config', 'config.json',
  'config.php', 'console', 'css', 'dashboard', 'data', 'db', 'debug', 'dev',
  'doc', 'docs', 'download', 'downloads', 'env', '.env', '.env.bak', '.env.local',
  '.env.production', 'error', 'error_log', 'files', 'graphql', 'health',
  'healthcheck', 'help', 'home', 'images', 'img', 'include', 'includes', 'index',
  'index.html', 'index.php', 'info', 'info.php', 'install', 'js', 'json', 'lib',
  'log', 'login', 'logout', 'logs', 'mail', 'manager', 'media', 'metrics',
  'monitor', 'old', 'package.json', 'phpinfo.php', 'phpmyadmin', 'private',
  'prod', 'public', 'readme.md', 'register', 'robots.txt', 'secret', 'server-status',
  'sitemap.xml', 'sql', 'static', 'stats', 'status', 'storage', 'swagger',
  'swagger.json', 'swagger-ui.html', 'sys', 'system', 'temp', 'test', 'tests',
  'tmp', 'tools', 'upload', 'uploads', 'user', 'users', 'v1', 'v2', 'vendor',
  'web.config', 'webmail', 'wp-admin', 'wp-config.php', 'wp-content', 'wp-login.php',
];

export const SUBDOMAINS = [
  'admin', 'api', 'app', 'auth', 'backup', 'beta', 'cdn', 'ci', 'cms', 'dev',
  'docs', 'git', 'grafana', 'internal', 'jira', 'jenkins', 'kibana', 'lab', 'mail',
  'mgmt', 'monitor', 'ns1', 'ns2', 'portal', 'preprod', 'prod', 'qa', 'redis',
  'sandbox', 'staging', 'static', 'test', 'vpn', 'uat', 'old', 'vpn2', 'webmail',
];

export interface WordlistPaths {
  discovery: string[];
  subdomains: string[];
}

const SECLISTS_CANDIDATES = [
  '/usr/share/seclists',
  '/usr/share/wordlists',
  '/opt/seclists',
  '/usr/local/share/seclists',
  `${process.env.HOME ?? ''}/SecLists`,
  `${process.env.HOME ?? ''}/wordlists`,
];

/** Resolve wordlists from disk when available, otherwise use built-ins. */
export function resolveWordlists(): WordlistPaths {
  const discovery: string[] = [...PATHS];
  const subdomains: string[] = [...SUBDOMAINS];
  for (const root of SECLISTS_CANDIDATES) {
    if (!root) continue;
    const common = `${root}/Discovery/Web-Content/common.txt`;
    if (existsSync(common)) {
      try {
        discovery.push(
          ...readFileSync(common, 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        );
      } catch {
        /* ignore unreadable list */
      }
    }
  }
  return { discovery, subdomains };
}
/** Files and headers that should never be public, used by the exposure and header checks. */

export const SENSITIVE_PATHS = [
  { path: '/.env', note: 'environment / secrets file' },
  { path: '/.env.bak', note: 'environment backup' },
  { path: '/.git/config', note: 'git remote and config' },
  { path: '/.git/HEAD', note: 'git HEAD' },
  { path: '/.svn/entries', note: 'subversion metadata' },
  { path: '/.DS_Store', note: 'directory listing leak' },
  { path: '/.htaccess', note: 'apache configuration' },
  { path: '/.htpasswd', note: 'password file' },
  { path: '/.aws/credentials', note: 'AWS credentials' },
  { path: '/web.config', note: 'IIS configuration' },
  { path: '/wp-config.php.bak', note: 'WordPress config backup' },
  { path: '/phpinfo.php', note: 'PHP configuration disclosure' },
  { path: '/server-status', note: 'Apache status' },
  { path: '/server-info', note: 'Apache info' },
  { path: '/actuator/env', note: 'Spring Boot environment' },
  { path: '/actuator/health', note: 'Spring Boot health' },
  { path: '/debug/pprof', note: 'Go pprof' },
  { path: '/config.json', note: 'application config' },
  { path: '/swagger.json', note: 'API schema' },
  { path: '/api-docs', note: 'API docs' },
  { path: '/backup.zip', note: 'archive backup' },
  { path: '/backup.sql', note: 'database dump' },
  { path: '/dump.sql', note: 'database dump' },
  { path: '/id_rsa', note: 'private key' },
  { path: '/.npmrc', note: 'npm credentials' },
  { path: '/.dockerignore', note: 'docker ignore' },
  { path: '/docker-compose.yml', note: 'compose file' },
];

export const HEADERS_TO_CHECK = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'x-xss-protection',
  'server',
  'x-powered-by',
  'set-cookie',
  'access-control-allow-origin',
];
