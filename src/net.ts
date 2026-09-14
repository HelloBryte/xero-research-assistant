import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

/**
 * Node races IPv6 and IPv4 when connecting and gives the first family only
 * 250ms by default. On a network where IPv6 is advertised but unreachable that
 * budget expires before the IPv4 attempt completes and the whole request fails
 * as ETIMEDOUT. Wikipedia reproduced this reliably during development, while
 * curl to the same address succeeded.
 *
 * This is a process-wide setting, and it lived as a side effect inside
 * `src/http.ts`. Any other entry point that called `fetch` directly silently
 * lost it: the ground-truth checker did exactly that and could not reach
 * Wikipedia. It is a shared, explicitly called function for that reason.
 */
export function configureConnectionTimeouts(): void {
  setDefaultAutoSelectFamilyAttemptTimeout(3_000);
}
