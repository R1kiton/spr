import assert from "node:assert/strict";

// Usage: node --env-file=.env.local scripts/test-rooms-api.mjs [https://deployment.example]
// No accounts, browser automation, database write credentials, or test bypasses.
const base = new URL(process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000");
const cleanup = new Map();
let requestCount = 0;

function client(name) {
  return { name, cookie: "" };
}

async function request(guest, path, body, expected = 200, extraHeaders = {}) {
  requestCount++;
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(guest.cookie ? { Cookie: guest.cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) guest.cookie = setCookie.split(";", 1)[0];
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Expected JSON from ${path}; received HTTP ${response.status}.`); }
  if (expected !== null) {
    const statuses = Array.isArray(expected) ? expected : [expected];
    assert.ok(statuses.includes(response.status),
      `${path}: expected HTTP ${statuses.join("/")}, received ${response.status}${typeof data.error === "string" ? ` (${data.error})` : ""}.`);
    if (response.status >= 400) assert.equal(typeof data.error, "string");
  }
  if (data.players) publicState(data, guest);
  return { data, status: response.status, headers: response.headers };
}

function publicState(room, guest) {
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.ok(room.players.length <= (room.mode === "tournament" ? 16 : 2), "Duels hold 2 players and tournaments 16.");
  assert.ok(room.players.every(player => !("tokenHash" in player)));
  const serialized = JSON.stringify(room);
  assert.ok(!serialized.includes("server_key_hash") && !serialized.includes("p_server_key"), "Storage credentials must remain private.");
  if (guest.cookie) assert.ok(!serialized.includes(guest.cookie.split("=", 2)[1]), "The session credential must never be in room JSON.");
  if (room.phase === "playing") assert.deepEqual(room.moves, {}, "Current opponents' moves must stay hidden.");
}

const enter = (guest, body, expected = 200) => request(guest, "/api/rooms", body, expected);
const action = (guest, code, body, expected = 200) => request(guest, `/api/rooms/${code}`, body, expected);
const read = async (guest, code, expected = 200) => (await request(guest, `/api/rooms?code=${encodeURIComponent(code)}`, undefined, expected)).data;

async function create(guest, mode, roundLimit) {
  const response = await enter(guest, { intent: "create", name: guest.name, mode, roundLimit });
  const room = response.data;
  cleanup.set(room.code, [guest]);
  assert.equal(room.phase, "lobby");
  assert.equal(room.players.length, 1);
  assert.equal(room.meId, room.hostId);
  assert.equal(room.mode, mode);
  assert.equal(room.roundLimit, roundLimit);
  assert.match(response.headers.get("set-cookie") ?? "", /; HttpOnly/i);
  assert.match(response.headers.get("set-cookie") ?? "", /; SameSite=Lax/i);
  if (base.protocol === "https:") assert.match(response.headers.get("set-cookie") ?? "", /; Secure/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("vary") ?? "", /Cookie/i);
  return room;
}

async function join(guest, code, expected = 200) {
  const response = await enter(guest, { intent: "join", name: guest.name, code }, expected);
  if (response.status === 200 && cleanup.has(response.data.code)) cleanup.get(response.data.code).push(guest);
  return response;
}

const moveBody = (room, move) => ({ type: "move", move, round: room.round, matchId: room.matchId });

async function submitAll(room, members, moveFor) {
  await Promise.all(members.map(guest => action(guest, room.code, moveBody(room, moveFor(guest)))));
  const next = await read(members[0], room.code);
  assert.equal(next.history.length, room.round, "Concurrent moves must resolve exactly one round.");
  assert.equal(next.phase, room.round === room.roundLimit ? "finished" : "between");
  return next;
}

async function databaseIsolation(code) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.log("SKIP: Direct database isolation checks require SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
    return;
  }
  const headers = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  const root = `${url.replace(/\/$/, "")}/rest/v1`;
  const rpc = await fetch(`${root}/rpc/gesto_room_store`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_server_key: "invalid-credential-for-api-isolation-test", p_operation: "read", p_code: code }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok([401, 403].includes(rpc.status), "A public database key must not grant access to the room RPC without the private server credential.");
  for (const table of ["rooms", "server_config"]) {
    const response = await fetch(`${root}/${table}?select=*`, { headers, signal: AbortSignal.timeout(15_000) });
    assert.ok(!response.ok, `The ${table} table must not be directly accessible through the public API.`);
  }
  const privateSchema = await fetch(`${root}/rooms?select=*`, {
    headers: { ...headers, "Accept-Profile": "gesto_private" }, signal: AbortSignal.timeout(15_000),
  });
  assert.ok(!privateSchema.ok, "The private schema must not be exposed through the Data API.");
  console.log("OK: Public database credentials cannot read room state or server configuration.");
}

async function verify() {
  const anonymous = client("Anonymous");
  await request(anonymous, "/api/rooms?code=ABCDEF", undefined, 403);
  await enter(anonymous, { intent: "create", name: "Invalid", mode: "solo", roundLimit: 4 }, 400);
  await enter(anonymous, [], 400);
  await request(anonymous, "/api/rooms", { intent: "create", name: "Cross Origin", mode: "solo", roundLimit: 3 }, 403, { Origin: "https://foreign.example" });
  await enter(anonymous, { intent: "create", name: "Oversized", mode: "solo", roundLimit: 3, extra: "x".repeat(4100) }, 413);

  await enter(anonymous, { intent: "create", name: "Team Host", mode: "teams", roundLimit: 3 }, 400);

  const host = client("Test Host");
  const outsider = client("Other Host");
  let room = await create(host, "solo", 5);
  const isolated = await create(outsider, "solo", 3);
  await read(anonymous, room.code, 403);
  await read(outsider, room.code, 403);
  await action(outsider, room.code, { type: "start" }, 403);
  await action(outsider, isolated.code, { type: "start" }, 400);
  await databaseIsolation(room.code);
  console.log("OK: Guest sessions, input validation, origin checks, team mode disabled, and room isolation.");

  const candidates = ["Guest One", "Guest Two"].map(client);
  const joined = await Promise.all(candidates.map(guest => join(guest, room.code.toLowerCase(), null)));
  assert.equal(joined.filter(result => result.status === 200).length, 1, "Only one guest may join a host, including simultaneous requests.");
  assert.equal(joined.filter(result => result.status === 400).length, 1, "The third player must be rejected.");
  const guest = candidates.find((_, index) => joined[index].status === 200);
  const members = [host, guest];
  room = await read(host, room.code);
  assert.equal(room.players.length, 2);
  assert.equal(new Set(room.players.map(player => player.id)).size, 2);
  const repeated = await join(guest, room.code);
  assert.equal(repeated.data.players.length, 2, "Rejoining the same session must not consume another seat.");
  await action(guest, room.code, { type: "start" }, 400);
  await action(guest, room.code, { type: "settings", mode: "solo", roundLimit: 3 }, 400);
  await action(host, room.code, { type: "settings", mode: "teams", roundLimit: 5 }, 400);
  await action(host, room.code, { type: "team", team: "b" }, 400);
  await action(host, room.code, { type: "unknown" }, 400);
  room = (await action(host, room.code, { type: "start" })).data;
  assert.equal(room.round, 1);
  assert.equal(room.phase, "playing");
  assert.ok(room.deadline > room.serverNow);
  await action(host, room.code, { type: "settings", mode: "solo", roundLimit: 3 }, 400);
  await join(outsider, room.code, 400);
  await action(host, room.code, { ...moveBody(room, "piedra"), matchId: "outdated-match" }, 400);
  await action(host, room.code, { ...moveBody(room, "piedra"), round: 0 }, 400);
  await action(host, room.code, { ...moveBody(room, "invalid") }, 400);

  const first = (await action(host, room.code, moveBody(room, "piedra"))).data;
  assert.equal(first.ownMove, "piedra");
  assert.equal(first.players.find(player => player.id === first.meId).submitted, true);
  const opponentView = await read(guest, room.code);
  assert.deepEqual(opponentView.moves, {});
  assert.equal(opponentView.ownMove, null);
  assert.deepEqual(opponentView.history, []);
  await action(host, room.code, moveBody(room, "papel"), 400);
  await action(host, room.code, moveBody(room, "piedra"));
  await action(guest, room.code, moveBody(room, "tijera"));
  room = await read(host, room.code);
  assert.equal(room.phase, "between");
  assert.equal(room.history.length, 1);
  assert.equal(room.players.find(player => player.id === room.hostId).score, 1);
  await action(host, room.code, moveBody(room, "piedra"));
  await action(host, room.code, moveBody(room, "papel"), 400);
  await action(guest, room.code, { type: "next" }, 400);
  console.log("OK: Two-player capacity, host permissions, and private immutable moves.");

  const hostWins = player => player === host ? "piedra" : "tijera";
  for (let round = 2; round <= 5; round++) {
    room = (await action(host, room.code, { type: "next" })).data;
    assert.equal(room.round, round);
    room = await submitAll(room, members, hostWins);
    assert.equal(room.players.find(player => player.id === room.hostId).score, round);
    assert.ok(room.players.filter(player => player.id !== room.hostId).every(player => player.score === 0));
  }
  const previousMatch = room.matchId;
  await action(guest, room.code, { type: "rematch" }, 400);
  room = (await action(host, room.code, { type: "rematch" })).data;
  assert.equal(room.phase, "lobby");
  assert.equal(room.round, 0);
  assert.deepEqual(room.history, []);
  assert.ok(room.players.every(player => player.score === 0));
  assert.notEqual(room.matchId, previousMatch);
  room = (await action(host, room.code, { type: "settings", mode: "solo", roundLimit: 3 })).data;
  assert.equal(room.roundLimit, 3);
  room = (await action(host, room.code, { type: "start" })).data;
  await action(host, room.code, { ...moveBody(room, "piedra"), matchId: previousMatch }, 400);
  for (let round = 1; round <= 3; round++) {
    if (round > 1) room = (await action(host, room.code, { type: "next" })).data;
    room = await submitAll(room, members, () => "papel");
    assert.ok(room.players.every(player => player.score === 0));
    assert.deepEqual(room.history[round - 1].winners, []);
  }
  assert.equal(room.phase, "finished");
  assert.equal(room.history.length, 3);
  console.log("OK: Complete five-round duel, rematch, and three tied rounds with concurrent submissions.");

  assert.deepEqual((await action(host, room.code, { type: "leave" })).data, { left: true });
  await read(host, room.code, 403);
  const transferred = await read(guest, room.code);
  assert.equal(transferred.players.length, 1);
  assert.notEqual(transferred.hostId, room.hostId);
  assert.equal(transferred.hostId, transferred.meId);
  assert.equal(transferred.phase, "lobby");
  assert.deepEqual(transferred.history, []);

  const duplicate = client(outsider.name);
  await join(duplicate, isolated.code, 400);
  const rival = client("Duel Rival");
  await join(rival, ` ${isolated.code.toLowerCase()} `);
  await join(client("Late Third"), isolated.code, 400);
  let duel = (await action(outsider, isolated.code, { type: "start" })).data;
  for (let round = 1; round <= 3; round++) {
    if (round > 1) duel = (await action(outsider, duel.code, { type: "next" })).data;
    duel = await submitAll(duel, [outsider, rival], player => player === outsider ? "papel" : "piedra");
  }
  assert.equal(duel.players.find(player => player.id === duel.hostId).score, 3);
  console.log("OK: Host transfer, leave/reset, duplicate names, full duel rooms, and a second independent duel.");

  const organizer = client("Cup Host");
  let cup = await create(organizer, "tournament", 3);
  const entrants = [organizer, ...["Cup Two", "Cup Three"].map(client)];
  for (const entrant of entrants.slice(1)) await join(entrant, cup.code);
  await action(organizer, cup.code, { type: "start" }, 400);
  const fourth = client("Cup Four");
  await join(fourth, cup.code);
  entrants.push(fourth);
  cup = (await action(organizer, cup.code, { type: "start" })).data;
  assert.equal(cup.phase, "playing");
  assert.equal(cup.tournament.rounds[0].length, 2);
  assert.equal(cup.tournament.rounds.length, 2);
  await action(organizer, cup.code, { type: "next" }, 400);
  const byId = new Map(cup.players.map(player => [player.id, entrants.find(guest => guest.name === player.name)]));
  for (let game = 1; game <= 2; game++) {
    cup = await read(organizer, cup.code);
    for (const match of cup.tournament.rounds[0].filter(item => !item.done)) {
      await action(byId.get(match.a), cup.code, { type: "move", move: "piedra", round: match.game, matchId: cup.matchId });
      await action(byId.get(match.b), cup.code, { type: "move", move: "tijera", round: match.game, matchId: cup.matchId });
    }
    if (game === 1) await new Promise(resolve => setTimeout(resolve, 3200));
  }
  cup = await read(organizer, cup.code);
  assert.ok(cup.tournament.rounds[0].every(match => match.done && match.winner === match.a), "Each first-round match ends 2-0 for side a.");
  assert.deepEqual([cup.tournament.rounds[1][0].a, cup.tournament.rounds[1][0].b], cup.tournament.rounds[0].map(match => match.a));
  console.log("OK: Four-player tournament with a best-of-3 first round and winners placed in the final.");
}

try {
  await verify();
  console.log(`PASS: Room API integration checks (${requestCount} HTTP requests).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Room API integration failed.");
  process.exitCode = 1;
} finally {
  // Leave through the public API; empty test rooms expire through normal TTL.
  for (const [code, guests] of cleanup) {
    for (const guest of new Set(guests)) {
      if (guest.cookie) {
        try { await action(guest, code, { type: "leave" }, [200, 403, 404]); }
        catch { /* Preserve the actual test failure if the deployment went away. */ }
      }
    }
  }
}
