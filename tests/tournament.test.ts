import { test } from "node:test";
import assert from "node:assert/strict";
import type { Move } from "../lib/game";
import {
  activeMatch, createTournament, forfeit, GAME_BREAK_MS, GAME_DURATION_MS, MAX_GAMES, ROUND_BREAK_MS,
  roundName, settleTournament, submitTournamentMove, type Tournament,
} from "../lib/tournament";
import { applyRoomAction, createRoom, joinRoom, publicRoom } from "../lib/rooms";

const NOW = 50_000;
const keepOrder = <T,>(items: T[]) => [...items];
const people = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Jugador ${index + 1}` }));
const bracket = (count: number) => createTournament(people(count), NOW, keepOrder);

/** Plays one game of a player's current match; returns the time after the reveal pause. */
function game(t: Tournament, a: Move, b: Move, player: string, now: number) {
  const match = activeMatch(t, player)!;
  submitTournamentMove(t, match.a!, a, match.game, now);
  submitTournamentMove(t, match.b!, b, match.game, now);
  return now + GAME_BREAK_MS;
}

test("brackets size to the next power of two and give byes to the best seeds", () => {
  assert.throws(() => bracket(3), /al menos 4/);
  assert.throws(() => bracket(17), /máximo 16/);
  const four = bracket(4);
  assert.deepEqual(four.rounds.map(round => round.length), [2, 1]);
  assert.deepEqual(four.rounds[0].map(match => [match.a, match.b]), [["p1", "p4"], ["p2", "p3"]]);
  assert.ok(four.rounds[0].every(match => !match.done && match.game === 1));
  const five = bracket(5);
  assert.deepEqual(five.rounds.map(round => round.length), [4, 2, 1]);
  assert.deepEqual(five.rounds[0].filter(match => match.walkover).map(match => match.winner), ["p1", "p2", "p3"]);
  assert.deepEqual([five.rounds[0][3].a, five.rounds[0][3].b, five.rounds[0][3].done], ["p4", "p5", false]);
  assert.deepEqual([five.rounds[1][0].a, five.rounds[1][0].b, five.rounds[1][1].a, five.rounds[1][1].b], ["p1", "p2", "p3", null]);
  assert.equal(bracket(16).rounds[0].length, 8);
  assert.deepEqual(roundName(0, 4), "Octavos de final");
  assert.deepEqual(roundName(3, 4), "Final");
});

test("a match is best of 3: tied games replay and two wins advance", () => {
  const t = bracket(4);
  let now = game(t, "piedra", "tijera", "p1", NOW);
  now = game(t, "papel", "papel", "p1", now + GAME_BREAK_MS);
  const match = t.rounds[0][0];
  assert.equal(match.done, false);
  assert.deepEqual(match.wins, { p1: 1 });
  assert.equal(match.game, 3);
  assert.throws(() => submitTournamentMove(t, "p1", "piedra", 3, now - 1), /aún no empieza/);
  now = game(t, "tijera", "piedra", "p1", now);
  now = game(t, "papel", "piedra", "p1", now + GAME_BREAK_MS);
  assert.equal(match.done, true);
  assert.equal(match.winner, "p1");
  assert.deepEqual(match.wins, { p1: 2, p4: 1 });
  assert.equal(match.games.length, 4);
  assert.equal(t.rounds[1][0].a, "p1", "The winner takes their slot in the next round right away.");
});

test("moves are tied to the current game, immutable, and safe to retry", () => {
  const t = bracket(4);
  assert.throws(() => submitTournamentMove(t, "p1", "piedra", 2, NOW), /ronda cambió/);
  submitTournamentMove(t, "p1", "piedra", 1, NOW);
  assert.throws(() => submitTournamentMove(t, "p1", "papel", 1, NOW), /Ya elegiste/);
  submitTournamentMove(t, "p1", "piedra", 1, NOW);
  submitTournamentMove(t, "p4", "tijera", 1, NOW);
  submitTournamentMove(t, "p4", "tijera", 1, NOW + 1);
  assert.deepEqual(t.rounds[0][0].wins, { p1: 1 });
  assert.throws(() => submitTournamentMove(t, "p1", "piedra", 2, NOW + GAME_BREAK_MS + GAME_DURATION_MS), /ya terminó/);
});

test("timeouts give the game to whoever played; two empty games advance the better seed", () => {
  const t = bracket(4);
  submitTournamentMove(t, "p4", "papel", 1, NOW);
  settleTournament(t, NOW + GAME_DURATION_MS);
  assert.deepEqual(t.rounds[0][0].wins, { p4: 1 });
  const second = t.rounds[0][1];
  settleTournament(t, second.deadline!);
  settleTournament(t, second.deadline!);
  assert.equal(second.done, true);
  assert.equal(second.winner, "p2");
  assert.deepEqual(second.wins, {});
});

test("an endless tie still ends after the game limit", () => {
  const t = bracket(4);
  let now = NOW;
  for (let index = 0; index < MAX_GAMES; index++) now = game(t, "piedra", "piedra", "p2", now) + 1;
  const match = t.rounds[0][1];
  assert.equal(match.done, true);
  assert.equal(match.winner, "p2");
  assert.equal(match.games.length, MAX_GAMES);
});

test("rounds advance together after a pause, and the final crowns a champion", () => {
  const t = bracket(4);
  let now = game(t, "piedra", "tijera", "p1", NOW);
  now = game(t, "piedra", "tijera", "p1", now);
  assert.equal(settleTournament(t, now), false);
  assert.equal(t.current, 0, "Semifinals wait for every first-round match.");
  now = game(t, "papel", "piedra", "p2", now);
  now = game(t, "papel", "piedra", "p2", now);
  assert.equal(settleTournament(t, now), false);
  assert.equal(t.breakUntil, now + ROUND_BREAK_MS);
  assert.equal(settleTournament(t, now + ROUND_BREAK_MS - 1), false);
  assert.equal(t.current, 0);
  settleTournament(t, now + ROUND_BREAK_MS);
  assert.equal(t.current, 1);
  assert.deepEqual([t.rounds[1][0].a, t.rounds[1][0].b], ["p1", "p2"]);
  now += ROUND_BREAK_MS;
  now = game(t, "tijera", "papel", "p1", now);
  now = game(t, "tijera", "papel", "p1", now);
  assert.equal(settleTournament(t, now), true);
  assert.equal(t.champion, "p1");
});

test("leaving forfeits the current match and any later one", () => {
  const t = bracket(4);
  forfeit(t, "p4");
  assert.equal(t.rounds[0][0].winner, "p1");
  assert.equal(t.rounds[0][0].walkover, true);
  forfeit(t, "p1");
  let now = game(t, "piedra", "tijera", "p2", NOW);
  now = game(t, "piedra", "tijera", "p2", now);
  settleTournament(t, now);
  settleTournament(t, now + ROUND_BREAK_MS);
  assert.equal(t.rounds[1][0].winner, "p2");
  assert.equal(t.champion, "p2");
});

test("tournament rooms hold 4 to 16 players, keep moves secret, and survive a player leaving", () => {
  let room = createRoom("TORNEO", { id: "p1", name: "Jugador 1", tokenHash: "secret-1" }, "tournament", 3, NOW);
  for (let index = 2; index <= 16; index++) room = joinRoom(room, { id: `p${index}`, name: `Jugador ${index}`, tokenHash: `secret-${index}` }, NOW + index);
  assert.throws(() => joinRoom(room, { id: "p17", name: "Jugador 17", tokenHash: "secret-17" }, NOW + 20), /máximo es de 16/);
  const small = joinRoom(joinRoom(createRoom("TORNEO", { id: "p1", name: "Uno", tokenHash: "s1" }, "tournament", 3, NOW), { id: "p2", name: "Dos", tokenHash: "s2" }, NOW), { id: "p3", name: "Tres", tokenHash: "s3" }, NOW);
  assert.throws(() => applyRoomAction(small, "p1", { type: "start" }, NOW + 30), /al menos 4/);

  room = applyRoomAction(room, "p1", { type: "start" }, NOW + 30);
  assert.equal(room.phase, "playing");
  assert.equal(room.tournament!.rounds[0].length, 8);
  const match = activeMatch(room.tournament!, "p1")!;
  const rival = match.a === "p1" ? match.b! : match.a!;
  room = applyRoomAction(room, "p1", { type: "move", move: "piedra", round: 1, matchId: room.matchId }, NOW + 31);
  const mine = publicRoom(room, "p1", NOW + 32);
  const theirs = publicRoom(room, rival, NOW + 32);
  assert.equal(mine.ownMove, "piedra");
  assert.equal(theirs.ownMove, null);
  assert.equal(JSON.stringify(theirs.tournament).includes("piedra"), false, "Opponents must not see a pending move.");
  assert.deepEqual(theirs.tournament!.rounds[0].find(item => item.id === match.id)!.ready, ["p1"]);
  assert.equal(theirs.players.find(player => player.id === "p1")!.submitted, true);
  assert.throws(() => applyRoomAction(room, "p1", { type: "next" }, NOW + 33), /avanza solo/);

  room = applyRoomAction(room, rival, { type: "leave" }, NOW + 34);
  assert.equal(room.phase, "playing", "One player leaving must not reset everyone else's tournament.");
  assert.equal(room.players.length, 15);
  assert.equal(room.tournament!.rounds[0].find(item => item.id === match.id)!.winner, "p1");
});
