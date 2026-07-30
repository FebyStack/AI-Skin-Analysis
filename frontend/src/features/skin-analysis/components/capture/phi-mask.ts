/**
 * The golden-ratio ("phi") face mask used as the capture guide — the polygonal
 * construction drawing, not a simplified outline.
 *
 * Authored once here in the reference drawing's own pixel space (345 x 455) and
 * projected on demand, so the SVG overlay and any 3D consumer can never drift
 * apart. Symmetric parts are written as a RIGHT half and mirrored, so the mask
 * cannot end up subtly lopsided.
 *
 * Rendering is SVG-first on purpose: the guide sits over a live camera feed
 * while MediaPipe runs, which is this app's tightest memory moment, and the
 * clinic's own phones report as memory-constrained. Paths cost nothing there.
 */

const CX = 172.5;
const TOP = 10;
const BOTTOM = 452;
const CY = (TOP + BOTTOM) / 2;
/** Normalising divisor: half the drawing's height, so y lands in [-1, 1]. */
const HALF = (BOTTOM - TOP) / 2;

type Pt = [number, number];

/** Mirror a chain whose first and last points sit ON the axis, to close a loop. */
function mirrorChain(right: Pt[]): Pt[] {
  return right
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => [2 * CX - x, y] as Pt);
}

const flip = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [2 * CX - x, y] as Pt);

/** Right half of the silhouette, crown → chin. */
const OUTER_RIGHT: Pt[] = [
  [CX, TOP],
  [240, 10],
  [292, 58],
  [306, 150],
  [300, 248],
  [272, 332],
  [216, 414],
  [CX, BOTTOM],
];

/** Full closed silhouette. */
export const OUTER: Pt[] = [...OUTER_RIGHT, ...mirrorChain(OUTER_RIGHT)];

/** Half-width of the silhouette at a given y, for construction lines that span it. */
function contourHalfWidthAt(y: number): number {
  let best = 0;
  for (let i = 0; i < OUTER_RIGHT.length - 1; i++) {
    const [x1, y1] = OUTER_RIGHT[i];
    const [x2, y2] = OUTER_RIGHT[i + 1];
    if (y < Math.min(y1, y2) || y > Math.max(y1, y2)) continue;
    const t = y2 === y1 ? 0 : (y - y1) / (y2 - y1);
    best = Math.max(best, x1 + (x2 - x1) * t - CX);
  }
  return best;
}

/** A horizontal construction line inset from the silhouette edge. */
function hLine(y: number, inset = 6): Pt[] {
  const hw = contourHalfWidthAt(y) - inset;
  return [
    [CX - hw, y],
    [CX + hw, y],
  ];
}

function circle(cx: number, cy: number, r: number, n = 18): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

/** Weight bands: the structure reads first, the construction grid sits behind it. */
type Ink = "structure" | "feature" | "construction";

interface Part {
  pts: Pt[];
  closed: boolean;
  ink: Ink;
  /** Radial push, as a fraction of radius — the nose stands off the dome. */
  lift?: number;
}

// Landmark heights follow classic facial proportion, measured from the crown as
// a fraction of the crown-to-chin span: brow .32, eye .40, nose base .60,
// mouth .72, chin crease .83. The first pass placed the nose base near .68 and
// everything below it followed, which visibly stretched the mid-face.
const Y = {
  hairline: 48,
  brow: 150,
  eye: 186,
  noseBase: 268,
  mouth: 330,
  chinCrease: 372,
} as const;

// ── forehead / phi divisions ────────────────────────────────────────────────
const FOREHEAD_RIGHT: Pt[] = [[CX, Y.hairline], [224, 51], [272, 96], [286, Y.brow], [CX, Y.brow]];

