/**
 * Injectable clock — the single seam for all time-related decisions.
 *
 * Every schedule, cutoff, "today", expiry, and late/on-time decision MUST route
 * through `now()` / `today()` instead of calling `new Date()` / `Date.now()`
 * inline. Tests override the clock to drive time-based behavior deterministically.
 *
 * Default: real wall-clock time (no changes needed in production).
 */

let clockFn: () => Date = () => new Date();

/** Returns the current moment (injectable). */
export function now(): Date {
  return clockFn();
}

/** Returns today's date at 00:00:00.000 local (injectable). */
export function today(): Date {
  const d = clockFn();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Override the clock for testing. Pass `undefined` to restore the real clock. */
export function setClock(fn: (() => Date) | undefined): void {
  clockFn = fn ?? (() => new Date());
}
