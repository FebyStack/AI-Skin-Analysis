import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptureFlow } from "./CaptureFlow";
import { useScanMachine } from "../../store/scan-machine";
import { buildVerdict } from "@ai/shared/verdict";
import * as analyzeClient from "../../api/analyze-client";

vi.mock("../../privacy/redact", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../privacy/redact")>();
  return {
    ...actual,
    stripMetadata: vi.fn(async () => {
      throw new actual.RedactError("Could not process this photo — it may be corrupt or unsupported.");
    }),
  };
});

describe("CaptureFlow — corrupt upload", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("shows an error message instead of failing silently", async () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().chooseUpload();
    render(<CaptureFlow mode="face" patientId="p-1" />);
    const file = new File(["bad"], "corrupt.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/upload a photo/i);
    await userEvent.upload(input, file);
    expect(await screen.findByText(/couldn.t process that photo/i)).toBeInTheDocument();
    // Dropzone still present — user can retry.
    expect(screen.getByLabelText(/upload a photo/i)).toBeInTheDocument();
  });
});

describe("CaptureFlow — analysis error routing", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("shows an analysis error with retry, not the upload dropzone", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().analysisFailed();
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(screen.getByText(/analysis failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/upload a photo/i)).not.toBeInTheDocument();
  });
});

describe("CaptureFlow — camera retry from upload fallback", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("offers a way back to the camera after camera denial", async () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraDenied();
    render(<CaptureFlow mode="face" patientId="p-1" />);
    const back = screen.getByRole("button", { name: /use camera instead/i });
    await userEvent.click(back);
    // The retry switches back to the camera source; jsdom has no camera, so the
    // remounted CameraFeed immediately reports no-camera and the fallback
    // (with the retry affordance) returns instead of crashing or looping.
    expect(useScanMachine.getState().captureSource).toBe("camera");
    expect(useScanMachine.getState().error).toBe("no-camera");
    expect(screen.getByRole("button", { name: /use camera instead/i })).toBeInTheDocument();
  });
});

describe("CaptureFlow — results rendering", () => {
  beforeEach(() => {
    useScanMachine.getState().reset();
    vi.restoreAllMocks();
  });

  it("renders the loading stages while analyzing", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      mode: "face",
      source: "camera",
      width: 10,
      height: 10,
    });
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/running deep analysis/i)).toBeInTheDocument();
  });

  it("renders the report when results are ready", async () => {
    vi.spyOn(analyzeClient, "getScan").mockResolvedValue(null);
    useScanMachine.getState().resultsReady(buildVerdict(null, []), "scan-1");
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(/partial analysis/i);
    expect(screen.getByRole("button", { name: /new scan/i })).toBeInTheDocument();
  });

  it("fetches the stored report by scan id and renders it once loaded", async () => {
    const golden = (await import("@ai/evaluation/fixtures/golden-report.json")).default;
    vi.spyOn(analyzeClient, "getScan").mockResolvedValue({
      id: "scan-1",
      patientId: "p-1",
      mode: "face",
      createdAt: 1,
      imageWidth: 10,
      imageHeight: 10,
      report: golden as never,
      partial: false,
      classifierFindings: [],
      promptVersion: 1,
    });
    useScanMachine.getState().resultsReady(buildVerdict(golden as never, []), "scan-1");
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(await screen.findByText(/fitzpatrick/i)).toBeInTheDocument();
  });

  it("shows a load-failure banner without breaking the results screen", async () => {
    vi.spyOn(analyzeClient, "getScan").mockRejectedValue(new Error("network down"));
    useScanMachine.getState().resultsReady(buildVerdict(null, []), "scan-1");
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load the full report/i);
  });
});