// ── brow, eye, iris ────────────────────────────────────────────────────────
const BROW_R: Pt[] = [[198, 158], [228, 145], [262, 150], [286, 166]];
const EYE_R: Pt[] = [[202, 190], [222, 172], [254, 169], [282, 184], [258, 203], [226, 201]];
const LID_R: Pt[] = [[210, 188], [231, 179], [253, 179], [273, 186]];
/** Dashed box framing each eye — part of the drawing's construction. */
const EYE_BOX_R: Pt[] = [[195, 165], [293, 165], [293, 209], [195, 209]];
/** Short outer-corner strokes. Long ones read as an X struck through the eye. */
const CROW_R: Pt[][] = [
  [[282, 184], [299, 176]],
  [[282, 184], [297, 194]],
  [[202, 190], [189, 184]],
];

// ── nose ───────────────────────────────────────────────────────────────────
const NOSE_BRIDGE_R: Pt[] = [[182, 152], [190, Y.noseBase - 10]];
const NOSE_TIP_RIGHT: Pt[] = [[CX, 250], [193, 262], [187, 286], [CX, 294]];
const NOSE_WING_R: Pt[] = [[193, 262], [215, 269], [221, 287], [199, 293], [187, 286]];

// ── lips ───────────────────────────────────────────────────────────────────
const LIP_UPPER_RIGHT: Pt[] = [[CX, 314], [201, 318], [225, 328], [201, 337], [CX, 335]];
const LIP_LOWER_RIGHT: Pt[] = [[CX, 339], [201, 341], [219, 350], [195, 362], [CX, 365]];

// ── chin nest ──────────────────────────────────────────────────────────────
const CHIN_RIGHT: Pt[] = [[CX, Y.chinCrease], [207, 378], [216, 406], [CX, 446]];
const CHIN_INNER_RIGHT: Pt[] = [[CX, 386], [196, 391], [204, 412], [CX, 436]];

/**
 * Every line in the mask, in draw order (construction first, so structure and
 * features sit on top of it).
 */
const PARTS: Part[] = [
  // ── construction grid: the phi divisions the drawing is built on ──────────
  ...[Y.hairline, Y.brow, Y.eye, Y.noseBase, 294, Y.mouth, Y.chinCrease].map(
    (y): Part => ({ pts: hLine(y), closed: false, ink: "construction" }),
  ),
  { pts: [[CX - 52, 24], [CX - 52, Y.chinCrease]], closed: false, ink: "construction" },
  { pts: [[CX + 52, 24], [CX + 52, Y.chinCrease]], closed: false, ink: "construction" },
  { pts: [[CX, TOP], [CX, 314]], closed: false, ink: "construction" },
  // Cheek diagonals converging on the chin and jaw.
  ...[
    [[CX + 118, Y.eye], [CX + 6, Y.chinCrease]],
    [[CX + 128, 248], [CX + 44, 414]],
    [[CX + 60, Y.eye], [CX + 100, 332]],
  ].flatMap((pts): Part[] => [
    { pts: pts as Pt[], closed: false, ink: "construction" },
    { pts: flip(pts as Pt[]), closed: false, ink: "construction" },
  ]),
  { pts: [...FOREHEAD_RIGHT, ...mirrorChain(FOREHEAD_RIGHT)], closed: true, ink: "construction" },
  ...[EYE_BOX_R].flatMap((pts): Part[] => [
    { pts, closed: true, ink: "construction" },
    { pts: flip(pts), closed: true, ink: "construction" },
  ]),

  // ── structure ─────────────────────────────────────────────────────────────
  { pts: OUTER, closed: true, ink: "structure" },
  { pts: [...CHIN_RIGHT, ...mirrorChain(CHIN_RIGHT)], closed: true, ink: "structure" },
  { pts: [...CHIN_INNER_RIGHT, ...mirrorChain(CHIN_INNER_RIGHT)], closed: true, ink: "structure" },

  // ── features ──────────────────────────────────────────────────────────────
  { pts: [...LIP_UPPER_RIGHT, ...mirrorChain(LIP_UPPER_RIGHT)], closed: true, ink: "feature" },
  { pts: [...LIP_LOWER_RIGHT, ...mirrorChain(LIP_LOWER_RIGHT)], closed: true, ink: "feature" },
  { pts: [...NOSE_TIP_RIGHT, ...mirrorChain(NOSE_TIP_RIGHT)], closed: true, ink: "feature", lift: 0.05 },
  ...[BROW_R, EYE_R, LID_R, NOSE_WING_R].flatMap((pts, i): Part[] => {
    const closed = pts === EYE_R || pts === NOSE_WING_R;
    const lift = i === 3 ? 0.03 : 0;
    return [
      { pts, closed, ink: "feature" as Ink, lift },
      { pts: flip(pts), closed, ink: "feature" as Ink, lift },
    ];
  }),
  { pts: NOSE_BRIDGE_R, closed: false, ink: "feature", lift: 0.04 },
  { pts: flip(NOSE_BRIDGE_R), closed: false, ink: "feature", lift: 0.04 },
  ...[circle(240, 186, 12), circle(240, 186, 4)].flatMap((pts): Part[] => [
    { pts, closed: true, ink: "feature" },
    { pts: flip(pts), closed: true, ink: "feature" },
  ]),
  ...CROW_R.flatMap((pts): Part[] => [
    { pts, closed: false, ink: "feature" },
    { pts: flip(pts), closed: false, ink: "feature" },
  ]),
];

