import { test } from "node:test";
import assert from "node:assert/strict";
import { type Move } from "../lib/game";
import {
  applyRoomAction,
  createRoom,
  joinRoom,
  publicRoom,
  settleRoom,
  ROUND_DURATION_MS,
  type RoomMode,
  type StoredRoom,
} from "../lib/rooms";

const NOW = 10_000;
const participant = (number: number) => ({ id: `p${number}`, name: `Jugador ${number}`, tokenHash: `secret-${number}` });

function lobby(count = 2, mode: RoomMode = "solo", roundLimit: 3 | 5 = 3): StoredRoom {
  let room = createRoom("ABC123", participant(1), mode, roundLimit, NOW);
  for (let index = 2; index <= count; index++) room = joinRoom(room, participant(index), NOW + index);
  return room;
}

function start(count = 2, mode: RoomMode = "solo", roundLimit: 3 | 5 = 3): StoredRoom {
  return applyRoomAction(lobby(count, mode, roundLimit), "p1", { type: "start" }, NOW + 10);
}

function play(room: StoredRoom, submitted: Move[], now = NOW + 20): StoredRoom {
  for (let index = 0; index < submitted.length; index++) {
    room = applyRoomAction(room, `p${index + 1}`, {
      type: "move", move: submitted[index], round: room.round, matchId: room.matchId,
    }, now + index);
  }
  return room;
}

test("room creation normalizes input and returns the requested match settings", () => {
  const room = createRoom(" abc123 ", { ...participant(1), name: "  Ana   Luz  " }, "teams", 5, NOW);
  assert.equal(room.code, "ABC123");
  assert.equal(room.players[0].name, "Ana Luz");
  assert.equal(room.players[0].team, "a");
  assert.equal(room.roundLimit, 5);
  assert.equal(room.phase, "lobby");
  assert.equal(room.round, 0);
  assert.ok(room.matchId);
  assert.throws(() => createRoom("ABC123", participant(1), "solo", 4 as 3, NOW), /3 o 5/);
});

test("joining is idempotent by private session even if the room is full or playing", () => {
  const room = start(4);
  const rejoined = joinRoom(room, { ...participant(2), id: "new-id", name: "Otro nombre" }, NOW + 30);
  assert.equal(rejoined.players.length, 4);
  assert.equal(rejoined.players[1].id, "p2");
  assert.equal(rejoined.players[1].name, "Jugador 2");
  assert.equal(rejoined.players[1].lastSeenAt, NOW + 30);
  assert.equal(room.players[1].lastSeenAt, NOW + 2);
});

test("rooms reject a fifth player, duplicate names, duplicate IDs, and late arrivals", () => {
  assert.throws(() => joinRoom(lobby(4), participant(5), NOW + 10), /llena/);
  assert.throws(() => joinRoom(lobby(), { ...participant(3), name: " jugador 1 " }, NOW + 10), /nombre/);
  assert.throws(() => joinRoom(lobby(), { ...participant(3), id: "p1" }, NOW + 10), /sesión/);
  assert.throws(() => joinRoom(start(), participant(3), NOW + 30), /ya comenzó/);
});

test("only the host controls settings, starts, next rounds, and rematches", () => {
  const room = lobby();
  assert.throws(() => applyRoomAction(room, "p2", { type: "settings", mode: "teams", roundLimit: 5 }, NOW + 10), /Solo quien/);
  assert.throws(() => applyRoomAction(room, "p2", { type: "start" }, NOW + 10), /Solo quien/);
  assert.throws(() => applyRoomAction(room, "missing", { type: "start" }, NOW + 10), /Vuelve a unirte/);
  assert.throws(() => applyRoomAction(lobby(1), "p1", { type: "start" }, NOW + 10), /al menos 2/);
  const between = play(start(), ["piedra", "tijera"]);
  assert.throws(() => applyRoomAction(between, "p2", { type: "next" }, NOW + 30), /Solo quien/);
  assert.throws(() => applyRoomAction(between, "p1", { type: "rematch" }, NOW + 30), /Termina/);
});

test("playing hides opponents' moves and token hashes while showing submission status", () => {
  const room = play(start(), ["papel"]);
  const first = publicRoom(room, "p1", NOW + 30);
  const second = publicRoom(room, "p2", NOW + 30);
  assert.deepEqual(first.moves, {});
  assert.equal(first.ownMove, "papel");
  assert.equal(second.ownMove, null);
  assert.equal(first.players[0].submitted, true);
  assert.equal(first.players[1].submitted, false);
  assert.equal(first.meId, "p1");
  assert.equal(publicRoom(room, "stranger", NOW).meId, null);
  assert.equal(JSON.stringify(first).includes("secret-"), false);
  assert.equal(JSON.stringify(first).includes("tokenHash"), false);
  assert.deepEqual(first.history, []);
  assert.equal(first.deadline, NOW + 10 + ROUND_DURATION_MS);
});

