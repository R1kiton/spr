import { CheckCheck, Clock3, Crown, LoaderCircle, RotateCcw, Trophy } from "lucide-react";
import { moves, type Move } from "../../lib/game";
import type { PublicRoom } from "../../lib/rooms";
import { activeMatch, MATCH_WINS, roundName, type PublicMatch } from "../../lib/tournament";
import { HandIcon } from "../hand-icon";
import { MoveIcon } from "../move-icon";

const youColor = "var(--you)";
const rivalColor = "var(--rival)";
const beats: Record<Move, Move> = { piedra: "tijera", papel: "piedra", tijera: "papel" };
const secondsUntil = (time: number, now: number) => Math.max(0, Math.ceil((time - now) / 1000));

type Props = { room: PublicRoom; now: number; host: boolean; pending: string; captureBusy: boolean; onMove: (move: Move) => void; onRematch: () => void };

/** A running or finished tournament: the viewer's match on top, the whole bracket below. `now` is server time. */
export function TournamentView({ room, now, host, pending, captureBusy, onMove, onRematch }: Props) {
  const tournament = room.tournament!;
  const total = tournament.rounds.length;
  const names = new Map(tournament.entrants.map(entrant => [entrant.id, entrant.name]));
  const nameOf = (id: string | null) => id ? names.get(id) ?? "Jugador" : "Pase";
  const me = room.meId;
  const match = me ? activeMatch(tournament, me) : null;
  const finished = room.phase === "finished";
  const champion = tournament.champion;
  const eliminatedIn = me ? tournament.rounds.flat().find(item => item.done && item.winner !== me && (item.a === me || item.b === me)) : undefined;
  const waitingNext = me && !match && !eliminatedIn && !finished;

  let clock: { label: string; value: number; urgent?: boolean } | null = null;
  if (match?.startsAt && now < match.startsAt) clock = { label: "para el juego", value: secondsUntil(match.startsAt, now) };
  else if (match?.deadline) clock = { label: "segundos", value: secondsUntil(match.deadline, now), urgent: secondsUntil(match.deadline, now) <= 5 };
  else if (tournament.breakUntil) clock = { label: "para la siguiente ronda", value: secondsUntil(tournament.breakUntil, now) };

  return <>
    <section className="room-match-heading"><h2>{finished ? "El torneo terminó." : `${roundName(tournament.current, total)}, al mejor de ${MATCH_WINS * 2 - 1}`}</h2>
      {clock && !finished ? <div className={`room-time ${clock.urgent ? "room-time-urgent" : ""}`} role="timer" aria-label={`${clock.value} ${clock.label}`}><Clock3 size={18} /><strong>{clock.value.toString().padStart(2, "0")}</strong><span>{clock.label}</span></div>
        : <span className="room-phase-badge">{finished ? "Torneo terminado" : `${tournament.rounds[tournament.current].filter(item => item.done).length} de ${tournament.rounds[tournament.current].length} listos`}</span>}
    </section>

    <section className="room-card tournament-mine">
      {finished ? <div className="tournament-champion"><span className="room-result-icon room-result-final"><Trophy size={36} /></span><h2>{champion ? `¡${nameOf(champion)}${champion === me ? " (tú)" : ""} gana el torneo!` : "El torneo terminó sin campeón"}</h2><p>{champion === me ? "Ganaste todos tus enfrentamientos. La arena es tuya." : "Así quedó el bracket. La revancha está a un clic."}</p>
        {host ? <button className="primary room-result-next" disabled={!!pending} onClick={onRematch}><span><RotateCcw size={17} /> Preparar otro torneo</span></button> : <span className="room-host-wait"><LoaderCircle className="room-spinner" size={14} /> El anfitrión puede preparar otro torneo.</span>}</div>
        : match ? <MatchCard match={match} me={me!} now={now} nameOf={nameOf} ownMove={room.ownMove} pending={pending} captureBusy={captureBusy} onMove={onMove} />
        : waitingNext ? <div className="tournament-waiting"><span className="room-result-icon"><CheckCheck size={31} /></span><h3>Ganaste tu enfrentamiento.</h3><p>Esperando a que terminen los demás para la siguiente ronda.</p></div>
        : eliminatedIn ? <div className="tournament-waiting"><h3>Quedaste fuera en {roundName(eliminatedIn.round, total).toLowerCase()}.</h3><p>Sigue el torneo desde el bracket. Pronto habrá revancha.</p></div>
        : <div className="tournament-waiting"><h3>Estás viendo el torneo.</h3></div>}
    </section>

    <section className="room-card tournament-bracket-card" aria-label="Bracket del torneo"><div className="room-card-title"><h2><Trophy size={17} /> Bracket</h2><span>{tournament.entrants.length} jugadores</span></div>
      <div className="tournament-bracket" style={{ gridTemplateColumns: `repeat(${total}, minmax(190px, 1fr))` }}>
        {tournament.rounds.map((round, index) => <div key={index} className={`tournament-round ${index === tournament.current && !finished ? "is-current" : ""}`}>
          <h3>{roundName(index, total)}</h3>
          <div className="tournament-round-matches">{round.map(item => <BracketMatch key={item.id} match={item} me={me} nameOf={nameOf} live={index === tournament.current && !item.done && !finished} />)}</div>
        </div>)}
      </div>
    </section>
  </>;
}

