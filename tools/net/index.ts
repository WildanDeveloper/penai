/** Network recon tools. */

import type { BuiltinTool } from '../../model/index.js';
import { tcpScan } from './tcp-scan.js';
import { dnsResolve } from './dns.js';
import { crtshEnumerate, httpHistory } from './passive.js';
import { rdapLookup } from './rdap.js';
import { expandCidr } from './cidr.js';

export const netTools: BuiltinTool[] = [tcpScan, dnsResolve, crtshEnumerate, rdapLookup, expandCidr, httpHistory];

export { tcpScan, dnsResolve, crtshEnumerate, rdapLookup, expandCidr, httpHistory };
export { connectBanner } from './connect.js';
export { COMMON_SERVICES, RISKY_SERVICES } from './services.js';
export type { BannerResult } from './services-types.js';
