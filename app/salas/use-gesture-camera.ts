"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { gestureMove, type Move } from "../../lib/game";

/** Video and gesture recognition stay in this browser. Only the chosen move is submitted. */
export function useGestureCamera(onCapture: (move: Move) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const frame = useRef(0);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sample = useRef<{ move: Move | null; since: number; at: number }>({ move: null, since: 0, at: 0 });
  const captureCallback = useRef(onCapture);
  const [status, setStatus] = useState<"off" | "loading" | "on">("off");
  const [detected, setDetected] = useState<Move | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { captureCallback.current = onCapture; }, [onCapture]);

  const cancelCapture = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCountdown(null);
  }, []);

  const stop = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(frame.current);
    cancelCapture();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recognizer.current?.close();
    recognizer.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    sample.current = { move: null, since: 0, at: 0 };
    setStatus("off");
    setDetected(null);
  }, [cancelCapture]);

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
      const element = videoRef.current;
      if (!element) throw new Error("No se pudo preparar la cámara.");
      element.srcObject = acquired;
      await element.play();
      if (token !== generation.current) return;
      setStatus("on");
      let previousTime = -1;
      let previousFrame = 0;
      const loop = (now: number) => {
        if (token !== generation.current) return;
        try {
          if (element.readyState >= 2 && element.currentTime !== previousTime && now - previousFrame >= 90) {
            previousTime = element.currentTime;
            previousFrame = now;
            const result = model!.recognizeForVideo(element, now);
            const category = result.gestures[0]?.[0];
            const move = category ? gestureMove(category.categoryName, category.score) : null;
            sample.current = { move, since: sample.current.move === move ? sample.current.since : now, at: now };
            setDetected(move);
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

  const capture = useCallback(() => {
    if (status !== "on" || timer.current) return;
    setError("");
    const deadline = performance.now() + 3000;
    setCountdown(3);
    timer.current = setInterval(() => {
      const now = performance.now();
      const left = Math.ceil((deadline - now) / 1000);
      if (left > 0) { setCountdown(left); return; }
      cancelCapture();
      const current = sample.current;
      if (current.move && now - current.at < 400 && now - current.since >= 350) captureCallback.current(current.move);
      else setError("No capturamos un gesto estable. Mantén una sola mano visible o elige un botón antes de que termine la ronda.");
    }, 80);
  }, [status, cancelCapture]);

  return { videoRef, status, detected, countdown, error, start, stop, capture, cancelCapture };
}
