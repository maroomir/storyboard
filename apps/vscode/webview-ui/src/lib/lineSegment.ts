export interface LineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

const minimumVisibleLengthPx: number = 4;

export function shortenLineSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  insetStart: number,
  insetEnd: number,
): LineSegment | undefined {
  const dx: number = x2 - x1;
  const dy: number = y2 - y1;
  const length: number = Math.hypot(dx, dy);

  if (length < insetStart + insetEnd + minimumVisibleLengthPx) {
    return undefined;
  }

  const ux: number = dx / length;
  const uy: number = dy / length;

  return {
    x1: x1 + ux * insetStart,
    y1: y1 + uy * insetStart,
    x2: x2 - ux * insetEnd,
    y2: y2 - uy * insetEnd,
  };
}
