import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DUR, EASE_POINTS, RISE_Y, staggerFor } from "./tokens";

gsap.registerPlugin(useGSAP);

const EASE = `cubic-bezier(${EASE_POINTS.join(",")})`;

/**
 * Staggered entrance for a group of elements. Mark children with
 * `data-reveal` and hand the returned ref to their container.
 *
 * Reduced motion is honoured through `gsap.matchMedia()`, which reverts the
 * tween and leaves the content in its final state — never hidden. That matters
 * more than usual here: a clinician who prefers no motion must still see every
 * result immediately.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []) {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      const targets = gsap.utils.toArray<HTMLElement>("[data-reveal]");
      if (targets.length === 0) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(targets, { clearProps: "all" });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(targets, {
          y: RISE_Y,
          opacity: 0,
          duration: DUR.slow,
          ease: EASE,
          stagger: staggerFor(targets.length),
          // Entrances only. The elements are already in the DOM and readable;
          // this animates *from* an offset so nothing is ever left invisible.
          clearProps: "transform,opacity",
        });
      });

      return () => mm.revert();
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );

  return scope;
}
