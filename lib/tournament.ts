import { outcome, type Move } from "./game";

export const TOURNAMENT_MIN_PLAYERS = 4;
export const TOURNAMENT_MAX_PLAYERS = 16;
/** Best of 3: the first to win two games takes the match. Tied games are replayed. */
export const MATCH_WINS = 2;
export const GAME_DURATION_MS = 20_000;
/** Pause between games of a match so both players see the reveal. */
export const GAME_BREAK_MS = 3_000;
/** Pause between bracket rounds so everyone sees who advanced. */
export const ROUND_BREAK_MS = 6_000;
/** Safety valves so an abandoned or endlessly tied match still ends. */
export const MAX_GAMES = 9;
const MAX_EMPTY_STREAK = 2;

export interface TournamentGame {
  moves: Record<string, Move | null>;
  /** Null when the game was tied or nobody played. */
  winner: string | null;
}

export interface TournamentMatch {
  id: string;
  round: number;
  slot: number;
  /** Side a always holds the better seed of the pairing. */
  a: string | null;
  b: string | null;
  wins: Record<string, number>;
  /** Current game number, from 1. */
  game: number;
  /** Hidden moves of the current game. */
  moves: Record<string, Move>;
  startsAt: number | null;
  deadline: number | null;
  games: TournamentGame[];
  emptyStreak: number;
  winner: string | null;
  done: boolean;
  /** Decided without playing (empty slot or a player who left). */
  walkover: boolean;
}

export interface Tournament {
  entrants: { id: string; name: string; seed: number }[];
  rounds: TournamentMatch[][];
  current: number;
  breakUntil: number | null;
  /** Players who left; they lose any match they would play. */
  out: string[];
  champion: string | null;
}

export type PublicMatch = Omit<TournamentMatch, "moves"> & { ready: string[] };
export type PublicTournament = Omit<Tournament, "rounds"> & { rounds: PublicMatch[][] };

