import { moves as legalMoves, outcome, type Move } from "./game";
import {
  activeMatch, createTournament, forfeit, matchesWon, publicTournament, settleTournament, submitTournamentMove,
  TOURNAMENT_MAX_PLAYERS, TOURNAMENT_MIN_PLAYERS, type PublicTournament, type Tournament,
} from "./tournament";

export type RoomMode = "solo" | "teams" | "tournament";
export type RoomPhase = "lobby" | "playing" | "between" | "finished";
export type Team = "a" | "b";

export interface StoredPlayer {
  id: string;
  name: string;
  tokenHash: string;
  team: Team | null;
  score: number;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomRound {
  number: number;
  moves: Record<string, Move | null>;
  points: Record<string, number>;
  teamPoints: { a: number; b: number };
  /** Player IDs; a team victory includes both members. An empty array is a draw. */
  winners: string[];
}

export interface StoredRoom {
  code: string;
  mode: RoomMode;
  roundLimit: 3 | 5;
  phase: RoomPhase;
  hostId: string;
  players: StoredPlayer[];
  round: number;
  deadline: number | null;
  moves: Record<string, Move>;
  history: RoomRound[];
  createdAt: number;
  updatedAt: number;
  matchId: string;
  /** When a resolved duel round automatically opens the next one; null while playing or when finished. */
  nextAt?: number | null;
  /** Bracket state while a tournament is running; absent in duels and in rooms stored before tournaments. */
  tournament?: Tournament | null;
}

export type RoomPlayerInput = Pick<StoredPlayer, "id" | "name" | "tokenHash">;
export type RoomAction =
  | { type: "team"; team: Team }
  | { type: "settings"; mode: RoomMode; roundLimit: 3 | 5 }
  | { type: "start" }
  | { type: "move"; move: Move; round: number; matchId: string }
  | { type: "next" }
  | { type: "rematch" }
  | { type: "leave" };

export type PublicPlayer = Omit<StoredPlayer, "tokenHash"> & {
  submitted: boolean;
  online: boolean;
};

export type PublicRoom = Omit<StoredRoom, "players" | "tournament"> & {
  players: PublicPlayer[];
  tournament: PublicTournament | null;
  meId: string | null;
  serverNow: number;
  ownMove: Move | null;
  teamScores: { a: number; b: number };
};

/** Seats offered per room. The engine supports up to 4 (including 2v2 teams); rooms are 1v1 duels for now. */
export const MAX_PLAYERS = 2;
export const capacityFor = (mode: RoomMode) => mode === "tournament" ? TOURNAMENT_MAX_PLAYERS : mode === "teams" ? 4 : MAX_PLAYERS;
export const ROUND_DURATION_MS = 20_000;
/** Pause after a duel round so both players see the result before the next round opens on its own. */
export const ROUND_RESULT_MS = 5_000;
export const ONLINE_DURATION_MS = 30_000;
export const STALE_DURATION_MS = 60_000;

function cloneRoom(room: StoredRoom): StoredRoom {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player })),
    moves: { ...room.moves },
    history: room.history.map((round) => ({
      ...round,
      moves: { ...round.moves },
      points: { ...round.points },
      teamPoints: { ...round.teamPoints },
      winners: [...round.winners],
    })),
    tournament: room.tournament ? structuredClone(room.tournament) : null,
  };
}

function validateSettings(mode: RoomMode, roundLimit: 3 | 5) {
  if (mode !== "solo" && mode !== "teams" && mode !== "tournament") throw new Error("El modo de juego no es válido.");
  if (roundLimit !== 3 && roundLimit !== 5) throw new Error("Elige una partida de 3 o 5 rondas.");
}

function normalizeName(name: string): string {
  if (typeof name !== "string") throw new Error("Escribe tu nombre.");
  const normalized = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 24 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Tu nombre debe tener entre 1 y 24 caracteres.");
  }
  return normalized;
}

function makePlayer(player: RoomPlayerInput, team: Team | null, now: number): StoredPlayer {
  if (!player || typeof player.id !== "string" || !player.id ||
      typeof player.tokenHash !== "string" || !player.tokenHash) {
    throw new Error("La sesión del jugador no es válida.");
  }
  return { id: player.id, name: normalizeName(player.name), tokenHash: player.tokenHash,
    team, score: 0, joinedAt: now, lastSeenAt: now };
}

