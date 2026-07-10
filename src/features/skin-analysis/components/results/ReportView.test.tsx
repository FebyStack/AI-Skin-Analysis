import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportView } from "./ReportView";
import { buildVerdict } from "../../ml/verdict";
import golden from "../../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../../api/contract";

const report = golden as unknown as AnalysisReport;

describe("ReportView", () => {
  it("renders summary, skin type, dimensions, findings, and the disclaimer", () => {
    render(
      <ReportView report={report} verdict={buildVerdict(report, [])} onNewScan={() => {}} />,
    );
    expect(screen.getByText(report.summary)).toBeInTheDocument();
    expect(screen.getByText(/combination/i)).toBeInTheDocument();
    expect(screen.getByText(/fitzpatrick/i)).toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /facial map/i })).toBeInTheDocument();
  });

  it("shows the partial banner for degraded verdicts", () => {
    render(
      <ReportView report={null} verdict={buildVerdict(null, [])} onNewScan={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/partial analysis/i);
  });

  it("shows inconclusive guidance without presenting condition findings", () => {
    const lowConfidenceReport: AnalysisReport = {
      ...report,
      findings: report.findings.map((finding) => ({ ...finding, confidence: 0.4 })),
    };
    render(
      <ReportView
        report={lowConfidenceReport}
        verdict={buildVerdict(lowConfidenceReport, [], 0.7)}
        onNewScan={() => {}}
      />,
    );
    expect(screen.getByText("Inconclusive Analysis")).toBeInTheDocument();
    expect(screen.getByText(/does not provide sufficient confidence/i)).toBeInTheDocument();
    expect(screen.queryByText(/Findings/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /facial map/i })).not.toBeInTheDocument();
  });

  it("offers Download PDF (print) and New scan actions", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const onNewScan = vi.fn();
    render(<ReportView report={report} verdict={buildVerdict(report, [])} onNewScan={onNewScan} />);
    await userEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(print).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /new scan/i }));
    expect(onNewScan).toHaveBeenCalled();
    print.mockRestore();
  });

  it("shows the derived multi-view panel when a captured photo is provided", () => {
    render(
      <ReportView
        report={report}
        verdict={buildVerdict(report, [])}
        onNewScan={() => {}}
        capturedBlob={new Blob(["x"], { type: "image/jpeg" })}
      />,
    );
    expect(screen.getByText(/derived from the visible-light photo/i)).toBeInTheDocument();
  });
});
