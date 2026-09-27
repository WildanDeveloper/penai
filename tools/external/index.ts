/**
 * Bridge to external security tooling.
 *
 * Adapters are registered only when their binary is on PATH; the built-in tools
 * remain the fallback for everything.
 */

import type { ExternalTool } from '../../model/index.js';
import { availableTools } from './discover.js';
import { nmap } from './adapters/nmap.js';
import { httpxProbe } from './adapters/httpx.js';
import { nucleiScan } from './adapters/nuclei.js';
import { ffuf } from './adapters/ffuf.js';
import { katana } from './adapters/katana.js';
import { sqlmapTool } from './adapters/sqlmap.js';
import { niktoTool } from './adapters/nikto.js';
import { subfinderTool } from './adapters/subfinder.js';

const ADAPTERS: Record<string, ExternalTool> = {
  nmap,
  httpx: httpxProbe,
  nuclei: nucleiScan,
  ffuf,
  katana,
  sqlmap: sqlmapTool,
  nikto: niktoTool,
  subfinder: subfinderTool,
};

export const externalTools: ExternalTool[] = availableTools()
  .map(({ name }) => ADAPTERS[name])
  .filter((tool): tool is ExternalTool => Boolean(tool));

export { nmap, httpxProbe, nucleiScan, ffuf, katana, sqlmapTool, niktoTool, subfinderTool };
export { which, availableTools } from './discover.js';
export { execCapture } from './exec.js';
export { runExternal } from './runner.js';