function MatchCard({ match, me, now, nameOf, ownMove, pending, captureBusy, onMove }: { match: PublicMatch; me: string; now: number; nameOf: (id: string | null) => string; ownMove: Move | null; pending: string; captureBusy: boolean; onMove: (move: Move) => void }) {
  const rival = match.a === me ? match.b! : match.a!;
  const lastGame = match.games.at(-1);
  const open = match.deadline !== null && now < match.deadline && (match.startsAt === null || now >= match.startsAt);
  const pips = (id: string) => Array.from({ length: MATCH_WINS }, (_, index) => <i key={index} className={index < (match.wins[id] ?? 0) ? "won" : ""} />);
  return <>
    <div className="tournament-versus">
      <div className="tournament-side you"><strong>{nameOf(me)} <small>tú</small></strong><span className="tournament-pips" aria-label={`${match.wins[me] ?? 0} juegos ganados`}>{pips(me)}</span></div>
      <span className="tournament-game">Juego {match.game}</span>
      <div className="tournament-side rival"><strong>{nameOf(rival)}</strong><span className="tournament-pips" aria-label={`${match.wins[rival] ?? 0} juegos ganados`}>{pips(rival)}</span></div>
    </div>
    {lastGame && <div className="tournament-last" aria-live="polite"><MoveIcon move={lastGame.moves[me] ?? "piedra"} accent={youColor} className={lastGame.moves[me] ? "" : "is-empty"} /><span>{lastGame.winner === me ? "Ganaste el juego anterior" : lastGame.winner === rival ? `${nameOf(rival)} ganó el juego anterior` : "Empate, se repite"}</span><MoveIcon move={lastGame.moves[rival] ?? "piedra"} side="p2" accent={rivalColor} className={lastGame.moves[rival] ? "" : "is-empty"} /></div>}
    {ownMove ? <div className="room-submitted" role="status"><span className="room-submitted-emoji"><MoveIcon move={ownMove} accent={youColor} /></span><h3>Ya elegiste {ownMove}.</h3><p>{match.ready.includes(rival) ? "Revelando…" : `Esperando a ${nameOf(rival)}.`}</p></div>
      : <><p className="room-card-intro">{open ? "Elige un gesto. Se confirma al tocarlo y ya no puedes cambiarlo." : "Prepárate para el siguiente juego."}</p>
        <div className="room-move-buttons">{moves.map(move => <button key={move} disabled={!open || !!pending || captureBusy} onClick={() => onMove(move)}><HandIcon move={move} wrap={youColor} /><strong>{move}</strong><small>Vence a {beats[move]}</small></button>)}</div></>}
  </>;
}

function BracketMatch({ match, me, nameOf, live }: { match: PublicMatch; me: string | null; nameOf: (id: string | null) => string; live: boolean }) {
  const row = (id: string | null) => <div className={`tournament-slot ${match.done && id && match.winner === id ? "is-winner" : ""} ${match.done && match.winner !== id ? "is-out" : ""} ${id && id === me ? "is-me" : ""}`}>
    <span>{match.winner === id && match.done && id ? <Crown size={13} /> : null}{id === null && match.round > 0 && !match.done ? "Por definir" : nameOf(id)}</span>
    <b>{match.walkover || id === null || (match.game === 0 && !match.done) ? "" : match.wins[id] ?? 0}</b>
  </div>;
  return <div className={`tournament-match ${live ? "is-live" : ""}`}>{row(match.a)}{row(match.b)}{match.walkover && match.winner && <small>Pasa directo</small>}</div>;
}
