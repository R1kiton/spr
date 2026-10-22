import type { Move } from "../lib/game";

const line = "#0a0518";
// p1 is you (blue), p2 is the rival (red).
const accents = { p1: "#2d8cff", p2: "#ff4a3d" };
const rock = "M9 45 L13 27 L25 14 L41 12 L54 22 L57 39 L49 51 L22 53 Z";
const sheet = "M15 7 H40 L50 17 V55 H15 Z";
const bladeA = "M29.5 34 L11 6 L17 4.5 L35.5 30 Z";
const bladeB = "M34.5 34 L53 6 L47 4.5 L28.5 30 Z";

function art(move: Move, accent: string) {
  if (move === "piedra") return <>
    <path d={rock} fill={line} stroke={line} strokeWidth="7" />
    <path d={rock} fill="#a39cbc" />
    <path d="M13 27 L25 14 L33 21 L21 33 Z" fill="#cdc8e0" />
    <path d="M41 12 L54 22 L57 39 L45 34 L42 22 Z" fill="#7b7499" />
    <path d="M21 33 L33 21 L42 22 L45 34 L35 40 Z" fill="#b6b0cc" />
    <path d="M21 33 L33 21 L42 22 L45 34 L35 40 Z M35 40 L32 52 M13 27 L21 33 M45 34 L57 39" fill="none" stroke={line} strokeWidth="2.4" />
  </>;
  if (move === "papel") return <g transform="rotate(-8 32 32)">
    <path d={sheet} fill={line} stroke={line} strokeWidth="7" />
    <path d={sheet} fill="#fff6e6" />
    <path d="M40 7 V17 H50 Z" fill="#d9ccb4" stroke={line} strokeWidth="2.4" />
    <path d="M21 25 H44 M21 32 H44 M21 39 H44 M21 46 H36" stroke="#8cb6ff" strokeWidth="2.6" />
    <path d="M20 9 V53" stroke="#ff8a80" strokeWidth="2" />
  </g>;
  return <>
    <g fill={line} stroke={line} strokeWidth="7"><path d={bladeA} /><path d={bladeB} /></g>
    <path d="M30 33 L23 42 M34 33 L41 42" stroke={line} strokeWidth="12" />
    <g fill="none" stroke={line} strokeWidth="13"><circle cx="20" cy="48" r="7.5" /><circle cx="44" cy="48" r="7.5" /></g>
    <path d={bladeA} fill="#e3e7f2" />
    <path d={bladeB} fill="#c4cadb" />
    <path d="M14 7 L31 31" stroke="#fff" strokeWidth="1.6" opacity=".8" />
    <g fill="none" stroke={accent} strokeWidth="5.5"><path d="M30 33 L23 42 M34 33 L41 42" /><circle cx="20" cy="48" r="7.5" /><circle cx="44" cy="48" r="7.5" /></g>
    <circle cx="32" cy="31" r="3.4" fill="#ffcf2e" stroke={line} strokeWidth="2.2" />
  </>;
}

type Props = { move: Move; side?: "p1" | "p2"; accent?: string; label?: string; className?: string };

/** The thrown move as an object (rock, sheet, scissors), shown when a round is revealed. Sized at 1em like HandIcon. */
export function MoveIcon({ move, side = "p1", accent, label, className }: Props) {
  const color = accent ?? accents[side];
  return <svg viewBox="0 0 64 64" width="1em" height="1em" className={className ? `move-object ${className}` : "move-object"} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} strokeLinecap="round" strokeLinejoin="round">
    <g transform={side === "p2" ? "translate(64 0) scale(-1 1)" : undefined}>
      {move !== "tijera" && <ellipse cx="32" cy="58.5" rx="22" ry="4.2" fill={color} stroke={line} strokeWidth="2.5" />}
      {art(move, color)}
    </g>
  </svg>;
}
