export const moves = ["piedra", "papel", "tijera"] as const;
export type Move = typeof moves[number];
export type Outcome = "win" | "lose" | "draw";
export const icons: Record<Move, string> = { piedra: "✊", papel: "✋", tijera: "✌️" };

export function outcome(player: Move, computer: Move): Outcome {
  if (player === computer) return "draw";
  return ({ piedra: "tijera", papel: "piedra", tijera: "papel" })[player] === computer ? "win" : "lose";
}

export function gestureMove(name: string, confidence: number): Move | null {
  if (confidence < 0.65) return null;
  return ({ Closed_Fist: "piedra", Open_Palm: "papel", Victory: "tijera" } as Record<string, Move>)[name] ?? null;
}

export function randomMove(): Move {
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] === 0xffffffff);
  return moves[value[0] % 3];
}