function assignTeam(room: StoredRoom): Team {
  const a = room.players.filter((player) => player.team === "a").length;
  const b = room.players.filter((player) => player.team === "b").length;
  return a <= b ? "a" : "b";
}

function isActive(player: StoredPlayer, now: number): boolean {
  return now - player.lastSeenAt <= STALE_DURATION_MS;
}

function assignHost(room: StoredRoom, now: number) {
  const host = room.players.find((player) => player.id === room.hostId);
  if (host && isActive(host, now)) return;
  const candidates = [...room.players].sort((left, right) => left.joinedAt - right.joinedAt);
  room.hostId = candidates.find((player) => isActive(player, now))?.id ?? host?.id ?? candidates[0]?.id ?? "";
}

function resetMatch(room: StoredRoom) {
  room.phase = "lobby";
  room.round = 0;
  room.deadline = null;
  room.nextAt = null;
  room.moves = {};
  room.history = [];
  room.matchId = crypto.randomUUID();
  room.tournament = null;
  for (const player of room.players) player.score = 0;
}

function refreshScores(room: StoredRoom) {
  for (const player of room.players) {
    // In a tournament the score is matches won; elsewhere it is points across rounds.
    player.score = room.tournament ? matchesWon(room.tournament, player.id)
      : room.history.reduce((sum, round) => sum + (round.points[player.id] ?? 0), 0);
  }
}

function resolveRound(room: StoredRoom, now: number) {
  const round: RoomRound = {
    number: room.round,
    moves: Object.fromEntries(room.players.map((player) => [player.id, room.moves[player.id] ?? null])),
    points: Object.fromEntries(room.players.map((player) => [player.id, 0])),
    teamPoints: { a: 0, b: 0 },
    winners: [],
  };
  for (let left = 0; left < room.players.length; left++) {
    for (let right = left + 1; right < room.players.length; right++) {
      const first = room.players[left];
      const second = room.players[right];
      if (room.mode === "teams" && first.team === second.team) continue;
      const firstMove = round.moves[first.id];
      const secondMove = round.moves[second.id];
      if (!firstMove && !secondMove) continue;
      if (!firstMove) round.points[second.id]++;
      else if (!secondMove) round.points[first.id]++;
      else {
        const result = outcome(firstMove, secondMove);
        if (result === "win") round.points[first.id]++;
        if (result === "lose") round.points[second.id]++;
      }
    }
  }
  for (const player of room.players) {
    if (player.team) round.teamPoints[player.team] += round.points[player.id];
  }
  if (room.mode === "teams") {
    if (round.teamPoints.a !== round.teamPoints.b) {
      const winner: Team = round.teamPoints.a > round.teamPoints.b ? "a" : "b";
      round.winners = room.players.filter((player) => player.team === winner).map((player) => player.id);
    }
  } else {
    const best = Math.max(0, ...Object.values(round.points));
    if (best > 0) round.winners = room.players.filter((player) => round.points[player.id] === best).map((player) => player.id);
  }
  room.history.push(round);
  room.deadline = null;
  room.phase = room.round >= room.roundLimit ? "finished" : "between";
  room.nextAt = room.phase === "between" ? now + ROUND_RESULT_MS : null;
  refreshScores(room);
}

function openRound(room: StoredRoom, number: number, now: number) {
  room.round = number;
  room.moves = {};
  room.deadline = now + ROUND_DURATION_MS;
  room.nextAt = null;
  room.phase = "playing";
}

/** All state transitions return a copy; callers persist it atomically. */
export function createRoom(code: string, player: RoomPlayerInput, mode: RoomMode, roundLimit: 3 | 5, now: number): StoredRoom {
  validateSettings(mode, roundLimit);
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalizedCode)) throw new Error("El código de sala no es válido.");
  const host = makePlayer(player, mode === "teams" ? "a" : null, now);
  return {
    code: normalizedCode, mode, roundLimit, phase: "lobby", hostId: host.id,
    players: [host], round: 0, deadline: null, moves: {}, history: [],
    createdAt: now, updatedAt: now, matchId: crypto.randomUUID(),
  };
}

