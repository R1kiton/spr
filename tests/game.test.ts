import { test } from "node:test";
import assert from "node:assert/strict";
import { gestureMove, moves, outcome, randomMove } from "../lib/game";

test("all nine matchups follow the rules", () => {
  const expected = [["draw", "lose", "win"], ["win", "draw", "lose"], ["lose", "win", "draw"]];
  moves.forEach((player, i) => moves.forEach((computer, j) => assert.equal(outcome(player, computer), expected[i][j])));
});
test("only supported gestures with sufficient confidence count", () => {
  assert.equal(gestureMove("Closed_Fist", 0.9), "piedra");
  assert.equal(gestureMove("Open_Palm", 0.9), "papel");
  assert.equal(gestureMove("Victory", 0.9), "tijera");
  assert.equal(gestureMove("Victory", 0.64), null);
  assert.equal(gestureMove("Thumb_Up", 0.99), null);
  assert.equal(gestureMove("None", 0.99), null);
});
test("computer returns a legal move", () => {
  for (let i = 0; i < 50; i++) assert.ok(moves.includes(randomMove()));
});
