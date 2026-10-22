"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Camera, CameraOff, Check, CheckCheck, Clock3, Copy, Crown, Link2, LoaderCircle, LogOut, Plus, Radio, RotateCcw, ShieldCheck, Swords, Trophy, Users, X } from "lucide-react";
import { moves, type Move } from "../../lib/game";
import { capacityFor, type PublicRoom } from "../../lib/rooms";
import { activeMatch, TOURNAMENT_MAX_PLAYERS, TOURNAMENT_MIN_PLAYERS } from "../../lib/tournament";
import { ArenaTopbar, ModeTabs } from "../arena-nav";
import { HandIcon } from "../hand-icon";
import { MoveIcon } from "../move-icon";
import { TournamentView } from "./tournament-view";
import { useGestureCamera } from "./use-gesture-camera";
import "../arena.css";
import "./rooms.css";

// Rooms are 1v1 duels or tournaments; the server does not offer 2v2 teams.
type Kind = "solo" | "tournament";
type Action = { type: "settings"; mode: Kind; roundLimit: 3 | 5 } | { type: "start" | "next" | "rematch" | "leave" } | { type: "move"; move: Move; round: number; matchId: string };
// As in the solo arena: you are blue and your rival is red.
const youColor = "var(--you)";
const rivalColor = "var(--rival)";
function playerColor(room: PublicRoom, id: string | null) {
  return id !== null && id === room.meId ? youColor : rivalColor;
}
const missingPlayers = (count: number) => count === 1 ? "Falta 1 jugador" : `Faltan ${count} jugadores`;
const beats: Record<Move, Move> = { piedra: "tijera", papel: "piedra", tijera: "papel" };
const ACTIVE_ROOM = "gesto-arena-room";
const PLAYER_NAME = "gesto-arena-name";

class RoomRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function requestRoom(path: string, signal: AbortSignal, body?: unknown): Promise<PublicRoom | { left: true }> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  let data;
  try { data = await response.json(); } catch { throw new Error("No pudimos conectar con la sala. Vuelve a intentarlo."); }
  if (!response.ok) throw new RoomRequestError(data.error || "No pudimos completar la acción. Vuelve a intentarlo.", response.status);
  return data;
}

