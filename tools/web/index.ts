/** Web application tools. */

import type { BuiltinTool } from '../../model/index.js';
import { httpProbe } from './http-probe.js';
import { httpFetch } from './http-fetch.js';
import { headerAudit } from './header-audit.js';
import { corsCheck } from './cors-check.js';
import { exposureCheck } from './exposure-check.js';
import { dirFuzz } from './dir-fuzz.js';
import { crawl } from './crawl.js';
import { openRedirectCheck } from './open-redirect.js';

export const webTools: BuiltinTool[] = [httpProbe, httpFetch, headerAudit, corsCheck, exposureCheck, dirFuzz, crawl, openRedirectCheck];

export { httpProbe, httpFetch, headerAudit, corsCheck, exposureCheck, dirFuzz, crawl, openRedirectCheck };
export { httpRequest, formatProbe } from './http.js';
export type { HttpResult, RequestOptions } from './http.js';
