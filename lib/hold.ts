import type { Move } from "./game";

export const HOLD_MS = 2000;
const GRACE_MS = 300;

export type Hold = { move: Move | null; since: number; seen: number; spent: boolean };
export const idleHold: Hold = { move: null, since: 0, seen: 0, spent: false };

// Tracks how long one gesture has been held. A short detection dropout keeps the hold
// alive; once a hold fires, that gesture must be released or changed before it fires again.
export function stepHold(hold: Hold, move: Move | null, now: number): { hold: Hold; progress: number; fire: Move | null } {
  let next: Hold;
  if (move && move === hold.move) next = { ...hold, seen: now };
  else if (move) next = { move, since: now, seen: now, spent: false };
  else if (hold.move && now - hold.seen <= GRACE_MS) next = hold;
  else next = idleHold;
  if (!next.move || next.spent) return { hold: next, progress: 0, fire: null };
  const progress = Math.min(1, (now - next.since) / HOLD_MS);
  if (progress < 1 || !move) return { hold: next, progress, fire: null };
  return { hold: { ...next, spent: true }, progress: 1, fire: move };
}
