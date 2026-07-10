export interface Point {
  x: number;
  y: number;
}

// Relative pixel distance. Absolute mm requires a calibration reference (future).
export function pixelDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