export default function RoomsPage() {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [entry, setEntry] = useState<"create" | "join">("create");
  const [kind, setKind] = useState<Kind>("solo");
  const [roundLimit, setRoundLimit] = useState<3 | 5>(3);
  const [pending, setPending] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [accessLost, setAccessLost] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const roomRef = useRef<PublicRoom | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  const offset = useRef(0);
  const pollController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);

  const acceptRoom = useCallback((next: PublicRoom) => {
    roomRef.current = next;
    offset.current = next.serverNow - Date.now();
    setRoom(next);
    setNow(Date.now());
    setAccessLost(false);
    try { localStorage.setItem(ACTIVE_ROOM, next.code); } catch { /* Storage is optional. */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    const params = new URLSearchParams(window.location.search);
    const invitation = (params.get("codigo") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    let saved = "";
    try { saved = localStorage.getItem(ACTIVE_ROOM) || ""; setName(localStorage.getItem(PLAYER_NAME) || ""); } catch { /* Storage is optional. */ }
    if (invitation) { setCode(invitation); setEntry("join"); }
    if (saved && (!invitation || invitation === saved)) {
      requestRoom(`/api/rooms?code=${encodeURIComponent(saved)}`, controller.signal)
        .then(data => { if (alive.current && !("left" in data)) acceptRoom(data); })
        .catch(cause => { if (!controller.signal.aborted && alive.current) { setCode(saved); setEntry("join"); setError(cause instanceof Error ? cause.message : "No pudimos recuperar la sala."); try { localStorage.removeItem(ACTIVE_ROOM); } catch { /* Storage is optional. */ } } })
        .finally(() => { if (alive.current) setRestoring(false); });
    } else setRestoring(false);
    return () => { alive.current = false; controller.abort(); actionController.current?.abort(); pollController.current?.abort(); };
  }, [acceptRoom]);

  const activeCode = room?.code;
  useEffect(() => {
    if (!activeCode) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (!busy.current && !document.hidden) {
        const controller = new AbortController();
        pollController.current = controller;
        const requestEpoch = epoch.current;
        try {
          const next = await requestRoom(`/api/rooms?code=${encodeURIComponent(activeCode)}`, controller.signal);
          if (!cancelled && alive.current && !controller.signal.aborted && requestEpoch === epoch.current && !("left" in next)) acceptRoom(next);
        } catch (cause) {
          if (!cancelled && !controller.signal.aborted && alive.current && requestEpoch === epoch.current) {
            setError(cause instanceof Error ? cause.message : "Se perdió la conexión. Estamos reintentando.");
            if (cause instanceof RoomRequestError && [403, 404].includes(cause.status)) setAccessLost(true);
          }
        } finally { if (pollController.current === controller) pollController.current = null; }
      }
      if (!cancelled) timeout = setTimeout(poll, 1200);
    };
    timeout = setTimeout(poll, 1200);
    return () => { cancelled = true; clearTimeout(timeout); pollController.current?.abort(); };
  }, [activeCode, acceptRoom]);

  useEffect(() => {
    if (room?.phase !== "playing") return;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [room?.phase]);

  const mutate = useCallback(async (body: unknown, label: string, initial = false) => {
    if (busy.current) return;
    busy.current = true;
    epoch.current++;
    pollController.current?.abort();
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setPending(label);
    setError("");
    setNotice("");
    try {
      const next = await requestRoom(initial ? "/api/rooms" : `/api/rooms/${roomRef.current?.code}`, controller.signal, body);
      if (!alive.current || controller.signal.aborted) return;
      if ("left" in next) {
        roomRef.current = null;
        setRoom(null);
        try { localStorage.removeItem(ACTIVE_ROOM); } catch { /* Storage is optional. */ }
      } else acceptRoom(next);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "No pudimos completar la acción.");
        if (!initial && cause instanceof RoomRequestError && [403, 404].includes(cause.status)) setAccessLost(true);
      }
    } finally { if (alive.current && actionController.current === controller) { busy.current = false; setPending(""); } }
  }, [acceptRoom]);

  const send = useCallback((action: Action, label: string = action.type) => mutate(action, label), [mutate]);
  const submitMove = useCallback((move: Move) => {
    const current = roomRef.current;
    if (!current || current.phase !== "playing" || current.ownMove) return;
    const serverNow = Date.now() + offset.current;
    if (current.tournament) {
      // In a tournament the move belongs to the current game of the player's own match.
      const match = current.meId ? activeMatch(current.tournament, current.meId) : null;
      if (!match?.deadline || serverNow >= match.deadline || (match.startsAt !== null && serverNow < match.startsAt)) return;
      void send({ type: "move", move, round: match.game, matchId: current.matchId }, "move");
      return;
    }
    if (!current.deadline || serverNow >= current.deadline) return;
    void send({ type: "move", move, round: current.round, matchId: current.matchId }, "move");
  }, [send]);
  const camera = useGestureCamera(submitMove);

  const myMatch = room?.tournament && room.meId ? activeMatch(room.tournament, room.meId) : null;
  useEffect(() => {
    camera.cancelCapture();
  }, [room?.round, room?.matchId, room?.phase, room?.ownMove, myMatch?.id, myMatch?.game, camera.cancelCapture]);
  useEffect(() => { if (!activeCode) camera.stop(); }, [activeCode, camera.stop]);

  function resetAccess() {
    epoch.current++;
    pollController.current?.abort();
    actionController.current?.abort();
    busy.current = false;
    camera.stop();
    roomRef.current = null;
    setRoom(null);
    setAccessLost(false);
    setPending("");
    setError("");
    try { localStorage.removeItem(ACTIVE_ROOM); } catch { /* Storage is optional. */ }
  }

  function enterRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = name.trim();
    if (nickname.length < 2) { setError("Escribe un nombre de al menos 2 caracteres para que tus amigos te reconozcan."); return; }
    try { localStorage.setItem(PLAYER_NAME, nickname); } catch { /* Storage is optional. */ }
    void mutate(entry === "create" ? { intent: "create", name: nickname, mode: kind, roundLimit } : { intent: "join", name: nickname, code }, entry, true);
  }

  async function copyInvitation(link: boolean) {
    if (!room) return;
    const value = link ? `${window.location.origin}/salas?codigo=${room.code}` : room.code;
    try { await navigator.clipboard.writeText(value); setNotice(link ? "Enlace copiado. Compártelo con tu rival." : "Código copiado."); }
    catch { setNotice(`Comparte este código con tu rival: ${room.code}`); }
  }

  const host = !!room && room.hostId === room.meId;
  const tournamentRoom = room?.mode === "tournament";
  const capacity = room ? capacityFor(room.mode) : 2;
  const canStart = !!room && room.players.length >= (tournamentRoom ? TOURNAMENT_MIN_PLAYERS : 2);
  const deadline = room?.tournament ? myMatch?.deadline : room?.deadline;
  const seconds = deadline ? Math.max(0, Math.ceil((deadline - now - offset.current) / 1000)) : 0;
  const canPlay = room?.tournament ? !!myMatch && seconds > 0 && (myMatch.startsAt === null || now + offset.current >= myMatch.startsAt) : room?.phase === "playing";
  const last = room?.history[room.history.length - 1];
  const rankings = room ? [...room.players].sort((a, b) => b.score - a.score) : [];
  const winningScore = rankings[0]?.score ?? 0;
  const champions = rankings.filter(player => player.score === winningScore);
  const finalTitle = champions.length === 1 ? `¡${champions[0].name} gana!` : "¡Empate en el duelo!";
  const allSubmitted = room?.players.filter(player => player.submitted).length ?? 0;

  return <main className="fight rooms-page">
    <ArenaTopbar />
    <section className="intro"><div className="intro-title"><h1>{room ? "Tu sala" : <>Pelea con<br />tus amigos</>}</h1><p>{room ? room.mode === "tournament" ? "Un torneo de eliminación directa: cada enfrentamiento es al mejor de 3." : "Un duelo de 2, cada quien desde su dispositivo. Las jugadas se revelan al cerrar la ronda." : "Crea una sala, comparte el código y que hablen las manos."}</p></div><ModeTabs current="friends" /></section>

    {error && <div className="room-alert" role="alert"><span>{error}</span>{accessLost && <button className="room-return-access" onClick={resetAccess}>Volver al acceso <ArrowRight size={14} /></button>}<button onClick={() => setError("")} aria-label="Cerrar aviso"><X size={17} /></button></div>}
    {notice && <div className="room-notice" role="status"><Check size={16} />{notice}</div>}

    {restoring ? <div className="room-restoring" role="status"><LoaderCircle className="room-spinner" size={22} /> Recuperando tu sala…</div> : !room ? <>
      <div className="room-entry-grid">
        <section className="room-entry-card">
          <div className="room-tabs" role="group" aria-label="Acceso a las salas"><button aria-pressed={entry === "create"} onClick={() => { setEntry("create"); setError(""); }}><Plus size={16} /> Crear una sala</button><button aria-pressed={entry === "join"} onClick={() => { setEntry("join"); setError(""); }}><Users size={16} /> Tengo un código</button></div>
          <form onSubmit={enterRoom}>
            <div className="room-form-heading"><span className={`room-feature-icon ${entry === "join" ? "join" : ""}`}>{entry === "create" ? <Swords size={24} /> : <Users size={24} />}</span><h2>{entry === "create" ? "Abre la puerta a la revancha." : "Tu lugar está en la arena."}</h2><p>{entry === "create" ? "Tú eliges cómo jugar. El código lo ponemos nosotros." : "Solo necesitas tu nombre y el código de tus amigos."}</p></div>
            <label className="room-label" htmlFor="player-name">Tu nombre</label><input id="player-name" className="room-input" autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} maxLength={20} required placeholder="¿Cómo te dicen tus amigos?" disabled={!!pending} />
            {entry === "join" ? <><label className="room-label" htmlFor="room-code">Código de la sala</label><input id="room-code" className="room-input room-code-input" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} minLength={6} pattern="[A-Z2-9]{6}" autoComplete="off" autoCapitalize="characters" spellCheck={false} required placeholder="ABC234" disabled={!!pending} /><p className="room-field-hint">Son 6 letras o números. Pídeselo a quien creó la sala.</p></> : <><fieldset className="room-fieldset"><legend>Tipo de sala</legend><div className="room-kind-options">{(["solo", "tournament"] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)} disabled={!!pending}><strong>{value === "solo" ? "Duelo" : "Torneo"}</strong><small>{value === "solo" ? "1 contra 1, a 3 o 5 rondas" : `De ${TOURNAMENT_MIN_PLAYERS} a ${TOURNAMENT_MAX_PLAYERS} jugadores, con bracket`}</small></button>)}</div></fieldset>{kind === "solo" && <fieldset className="room-fieldset"><legend>¿Cuántas rondas?</legend><div className="room-round-options">{([3, 5] as const).map(value => <button type="button" key={value} aria-pressed={roundLimit === value} onClick={() => setRoundLimit(value)} disabled={!!pending}>{value} rondas {roundLimit === value && <Check size={14} />}</button>)}</div></fieldset>}</>}
            <button className="primary room-entry-submit" type="submit" disabled={!!pending || (entry === "join" && code.length !== 6)}><span>{pending ? <LoaderCircle className="room-spinner" size={18} /> : entry === "create" ? "Crear sala" : "Entrar a la sala"}</span></button><p className="room-no-login"><ShieldCheck size={13} /> Solo necesitas un nombre. Sin cuentas ni contraseñas.</p>
          </form>
        </section>
        <aside className="room-invite-art"><span className="room-art-tag"><Radio size={13} /> En línea</span><div className="room-art-hands" aria-hidden="true"><HandIcon move="piedra" wrap={youColor} /><HandIcon move="tijera" side="p2" wrap={rivalColor} /><i>VS</i></div><h2>Juntos, aunque<br />estén lejos.</h2><p>Cada quien desde su dispositivo.<br />Tu cámara o tres botones: tú decides.</p><div className="room-art-details"><span><Users size={16} /> Duelos 1 contra 1 o torneos de 4 a 16</span><span><Clock3 size={16} /> Rondas de 20 segundos</span><span><Trophy size={16} /> Duelos a 3 o 5 rondas, torneos al mejor de 3</span></div></aside>
      </div>
      <section className="room-quick-guide" aria-label="Cómo jugar"><div><span>01</span><strong>Crea o entra</strong><p>Un nombre y un código. Así de fácil.</p></div><div><span>02</span><strong>Invita a tu gente</strong><p>Un rival para un duelo, o hasta 16 para un torneo.</p></div><div><span>03</span><strong>Elige. Revela. Repite.</strong><p>Las jugadas se revelan al cerrar la ronda.</p></div></section>
    </> : <>
      <section className="room-bar" aria-label="Información de la sala"><div><span className="room-status-dot" /><span className="room-bar-label">Sala</span><strong className="room-code">{room.code}</strong><button className="room-icon-button" onClick={() => copyInvitation(false)} aria-label="Copiar código de sala"><Copy size={16} /></button></div><div><button className="room-soft-button" onClick={() => copyInvitation(true)}><Link2 size={15} /> {room.mode === "tournament" ? "Invitar jugadores" : "Invitar a tu rival"}</button><button className="room-leave" disabled={!!pending} onClick={() => { camera.stop(); void send({ type: "leave" }); }}><LogOut size={15} /> Salir<span className="room-desktop-only"> de la sala</span></button></div></section>

      <CameraPanel camera={camera} room={room} seconds={seconds} pending={!!pending} active={canPlay} />

      {room.phase === "lobby" ? <div className="room-lobby-grid">
        <section className="room-card room-players-card"><div className="room-card-title"><h2><Users size={18} /> {tournamentRoom ? "Participantes" : "Los rivales"}</h2><span>{room.players.length} / {capacity} jugadores</span></div><p className="room-card-intro">{tournamentRoom ? room.players.length < TOURNAMENT_MIN_PLAYERS ? `Comparte el código. ${missingPlayers(TOURNAMENT_MIN_PLAYERS - room.players.length)} para poder empezar.` : "Ya pueden empezar, o esperar a más gente." : room.players.length < capacity ? "Comparte el código con tu rival para empezar el duelo." : "Los dos están listos. Que empiece el duelo."}</p>
          <div className="room-player-list">{room.players.map(player => <Player key={player.id} player={player} room={room} />)}{tournamentRoom ? room.players.length < capacity && <div className="room-empty-slot"><Plus size={18} /> {room.players.length < TOURNAMENT_MIN_PLAYERS ? missingPlayers(TOURNAMENT_MIN_PLAYERS - room.players.length) : "Pueden entrar más jugadores…"}</div> : Array.from({ length: Math.max(0, capacity - room.players.length) }, (_, index) => <div key={index} className="room-empty-slot"><Plus size={18} /> Esperando a tu rival…</div>)}</div>
          <div className="room-waiting-hint"><span className="room-status-dot" /> La sala se actualiza automáticamente.</div>
        </section>
        <aside className="room-card room-settings"><div className="room-card-title"><h2>La partida</h2><span>{host ? <><Crown size={12} /> Tú organizas</> : "Configura el anfitrión"}</span></div>{!tournamentRoom && <fieldset className="room-fieldset"><legend>Duración de la partida</legend><div className="room-round-options">{([3, 5] as const).map(value => <button key={value} disabled={!host || !!pending} aria-pressed={room.roundLimit === value} onClick={() => send({ type: "settings", mode: "solo", roundLimit: value })}>{value} rondas</button>)}</div></fieldset>}<div className="room-rules">{tournamentRoom ? <><strong>Eliminación directa, al mejor de 3.</strong><p>El bracket se sortea al empezar; si no son 4, 8 o 16, algunos pasan directo a la siguiente ronda. Gana el enfrentamiento quien gane 2 juegos; los empates se repiten. Cada juego dura 20 segundos y los enfrentamientos de una ronda se juegan a la vez.</p></> : <><strong>Una jugada, un rival.</strong><p>Ganas 1 punto por cada ronda que le ganas a tu rival. Los empates también cuentan como ronda. Tienes 20 segundos para elegir; si no juegas y tu rival sí, la ronda es suya.</p></>}</div><button className="primary room-start" disabled={!host || !canStart || !!pending} onClick={() => send({ type: "start" })}><span>{pending === "start" ? <LoaderCircle size={17} className="room-spinner" /> : tournamentRoom ? "¡Que empiece el torneo!" : "¡Que empiece la partida!"}</span></button><p className="room-start-hint">{!host ? "El anfitrión dará inicio cuando estén listos." : tournamentRoom ? room.players.length < TOURNAMENT_MIN_PLAYERS ? `Necesitan al menos ${TOURNAMENT_MIN_PLAYERS} jugadores.` : `Se sortea un bracket para ${room.players.length} jugadores.` : room.players.length < 2 ? "Invita a tu rival para empezar." : "Los dos entrarán a la vez."}</p></aside>
      </div> : room.tournament ? <TournamentView room={room} now={now + offset.current} host={host} pending={pending} captureBusy={camera.countdown !== null} onMove={submitMove} onRematch={() => void send({ type: "rematch" })} /> : <>
        <section className="room-match-heading"><h2>{room.phase === "finished" ? "La arena ya decidió." : `Ronda ${room.round} de ${room.roundLimit}`}</h2>{room.phase === "playing" ? <div className={`room-time ${seconds <= 5 ? "room-time-urgent" : ""}`} role="timer" aria-label={`${seconds} segundos restantes`}><Clock3 size={18} /><strong>{seconds.toString().padStart(2, "0")}</strong><span>segundos</span></div> : <span className="room-phase-badge">{room.phase === "finished" ? "Partida terminada" : "Ronda terminada"}</span>}</section>
        <div className="room-game-grid">
          <section className="room-card room-play-card">
            {room.phase === "playing" ? <><div className="room-card-title"><h2>{room.ownMove ? "Tu jugada está guardada" : "Tu mano decide."}</h2><span><ShieldCheck size={12} /> Jugadas secretas</span></div>{room.ownMove ? <div className="room-submitted" role="status"><span className="room-submitted-emoji"><MoveIcon move={room.ownMove} accent={playerColor(room, room.meId)} /></span><span className="room-success-check"><CheckCheck size={23} /></span><h3>Ya elegiste {room.ownMove}.</h3><p>Tu jugada queda oculta hasta que todos elijan<br className="room-desktop-only" /> o se termine el tiempo.</p><span className="room-submitted-count">{allSubmitted} de {room.players.length} jugadores listos</span></div> : <><p className="room-card-intro">Elige un gesto. Se confirma al tocarlo y ya no puedes cambiarlo.</p><div className="room-move-buttons">{moves.map(move => <button key={move} disabled={!!pending || seconds === 0 || camera.countdown !== null} onClick={() => submitMove(move)}><HandIcon move={move} wrap={playerColor(room, room.meId)} /><strong>{move}</strong><small>Vence a {beats[move]}</small></button>)}</div>{seconds === 0 && <p className="room-deadline-message" role="status">Tiempo terminado. Revelando las jugadas…</p>}</>}

            </> : <div className="room-round-result"><span className={`room-result-icon ${room.phase === "finished" ? "room-result-final" : ""}`}>{room.phase === "finished" ? <Trophy size={36} /> : <CheckCheck size={31} />}</span><h2>{room.phase === "finished" ? finalTitle : last && last.winners.length === 1 ? `¡${room.players.find(player => player.id === last.winners[0])?.name || "Un jugador"} se lleva la ronda!` : "¡Empate!"}</h2><p>{room.phase === "finished" ? `${room.roundLimit} rondas jugadas. La próxima partida la escriben ustedes.` : `Ronda ${last?.number || room.round}: todas las manos, sobre la mesa.`}</p>{last && <div className="room-revealed-moves">{room.players.map(player => <div key={player.id} className={player.id === room.meId ? "is-me" : ""}><span>{last.moves[player.id] ? <MoveIcon move={last.moves[player.id]!} accent={playerColor(room, player.id)} /> : "—"}</span><strong>{player.name}{player.id === room.meId ? " (tú)" : ""}</strong><small>{last.moves[player.id] || "Sin jugada"}</small><b>+{last.points[player.id] || 0} pts</b></div>)}</div>}{host ? <button className="primary room-result-next" disabled={!!pending} onClick={() => send({ type: room.phase === "finished" ? "rematch" : "next" })}><span>{room.phase === "finished" ? <><RotateCcw size={17} /> Preparar la revancha</> : "Siguiente ronda"}</span></button> : <span className="room-host-wait"><LoaderCircle className="room-spinner" size={14} />{room.phase === "finished" ? "El anfitrión puede preparar otra partida." : "El anfitrión iniciará la siguiente ronda."}</span>}</div>}
          </section>
          <aside className="room-card room-score-card"><div className="room-card-title"><h2><Trophy size={17} /> Marcador</h2><span>{room.phase === "finished" ? "Final" : `${room.history.length} de ${room.roundLimit} rondas`}</span></div><div className="room-ranking">{rankings.map((player, index) => <div key={player.id} className={`room-ranking-player ${player.id === room.meId ? "is-me" : ""}`}><span className="room-rank">{index === 0 && player.score > 0 ? <Crown size={16} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{player.name}{player.id === room.meId && <small> tú</small>}</strong><span>{room.phase === "playing" ? player.submitted ? "Jugada lista" : player.online ? "Eligiendo…" : "Sin conexión" : player.online ? "En la sala" : "Sin conexión"}</span></div><b>{player.score}<small> pts</small></b></div>)}</div><div className="room-score-rule"><ShieldCheck size={15} /><p>1 punto por cada ronda ganada. Gana quien sume más puntos al terminar todas las rondas.</p></div></aside>
        </div>
        {room.history.length > 0 && <section className="room-card room-history"><div className="room-card-title"><h2>Así va la partida</h2><span>El detalle de cada ronda</span></div><div className="room-history-scroll"><table><thead><tr><th scope="col">Ronda</th>{room.players.map(player => <th key={player.id} scope="col">{player.name}{player.id === room.meId ? " (tú)" : ""}</th>)}</tr></thead><tbody>{room.history.map(round => <tr key={round.number}><th scope="row">{String(round.number).padStart(2, "0")}</th>{room.players.map(player => <td key={player.id}><span aria-label={round.moves[player.id] || "Sin jugada"}>{round.moves[player.id] ? <MoveIcon move={round.moves[player.id]!} accent={playerColor(room, player.id)} /> : "—"}</span><small>+{round.points[player.id] || 0}</small></td>)}</tr>)}</tbody></table></div></section>}
      </>}
    </>}
    <footer><span className="footer-brand"><Swords size={15} /> Gesto Arena</span><span>Una revancha a la vez.</span><span><ShieldCheck size={14} /> Sin cuentas, cámara local</span></footer>
  </main>;
}