export function joinRoom(room: StoredRoom, player: RoomPlayerInput, now: number, capacity = capacityFor(room.mode)): StoredRoom {
  let next = cloneRoom(room);
  const existing = next.players.find((member) => member.tokenHash === player.tokenHash);
  if (existing) {
    existing.lastSeenAt = now;
    next = settleRoom(next, now);
    next.updatedAt = now;
    return next;
  }
  next = settleRoom(next, now);
  if (next.phase !== "lobby") throw new Error("La partida ya comenzó. Espera a que vuelvan a la sala.");
  if (next.players.length >= capacity) throw new Error(`La sala está llena. El máximo es de ${capacity} jugadores.`);
  const added = makePlayer(player, next.mode === "teams" ? assignTeam(next) : null, now);
  if (next.players.some((member) => member.id === added.id)) throw new Error("La sesión del jugador ya está en uso.");
  if (next.players.some((member) => member.name.toLocaleLowerCase("es") === added.name.toLocaleLowerCase("es"))) {
    throw new Error("Ese nombre ya está en la sala. Elige otro.");
  }
  next.players.push(added);
  assignHost(next, now);
  next.updatedAt = now;
  return next;
}

export function settleRoom(room: StoredRoom, now: number): StoredRoom {
  const next = cloneRoom(room);
  let changed = false;
  if (next.phase === "lobby") {
    const players = next.players.filter((player) => isActive(player, now));
    changed = players.length !== next.players.length;
    next.players = players;
  }
  const oldHost = next.hostId;
  assignHost(next, now);
  changed ||= oldHost !== next.hostId;
  if (next.phase === "playing" && next.tournament) {
    const before = JSON.stringify(next.tournament);
    if (settleTournament(next.tournament, now)) next.phase = "finished";
    changed ||= before !== JSON.stringify(next.tournament);
  } else if (next.phase === "playing" && next.deadline !== null && now >= next.deadline) {
    resolveRound(next, now);
    changed = true;
  }
  if (next.phase === "between" && next.nextAt && now >= next.nextAt) {
    openRound(next, next.round + 1, now);
    changed = true;
  }
  refreshScores(next);
  if (changed) next.updatedAt = now;
  return next;
}

