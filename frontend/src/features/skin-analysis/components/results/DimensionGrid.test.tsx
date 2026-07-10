import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DimensionGrid } from "./DimensionGrid";
import golden from "@ai/evaluation/fixtures/golden-report.json";
import type { AnalysisReport } from "@shared/contract";

const report = golden as unknown as AnalysisReport;

describe("DimensionGrid", () => {
  it("renders all 12 dimensions with notes", () => {
    render(<DimensionGrid dimensions={report.dimensions} />);
    expect(screen.getByText(/oiliness/i)).toBeInTheDocument();
    expect(screen.getByText(report.dimensions.acne.note)).toBeInTheDocument();
  });

  it("labels proxy dimensions as visual proxies", () => {
    render(<DimensionGrid dimensions={report.dimensions} />);
    expect(screen.getAllByText(/visual proxy/i).length).toBeGreaterThanOrEqual(3);
  });
});
