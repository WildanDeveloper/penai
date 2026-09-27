/** The decision the policy engine returns for every action it is asked about. */

import type { Risk } from '../model/index.js';

export type Action = 'run' | 'confirm' | 'deny' | 'manual';

export interface Decision {
  action: Action;
  risk: Risk;
  reason: string;
  targets: string[];
  command: string;
  tool?: string;
}
