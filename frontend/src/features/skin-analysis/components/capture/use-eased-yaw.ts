import { useEffect, useRef, useState } from "react";

/**
 * Eases a yaw value toward `target` on rAF, so a step change reads as the guide
 * turning rather than teleporting. Both overlay layers consume the SAME eased
 * value, which is the point: if the SVG snapped while the wireframe eased, the
 * two would visibly come apart mid-transition.
 *
 * Only runs while settling (a few hundred ms per step), then stops — this sits
 * in a component that is already doing camera work every frame.
 */
export function useEasedYaw(target: number): number {
  const [yaw, setYaw] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setYaw(target);
      return;
    }
    let raf = 0;
    const step = () => {
      const next = current.current + (target - current.current) * 0.18;
      current.current = Math.abs(target - next) < 0.2 ? target : next;
      setYaw(current.current);
      if (current.current !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return yaw;
}
