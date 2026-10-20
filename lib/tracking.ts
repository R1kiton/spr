import { gestureMove, type Move } from "./game";

type HandResult = {
  landmarks: { x: number }[][];
  gestures: { categoryName: string; score: number }[][];
};

// Video is mirrored: larger source x appears on the left of the screen.
// The center is neutral. Two hands in one zone invalidate that player's sample.
export function playerMoves(result: HandResult): [Move | null, Move | null] {
  const hands: [number[], number[]] = [[], []];
  result.landmarks.forEach((points, index) => {
    const x = points[0]?.x;
    if (x > 0.55) hands[0].push(index);
    else if (x < 0.45) hands[1].push(index);
  });
  return hands.map(indices => {
    if (indices.length !== 1) return null;
    const category = result.gestures[indices[0]]?.[0];
    return category ? gestureMove(category.categoryName, category.score) : null;
  }) as [Move | null, Move | null];
}