export function applyRoomAction(room: StoredRoom, playerId: string, action: RoomAction, now: number): StoredRoom {
  let next = cloneRoom(room);
  const connected = next.players.find((player) => player.id === playerId);
  if (!connected) throw new Error("Ya no estás en esta sala. Vuelve a unirte con el código.");
  connected.lastSeenAt = now;
  next = settleRoom(next, now);
  const player = next.players.find((member) => member.id === playerId)!;
  const hostOnly = () => {
    if (next.hostId !== playerId) throw new Error("Solo quien dirige la sala puede hacer esto.");
  };
  const lobbyOnly = () => {
    if (next.phase !== "lobby") throw new Error("Solo puedes cambiar esto antes de iniciar la partida.");
  };
  switch (action.type) {
    case "team":
      lobbyOnly();
      if (next.mode !== "teams") throw new Error("Activa el modo de equipos para elegir un lado.");
      if (action.team !== "a" && action.team !== "b") throw new Error("El equipo no es válido.");
      player.team = action.team;
      break;
    case "settings":
      hostOnly();
      lobbyOnly();
      validateSettings(action.mode, action.roundLimit);
      if (next.players.length > capacityFor(action.mode)) throw new Error("Hay demasiados jugadores en la sala para ese modo.");
      if (next.mode !== action.mode) {
        next.players.forEach((member, index) => { member.team = action.mode === "teams" ? (index % 2 === 0 ? "a" : "b") : null; });
      }
      next.mode = action.mode;
      next.roundLimit = action.roundLimit;
      break;
    case "start":
      hostOnly();
      lobbyOnly();
      if (next.mode === "tournament") {
        if (next.players.length < TOURNAMENT_MIN_PLAYERS) throw new Error(`Un torneo necesita al menos ${TOURNAMENT_MIN_PLAYERS} jugadores.`);
        resetMatch(next);
        next.tournament = createTournament(next.players, now);
        next.round = 1;
        next.phase = "playing";
        break;
      }
      if (next.players.length < 2) throw new Error("Necesitas al menos 2 jugadores para comenzar.");
      if (next.mode === "teams" && (next.players.length !== 4 ||
          next.players.filter((member) => member.team === "a").length !== 2 ||
          next.players.filter((member) => member.team === "b").length !== 2)) {
        throw new Error("Para jugar 2 contra 2 necesitan 4 jugadores, con 2 en cada equipo.");
      }
      resetMatch(next);
      openRound(next, 1, now);
      break;
    case "move": {
      if (!legalMoves.includes(action.move)) throw new Error("Elige piedra, papel o tijera.");
      if (next.tournament) {
        if (action.matchId !== next.matchId) throw new Error("La ronda cambió. Actualiza la sala y vuelve a elegir.");
        if (next.phase !== "playing") throw new Error("El torneo ya terminó.");
        // In a tournament `round` is the game number inside the player's current match.
        submitTournamentMove(next.tournament, playerId, action.move, action.round, now);
        if (settleTournament(next.tournament, now)) next.phase = "finished";
        break;
      }
      if (action.matchId !== next.matchId || action.round !== next.round) {
        throw new Error("La ronda cambió. Actualiza la sala y vuelve a elegir.");
      }
      if (next.phase !== "playing") {
        const resolved = next.history.find((round) => round.number === action.round);
        if (resolved?.moves[playerId] === action.move) break;
        throw new Error("La ronda ya terminó. Espera a la siguiente.");
      }
      const previous = next.moves[playerId];
      if (previous && previous !== action.move) throw new Error("Ya elegiste tu jugada para esta ronda.");
      next.moves[playerId] = action.move;
      if (next.players.every((member) => Boolean(next.moves[member.id]))) resolveRound(next, now);
      break;
    }
    case "next":
      hostOnly();
      if (next.tournament) throw new Error("El torneo avanza solo cuando terminan todos los enfrentamientos.");
      if (next.phase !== "between") throw new Error("Todavía no puedes abrir la siguiente ronda.");
      openRound(next, next.round + 1, now);
      break;
    case "rematch":
      hostOnly();
      if (next.phase !== "finished") throw new Error("Termina la partida antes de pedir la revancha.");
      resetMatch(next);
      break;
    case "leave":
      next.players = next.players.filter((member) => member.id !== playerId);
      if (next.tournament && next.phase === "playing") {
        // Leaving a tournament forfeits; everyone else keeps playing.
        forfeit(next.tournament, playerId);
        if (settleTournament(next.tournament, now)) next.phase = "finished";
      } else if (next.phase !== "lobby") resetMatch(next);
      assignHost(next, now);
      break;
    default:
      throw new Error("La acción de sala no es válida.");
  }
  next.updatedAt = now;
  return next;
}

export function publicRoom(room: StoredRoom, viewerId: string | null, now: number): PublicRoom {
  const next = cloneRoom(room);
  refreshScores(next);
  const meId = next.players.some((player) => player.id === viewerId) ? viewerId : null;
  const teamScores = next.history.reduce((total, round) => ({
    a: total.a + round.teamPoints.a,
    b: total.b + round.teamPoints.b,
  }), { a: 0, b: 0 });
  const tournament = next.tournament ?? null;
  const pendingMoves = (id: string) => tournament ? activeMatch(tournament, id)?.moves ?? {} : next.moves;
  return {
    ...next,
    moves: next.phase === "playing" ? {} : { ...next.moves },
    players: next.players.map(({ tokenHash: _secret, ...player }) => ({
      ...player,
      submitted: Boolean(pendingMoves(player.id)[player.id]),
      online: now - player.lastSeenAt <= ONLINE_DURATION_MS,
    })),
    meId,
    serverNow: now,
    ownMove: meId ? pendingMoves(meId)[meId] ?? null : null,
    teamScores,
    tournament: tournament ? publicTournament(tournament) : null,
  };
}
