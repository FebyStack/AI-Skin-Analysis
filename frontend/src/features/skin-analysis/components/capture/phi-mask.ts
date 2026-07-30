/**
 * The golden-ratio ("phi") face mask used as the capture guide.
 *
 * Authored once here, in the reference drawing's own pixel space, and consumed
 * three ways so the shapes can never drift apart:
 *   - `outerPathD()`   → the SVG scrim hole + the hold-progress trace
 *   - `maskSegments()` → line-pair positions for a three.js LineSegments mesh
 *   - `OUTER`          → hit/really just the silhouette, for both of the above
 *
 * Everything symmetric is authored as its RIGHT half and mirrored, so the mask
 * cannot end up subtly lopsided.
 */

/** Reference drawing bounds. Only the ratio matters; the values are arbitrary. */
const CX = 172.5;
const TOP = 12;
const BOTTOM = 452;
const CY = (TOP + BOTTOM) / 2;
/** Normalising divisor: half the drawing's height, so y lands in [-1, 1]. */
const HALF = (BOTTOM - TOP) / 2;

type Pt = [number, number];

/**
 * Mirror a right-half chain whose first and last points sit ON the axis, giving
 * the left half to close the loop with. Those two shared points are dropped so
 * the closed polygon has no duplicate vertices.
 */
function mirrorChain(right: Pt[]): Pt[] {
  return right
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => [2 * CX - x, y] as Pt);
}

/** Right half of the silhouette, crown → chin. */
const OUTER_RIGHT: Pt[] = [
  [CX, TOP],
  [239, 12],
  [291, 60],
  [306, 152],
  [299, 247],
  [271, 330],
  [216, 414],
  [CX, BOTTOM],
];

/** Full closed silhouette. */
export const OUTER: Pt[] = [...OUTER_RIGHT, ...mirrorChain(OUTER_RIGHT)];

const JAW_RIGHT: Pt[] = [[CX, 352], [205, 356], [218, 395], [CX, 435]];
const JAW_INNER_RIGHT: Pt[] = [[CX, 370], [195, 372], [203, 398], [CX, 424]];
const MOUTH_RIGHT: Pt[] = [[CX, 304], [195, 306], [219, 320], [195, 340], [CX, 342]];

/** Right eye almond, as a closed hexagon (outer corner → inner corner → back). */
const EYE_RIGHT: Pt[] = [[205, 190], [225, 172], [260, 168], [287, 185], [267, 203], [233, 205]];

/** Nose: bridge down from the brow, flaring into a wing and back to the philtrum. */
const NOSE_RIGHT: Pt[] = [[186, 156], [191, 268], [206, 286], [196, 302], [CX, 306]];

/** Circle as a polyline — used for the irises. */
function circle(cx: number, cy: number, r: number, n = 16): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

interface Part {
  pts: Pt[];
  closed: boolean;
  /** Nose sits proud of the dome; everything else follows it. */
  lift?: number;
}

function pair(right: Pt[], closed: boolean, lift?: number): Part[] {
  return [
    { pts: right, closed, lift },
    { pts: right.map(([x, y]) => [2 * CX - x, y] as Pt), closed, lift },
  ];
}

/**
 * Every line in the mask. Deliberately NOT the full construction hatching of
 * the original drawing — this sits over a live camera feed, and a dense
 * wireframe would hide the very skin the patient is trying to frame.
 */
const PARTS: Part[] = [
  { pts: OUTER, closed: true },
  { pts: [...JAW_RIGHT, ...mirrorChain(JAW_RIGHT)], closed: true },
  { pts: [...JAW_INNER_RIGHT, ...mirrorChain(JAW_INNER_RIGHT)], closed: true },
  { pts: [...MOUTH_RIGHT, ...mirrorChain(MOUTH_RIGHT)], closed: true },
  ...pair(EYE_RIGHT, true),
  ...pair(circle(245, 186, 11), true),
  ...pair(NOSE_RIGHT, false, 0.06),
  // The two horizontal thirds the phi construction turns on: eye line, nose base.
  { pts: [[52, 186], [293, 186]], closed: false },
  { pts: [[70, 300], [275, 300]], closed: false },
];

