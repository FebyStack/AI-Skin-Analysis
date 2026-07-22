// Apple-style segmented control with a sliding gold-wash thumb. Equal-width segments,
// thumb positioned by index via translateX so only `transform` animates (DESIGN.md §7).

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const pct = 100 / options.length;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="segmented w-full max-w-xs"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        className="segmented-thumb"
        style={{ width: `calc(${pct}% - 0.5rem)`, transform: `translateX(calc(${index * 100}% + ${index * 0.5}rem))`, left: "0.25rem" }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`segmented-item ${active ? "text-ink" : "text-ink-secondary hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
