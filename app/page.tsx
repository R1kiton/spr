"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, CameraOff, Check, ChevronRight, CircleHelp, Cpu, Hand, Keyboard, RotateCcw, ScanLine, ShieldCheck, Sparkles, Trophy, X } from "lucide-react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { gestureMove, icons, moves, outcome, randomMove, type Move, type Outcome } from "../lib/game";
import { playerMoves } from "../lib/tracking";

type Round = { player: Move; computer: Move; result: Outcome; id: number };
const resultText = { win: "¡Esta ronda es tuya!", lose: "La compu gana esta vez", draw: "¡Mentes sincronizadas!" };

export default function Home() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const sample = useRef<{ move: Move | null; since: number; at: number }>({ move: null, since: 0, at: 0 });
  const secondSample = useRef<{ move: Move | null; since: number; at: number }>({ move: null, since: 0, at: 0 });
  const [mode, setMode] = useState<"cpu" | "duo">("cpu");
  const duo = mode === "duo";
  const [secondDetected, setSecondDetected] = useState<Move | null>(null);
  const roundLocked = useRef(false);
  const [camera, setCamera] = useState<"off" | "loading" | "on">("off");
  const [manual, setManual] = useState(false);
  const [detected, setDetected] = useState<Move | null>(null);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [help, setHelp] = useState(false);
  const last = rounds[0];
  const wins = rounds.filter(r => r.result === "win").length;
  const losses = rounds.filter(r => r.result === "lose").length;
  const draws = rounds.length - wins - losses;

  function stopCamera() {
    generation.current++;
    cancelAnimationFrame(frame.current);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    roundLocked.current = false;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recognizer.current?.close();
    recognizer.current = null;
    if (video.current) video.current.srcObject = null;
    sample.current = { move: null, since: 0, at: 0 };
    secondSample.current = { move: null, since: 0, at: 0 };
    setSecondDetected(null);
    setCamera("off"); setDetected(null); setCountdown(null);
  }

  useEffect(() => {
    const hide = () => { if (document.hidden) stopCamera(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); stopCamera(); };
  }, []);

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
        runningMode: "VIDEO", numHands: duo ? 2 : 1,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6,
      });
      if (token !== generation.current) { model.close(); acquired.getTracks().forEach(t => t.stop()); return; }
      recognizer.current = model;
      const element = video.current!;
      element.srcObject = acquired;
      await element.play();
      if (token !== generation.current) return;
      setCamera("on");
      let previousTime = -1;
      let previousFrame = 0;
      const loop = (now: number) => {
        if (token !== generation.current) return;
        try {
          if (element.readyState >= 2 && element.currentTime !== previousTime && now - previousFrame >= 80) {
            previousTime = element.currentTime; previousFrame = now;
            const result = model!.recognizeForVideo(element, now);
            const category = result.gestures[0]?.[0];
            const pair = duo ? playerMoves(result) : null;
            const move = pair ? pair[0] : category ? gestureMove(category.categoryName, category.score) : null;
            sample.current = { move, since: sample.current.move === move ? sample.current.since : now, at: now };
            const secondMove = pair?.[1] ?? null;
            secondSample.current = { move: secondMove, since: secondSample.current.move === secondMove ? secondSample.current.since : now, at: now };
            setSecondDetected(secondMove);
            setDetected(move);
            const ctx = canvas.current?.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, 640, 480);
              for (const points of result.landmarks) {
                ctx.strokeStyle = duo && points[0].x < 0.45 ? "#b8abff" : "#c7fa73"; ctx.lineWidth = 2;
                for (const connection of GestureRecognizer.HAND_CONNECTIONS) {
                  ctx.beginPath(); ctx.moveTo(points[connection.start].x * 640, points[connection.start].y * 480);
                  ctx.lineTo(points[connection.end].x * 640, points[connection.end].y * 480); ctx.stroke();
                }
                ctx.fillStyle = "#fff";
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

  function playRound() {
    if (roundLocked.current || camera !== "on") return;
    roundLocked.current = true; setError("");
    const computer = randomMove();
    const deadline = performance.now() + 3000;
    setCountdown(3);
    timer.current = setInterval(() => {
      const now = performance.now();
      const left = Math.ceil((deadline - now) / 1000);
      if (left > 0) { setCountdown(left); return; }
      clearInterval(timer.current!); timer.current = null;
      setCountdown(null); roundLocked.current = false;
      const current = sample.current;
      const second = secondSample.current;
      const secondReady = second.move && now - second.at < 400 && now - second.since >= 350;
      if (current.move && now - current.at < 400 && now - current.since >= 350 && (!duo || secondReady)) saveRound(current.move, duo ? second.move! : computer);
      else setError(duo ? "Falta un gesto estable: cada jugador debe mostrar una mano en su lado de la pantalla, lejos del centro. No se sumaron puntos." : "No capturamos un gesto estable. Muestra una sola mano, mantén el gesto y vuelve a jugar. No se sumaron puntos.");
    }, 80);
  }

  return <main>
    <header className="topbar"><a href="/" className="brand"><span className="brand-icon"><Hand size={23} /></span>gesto<span className="brand-light">arena</span><span className="beta">BETA</span></a><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} /> Cómo jugar</button></header>
    <section className="intro"><div className="eyebrow"><span /> EL CLÁSICO, CON UN NUEVO MOVIMIENTO</div><h1>Tu mano. Tu jugada.<br /><span>{duo ? "¿Quién gana esta ronda?" : "¿Le ganas a la compu?"}</span></h1><p>Piedra, papel o tijera, como siempre lo jugaste.<br className="mobile-break" /> Ahora tu cámara es el control.</p></section>
    <div className="mode-selector" role="group" aria-label="Modo de juego">{(["cpu", "duo"] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => { if (mode === value) return; stopCamera(); setMode(value); setRounds([]); setManual(false); setError(""); }}>{value === "cpu" ? <Cpu size={16} /> : <Hand size={16} />}{value === "cpu" ? "Contra la computadora" : "Dos personas"}</button>)}</div>
    {duo && <p className="duo-instructions">Una cámara, dos personas. Jugador 1 a la izquierda de la pantalla y jugador 2 a la derecha. Cada quien muestra una mano sin cruzar el centro.</p>}
    <section className="arena" aria-label="Zona de juego">
      <div className="play-area"><div className="panel-heading"><span><span className={camera === "on" ? "dot live" : "dot"} /> {manual ? "MODO MANUAL" : "TU CÁMARA"}</span><span className="small-muted">{manual ? "Sin cámara" : camera === "on" ? "En vivo" : "Esperando conexión"}</span></div>
        <div className={`camera-stage ${camera === "on" ? "active" : ""}`}>
          <video ref={video} autoPlay playsInline muted aria-label="Vista de tu cámara" />
          <canvas ref={canvas} width={640} height={480} aria-hidden="true" />
          {camera !== "on" && <div className="camera-placeholder"><div className="orbit"><span className="orbit-small one">✊</span><span className="orbit-small two">✌️</span><span className="hand-hero">✋</span><span className="spark">✦</span></div><h2>{manual ? "Elige tu próximo movimiento" : camera === "loading" ? "Preparando tu cámara…" : "Entra a la arena"}</h2><p>{manual ? "Toca un gesto para jugar una ronda." : camera === "loading" ? "Cargando el reconocimiento de gestos." : "Activa tu cámara y deja que tu mano hable."}</p>{!manual && <button className="primary" disabled={camera === "loading"} onClick={startCamera}><Camera size={18} />{camera === "loading" ? "Cargando…" : "Activar cámara"}{camera !== "loading" && <ArrowRight size={18} />}</button>}{!manual && <span className="privacy"><ShieldCheck size={13} /> Tu video no sale de tu dispositivo</span>}{manual && <div className="manual-options">{moves.map(move => <button key={move} onClick={() => { const computer = randomMove(); saveRound(move, computer); }}><span>{icons[move]}</span>{move}</button>)}</div>}</div>}
          {camera === "on" && <><div className="view-corners" />{duo && <div className="player-zones"><span>J1 · IZQUIERDA</span><span>J2 · DERECHA</span></div>}<span className="live-label"><span className="dot live" /> CÁMARA EN VIVO</span><div className="detection"><ScanLine size={17} />{duo ? `J1: ${detected ? icons[detected] : "—"} · J2: ${secondDetected ? icons[secondDetected] : "—"}` : detected ? `${icons[detected]} ${detected}` : "Muestra tu mano"}{detected && <Check size={16} />}</div></>}
          {countdown !== null && <div className="countdown" aria-live="polite"><strong key={countdown}>{countdown}</strong><span>¡Mantén tu gesto!</span></div>}
        </div>
        <div className="camera-toolbar"><span><ShieldCheck size={15} /> Procesamiento 100% local</span>{camera !== "off" ? <button onClick={stopCamera}><CameraOff size={15} /> Desactivar</button> : !duo && <button onClick={() => { setManual(!manual); setError(""); }}><Keyboard size={15} />{manual ? "Usar cámara" : "Probar sin cámara"}</button>}</div>
      </div>
      <aside className="match-panel"><div className="panel-heading"><span>EL ENFRENTAMIENTO</span><span className="round-label">Ronda {rounds.length + 1}</span></div><div className="scoreboard"><div><span className="avatar player"><Hand size={23} /></span><span>{duo ? "Jugador 1" : "Tú"}</span><strong>{wins.toString().padStart(2, "0")}</strong></div><div className="score-middle"><span>VS</span><small>{draws} empate{draws !== 1 ? "s" : ""}</small></div><div><span className="avatar computer">{duo ? <Hand size={23} /> : <Cpu size={23} />}</span><span>{duo ? "Jugador 2" : "Computadora"}</span><strong>{losses.toString().padStart(2, "0")}</strong></div></div>
        <div className={`result-card ${last ? last.result : ""}`} aria-live="polite"><div className="result-gestures"><span>{last ? icons[last.player] : "✊"}</span><span className="versus">vs</span><span>{last ? icons[last.computer] : duo ? "✋" : "🤖"}</span></div><h3>{countdown ? "Piedra, papel o…" : last ? duo ? last.result === "draw" ? "¡Empate!" : last.result === "win" ? "¡Gana el jugador 1!" : "¡Gana el jugador 2!" : resultText[last.result] : "¿Listo para la primera?"}</h3><p>{countdown ? duo ? "Muestren sus gestos al mismo tiempo." : "La compu ya eligió. Es tu turno." : last ? `${duo ? "J1" : "Tú"}: ${last.player} · ${duo ? "J2" : "Compu"}: ${last.computer}` : "La suerte ayuda. Tu mano decide."}</p></div>
        <button className="primary play-button" disabled={camera !== "on" || countdown !== null} onClick={playRound}>{countdown ? "Preparados…" : last ? "Jugar otra ronda" : "Jugar una ronda"}<ArrowRight size={18} /></button><p className="play-hint">{manual ? "Elige un gesto en el panel de la izquierda" : camera === "on" ? duo ? "Ambas manos deben estar listas al terminar la cuenta" : "Tienes 3 segundos para mostrar tu gesto" : "Activa la cámara para empezar"}</p><button className="reset" disabled={!rounds.length || countdown !== null} onClick={() => { setRounds([]); setError(""); }}><RotateCcw size={14} /> Reiniciar marcador</button>
      </aside>
    </section>
    {error && <div className="error" role="alert"><CircleHelp size={18} /><span>{error}</span><button aria-label="Cerrar aviso" onClick={() => setError("")}><X size={17} /></button></div>}
    <section className="guide"><div className="guide-title"><span className="eyebrow">TRES GESTOS. INFINITAS REVANCHAS.</span><h2>Las reglas no cambian.</h2><p>Una mano, buena luz y tu mejor jugada.</p></div><div className="gesture-cards">{moves.map((move, index) => <div className={`gesture-card gesture-${move}`} key={move}><span className="gesture-emoji">{icons[move]}</span><div><h3>{move}<span>0{index + 1}</span></h3><p>{move === "piedra" ? "Cierra el puño" : move === "papel" ? "Abre la palma" : "Haz una V con dos dedos"}</p><small>Le gana a {move === "piedra" ? "tijera" : move === "papel" ? "piedra" : "papel"}<ChevronRight size={12} /></small></div></div>)}</div></section>
    {rounds.length > 0 && <section className="history"><div><h2><Trophy size={18} /> Últimas rondas</h2><span>{rounds.length} jugadas</span></div><ol>{rounds.slice(0, 5).map(r => <li key={r.id}><span className="history-round">#{r.id}</span><span>{icons[r.player]} <small>vs</small> {icons[r.computer]}</span><span className={`outcome ${r.result}`}>{r.result === "win" ? duo ? "Ganó J1" : "Ganaste" : r.result === "lose" ? duo ? "Ganó J2" : "Ganó la compu" : "Empate"}</span></li>)}</ol></section>}
    <footer><span className="footer-brand"><Hand size={15} /> gestoarena</span><span>Hecho para jugar. Una revancha a la vez.</span><span><Sparkles size={14} /> Powered by MediaPipe</span></footer>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") setHelp(false); }}><button className="close-modal" autoFocus onClick={() => setHelp(false)} aria-label="Cerrar instrucciones"><X /></button><span className="avatar player"><Hand /></span><h2 id="help-title">Tu mano es el control.</h2><ol><li>Activa la cámara y acepta el permiso del navegador.</li><li>{duo ? "Cada persona muestra una mano: jugador 1 a la izquierda de la pantalla y jugador 2 a la derecha. Mantengan las manos separadas del centro." : "Ubica una sola mano frente a la cámara, con buena iluminación."}</li><li>Pulsa «Jugar una ronda». Tienes 3 segundos para formar y mantener tu gesto.</li><li>{duo ? "Al terminar la cuenta se capturan ambas jugadas simultáneamente." : "Al terminar la cuenta se captura tu jugada y se revela la de la computadora."}</li></ol><p>✊ Puño = piedra · ✋ Palma = papel · ✌️ V = tijera</p><p>{duo ? "Si falta un gesto estable en cualquiera de los lados, la ronda no cuenta. Al cambiar de modo se reinicia el marcador y hay que activar de nuevo la cámara." : "Si no se reconoce un gesto estable, la ronda no cuenta. La computadora elige al azar antes de la cuenta regresiva."}</p><button className="primary" onClick={() => setHelp(false)}>¡A jugar! <ArrowRight size={17} /></button></section></div>}
  </main>;
}
