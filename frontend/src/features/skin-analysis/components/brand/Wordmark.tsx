import { useState } from "react";

/**
 * The Sev Clinic mark.
 *
 * Prefers the real monogram artwork at MONOGRAM_SRC. If that file is not present
 * — or fails to decode — it falls back to the drawn "S" tile, so the header can
 * never render a broken image.
 *
 * The asset MUST have a transparent background. The app canvas is #0B0B0D, so a
 * logo exported on white shows up as a white rectangle around the mark. PNG with
 * alpha, or SVG.
 */
const MONOGRAM_SRC = "/brand/sev-monogram.png";

interface Props {
  size?: "lg" | "sm";
  tagline?: boolean;
}

export function Wordmark({ size = "sm", tagline = true }: Props) {
  const lg = size === "lg";
  // Set once the artwork fails to load, which is also the "file not added yet"
  // path — a missing file 404s and lands here.
  const [artworkMissing, setArtworkMissing] = useState(false);

  // The monogram is a portrait tile (roughly 1:1.9), so height drives the box.
  const box = lg ? "h-14" : "h-9";

  return (
    <div className="flex items-center gap-3">
      {artworkMissing ? (
        <span
          className={`gold-tile grid shrink-0 place-items-center rounded-[0.7rem] font-serif text-gold-ink shadow-thumb ${
            lg ? "h-14 w-11 text-2xl" : "h-9 w-7 text-lg"
          }`}
          aria-hidden
        >
          S
        </span>
      ) : (
        <img
          src={MONOGRAM_SRC}
          alt=""
          aria-hidden
          onError={() => setArtworkMissing(true)}
          className={`${box} w-auto shrink-0 select-none rounded-[0.35rem] object-contain`}
          draggable={false}
        />
      )}
      <span className="flex flex-col">
        <span
          className={`text-gold-gradient font-serif font-semibold leading-none ${
            lg ? "text-[1.9rem] tracking-[0.14em]" : "text-base tracking-[0.16em]"
          }`}
        >
          THE SEV CLINIC
        </span>
        {tagline && (
          <span
            className={`font-serif italic text-gold/90 ${
              lg ? "mt-1.5 text-sm tracking-[0.14em]" : "mt-0.5 text-[0.6875rem] tracking-[0.08em]"
            }`}
          >
            Family · Lifestyle · Aesthetics
          </span>
        )}
      </span>
    </div>
  );
}
