import { Suspense } from "react";
import { Boundary, lazyRetry } from "./Boundary";

const ObsidianOrb = lazyRetry(() => import("./ObsidianOrb"));

/**
 * The app's single waiting treatment.
 *
 * Two variants, and the split is a hard constraint rather than a taste call:
 * every orb is a live WebGL context, browsers cap how many can exist at once,
 * and the oldest gets evicted when you pass the cap. The Training tab alone
 * mounts four data-loading sections at the same moment — four orbs there would
 * fight each other and flicker.
 *
 * So `page` (the orb) is for a view that IS the wait: nothing else on screen is
 * loading beside it. `inline` is a CSS-only echo of the same look, for sections
 * that can appear several at a time.
 */
export function LoadingState({
  label,
  variant = "page",
}: {
  label: string;
  variant?: "page" | "inline";
}) {
  if (variant === "inline") {
    return (
      <div className="flex items-center gap-3 py-2" role="status" aria-live="polite">
        <span className="relative grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full border border-gold/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-gold-bright to-gold/40" />
        </span>
        <span className="text-sm text-ink-tertiary">{label}</span>
      </div>
    );
  }

  const plain = <p className="py-10 text-center text-sm text-ink-secondary">{label}</p>;

  return (
    // Boundary OUTSIDE Suspense on purpose. Suspense covers the wait; only the
    // boundary covers the chunk failing to arrive. Without it a dropped fetch
    // unmounts the app and the user is left staring at black — with no route
    // forward, because this sits on the path to their results.
    <Boundary fallback={plain}>
      <Suspense fallback={plain}>
        <ObsidianOrb label={label} />
      </Suspense>
    </Boundary>
  );
}
