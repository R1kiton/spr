import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { applyRoomAction, createRoom, joinRoom, publicRoom, settleRoom, type RoomAction, type RoomMode, type StoredRoom } from "./rooms";
import { readRoom, roomStore, RoomApiError } from "./room-store";
import { moves } from "./game";

const COOKIE = "gesto_guest_v1";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function roomCode(value: unknown): string {
  if (typeof value !== "string") throw new RoomApiError("Escribe el código de 6 caracteres de la sala.");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new RoomApiError("El código debe tener 6 letras o números del 2 al 9.");
  return code;
}

function playerName(value: unknown): string {
  if (typeof value !== "string") throw new RoomApiError("Escribe tu nombre para jugar.");
  const name = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 20) throw new RoomApiError("Tu nombre debe tener entre 2 y 20 caracteres.");
  return name;
}

function settings(data: Record<string, unknown>): { mode: RoomMode; roundLimit: 3 | 5 } {
  // Rooms offer 1v1 duels and tournaments; 2v2 teams stay off even though lib/rooms.ts supports them.
  if (data.mode !== "solo" && data.mode !== "tournament") throw new RoomApiError("Elige un duelo o un torneo.");
  if (data.roundLimit !== 3 && data.roundLimit !== 5) throw new RoomApiError("Elige 3 o 5 rondas.");
  return { mode: data.mode, roundLimit: data.roundLimit };
}

export async function roomBody(request: NextRequest): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if ((origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new RoomApiError("La petición debe enviarse desde el juego.", 403);
  if (Number(request.headers.get("content-length")) > 4096) throw new RoomApiError("La petición es demasiado grande.", 413);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) {
          await reader.cancel();
          throw new RoomApiError("La petición es demasiado grande.", 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new RoomApiError("La petición no es válida."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new RoomApiError("La petición no es válida.");
  return data as Record<string, unknown>;
}

function session(request: NextRequest, create = false) {
  let token = request.cookies.get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) throw new RoomApiError("Únete a la sala con tu nombre para continuar.", 403);
    token = randomBytes(32).toString("hex");
  }
  return { token, tokenHash: hash(token) };
}

function response(request: NextRequest, data: unknown, token?: string) {
  const result = NextResponse.json(data, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
  if (token) result.cookies.set(COOKIE, token, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return result;
}

export function roomError(error: unknown) {
  const status = error instanceof RoomApiError ? error.status : 400;
  const message = error instanceof Error ? error.message : "No pudimos completar esa acción.";
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store, private" } });
}

/** Compare-and-swap retries serialize simultaneous joins and submissions across server instances. */
async function updateRoom(code: string, change: (state: StoredRoom, now: number) => { state: StoredRoom; viewerId: string; left?: boolean }) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const record = await readRoom(code);
    const now = Date.now();
    const { state, viewerId, left } = change(record.state, now);
    const changed = JSON.stringify(state) !== JSON.stringify(record.state);
    if (!changed) return left ? { left: true } : publicRoom(state, viewerId, now);
    const result = await roomStore("update", code, state, record.version);
    if (result && !("conflict" in result)) return left ? { left: true } : publicRoom(result.state, viewerId, now);
    await new Promise(resolve => setTimeout(resolve, randomInt(15, 65)));
  }
  throw new RoomApiError("La sala está ocupada. Intenta de nuevo en un momento.", 409);
}

export async function getRoom(request: NextRequest) {
  const code = roomCode(request.nextUrl.searchParams.get("code"));
  const guest = session(request);
  const data = await updateRoom(code, (stored, now) => {
    const state = structuredClone(stored);
    const me = state.players.find(player => player.tokenHash === guest.tokenHash);
    if (!me) throw new RoomApiError("No formas parte de esta sala. Únete con tu nombre.", 403);
    // Persist presence at most once every eight seconds per player.
    if (now - me.lastSeenAt >= 8000) me.lastSeenAt = now;
    return { state: settleRoom(state, now), viewerId: me.id };
  });
  return response(request, data);
}

export async function enterRoom(request: NextRequest) {
  const body = await roomBody(request);
  const name = playerName(body.name);
  const guest = session(request, true);
  const player = { id: randomUUID(), name, tokenHash: guest.tokenHash };
  if (body.intent === "create") {
    const options = settings(body);
    for (let i = 0; i < 8; i++) {
      const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
      const now = Date.now();
      const state = createRoom(code, player, options.mode, options.roundLimit, now);
      const result = await roomStore("create", code, state);
      if (result && !("conflict" in result)) return response(request, publicRoom(result.state, player.id, now), guest.token);
    }
    throw new RoomApiError("No pudimos crear un código. Inténtalo de nuevo.", 503);
  }
  if (body.intent !== "join") throw new RoomApiError("Elige crear una sala o unirte por código.");
  const code = roomCode(body.code);
  const data = await updateRoom(code, (stored, now) => {
    const fresh = structuredClone(stored);
    const existing = fresh.players.find(person => person.tokenHash === guest.tokenHash);
    if (existing) existing.lastSeenAt = now;
    const state = joinRoom(settleRoom(fresh, now), player, now);
    const me = state.players.find(person => person.tokenHash === guest.tokenHash)!;
    return { state, viewerId: me.id };
  });
  return response(request, data, guest.token);
}

function parseAction(body: Record<string, unknown>): RoomAction {
  switch (body.type) {
    case "settings": return { type: "settings", ...settings(body) };
    case "team":
      if (body.team !== "a" && body.team !== "b") throw new RoomApiError("Elige un equipo válido.");
      return { type: "team", team: body.team };
    case "move":
      if (!moves.includes(body.move as typeof moves[number]) || !Number.isInteger(body.round) || typeof body.matchId !== "string" || body.matchId.length > 100) throw new RoomApiError("La jugada no es válida.");
      return { type: "move", move: body.move as typeof moves[number], round: body.round as number, matchId: body.matchId };
    case "start": case "next": case "rematch": case "leave": return { type: body.type };
    default: throw new RoomApiError("Esa acción no está disponible.");
  }
}

export async function actInRoom(request: NextRequest, codeValue: string) {
  const code = roomCode(codeValue);
  const action = parseAction(await roomBody(request));
  const guest = session(request);
  const data = await updateRoom(code, (stored, now) => {
    const state = structuredClone(stored);
    const me = state.players.find(player => player.tokenHash === guest.tokenHash);
    if (!me) throw new RoomApiError("No formas parte de esta sala.", 403);
    me.lastSeenAt = now;
    return { state: applyRoomAction(settleRoom(state, now), me.id, action, now), viewerId: me.id, left: action.type === "leave" };
  });
  return response(request, data);
}
