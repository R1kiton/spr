import { useState } from "react";
import { Camera, CameraOff, Check, Hand, LoaderCircle, RotateCcw, ScanLine, ShieldCheck, Zap } from "lucide-react";
import { moves, type Move } from "../../lib/game";
import { HOLD_MS } from "../../lib/hold";
import type { PublicRoom } from "../../lib/rooms";
import { HandIcon } from "../hand-icon";
import { MoveIcon } from "../move-icon";
import type { useGestureCamera } from "./use-gesture-camera";

const callouts = { win: "K.O.", lose: "Derrota", draw: "Doble K.O." };
// The leader keeps a full bar; the trailing fighter's bar drains in proportion (same as the solo arena).
const health = (own: number, rival: number) => Math.round((own + 1) / (Math.max(own, rival) + 1) * 100);

type Props = {
  room: PublicRoom;
  camera: ReturnType<typeof useGestureCamera>;
  /** Server-aligned clock. */
  now: number;
  seconds: number;
  canPlay: boolean;
  host: boolean;
  pending: string;
  onMove: (move: Move) => void;
  onRematch: () => void;
};

/** A 1v1 room laid out like the solo arena: HUD, full-width stage, and the result over the stage. */
export function DuelArena({ room, camera, now, seconds, canPlay, host, pending, onMove, onRematch }: Props) {
  const me = room.players.find(player => player.id === room.meId);
  const rival = room.players.find(player => player.id !== room.meId);
  const rivalName = rival?.name ?? "Tu rival";
  const last = room.history.at(-1);
  const resultKey = last ? `${room.matchId}:${last.number}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const finished = room.phase === "finished";
  const showResult = !!last && room.phase !== "playing" && (finished || dismissed !== resultKey);
  const myScore = me?.score ?? 0;
  const rivalScore = rival?.score ?? 0;
  const myMove = last && me ? last.moves[me.id] : null;
  const rivalMove = last && rival ? last.moves[rival.id] : null;
  const outcome = !last || !me ? "draw" : last.winners.includes(me.id) ? "win" : last.winners.length === 0 ? "draw" : "lose";
  const waiting = room.phase === "playing" && !!room.ownMove;
  const cameraOn = camera.status === "on";

  const roundTitle = { win: "¡Esta ronda es tuya!", lose: `${rivalName} gana esta ronda`, draw: "¡Mentes sincronizadas!" }[outcome];
  const finalOutcome = myScore === rivalScore ? "draw" : myScore > rivalScore ? "win" : "lose";
  const finalCallout = { win: "¡Ganaste!", lose: "Derrota", draw: "Empate" }[finalOutcome];
  const hint = finished ? "La partida terminó." : room.phase !== "playing" ? "La siguiente ronda empieza sola." : waiting ? `Tu jugada está guardada. Esperando a ${rivalName}.`
    : cameraOn ? camera.holdState.spent ? "Baja la mano o cambia de gesto para la siguiente ronda" : `Mantén un gesto ${HOLD_MS / 1000} segundos para elegir` : "Elige con los botones o activa la cámara";

  return <section className="arena duel-arena" aria-label="Duelo">
    <div className="hud" aria-label="Marcador">
      <div className="fighter p1"><div className="nameplate"><span className="avatar"><Hand size={19} /></span><strong>{me?.name ?? "Tú"}</strong><b aria-label={`${myScore} puntos`}>{myScore.toString().padStart(2, "0")}</b></div><div className="bar" role="meter" aria-label="Tu vida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health(myScore, rivalScore)}><i style={{ width: `${health(myScore, rivalScore)}%` }} /></div></div>
      <div className={`hud-center ${room.phase === "playing" && seconds <= 5 ? "is-urgent" : ""}`} role={room.phase === "playing" ? "timer" : undefined}><span>Ronda</span><strong>{Math.max(1, room.round)}</strong><small>{room.phase === "playing" ? `${seconds} s` : `de ${room.roundLimit}`}</small></div>
      <div className="fighter p2"><div className="nameplate"><span className="avatar">{rivalName.slice(0, 1).toLocaleUpperCase("es")}</span><strong>{rivalName}</strong><b aria-label={`${rivalScore} puntos`}>{rivalScore.toString().padStart(2, "0")}</b></div><div className="bar" role="meter" aria-label={`Vida de ${rivalName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={health(rivalScore, myScore)}><i style={{ width: `${health(rivalScore, myScore)}%` }} /></div></div>
    </div>

    <div className="play-area">
      <div className="panel-heading"><span><span className={cameraOn ? "dot live" : "dot"} /> {cameraOn ? "Tu cámara" : "Botones"}</span><span className="small-muted">{room.phase !== "playing" ? "Ronda terminada" : rival?.submitted ? `${rivalName} ya eligió` : rival?.online === false ? `${rivalName} sin conexión` : `${rivalName} está eligiendo…`}</span></div>
      <div className={`camera-stage ${cameraOn ? "active" : ""} ${showResult || waiting ? "has-result" : ""}`}>
        <video ref={camera.videoRef} autoPlay playsInline muted aria-label="Vista de tu cámara" />
        <canvas ref={camera.canvasRef} width={640} height={480} aria-hidden="true" />
        {!cameraOn && <div className="camera-placeholder">
          <div className="placeholder-hands" aria-hidden="true"><HandIcon move="piedra" /><span className="vs-mark">VS</span><HandIcon move="tijera" side="p2" /></div>
          <h2>{canPlay ? "Elige tu golpe" : "Prepárate"}</h2>
          <p>{canPlay ? "Toca un gesto o activa la cámara y mantenlo." : "La ronda empieza en un momento."}</p>
          <div className="manual-options">{moves.map(move => <button key={move} disabled={!canPlay || !!pending} onClick={() => onMove(move)}><HandIcon move={move} />{move}</button>)}</div>
        </div>}
        {cameraOn && <><div className="view-corners" /><span className="live-label"><span className="dot live" /> En vivo</span>
          <div className="detection"><ScanLine size={17} />{camera.detected ? <><MoveIcon move={camera.detected} />{camera.holdState.spent ? "Baja la mano para otra ronda" : camera.detected}</> : "Muestra tu mano"}{camera.detected && <Check size={16} />}<i className="hold-fill" style={{ transform: `scaleX(${camera.holdState.progress})` }} /></div></>}

        {waiting && <div className="round-result round-wait" role="status" aria-live="polite">
          <div className="result-gestures"><span><MoveIcon move={room.ownMove!} label={`Tu jugada: ${room.ownMove}`} /></span><span className="versus">VS</span><span className="round-wait-rival" aria-hidden="true">?</span></div>
          <h3><LoaderCircle className="room-spinner" size={20} /> Esperando a {rivalName}…</h3>
          <p>Ya elegiste {room.ownMove}. La ronda se cierra cuando {rivalName} elija o se acabe el tiempo.</p>
        </div>}

        {showResult && <div className={`round-result ${finished ? finalOutcome : outcome}`} key={resultKey} role="status" aria-live="polite">
          <strong className="round-result-callout">{finished ? finalCallout : callouts[outcome]}</strong>
          <div className="result-gestures"><span>{myMove ? <MoveIcon move={myMove} label={`Tú: ${myMove}`} /> : <span className="round-wait-rival">—</span>}</span><span className="versus">VS</span><span>{rivalMove ? <MoveIcon move={rivalMove} side="p2" label={`${rivalName}: ${rivalMove}`} /> : <span className="round-wait-rival">—</span>}</span></div>
          <h3>{finished ? `${myScore} a ${rivalScore}. ${finalOutcome === "win" ? "La arena es tuya." : finalOutcome === "lose" ? `${rivalName} se lleva el duelo.` : "Nadie cede."}` : roundTitle}</h3>
          <p>{finished ? `Última ronda: tú ${myMove ?? "sin jugada"}, ${rivalName} ${rivalMove ?? "sin jugada"}.` : `Tú: ${myMove ?? "sin jugada"}, ${rivalName}: ${rivalMove ?? "sin jugada"}`}</p>
          {finished ? host ? <button className="primary" disabled={!!pending} onClick={onRematch}><span><RotateCcw size={17} /> Preparar la revancha</span></button> : <span className="room-host-wait"><LoaderCircle className="room-spinner" size={14} /> El anfitrión puede preparar la revancha.</span>
            : <button className="primary" onClick={() => setDismissed(resultKey)}><span>Continuar</span></button>}
          {!finished && room.nextAt && <i className="round-result-timer" style={{ animationDuration: `${Math.max(0, room.nextAt - now)}ms` }} aria-hidden="true" />}
        </div>}
      </div>
      <div className="camera-toolbar"><span>{cameraOn ? <Zap size={15} /> : <ShieldCheck size={15} />}{hint}</span><div className="camera-actions">{cameraOn ? <button onClick={camera.stop}><CameraOff size={15} /> Desactivar</button> : <button onClick={camera.start} disabled={camera.status === "loading"}>{camera.status === "loading" ? <><LoaderCircle className="room-spinner" size={15} /> Cargando…</> : <><Camera size={15} /> Activar cámara</>}</button>}</div></div>
      {camera.error && <p className="room-camera-error duel-camera-error" role="alert">{camera.error}</p>}
    </div>
  </section>;
}
