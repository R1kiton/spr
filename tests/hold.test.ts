import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLD_MS, idleHold, stepHold, type Hold } from "../lib/hold";
import type { Move } from "../lib/game";

function run(frames: [Move | null, number][], start: Hold = idleHold) {
  let hold = start;
  return frames.map(([move, now]) => { const step = stepHold(hold, move, now); hold = step.hold; return step; });
}

test("holding a gesture fires once the hold time is reached", () => {
  const steps = run([["piedra", 0], ["piedra", HOLD_MS / 2], ["piedra", HOLD_MS]]);
  assert.equal(steps[1].progress, 0.5);
  assert.equal(steps[1].fire, null);
  assert.equal(steps[2].fire, "piedra");
});
test("a fired gesture does not fire again until released", () => {
  const steps = run([["papel", 0], ["papel", HOLD_MS], ["papel", HOLD_MS * 3], [null, HOLD_MS * 3 + 500], ["papel", HOLD_MS * 4], ["papel", HOLD_MS * 5]]);
  assert.equal(steps[1].fire, "papel");
  assert.equal(steps[2].fire, null);
  assert.equal(steps[2].progress, 0);
  assert.equal(steps[5].fire, "papel");
});
test("changing gesture restarts the hold and can fire a new round", () => {
  const steps = run([["piedra", 0], ["piedra", HOLD_MS], ["tijera", HOLD_MS + 100], ["tijera", HOLD_MS * 2 + 50], ["tijera", HOLD_MS * 2 + 100]]);
  assert.equal(steps[1].fire, "piedra");
  assert.equal(steps[3].fire, null);
  assert.equal(steps[4].fire, "tijera");
});
test("a brief dropout keeps the hold, a long one resets it", () => {
  const brief = run([["tijera", 0], ["tijera", 900], [null, 1000], ["tijera", 1150], ["tijera", HOLD_MS]]);
  assert.equal(brief[4].fire, "tijera");
  const long = run([["tijera", 0], ["tijera", 900], [null, 1000], [null, 1300], ["tijera", 1400], ["tijera", HOLD_MS]]);
  assert.equal(long[5].fire, null);
});
test("nothing fires while no hand is detected, even inside the dropout grace", () => {
  const steps = run([["piedra", 0], ["piedra", HOLD_MS - 100], [null, HOLD_MS + 50]]);
  assert.equal(steps[2].fire, null);
});
