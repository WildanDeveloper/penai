/**
 * The fully resolved configuration the app runs with.
 *
 * Assembled by `internal/config` from, in order: environment, the penai config
 * file, the operator's opencode config, then built-in defaults.
 */

import type { PolicyConfig } from './policy.js';
import type { ProviderConfig } from './provider.js';

export interface AppConfig {
  provider: ProviderConfig;
  policy: PolicyConfig;
  dataDir: string;
  engagement: string;
  tester: string;
}
