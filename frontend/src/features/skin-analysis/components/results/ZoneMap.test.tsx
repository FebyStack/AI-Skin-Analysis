import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZoneMap } from "./ZoneMap";
import { goldenFaceReport } from "@shared/testing/face-fixtures";

describe("ZoneMap", () => {
  it("renders every zone as readable text, not only as 3D", () => {
    const report = goldenFaceReport();
    render(<ZoneMap report={report} />);

    // jsdom has no WebGL, so this is the fallback path — which is exactly the
    // guarantee: the zone data is legible without a GPU.
    for (const z of report.dimensions.acne.perZone) {
      expect(screen.getByText(z.zone.replace(/-/g, " "))).toBeInTheDocument();
    }
  });

  it("says which dimension the scores belong to", () => {
    render(<ZoneMap report={goldenFaceReport()} />);
    expect(screen.getByText(/scores per facial zone/i)).toBeInTheDocument();
  });
});
