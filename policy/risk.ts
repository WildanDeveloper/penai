/** Risk ordering: how the engine compares an action's risk against a mode's ceiling. */

import type { Mode, Risk } from '../model/index.js';
import { RISK_ORDER } from '../model/index.js';

const RANK: Record<Risk, number> = Object.fromEntries(
  RISK_ORDER.map((risk, index) => [risk, index]),
) as Record<Risk, number>;

/** True when `risk` is at or below the ceiling. */
export function riskAtLeast(risk: Risk, ceiling: Risk): boolean {
  return RANK[risk] <= RANK[ceiling];
}
