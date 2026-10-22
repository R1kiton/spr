"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { gestureMove, type Move } from "../../lib/game";
import { idleHold, stepHold } from "../../lib/hold";

/**
 * Video and gesture recognition stay in this browser. Only the chosen move is submitted.
 * Like the solo arena, a move fires by holding one gesture for HOLD_MS while `active` is true.
 */
export function useGestureCamera(onCapture: (move: Move) => void, active: boolean) {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const frame = useRef(0);
  const generation = useRef(0);
  const hold = useRef(idleHold);
  const activeRef = useRef(active);
  const captureCallback = useRef(onCapture);
  const [status, setStatus] = useState<"off" | "loading" | "on">("off");
  const [detected, setDetected] = useState<Move | null>(null);
  const [holdState, setHoldState] = useState({ progress: 0, spent: false });
  const [error, setError] = useState("");
  useEffect(() => { captureCallback.current = onCapture; }, [onCapture]);
  useEffect(() => { activeRef.current = active; }, [active]);

  // The <video> moves between the lobby panel and the game stage; reattach the stream to whichever is mounted.
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (element && stream.current && element.srcObject !== stream.current) {
      element.srcObject = stream.current;
      void element.play().catch(() => undefined);
    }
  }, []);
  const canvasRef = useCallback((element: HTMLCanvasElement | null) => { canvas.current = element; }, []);

  const stop = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recognizer.current?.close();
    recognizer.current = null;
    if (video.current) video.current.srcObject = null;
    hold.current = idleHold;
    setHoldState({ progress: 0, spent: false });
    setStatus("off");
    setDetected(null);
  }, []);

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); stop(); };
  }, [stop]);

  const start = useCallback(async () => {
    stop();
    setStatus("loading");
    setError("");
    const token = generation.current;
    let acquired: MediaStream | null = null;
    let model: GestureRecognizer | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara necesita una conexión HTTPS o localhost.");
      acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (token !== generation.current) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      model = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/gesture_recognizer.task", delegate: "CPU" },
        runningMode: "VIDEO", numHands: 1,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6,
      });
      if (token !== generation.current) { model.close(); acquired.getTracks().forEach(track => track.stop()); return; }
      recognizer.current = model;
      if (!video.current) throw new Error("No se pudo preparar la cámara.");
      video.current.srcObject = acquired;
      await video.current.play();
      if (token !== generation.current) return;
      setStatus("on");
      let previousTime = -1;
      let previousFrame = 0;
      const loop = (now: number) => {
        if (token !== generation.current) return;
        try {
          const element = video.current;
          if (element && element.readyState >= 2 && element.currentTime !== previousTime && now - previousFrame >= 90) {
            previousTime = element.currentTime;
            previousFrame = now;
            const result = model!.recognizeForVideo(element, now);
            const category = result.gestures[0]?.[0];
            const move = category ? gestureMove(category.categoryName, category.score) : null;
            setDetected(move);
            // Outside a playable moment nothing fires, and the hold restarts once play opens.
            if (!activeRef.current) hold.current = { ...hold.current, since: now, seen: now };
            const step = activeRef.current ? stepHold(hold.current, move, now) : { hold: hold.current, progress: 0, fire: null };
            hold.current = step.hold;
            const progress = Math.round(step.progress * 100) / 100, spent = step.hold.spent;
            setHoldState(old => old.progress === progress && old.spent === spent ? old : { progress, spent });
            if (step.fire) captureCallback.current(step.fire);
            const ctx = canvas.current?.getContext("2d");
            if (ctx) {
              // Canvas can't read CSS variables, so resolve the token colors on the canvas itself.
              const tokens = getComputedStyle(canvas.current!);
              ctx.clearRect(0, 0, 640, 480);
              ctx.strokeStyle = tokens.getPropertyValue("--you").trim();
              ctx.fillStyle = tokens.getPropertyValue("--gold").trim();
              ctx.lineWidth = 3;
              for (const points of result.landmarks) {
                for (const connection of GestureRecognizer.HAND_CONNECTIONS) {
                  ctx.beginPath();
                  ctx.moveTo(points[connection.start].x * 640, points[connection.start].y * 480);
                  ctx.lineTo(points[connection.end].x * 640, points[connection.end].y * 480);
                  ctx.stroke();
                }
                points.forEach(point => { ctx.beginPath(); ctx.arc(point.x * 640, point.y * 480, 3, 0, Math.PI * 2); ctx.fill(); });
              }
            }
          }
          frame.current = requestAnimationFrame(loop);
        } catch { stop(); setError("Se interrumpió el reconocimiento. Activa la cámara de nuevo o elige un gesto con los botones."); }
      };
      frame.current = requestAnimationFrame(loop);
      acquired.getVideoTracks()[0].onended = () => {
        if (token === generation.current) { stop(); setError("La cámara se desconectó. Puedes seguir jugando con los botones."); }
      };
    } catch (cause) {
      acquired?.getTracks().forEach(track => track.stop());
      if (token !== generation.current) return;
      if (model && model !== recognizer.current) model.close();
      stop();
      const name = cause instanceof Error ? cause.name : "";
      setError(name === "NotAllowedError" ? "Permite el acceso a la cámara en tu navegador o juega con los botones." : name === "NotFoundError" ? "No encontramos una cámara. Puedes jugar con los botones." : name === "NotReadableError" ? "Otra aplicación está usando tu cámara. Ciérrala o juega con los botones." : "No se pudo iniciar la cámara. Vuelve a intentarlo o juega con los botones.");
    }
  }, [stop]);

  return { videoRef, canvasRef, status, detected, holdState, error, start, stop };
}