test("submitted moves are immutable and tied to a specific match and round", () => {
  const initial = start();
  const room = play(initial, ["piedra"]);
  const action = { type: "move" as const, move: "piedra" as const, round: 1, matchId: room.matchId };
  assert.equal(applyRoomAction(room, "p1", action, NOW + 30).moves.p1, "piedra");
  assert.throws(() => applyRoomAction(room, "p1", { ...action, move: "papel" }, NOW + 30), /Ya elegiste/);
  assert.throws(() => applyRoomAction(room, "p2", { ...action, round: 2 }, NOW + 30), /ronda cambió/);
  assert.throws(() => applyRoomAction(room, "p2", { ...action, matchId: "old-match" }, NOW + 30), /ronda cambió/);
  assert.throws(() => applyRoomAction(room, "p2", { ...action, move: "lagarto" as Move }, NOW + 30), /piedra, papel o tijera/);
  assert.deepEqual(initial.moves, {});
});

test("solo scoring compares every pair exactly once and resolves on the final submission", () => {
  const initial = start(4);
  const almost = play(initial, ["piedra", "papel", "tijera"]);
  assert.equal(almost.phase, "playing");
  const room = applyRoomAction(almost, "p4", { type: "move", move: "papel", round: 1, matchId: almost.matchId }, NOW + 30);
  assert.equal(room.phase, "between");
  assert.equal(room.deadline, null);
  assert.deepEqual(room.history[0].points, { p1: 1, p2: 1, p3: 2, p4: 1 });
  assert.deepEqual(room.history[0].winners, ["p3"]);
  assert.deepEqual(room.players.map((player) => player.score), [1, 1, 2, 1]);
  assert.equal(initial.history.length, 0);
  assert.equal(almost.history.length, 0);
});

test("deadline gives each valid move a win against each absent move and settles only once", () => {
  const room = play(start(4), ["tijera"]);
  const early = settleRoom(room, room.deadline! - 1);
  assert.equal(early.phase, "playing");
  const settled = settleRoom(room, room.deadline!);
  assert.equal(settled.phase, "between");
  assert.deepEqual(settled.history[0].moves, { p1: "tijera", p2: null, p3: null, p4: null });
  assert.deepEqual(settled.history[0].points, { p1: 3, p2: 0, p3: 0, p4: 0 });
  assert.equal(settleRoom(settled, room.deadline! + 1).history.length, 1);
  assert.equal(room.history.length, 0);
});

test("a request at the deadline cannot sneak a late move into the resolved round", () => {
  const room = play(start(), ["piedra"]);
  assert.throws(() => applyRoomAction(room, "p2", {
    type: "move", move: "papel", round: 1, matchId: room.matchId,
  }, room.deadline!), /ronda ya terminó/);
  const settled = settleRoom(room, room.deadline!);
  assert.deepEqual(settled.history[0].points, { p1: 1, p2: 0 });
});

test("an entirely absent round draws, gives no points, and still counts", () => {
  const room = start();
  const settled = settleRoom(room, room.deadline!);
  assert.equal(settled.history.length, 1);
  assert.deepEqual(settled.history[0].points, { p1: 0, p2: 0 });
  assert.deepEqual(settled.history[0].winners, []);
});

for (const limit of [3, 5] as const) {
  test(`the match always plays exactly ${limit} rounds, including ties, with accumulated scores`, () => {
    let room = start(2, "solo", limit);
    for (let index = 1; index <= limit; index++) {
      room = play(room, index === 2 ? ["papel", "papel"] : ["piedra", "tijera"], NOW + index * 100);
      assert.equal(room.history.length, index);
      assert.equal(room.round, index);
      assert.equal(room.phase, index === limit ? "finished" : "between");
      if (index < limit) room = applyRoomAction(room, "p1", { type: "next" }, NOW + index * 100 + 10);
    }
    assert.equal(room.players[0].score, limit - 1);
    assert.equal(room.players[1].score, 0);
    assert.throws(() => applyRoomAction(room, "p1", { type: "next" }, NOW + 1_000), /siguiente ronda/);
    const priorMatch = room.matchId;
    const rematch = applyRoomAction(room, "p1", { type: "rematch" }, NOW + 1_000);
    assert.equal(rematch.phase, "lobby");
    assert.equal(rematch.round, 0);
    assert.equal(rematch.roundLimit, limit);
    assert.notEqual(rematch.matchId, priorMatch);
    assert.deepEqual(rematch.history, []);
    assert.deepEqual(rematch.moves, {});
    assert.deepEqual(rematch.players.map((player) => player.score), [0, 0]);
    assert.throws(() => applyRoomAction(applyRoomAction(rematch, "p1", { type: "start" }, NOW + 1_001), "p1", {
      type: "move", move: "piedra", round: 1, matchId: priorMatch,
    }, NOW + 1_002), /ronda cambió/);
  });
}