function randomOrder<T>(items: T[]): T[] {
  const order = [...items];
  for (let index = order.length - 1; index > 0; index--) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    const swap = value[0] % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function emptyMatch(round: number, slot: number): TournamentMatch {
  return { id: `r${round + 1}m${slot + 1}`, round, slot, a: null, b: null, wins: {}, game: 0, moves: {},
    startsAt: null, deadline: null, games: [], emptyStreak: 0, winner: null, done: false, walkover: false };
}

/** Seeds players at random into a single-elimination bracket; extra slots become byes. */
export function createTournament(players: { id: string; name: string }[], now: number, order = randomOrder): Tournament {
  if (players.length < TOURNAMENT_MIN_PLAYERS) throw new Error(`Un torneo necesita al menos ${TOURNAMENT_MIN_PLAYERS} jugadores.`);
  if (players.length > TOURNAMENT_MAX_PLAYERS) throw new Error(`Un torneo admite como máximo ${TOURNAMENT_MAX_PLAYERS} jugadores.`);
  const seeded = order(players);
  let size = 2;
  while (size < seeded.length) size *= 2;
  const rounds: TournamentMatch[][] = [];
  for (let round = 0, matches = size / 2; matches >= 1; round++, matches /= 2) {
    rounds.push(Array.from({ length: matches }, (_, slot) => emptyMatch(round, slot)));
  }
  // Seed i meets seed size-1-i, so byes go to the best seeds and never pair two empty slots.
  rounds[0].forEach((match, slot) => {
    match.a = seeded[slot]?.id ?? null;
    match.b = seeded[size - 1 - slot]?.id ?? null;
  });
  const tournament: Tournament = {
    entrants: seeded.map((player, index) => ({ id: player.id, name: player.name, seed: index + 1 })),
    rounds, current: 0, breakUntil: null, out: [], champion: null,
  };
  openRound(tournament, 0, now);
  return tournament;
}

function decide(tournament: Tournament, match: TournamentMatch, winner: string | null, walkover = false) {
  Object.assign(match, { winner, done: true, walkover, moves: {}, startsAt: null, deadline: null });
  const next = tournament.rounds[match.round + 1]?.[Math.floor(match.slot / 2)];
  if (next) next[match.slot % 2 === 0 ? "a" : "b"] = winner;
}

function openGame(match: TournamentMatch, number: number, startsAt: number) {
  Object.assign(match, { game: number, moves: {}, startsAt, deadline: startsAt + GAME_DURATION_MS });
}

function openRound(tournament: Tournament, index: number, now: number) {
  tournament.current = index;
  tournament.breakUntil = null;
  for (const match of tournament.rounds[index]) {
    const a = match.a && !tournament.out.includes(match.a) ? match.a : null;
    const b = match.b && !tournament.out.includes(match.b) ? match.b : null;
    if (!a || !b) decide(tournament, match, a ?? b, true);
    else openGame(match, 1, now);
  }
}

function resolveGame(tournament: Tournament, match: TournamentMatch, now: number) {
  const a = match.a!;
  const b = match.b!;
  const moveA = match.moves[a] ?? null;
  const moveB = match.moves[b] ?? null;
  let winner: string | null = null;
  if (moveA && moveB) {
    const result = outcome(moveA, moveB);
    winner = result === "win" ? a : result === "lose" ? b : null;
  } else winner = moveA ? a : moveB ? b : null;
  match.games.push({ moves: { [a]: moveA, [b]: moveB }, winner });
  match.emptyStreak = moveA || moveB ? 0 : match.emptyStreak + 1;
  if (winner) match.wins[winner] = (match.wins[winner] ?? 0) + 1;
  if (winner && match.wins[winner] >= MATCH_WINS) return decide(tournament, match, winner);
  if (match.emptyStreak >= MAX_EMPTY_STREAK || match.games.length >= MAX_GAMES) {
    // Nobody is playing or it never breaks the tie: more wins advance, then the better seed.
    return decide(tournament, match, (match.wins[b] ?? 0) > (match.wins[a] ?? 0) ? b : a);
  }
  openGame(match, match.game + 1, now + GAME_BREAK_MS);
}

/** Resolves expired games and moves the bracket forward. Returns true once a champion is decided. */
export function settleTournament(tournament: Tournament, now: number): boolean {
  const final = tournament.rounds[tournament.rounds.length - 1][0];
  if (final.done) {
    tournament.champion = final.winner;
    return true;
  }
  const round = tournament.rounds[tournament.current];
  for (const match of round) {
    if (!match.done && match.deadline !== null && now >= match.deadline) resolveGame(tournament, match, now);
  }
  if (!round.every(match => match.done)) return false;
  if (tournament.current === tournament.rounds.length - 1) {
    tournament.champion = round[0].winner;
    return true;
  }
  if (tournament.breakUntil === null) tournament.breakUntil = now + ROUND_BREAK_MS;
  else if (now >= tournament.breakUntil) {
    openRound(tournament, tournament.current + 1, now);
    return settleTournament(tournament, now);
  }
  return false;
}

type MatchSides = { a: string | null; b: string | null; done: boolean };

/** The unfinished match a player is in during the current bracket round, if any. Works on public snapshots too. */
export function activeMatch<M extends MatchSides>(tournament: { rounds: M[][]; current: number }, playerId: string): M | null {
  return tournament.rounds[tournament.current]?.find(match => !match.done && (match.a === playerId || match.b === playerId)) ?? null;
}

export function submitTournamentMove(tournament: Tournament, playerId: string, move: Move, game: number, now: number) {
  const current = tournament.rounds[tournament.current].find(match => match.a === playerId || match.b === playerId);
  // Retrying a move that already counted is harmless.
  if (current?.games[game - 1]?.moves[playerId] === move) return;
  const match = activeMatch(tournament, playerId);
  if (!match) throw new Error("No tienes un enfrentamiento en curso. Espera a la siguiente ronda del torneo.");
  if (game !== match.game) throw new Error("La ronda cambió. Actualiza la sala y vuelve a elegir.");
  if (match.startsAt !== null && now < match.startsAt) throw new Error("El siguiente juego aún no empieza.");
  if (match.deadline !== null && now >= match.deadline) throw new Error("La ronda ya terminó. Espera a la siguiente.");
  const previous = match.moves[playerId];
  if (previous && previous !== move) throw new Error("Ya elegiste tu jugada para esta ronda.");
  match.moves[playerId] = move;
  if (match.moves[match.a!] && match.moves[match.b!]) resolveGame(tournament, match, now);
}

/** A player who leaves loses their current match and any later one. */
export function forfeit(tournament: Tournament, playerId: string) {
  if (!tournament.out.includes(playerId)) tournament.out.push(playerId);
  const match = activeMatch(tournament, playerId);
  if (match) decide(tournament, match, match.a === playerId ? match.b : match.a, true);
}

export function matchesWon(tournament: Tournament, playerId: string) {
  return tournament.rounds.flat().filter(match => match.winner === playerId && !match.walkover).length;
}

/** Hides the moves of games still in progress; reveals who already chose. */
export function publicTournament(tournament: Tournament): PublicTournament {
  const copy = structuredClone(tournament);
  return { ...copy, rounds: copy.rounds.map(round => round.map(({ moves, ...match }) => ({ ...match, ready: Object.keys(moves) }))) };
}

export function roundName(index: number, total: number) {
  const fromEnd = total - 1 - index;
  return ["Final", "Semifinales", "Cuartos de final", "Octavos de final"][fromEnd] ?? `Ronda ${index + 1}`;
}
