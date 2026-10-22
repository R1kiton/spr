import type { CSSProperties, ReactNode } from "react";
import type { Move } from "../lib/game";

// Colors come from the tokens in globals.css. SVG presentation attributes can't read
// CSS variables, so paint goes through `style`. p1 is you (blue), p2 is the rival (red).
const line = "var(--shadow)";
const skin = "var(--art-skin)";
const wraps = { p1: "var(--you)", p2: "var(--rival)" };
const paint = (fill: string, stroke?: string): CSSProperties => ({ fill, stroke });

// Each hand is a silhouette (drawn twice: thick outline, then fill, so overlaps
// leave no seams), optional crease lines, and parts that sit in front (the thumb).
const shapes: Record<Move, { silhouette: ReactNode; creases?: string; front?: ReactNode }> = {
  piedra: {
    silhouette: <rect x="12" y="13" width="40" height="38" rx="13" />,
    creases: "M22 18v13M31 17v14M40 18v13M14 32h36",
    front: <rect x="11" y="33" width="27" height="10" rx="5" />,
  },
  papel: {
    silhouette: <>
      <rect x="17" y="7" width="8" height="32" rx="4" />
      <rect x="26.5" y="3" width="8" height="36" rx="4" />
      <rect x="36" y="6" width="8" height="33" rx="4" />
      <rect x="45" y="13" width="7" height="26" rx="3.5" />
      <rect x="14" y="26" width="8" height="22" rx="4" transform="rotate(-30 18 46)" />
      <rect x="15" y="26" width="37" height="26" rx="11" />
    </>,
  },
  tijera: {
    silhouette: <>
      <rect x="16" y="3" width="8.5" height="34" rx="4.25" transform="rotate(-14 20 37)" />
      <rect x="28" y="3" width="8.5" height="34" rx="4.25" transform="rotate(12 32 37)" />
      <rect x="14" y="27" width="37" height="25" rx="11" />
    </>,
    creases: "M34 30v10M42 30.5v10M27 41h22",
    front: <rect x="13" y="38" width="25" height="10" rx="5" />,
  },
};

type Props = { move: Move; side?: "p1" | "p2"; wrap?: string; label?: string; className?: string };

/** Cartoon fighter hand. Sized at 1em so it drops in where an emoji was; p2 faces left. `wrap` overrides the wrist color. */
export function HandIcon({ move, side = "p1", wrap, label, className }: Props) {
  const { silhouette, creases, front } = shapes[move];
  const wrist = <rect x="18" y="48" width="28" height="13" rx="3" />;
  return <svg viewBox="0 0 64 64" width="1em" height="1em" className={className ? `hand ${className}` : "hand"} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} strokeLinecap="round" strokeLinejoin="round">
    <g transform={side === "p2" ? "translate(64 0) scale(-1 1)" : undefined}>
      <g style={paint(line, line)} strokeWidth="7">{silhouette}{wrist}</g>
      <g style={paint(skin)}>{silhouette}</g>
      {creases && <path d={creases} style={paint("none", line)} strokeWidth="2.6" />}
      {front && <g style={paint(skin, line)} strokeWidth="3">{front}</g>}
      <g style={paint(wrap ?? wraps[side])}>{wrist}</g>
      <path d="M19 54.5h26" style={paint("none", line)} strokeWidth="2" opacity=".35" />
    </g>
  </svg>;
}
