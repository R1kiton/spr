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
  assert.ok(room.players.length <= 4);
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

  const host = client("Test Host");
  const outsider = client("Other Host");
  let room = await create(host, "teams", 5);
  const isolated = await create(outsider, "solo", 3);
  await read(anonymous, room.code, 403);
  await read(outsider, room.code, 403);
  await action(outsider, room.code, { type: "start" }, 403);
  await action(outsider, isolated.code, { type: "start" }, 400);
  await databaseIsolation(room.code);
  console.log("OK: Guest sessions, input validation, origin checks, and room isolation.");

  const candidates = ["Guest One", "Guest Two", "Guest Three", "Guest Four"].map(client);
  const joined = await Promise.all(candidates.map(guest => join(guest, room.code.toLowerCase(), null)));
  assert.equal(joined.filter(result => result.status === 200).length, 3, "Only three guests may join a host, including simultaneous requests.");
  assert.equal(joined.filter(result => result.status === 400).length, 1, "The fifth player must be rejected.");
  const members = [host, ...candidates.filter((_, index) => joined[index].status === 200)];
  room = await read(host, room.code);
  assert.equal(room.players.length, 4);
  assert.equal(new Set(room.players.map(player => player.id)).size, 4);
  const repeated = await join(members[1], room.code);
  assert.equal(repeated.data.players.length, 4, "Rejoining the same session must not consume another seat.");
  await action(members[1], room.code, { type: "start" }, 400);
  await action(members[1], room.code, { type: "settings", mode: "solo", roundLimit: 3 }, 400);
  await action(host, room.code, { type: "unknown" }, 400);
  await action(host, room.code, { type: "team", team: "b" });
  await action(host, room.code, { type: "start" }, 400);
  await action(host, room.code, { type: "team", team: "a" });
  room = (await action(host, room.code, { type: "start" })).data;
  assert.equal(room.round, 1);
  assert.equal(room.phase, "playing");
  assert.ok(room.deadline > room.serverNow);
  assert.equal(room.players.filter(player => player.team === "a").length, 2);
  assert.equal(room.players.filter(player => player.team === "b").length, 2);
  await action(host, room.code, { type: "settings", mode: "solo", roundLimit: 3 }, 400);
  await join(outsider, room.code, 400);
  await action(host, room.code, { ...moveBody(room, "piedra"), matchId: "outdated-match" }, 400);
  await action(host, room.code, { ...moveBody(room, "piedra"), round: 0 }, 400);
  await action(host, room.code, { ...moveBody(room, "invalid") }, 400);

  const first = (await action(host, room.code, moveBody(room, "piedra"))).data;
  assert.equal(first.ownMove, "piedra");
  assert.equal(first.players.find(player => player.id === first.meId).submitted, true);
  const opponentView = await read(members[1], room.code);
  assert.deepEqual(opponentView.moves, {});
  assert.equal(opponentView.ownMove, null);
  assert.deepEqual(opponentView.history, []);
  await action(host, room.code, moveBody(room, "papel"), 400);
  await action(host, room.code, moveBody(room, "piedra"));
  const teams = new Map(room.players.map(player => [player.name, player.team]));
  const teamMove = guest => teams.get(guest.name) === "a" ? "piedra" : "tijera";
  await Promise.all(members.slice(1).map(guest => action(guest, room.code, moveBody(room, teamMove(guest)))));
  room = await read(host, room.code);
  assert.equal(room.phase, "between");
  assert.equal(room.history.length, 1);
  assert.deepEqual(room.teamScores, { a: 4, b: 0 });
  await action(host, room.code, moveBody(room, "piedra"));
  await action(host, room.code, moveBody(room, "papel"), 400);
  await action(members[1], room.code, { type: "next" }, 400);
  console.log("OK: Four-player capacity, team balance, host permissions, and private immutable moves.");

  for (let round = 2; round <= 5; round++) {
    room = (await action(host, room.code, { type: "next" })).data;
    assert.equal(room.round, round);
    room = await submitAll(room, members, teamMove);
    assert.deepEqual(room.teamScores, { a: round * 4, b: 0 });
    for (const player of room.players) assert.equal(player.score, player.team === "a" ? round * 2 : 0);
  }
  const previousMatch = room.matchId;
  await action(members[1], room.code, { type: "rematch" }, 400);
  room = (await action(host, room.code, { type: "rematch" })).data;
  assert.equal(room.phase, "lobby");
  assert.equal(room.round, 0);
  assert.deepEqual(room.history, []);
  assert.ok(room.players.every(player => player.score === 0));
  assert.notEqual(room.matchId, previousMatch);
  room = (await action(host, room.code, { type: "settings", mode: "solo", roundLimit: 3 })).data;
  assert.equal(room.mode, "solo");
  assert.equal(room.roundLimit, 3);
  assert.ok(room.players.every(player => player.team === null));
  room = (await action(host, room.code, { type: "start" })).data;
  await action(host, room.code, { ...moveBody(room, "piedra"), matchId: previousMatch }, 400);
  for (let round = 1; round <= 3; round++) {
    if (round > 1) room = (await action(host, room.code, { type: "next" })).data;
    room = await submitAll(room, members, guest => guest === host ? "piedra" : "tijera");
    assert.equal(room.players.find(player => player.id === room.hostId).score, round * 3);
    assert.ok(room.players.filter(player => player.id !== room.hostId).every(player => player.score === 0));
  }
  assert.equal(room.phase, "finished");
  assert.equal(room.history.length, 3);
  console.log("OK: Complete five-round 2v2 match, rematch, and three-round free-for-all with concurrent submissions.");

  assert.deepEqual((await action(host, room.code, { type: "leave" })).data, { left: true });
  await read(host, room.code, 403);
  const transferred = await read(members[1], room.code);
  assert.equal(transferred.players.length, 3);
  assert.notEqual(transferred.hostId, room.hostId);
  assert.ok(transferred.players.some(player => player.id === transferred.hostId));
  assert.equal(transferred.phase, "lobby");
  assert.deepEqual(transferred.history, []);

  const duplicate = client(outsider.name);
  await join(duplicate, isolated.code, 400);
  const rival = client("Duel Rival");
  await join(rival, ` ${isolated.code.toLowerCase()} `);
  let duel = (await action(outsider, isolated.code, { type: "start" })).data;
  for (let round = 1; round <= 3; round++) {
    if (round > 1) duel = (await action(outsider, duel.code, { type: "next" })).data;
    duel = await submitAll(duel, [outsider, rival], () => "papel");
    assert.ok(duel.players.every(player => player.score === 0));
    assert.deepEqual(duel.history[round - 1].winners, []);
  }
  console.log("OK: Host transfer, leave/reset, duplicate names, two-player play, and tied rounds.");
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
