/**
 * Brand motion identity — the three constants every animation in the app draws
 * from. Archetype is **Premium**: dark canvas, champagne gold, unhurried, zero
 * overshoot. This is a clinical tool, so nothing bounces and nothing is cute.
 *
 * Clinical rule that outranks all of it: motion may never delay, obscure, or
 * animate away a result a clinician is reading. Reveals run once, on mount.
 */

/** Signature easing — one curve for ~80% of motion. Mirrors CSS `ease-spring`. */
export const EASE = "cubic-bezier(0.32,0.72,0,1)";
/** GSAP wants the four numbers, not the CSS function. */
export const EASE_POINTS = [0.32, 0.72, 0, 1] as const;

/** Duration palette, seconds (GSAP's unit). Premium archetype: 350–600ms band. */
export const DUR = {
  /** Hover, toggle, micro-feedback — must feel instant. */
  quick: 0.16,
  /** Cards, panels, the default. */
  standard: 0.32,
  /** Page-level and brand surfaces. */
  slow: 0.62,
} as const;

/** Entrance pattern: rise + fade. One style, used everywhere. */
export const RISE_Y = 16;

/**
 * Stagger delay for a cascade. The motion-design budget caps *total* stagger at
 * 500ms, so long lists clamp the per-item delay rather than running off the end.
 */
export const STAGGER = 0.06;
export const STAGGER_BUDGET = 0.5;

export function staggerFor(count: number): number {
  if (count <= 1) return 0;
  return Math.min(STAGGER, STAGGER_BUDGET / (count - 1));
}

/** Severity → the accent a zone is painted with. Matches the CSS design tokens. */
export const SEVERITY_COLOR = {
  ok: "#6FBF8F",
  routine: "#C8A96A",
  soon: "#E0A33E",
  urgent: "#D96A5B",
} as const;

/** 0..1 dimension score → severity token. Shared by the 2D and 3D zone maps. */
export function severityOf(score: number): keyof typeof SEVERITY_COLOR {
  if (score >= 0.7) return "urgent";
  if (score >= 0.45) return "soon";
  if (score >= 0.2) return "routine";
  return "ok";
}