test("2v2 requires four balanced players while permitting temporary uneven teams for swapping", () => {
  assert.throws(() => applyRoomAction(lobby(3, "teams"), "p1", { type: "start" }, NOW + 10), /4 jugadores/);
  let room = lobby(4, "teams");
  assert.deepEqual(room.players.map((player) => player.team), ["a", "b", "a", "b"]);
  room = applyRoomAction(room, "p1", { type: "team", team: "b" }, NOW + 10);
  assert.throws(() => applyRoomAction(room, "p1", { type: "start" }, NOW + 11), /2 en cada equipo/);
  room = applyRoomAction(room, "p2", { type: "team", team: "a" }, NOW + 12);
  assert.equal(applyRoomAction(room, "p1", { type: "start" }, NOW + 13).phase, "playing");
});

test("2v2 scores only enemy pairings and derives shared team totals from history", () => {
  const room = play(start(4, "teams"), ["piedra", "papel", "tijera", "piedra"]);
  assert.deepEqual(room.history[0].points, { p1: 0, p2: 1, p3: 1, p4: 1 });
  assert.deepEqual(room.history[0].teamPoints, { a: 1, b: 2 });
  assert.deepEqual(room.history[0].winners, ["p2", "p4"]);
  assert.deepEqual(publicRoom(room, "p1", NOW + 30).teamScores, { a: 1, b: 2 });
  const corruptedScores = { ...room, players: room.players.map((player) => ({ ...player, score: 999 })) };
  assert.deepEqual(publicRoom(corruptedScores, "p1", NOW + 30).players.map((player) => player.score), [0, 1, 1, 1]);
  assert.throws(() => applyRoomAction(room, "p1", { type: "team", team: "b" }, NOW + 30), /antes de iniciar/);
});

test("mode changes reset team allocation and only happen in the lobby", () => {
  const teams = applyRoomAction(lobby(4), "p1", { type: "settings", mode: "teams", roundLimit: 5 }, NOW + 10);
  assert.deepEqual(teams.players.map((player) => player.team), ["a", "b", "a", "b"]);
  const solo = applyRoomAction(teams, "p1", { type: "settings", mode: "solo", roundLimit: 3 }, NOW + 20);
  assert.deepEqual(solo.players.map((player) => player.team), [null, null, null, null]);
  assert.throws(() => applyRoomAction(start(), "p1", { type: "settings", mode: "teams", roundLimit: 5 }, NOW + 20), /antes de iniciar/);
});

test("leaving an active match cancels it and immediately gives the next player host control", () => {
  const room = play(start(), ["piedra", "tijera"]);
  const left = applyRoomAction(room, "p1", { type: "leave" }, NOW + 40);
  assert.equal(left.hostId, "p2");
  assert.equal(left.phase, "lobby");
  assert.equal(left.round, 0);
  assert.deepEqual(left.history, []);
  assert.deepEqual(left.moves, {});
  assert.equal(left.players[0].score, 0);
  assert.equal(room.players.length, 2);
  const empty = applyRoomAction(left, "p2", { type: "leave" }, NOW + 41);
  assert.equal(empty.hostId, "");
  assert.equal(joinRoom(empty, participant(3), NOW + 42).hostId, "p3");
});

test("presence expires at30 seconds; stale lobby slots free after60 seconds", () => {
  const room = lobby();
  assert.equal(publicRoom(room, "p1", NOW + 30_000).players[0].online, true);
  assert.equal(publicRoom(room, "p1", NOW + 30_001).players[0].online, false);
  room.players[1].lastSeenAt = NOW + 50_000;
  const settled = settleRoom(room, NOW + 60_001);
  assert.deepEqual(settled.players.map((player) => player.id), ["p2"]);
  assert.equal(settled.hostId, "p2");
  assert.equal(room.players.length, 2);
});

test("stale hosts transfer during a match without dropping players or preventing timeout resolution", () => {
  const room = start();
  room.players[1].lastSeenAt = NOW + 61_000;
  const settled = settleRoom(room, NOW + 61_001);
  assert.equal(settled.hostId, "p2");
  assert.equal(settled.players.length, 2);
  assert.equal(settled.phase, "between");
  const next = applyRoomAction(settled, "p2", { type: "next" }, NOW + 61_002);
  assert.equal(next.phase, "playing");
  assert.equal(next.round, 2);
});

test("a returning player's authenticated action refreshes presence before stale-lobby cleanup", () => {
  const room = lobby();
  const resumed = applyRoomAction(room, "p1", { type: "settings", mode: "solo", roundLimit: 5 }, NOW + 61_000);
  assert.equal(resumed.players.length, 1);
  assert.equal(resumed.players[0].id, "p1");
  assert.equal(resumed.roundLimit, 5);
});

test("public snapshots are detached copies and cannot edit authoritative history or moves", () => {
  const room = play(start(), ["piedra", "tijera"]);
  const visible = publicRoom(room, "p1", NOW + 30);
  visible.history[0].points.p1 = 999;
  visible.history[0].moves.p1 = "papel";
  visible.moves.p1 = "papel";
  visible.players[0].score = 999;
  assert.equal(room.history[0].points.p1, 1);
  assert.equal(room.history[0].moves.p1, "piedra");
  assert.equal(room.moves.p1, "piedra");
  assert.equal(room.players[0].score, 1);
});