/** Reference px → normalised mask space (y up, y in [-1, 1]). */
function norm([px, py]: Pt): [number, number] {
  return [(px - CX) / HALF, (CY - py) / HALF];
}

/** Half-extent of the normalised mask, for framing the camera and the scrim. */
export const MASK_HALF_W = (306 - CX) / HALF;
export const MASK_HALF_H = 1;

/** Dome depth, as a fraction of half-height. Enough to read as a face when turned. */
const DEPTH = 0.34;

/** Push a flat point onto an implied face dome so rotation looks like a head. */
function domeZ(nx: number, ny: number): number {
  const t = 1 - (nx / (MASK_HALF_W * 1.04)) ** 2 * 0.9 - ny ** 2 * 0.55;
  return t <= 0 ? 0 : DEPTH * Math.sqrt(t);
}

/**
 * Flat array of line-segment endpoints (x,y,z per vertex, two vertices per
 * segment) ready for `new THREE.BufferAttribute(…, 3)`.
 */
export function maskSegments(): Float32Array {
  const out: number[] = [];
  const push = (p: Pt, lift: number) => {
    const [nx, ny] = norm(p);
    out.push(nx, ny, domeZ(nx, ny) + lift);
  };
  for (const { pts, closed, lift = 0 } of PARTS) {
    for (let i = 0; i < pts.length - 1; i++) {
      push(pts[i], lift);
      push(pts[i + 1], lift);
    }
    if (closed) {
      push(pts[pts.length - 1], lift);
      push(pts[0], lift);
    }
  }
  return new Float32Array(out);
}

/**
 * The silhouette as an SVG path, mapped into a viewBox. `scale` is the mask's
 * half-height in viewBox units.
 *
 * `yawDeg` turns the outline about the vertical axis using the same dome depth
 * and the same orthographic projection as the WebGL layer, so the scrim, the
 * outline and the wireframe stay registered when a step asks for a turned head.
 * (This is the rotated outline, not a true silhouette — it is a guide to aim at,
 * and matching the wireframe exactly matters more than optical correctness.)
 */
export function outerPathD(cx: number, cy: number, scale: number, yawDeg = 0): string {
  const a = (yawDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (
    OUTER.map(([px, py], i) => {
      const [nx, ny] = norm([px, py]);
      const rx = nx * cos + domeZ(nx, ny) * sin;
      return `${i === 0 ? "M" : "L"}${(cx + rx * scale).toFixed(2)} ${(cy - ny * scale).toFixed(2)}`;
    }).join(" ") + " Z"
  );
}

/**
 * Where the guide sits inside the capture frame, as fractions of the frame.
 * The SVG scrim and the 3D wireframe both derive their framing from this, so
 * the two layers stay registered on top of each other.
 */
export const GUIDE = {
  /** Mask height ÷ frame height. */
  heightFraction: 0.78,
  centerX: 0.5,
  /** Slightly above centre — chin needs less room than the crown. */
  centerY: 0.45,
} as const;

/**
 * How much of the step's pose yaw the framing silhouette takes on.
 *
 * A real head stays roughly head-width at ANY yaw — only the face compresses.
 * Turning the framing outline the full amount foreshortens it into a sliver,
 * which would tell the patient to squeeze their whole head into a narrow band.
 * So the outline only leans, to show direction, while the wireframe inside turns
 * the whole way to show the actual target pose.
 */
export const SILHOUETTE_YAW_RATIO = 0.35;

/** Framing for an SVG layer with the given viewBox. */
export function svgGuide(vbW: number, vbH: number) {
  return {
    cx: GUIDE.centerX * vbW,
    cy: GUIDE.centerY * vbH,
    scale: (GUIDE.heightFraction * vbH) / 2,
  };
}

/**
 * Orthographic half-height that makes the mask occupy `heightFraction` of the
 * container, and the world-space y offset that matches `centerY`.
 */
export function orthoFraming() {
  const halfHeight = MASK_HALF_H / GUIDE.heightFraction;
  return { halfHeight, offsetY: halfHeight * (1 - 2 * GUIDE.centerY) };
}
