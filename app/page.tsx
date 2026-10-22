"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Check, CircleHelp, Cpu, Hand, Keyboard, RotateCcw, ScanLine, ShieldCheck, Swords, Trophy, X, Zap } from "lucide-react";
import "./arena.css";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { gestureMove, moves, outcome, randomMove, type Move, type Outcome } from "../lib/game";
import { HOLD_MS, idleHold, stepHold } from "../lib/hold";
import { playResult } from "../lib/sounds";
import { ArenaTopbar, ModeTabs } from "./arena-nav";
import { HandIcon } from "./hand-icon";
import { MoveIcon } from "./move-icon";

type Round = { player: Move; computer: Move; result: Outcome; id: number };
const resultText = { win: "¡Esta ronda es tuya!", lose: "La compu gana esta vez", draw: "¡Mentes sincronizadas!" };
const callouts = { win: "K.O.", lose: "Derrota", draw: "Empate" };
const beats: Record<Move, Move> = { piedra: "tijera", papel: "piedra", tijera: "papel" };
/** How long the round result stays over the stage unless the player dismisses it. */
const RESULT_MS = 3000;

export default function Home() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const frame = useRef(0);
  const generation = useRef(0);
  // A round fires by holding a gesture; the CPU picks before each hold starts.
  const hold = useRef(idleHold);
  const cpuPick = useRef<Move>("piedra");
  const [holdState, setHoldState] = useState({ progress: 0, spent: false });
  const [camera, setCamera] = useState<"off" | "loading" | "on">("off");
  const [manual, setManual] = useState(false);
  const [detected, setDetected] = useState<Move | null>(null);
  const [error, setError] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [help, setHelp] = useState(false);
  // Id of the round whose result covers the stage; null when the stage is free to play.
  const [shown, setShown] = useState<number | null>(null);
  const resultOpen = useRef(false);
  resultOpen.current = shown !== null;
  const last = rounds[0];
  const shownRound = rounds.find(round => round.id === shown);
  const wins = rounds.filter(r => r.result === "win").length;
  const losses = rounds.filter(r => r.result === "lose").length;
  const draws = rounds.length - wins - losses;
  // The leader keeps a full bar; the trailing fighter's bar drains in proportion.
  const health = (own: number, rival: number) => Math.round((own + 1) / (Math.max(own, rival) + 1) * 100);

  function stopCamera() {
    generation.current++;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recognizer.current?.close();
    recognizer.current = null;
    if (video.current) video.current.srcObject = null;
    hold.current = idleHold;
    setHoldState({ progress: 0, spent: false });
    setCamera("off"); setDetected(null);
  }

  useEffect(() => {
    const hide = () => { if (document.hidden) stopCamera(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); stopCamera(); };
  }, []);

  // Every new round opens the result over the stage with its sound; resetting the match clears it.
  useEffect(() => {
    setShown(last ? last.id : null);
    if (last) playResult(last.result);
  }, [last?.id]);

  useEffect(() => {
    if (shown === null) return;
    const timeout = setTimeout(() => setShown(null), RESULT_MS);
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setShown(null); };
    document.addEventListener("keydown", close);
    return () => { clearTimeout(timeout); document.removeEventListener("keydown", close); };
  }, [shown]);

  useEffect(() => {
    if (!help) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelp(false);
      if (event.key === "Tab") {
        const buttons = document.querySelectorAll<HTMLButtonElement>(".modal button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [help]);

  async function startCamera() {
    stopCamera(); setManual(false); setError(""); setCamera("loading");
    const token = generation.current;
    let acquired: MediaStream | null = null;
    let model: GestureRecognizer | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Abre el juego en localhost o con HTTPS para usar tu cámara.");
      acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (token !== generation.current) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream.current = acquired;
      const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      model = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/gesture_recognizer.task", delegate: "CPU" },
        runningMode: "VIDEO", numHands: 1,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6,
      });
      if (token !== generation.current) { model.close(); acquired.getTracks().forEach(t => t.stop()); return; }
      recognizer.current = model;
      const element = video.current!;
      element.srcObject = acquired;
      await element.play();
      if (token !== generation.current) return;
      setCamera("on");
      cpuPick.current = randomMove();
      // Canvas can't read CSS variables, so take the resolved token colors once.
      const tokens = getComputedStyle(element);
      const handInk = tokens.getPropertyValue("--you").trim();
      const jointInk = tokens.getPropertyValue("--gold").trim();
      let previousTime = -1;
      let previousFrame = 0;
      const loop = (now: number) => {
        if (token !== generation.current) return;
        try {
          if (element.readyState >= 2 && element.currentTime !== previousTime && now - previousFrame >= 80) {
            previousTime = element.currentTime; previousFrame = now;
            const result = model!.recognizeForVideo(element, now);
            const category = result.gestures[0]?.[0];
            const move = category ? gestureMove(category.categoryName, category.score) : null;
            setDetected(move);
            // While the result covers the stage nothing fires; the hold restarts once it closes.
            if (resultOpen.current) hold.current = { ...hold.current, since: now, seen: now };
            const step = resultOpen.current ? { hold: hold.current, progress: 0, fire: null } : stepHold(hold.current, move, now);
            hold.current = step.hold;
            const progress = Math.round(step.progress * 100) / 100, spent = step.hold.spent;
            setHoldState(old => old.progress === progress && old.spent === spent ? old : { progress, spent });
            if (step.fire) { saveRound(step.fire, cpuPick.current); cpuPick.current = randomMove(); setError(""); }
            const ctx = canvas.current?.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, 640, 480);
              for (const points of result.landmarks) {
                ctx.strokeStyle = handInk; ctx.lineWidth = 3;
                for (const connection of GestureRecognizer.HAND_CONNECTIONS) {
                  ctx.beginPath(); ctx.moveTo(points[connection.start].x * 640, points[connection.start].y * 480);
                  ctx.lineTo(points[connection.end].x * 640, points[connection.end].y * 480); ctx.stroke();
                }
                ctx.fillStyle = jointInk;
                points.forEach(p => { ctx.beginPath(); ctx.arc(p.x * 640, p.y * 480, 3, 0, Math.PI * 2); ctx.fill(); });
              }
            }
          }
          frame.current = requestAnimationFrame(loop);
        } catch { stopCamera(); setError("Se interrumpió el reconocimiento. Vuelve a activar la cámara o usa el modo manual."); }
      };
      frame.current = requestAnimationFrame(loop);
      acquired.getVideoTracks()[0].onended = () => {
        if (token === generation.current) { stopCamera(); setError("La cámara se desconectó. Puedes conectarla de nuevo."); }
      };
    } catch (err) {
      acquired?.getTracks().forEach(t => t.stop());
      if (token !== generation.current) return;
      stopCamera();
      const name = err instanceof Error ? err.name : "";
      setError(name === "NotAllowedError" ? "El permiso de cámara está bloqueado. Permítelo en tu navegador o juega en modo manual." : name === "NotFoundError" ? "No encontramos una cámara. Conecta una o prueba el modo manual." : name === "NotReadableError" ? "Otra aplicación está usando tu cámara. Ciérrala e inténtalo de nuevo." : err instanceof Error && err.message.includes("localhost") ? err.message : "No se pudo iniciar la cámara o cargar el modelo. Inténtalo de nuevo o usa el modo manual.");
    }
  }

  function saveRound(player: Move, computer: Move) {
    setRounds(old => [{ player, computer, result: outcome(player, computer), id: (old[0]?.id ?? 0) + 1 }, ...old]);
  }

  const p1Health = health(wins, losses);
  const p2Health = health(losses, wins);

  return <main className="fight">
    <ArenaTopbar><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} /> Cómo jugar</button></ArenaTopbar>
    <section className="intro"><div className="intro-title"><h1>Piedra, papel<br />o tijera</h1><p>Tu mano es el control. La computadora ya eligió su golpe.</p></div><ModeTabs current="cpu" /></section>
    <section className="arena" aria-label="Zona de juego">
      <div className="hud" aria-label="Marcador">
        <div className="fighter p1"><div className="nameplate"><span className="avatar"><Hand size={19} /></span><strong>Tú</strong><b aria-label={`${wins} victorias`}>{wins.toString().padStart(2, "0")}</b></div><div className="bar" role="meter" aria-label="Tu vida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p1Health}><i style={{ width: `${p1Health}%` }} /></div></div>
        <div className="hud-center"><span>Ronda</span><strong>{rounds.length + 1}</strong><small>{draws} empate{draws !== 1 ? "s" : ""}</small></div>
        <div className="fighter p2"><div className="nameplate"><span className="avatar"><Cpu size={19} /></span><strong>Computadora</strong><b aria-label={`${losses} victorias`}>{losses.toString().padStart(2, "0")}</b></div><div className="bar" role="meter" aria-label="Vida de la computadora" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p2Health}><i style={{ width: `${p2Health}%` }} /></div></div>
      </div>
      <div className="play-area"><div className="panel-heading"><span><span className={camera === "on" ? "dot live" : "dot"} /> {manual ? "Modo manual" : "Tu cámara"}</span><span className="small-muted">{manual ? "Sin cámara" : camera === "on" ? "En vivo" : "Esperando conexión"}</span></div>
        <div className={`camera-stage ${camera === "on" ? "active" : ""} ${shownRound ? "has-result" : ""}`}>
          <video ref={video} autoPlay playsInline muted aria-label="Vista de tu cámara" />
          <canvas ref={canvas} width={640} height={480} aria-hidden="true" />
          {camera !== "on" && <div className="camera-placeholder"><div className="placeholder-hands" aria-hidden="true"><HandIcon move="piedra" /><span className="vs-mark">VS</span><HandIcon move="tijera" side="p2" /></div><h2>{manual ? "Elige tu golpe" : camera === "loading" ? "Preparando tu cámara…" : "Entra a la arena"}</h2><p>{manual ? "Toca un gesto para jugar una ronda." : camera === "loading" ? "Cargando el reconocimiento de gestos." : "Activa tu cámara y deja que tu mano pelee."}</p>{!manual && <button className="primary" disabled={camera === "loading"} onClick={startCamera}><span><Camera size={18} />{camera === "loading" ? "Cargando…" : "Activar cámara"}</span></button>}{!manual && <span className="privacy"><ShieldCheck size={14} /> Tu video no sale de tu dispositivo</span>}{manual && <div className="manual-options">{moves.map(move => <button key={move} onClick={() => { const computer = randomMove(); saveRound(move, computer); }}><HandIcon move={move} />{move}</button>)}</div>}</div>}
          {camera === "on" && <><div className="view-corners" /><span className="live-label"><span className="dot live" /> En vivo</span><div className="detection"><ScanLine size={17} />{detected ? <><MoveIcon move={detected} />{holdState.spent ? "Baja la mano para otra ronda" : detected}</> : "Muestra tu mano"}{detected && <Check size={16} />}<i className="hold-fill" style={{ transform: `scaleX(${holdState.progress})` }} /></div></>}
          {shownRound && <div className={`round-result ${shownRound.result}`} key={shownRound.id} role="status" aria-live="polite">
            <strong className="round-result-callout">{callouts[shownRound.result]}</strong>
            <div className="result-gestures"><span><MoveIcon move={shownRound.player} label={`Tú: ${shownRound.player}`} /></span><span className="versus">VS</span><span><MoveIcon move={shownRound.computer} side="p2" label={`Compu: ${shownRound.computer}`} /></span></div>
            <h3>{resultText[shownRound.result]}</h3>
            <p>Tú: {shownRound.player}, compu: {shownRound.computer}</p>
            <button className="primary" onClick={() => setShown(null)}><span>Continuar</span></button>
            <i className="round-result-timer" style={{ animationDuration: `${RESULT_MS}ms` }} aria-hidden="true" />
          </div>}
        </div>
        <div className="camera-toolbar"><span>{camera === "on" ? <Zap size={15} /> : <ShieldCheck size={15} />}{manual ? "Elige un gesto en el escenario" : camera !== "on" ? "Procesamiento 100% local" : holdState.spent ? "Baja la mano o cambia de gesto para la siguiente ronda" : `Mantén un gesto ${HOLD_MS / 1000} segundos y la ronda se juega sola`}</span><div className="camera-actions"><button className="reset" disabled={!rounds.length} onClick={() => { setRounds([]); setError(""); }}><RotateCcw size={14} /> Reiniciar combate</button>{camera !== "off" ? <button onClick={stopCamera}><CameraOff size={15} /> Desactivar</button> : <button onClick={() => { setManual(!manual); setError(""); }}><Keyboard size={15} />{manual ? "Usar cámara" : "Probar sin cámara"}</button>}</div></div>
      </div>
    </section>
    {error && <div className="error" role="alert"><CircleHelp size={18} /><span>{error}</span><button aria-label="Cerrar aviso" onClick={() => setError("")}><X size={17} /></button></div>}
    <section className="guide"><div className="guide-title"><h2>Lista de movimientos</h2><p>Tres golpes. Cada uno vence a otro.</p></div><div className="gesture-cards">{moves.map(move => <div className={`gesture-card gesture-${move}`} key={move}><span className="gesture-emoji"><HandIcon move={move} /></span><div><h3>{move}</h3><p>{move === "piedra" ? "Cierra el puño" : move === "papel" ? "Abre la palma" : "Haz una V con dos dedos"}</p><small>Vence a {beats[move]}</small></div></div>)}</div></section>
    {rounds.length > 0 && <section className="history"><div><h2><Trophy size={18} /> Registro de combate</h2><span>{rounds.length} rondas</span></div><ol>{rounds.slice(0, 5).map(r => <li key={r.id}><span className="history-round">#{r.id}</span><span className="history-hands"><MoveIcon move={r.player} label={r.player} /><small>vs</small><MoveIcon move={r.computer} side="p2" label={r.computer} /></span><span className={`outcome ${r.result}`}>{r.result === "win" ? "Ganaste" : r.result === "lose" ? "Ganó la compu" : "Empate"}</span></li>)}</ol></section>}
    <footer><span className="footer-brand"><Swords size={15} /> Gesto Arena</span><span>Una revancha a la vez.</span><span>Reconocimiento con MediaPipe, en tu dispositivo</span></footer>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") setHelp(false); }}><button className="close-modal" autoFocus onClick={() => setHelp(false)} aria-label="Cerrar instrucciones"><X /></button><span className="avatar"><Hand /></span><h2 id="help-title">Tu mano es el control</h2><ol><li>Activa la cámara y acepta el permiso del navegador.</li><li>Ubica una sola mano frente a la cámara, con buena iluminación.</li><li>Forma tu gesto y mantenlo {HOLD_MS / 1000} segundos, hasta que se llene la barra.</li><li>Al llenarse la barra se captura tu jugada y se revela la de la computadora. Para otra ronda, baja la mano o cambia de gesto.</li></ol><ul className="modal-moves">{moves.map(move => <li key={move}><HandIcon move={move} /><span><strong>{move}</strong>{move === "piedra" ? "Puño" : move === "papel" ? "Palma abierta" : "V con dos dedos"}</span></li>)}</ul><p>La barra solo avanza mientras se reconoce el mismo gesto. La computadora elige al azar antes de que empieces a mantenerlo. Para jugar con otras personas, abre «Con amigos».</p><button className="primary" onClick={() => setHelp(false)}><span>Entendido</span></button></section></div>}
  </main>;
}