function Player({ player, room }: { player: PublicRoom["players"][number]; room: PublicRoom }) {
  return <div className={`room-player ${player.id === room.meId ? "is-me" : ""}`}><span className="room-player-avatar" style={{ background: playerColor(room, player.id) }}>{player.name.slice(0, 1).toLocaleUpperCase("es")}</span><div><strong>{player.name}{player.id === room.meId && <small> tú</small>}</strong><span><i className={player.online ? "online" : ""} />{player.online ? "En la sala" : "Sin conexión"}</span></div>{player.id === room.hostId && <span className="room-host-label" title="Anfitrión"><Crown size={14} /><span>Anfitrión</span></span>}</div>;
}

function CameraPanel({ camera, room, seconds, pending, active }: { camera: ReturnType<typeof useGestureCamera>; room: PublicRoom; seconds: number; pending: boolean; active: boolean }) {
  // Whether the viewer can submit a move right now (a duel round or their own tournament game).
  const playing = active;
  return <section className={`room-camera-setup ${camera.status === "on" ? "is-active" : ""}`} aria-label="Cámara opcional">
    <div className={`room-camera-panel ${camera.status === "on" ? "room-camera-active" : ""}`}>
      <video ref={camera.videoRef} autoPlay muted playsInline aria-label="Vista local de tu cámara" />
      {camera.status === "on" ? <>
        <div className="room-camera-overlay"><span><span className="room-status-dot" /> Solo en tu dispositivo</span><button onClick={camera.stop} aria-label="Desactivar cámara"><CameraOff size={16} /></button></div>
        <div className="room-camera-detected">{camera.detected ? <><MoveIcon move={camera.detected} accent={playerColor(room, room.meId)} />{camera.detected}</> : "Muestra una mano frente a la cámara"}</div>
        {camera.countdown !== null && <div className="room-camera-countdown" role="status"><strong>{camera.countdown}</strong><span>Mantén tu gesto</span></div>}
      </> : <div className="room-camera-off"><div><Camera size={19} /><span><strong>¿Prefieres jugar con la mano?</strong><small>Prepara tu cámara desde ahora. Tu video se queda en tu dispositivo.</small></span></div><button className="room-soft-button" onClick={camera.start} disabled={camera.status === "loading"}>{camera.status === "loading" ? <><LoaderCircle className="room-spinner" size={15} /> Cargando…</> : "Activar cámara"}</button></div>}
    </div>
    {camera.status === "on" && <div className="room-capture-toolbar"><span><ShieldCheck size={12} />{!playing ? "Cámara lista. Puedes practicar; tu gesto no se envía hasta que lo confirmes en una ronda." : room.ownMove ? "Tu jugada ya está guardada. Espera la revelación." : "Puño es piedra, palma es papel y V es tijera. Confirma tu gesto antes de que termine la ronda."}</span>{playing && !room.ownMove && <button className="primary" onClick={camera.capture} disabled={pending || camera.countdown !== null || seconds < 4}><span><Camera size={16} />{camera.countdown ? "Capturando…" : "Capturar en 3 segundos"}</span></button>}</div>}
    {camera.error && <p className="room-camera-error" role="alert">{camera.error}</p>}
  </section>;
}
