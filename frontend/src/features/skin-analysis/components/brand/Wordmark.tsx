// The Sev Clinic wordmark, recreated as gold-gradient Didone type on transparent —
// the correct luxury treatment on a dark canvas (a raster gold-on-white logo would
// show a white box). Swap for /sev-clinic-logo.png here if a transparent asset lands.

interface Props {
  size?: "lg" | "sm";
  tagline?: boolean;
}

export function Wordmark({ size = "sm", tagline = true }: Props) {
  const lg = size === "lg";
  return (
    <div className="flex items-center gap-3">
      {/* Monogram tile */}
      <span
        className={`gold-tile grid shrink-0 place-items-center rounded-[0.7rem] font-serif text-gold-ink shadow-thumb ${
          lg ? "h-14 w-11 text-2xl" : "h-9 w-7 text-lg"
        }`}
        aria-hidden
      >
        S
      </span>
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
            className={`font-serif italic text-ink-secondary ${
              lg ? "mt-2 text-sm tracking-[0.1em]" : "mt-0.5 text-[0.6875rem] tracking-[0.06em]"
            }`}
          >
            Family · Lifestyle · Aesthetics
          </span>
        )}
      </span>
    </div>
  );
}
