/**
 * Turning an HTTP failure into something an operator can act on.
 *
 * A bare status code is not enough: the common failures (no key, wrong base URL,
 * rate limited) each have a specific fix worth stating.
 *
 * The free tier gets its own wording, because its two failure modes are not the
 * same as a paid provider's and neither is fixed by adding a key:
 *
 *   - `429 FreeUsageLimitError` means this particular free model is busy. Another
 *     free model usually answers, so the fix is to switch, not to wait.
 *   - `403 FreeTierError` means the gateway will not serve that model to an
 *     anonymous caller at all.
 *
 * Being able to tell those apart is the whole job here. "Rate limited, wait and
 * retry" would send an operator to wait out a limit that resets per model.
 */

import { ZEN } from '../catalog.js';

const FREE_USAGE = /freeusagelimiterror|free usage|rate limit exceeded/i;
const FREE_TIER = /freetiererror|free tier/i;

export function describeHttpError(status: number, body: string, baseUrl = ''): string {
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } | string; message?: string };
    const message =
      typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
    if (message) detail = message;
  } catch {
    /* keep raw body */
  }

  const onZen = baseUrl.includes('opencode.ai');
  if (onZen && status === 429 && FREE_USAGE.test(detail)) {
    return (
      `the free tier is busy for this model (${detail.slice(0, 120)}). ` +
      `Another free model usually answers: run /model and pick one, or set ` +
      `PENAI_API_KEY for the paid tier. Free models: ${ZEN.freeModels.slice(0, 4).join(', ')}…`
    );
  }
  if (onZen && (status === 403 || status === 500) && FREE_TIER.test(detail)) {
    return (
      `the anonymous tier will not serve this model (${detail.slice(0, 120)}). ` +
      `Run /model and pick another free one, or set PENAI_API_KEY.`
    );
  }

  const hint: Record<number, string> = {
    401: 'API key missing or invalid (set PENAI_API_KEY)',
    403: 'Key rejected for this model or provider',
    404: 'Endpoint not found — check PENAI_BASE_URL points at the API root, e.g. https://host/v1',
    429: 'Rate limited by the provider — wait and retry',
  };
  return `provider error ${status}${hint[status] ? ` (${hint[status]})` : ''}: ${detail.slice(0, 300)}`;
}
