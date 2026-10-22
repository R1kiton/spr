// Round-result sound effects, synthesized with the Web Audio API: no audio files to load or license.
// Browser only. Browsers start audio suspended until a user gesture; every game reaches a result
// through a click or the camera button first, and `resume()` is retried on each play.

export type ResultSound = "win" | "lose" | "draw";

const MUTE_KEY = "gesto-arena-sound";
let context: AudioContext | null = null;
let master: GainNode | null = null;

export function soundEnabled() {
  try { return localStorage.getItem(MUTE_KEY) !== "off"; } catch { return true; }
}

export function setSoundEnabled(enabled: boolean) {
  try { localStorage.setItem(MUTE_KEY, enabled ? "on" : "off"); } catch { /* Storage is optional. */ }
}

function audio() {
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    // A compressor keeps the layered hits loud without clipping.
    const limiter = context.createDynamicsCompressor();
    master = context.createGain();
    master.gain.value = 0.32;
    master.connect(limiter).connect(context.destination);
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

/** One oscillator note with a fast attack and exponential release; optionally slides in pitch. */
function tone(ctx: AudioContext, at: number, length: number, frequency: number, type: OscillatorType, volume: number, slideTo?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(master!);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** Filtered noise burst: the "smack" of a hit. */
function hit(ctx: AudioContext, at: number, length: number, volume: number, filter: BiquadFilterType, frequency: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 2;
  const source = ctx.createBufferSource();
  const shape = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  shape.type = filter;
  shape.frequency.value = frequency;
  gain.gain.value = volume;
  source.connect(shape).connect(gain).connect(master!);
  source.start(at);
}

const sounds: Record<ResultSound, (ctx: AudioContext, t: number) => void> = {
  // Knock-out punch, then a rising fanfare that lands on a held high note.
  win: (ctx, t) => {
    hit(ctx, t, 0.22, 1.1, "lowpass", 1800);
    tone(ctx, t, 0.35, 140, "sine", 0.9, 38);
    [523.25, 659.25, 783.99].forEach((note, index) => tone(ctx, t + 0.22 + index * 0.09, 0.14, note, "square", 0.22));
    tone(ctx, t + 0.49, 0.55, 1046.5, "square", 0.24);
    tone(ctx, t + 0.49, 0.55, 1318.5, "triangle", 0.14);
  },
  // A duller blow, then a descending "wah-wah-waaah".
  lose: (ctx, t) => {
    hit(ctx, t, 0.18, 0.7, "lowpass", 700);
    tone(ctx, t, 0.3, 110, "sine", 0.7, 45);
    tone(ctx, t + 0.25, 0.26, 392, "sawtooth", 0.16, 370);
    tone(ctx, t + 0.53, 0.26, 349.23, "sawtooth", 0.16, 330);
    tone(ctx, t + 0.81, 0.75, 311.13, "sawtooth", 0.17, 196);
  },
  // Two fists colliding: twin metallic clashes and the same neutral tone twice.
  draw: (ctx, t) => {
    hit(ctx, t, 0.16, 0.9, "bandpass", 2400);
    tone(ctx, t, 0.12, 659.25, "triangle", 0.25);
    hit(ctx, t + 0.2, 0.16, 0.9, "bandpass", 2400);
    tone(ctx, t + 0.2, 0.3, 659.25, "triangle", 0.25);
  },
};

export function playResult(kind: ResultSound) {
  if (typeof window === "undefined" || !soundEnabled()) return;
  const ctx = audio();
  if (!ctx || !master) return;
  sounds[kind](ctx, ctx.currentTime + 0.02);
}
