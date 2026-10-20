import { test } from "node:test";
import assert from "node:assert/strict";
import { playerMoves } from "../lib/tracking";

const hand = (x: number, categoryName: string, score = 0.95) => ({ points: [{ x }], category: [{ categoryName, score }] });
function result(...hands: ReturnType<typeof hand>[]) {
  return { landmarks: hands.map(h => h.points), gestures: hands.map(h => h.category) };
}

test("players follow mirrored screen zones regardless of detector order", () => {
  const left = hand(0.8, "Closed_Fist");
  const right = hand(0.2, "Victory");
  assert.deepEqual(playerMoves(result(left, right)), ["piedra", "tijera"]);
  assert.deepEqual(playerMoves(result(right, left)), ["piedra", "tijera"]);
});
test("a missing hand never fills the other player's slot", () => {
  assert.deepEqual(playerMoves(result(hand(0.2, "Open_Palm"))), [null, "papel"]);
  assert.deepEqual(playerMoves(result()), [null, null]);
});
test("center and ambiguous zones cannot produce a valid round", () => {
  assert.deepEqual(playerMoves(result(hand(0.5, "Closed_Fist"))), [null, null]);
  assert.deepEqual(playerMoves(result(hand(0.8, "Closed_Fist"), hand(0.7, "Victory"))), [null, null]);
});
test("unsupported or uncertain gestures remain unrecognized", () => {
  assert.deepEqual(playerMoves(result(hand(0.8, "Thumb_Up"), hand(0.2, "Victory", 0.3))), [null, null]);
});
