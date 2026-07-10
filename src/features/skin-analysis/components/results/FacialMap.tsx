import type { FaceZone } from "../../types";
import type { MergedFinding } from "../../types";

const ZONE_POS: Record<Exclude<FaceZone, "other">, { cx: number; cy: number }> = {
  forehead: { cx: 100, cy: 52 },
  periorbital: { cx: 100, cy: 88 },
  nose: { cx: 100, cy: 115 },
  "left-cheek": { cx: 62, cy: 118 },
  "right-cheek": { cx: 138, cy: 118 },
  chin: { cx: 100, cy: 168 },
};

export function FacialMap({ findings }: { findings: MergedFinding[] }) {
  const placed = findings.filter(
    (f): f is MergedFinding & { region: Exclude<FaceZone, "other"> } =>
      f.region !== undefined && f.region !== "other",
  );
  return (
    <svg viewBox="0 0 200 220" className="mx-auto w-48" role="img" aria-label="Facial map">
      {/* face outline */}
      <ellipse cx="100" cy="110" rx="70" ry="95" fill="#fffdf9" stroke="#ede5d8" strokeWidth="2" />
      {/* eyes / nose / mouth hints */}
      <ellipse cx="72" cy="88" rx="10" ry="5" fill="#ede5d8" />
      <ellipse cx="128" cy="88" rx="10" ry="5" fill="#ede5d8" />
      <path d="M96 100 Q100 122 104 100" fill="none" stroke="#ede5d8" strokeWidth="2" />
      <path d="M80 148 Q100 160 120 148" fill="none" stroke="#ede5d8" strokeWidth="2" />
      {placed.map((f) => {
        const pos = ZONE_POS[f.region];
        return (
          <circle
            key={`${f.id}-${f.region}`}
            cx={pos.cx}
            cy={pos.cy}
            r={8}
            fill={f.escalated ? "#f59e0b" : "#0f766e"}
            fillOpacity={0.75}
            stroke="#ffffff"
            strokeWidth="2"
            role="img"
            aria-label={`${f.region}: ${f.label}`}
          />
        );
      })}
    </svg>
  );
}