/** Reference px → normalised mask space (y up, y in [-1, 1]). */
function norm([px, py]: Pt): [number, number] {
  return [(px - CX) / HALF, (CY - py) / HALF];
}

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
 * Where the guide sits inside the capture frame, as fractions of the frame.
 * Every layer derives its framing from this so they stay registered.
 */
export const GUIDE = {
  /** Mask height ÷ frame height. */
  heightFraction: 0.78,
  centerX: 0.5,
  /** Slightly above centre — the chin needs less room than the crown. */
  centerY: 0.45,
} as const;

/**
 * How much of the step's pose yaw the framing silhouette takes on.
 *
 * A real head stays roughly head-width at ANY yaw — only the face compresses.
 * Turning the framing outline the full amount foreshortens it into a sliver,
 * which would tell the patient to squeeze their whole head into a narrow band.
 * So the outline only leans, to show direction, while the interior turns fully.
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

interface Projection {
  cx: number;
  cy: number;
  scale: number;
  yawDeg: number;
}

/** Project one point: dome → Y-rotation → orthographic → viewBox units. */
function project([px, py]: Pt, lift: number, { cx, cy, scale, yawDeg }: Projection): [number, number] {
  const a = (yawDeg * Math.PI) / 180;
  const [nx, ny] = norm([px, py]);
  const z = domeZ(nx, ny);
  const k = 1 + lift;
  const rx = nx * k * Math.cos(a) + z * k * Math.sin(a);
  return [cx + rx * scale, cy - ny * scale];
}

function toPath(pts: Pt[], closed: boolean, lift: number, p: Projection): string {
  const d = pts
    .map((pt, i) => {
      const [x, y] = project(pt, lift, p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return closed ? `${d} Z` : d;
}

/** The silhouette alone — the scrim hole and the hold-progress trace. */
export function outerPathD(cx: number, cy: number, scale: number, yawDeg = 0): string {
  return toPath(OUTER, true, 0, { cx, cy, scale, yawDeg });
}

export interface MaskPath {
  d: string;
  ink: Ink;
}

/**
 * The whole mask as SVG paths, grouped by ink so the caller can weight them.
 * The silhouette is excluded — callers draw that separately, at a gentler yaw,
 * because it doubles as the framing region.
 */
export function maskPaths(cx: number, cy: number, scale: number, yawDeg = 0): MaskPath[] {
  const p = { cx, cy, scale, yawDeg };
  return PARTS.filter((part) => part.pts !== OUTER).map((part) => ({
    d: toPath(part.pts, part.closed, part.lift ?? 0, p),
    ink: part.ink,
  }));
}

/**
 * Line-segment endpoints (x,y,z per vertex, two per segment) for a three.js
 * `LineSegments`. Unused by the capture overlay, which is SVG — kept because the
 * geometry is the shared source of truth for any 3D consumer.
 */
export function maskSegments(): Float32Array {
  const out: number[] = [];
  const push = (pt: Pt, lift: number) => {
    const [nx, ny] = norm(pt);
    const k = 1 + lift;
    out.push(nx * k, ny * k, domeZ(nx, ny) * k);
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
