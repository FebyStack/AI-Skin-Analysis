import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FindingOverlay } from "./FindingOverlay";
import { goldenFaceReport } from "@shared/testing/face-fixtures";
import type { FaceReport, FindingMark } from "@shared/face";

const mark = (angle: "front" | "left-45", x: number): FindingMark => ({
  kind: "acne", angle, confidence: 0.9, source: "model", shape: { type: "box", x, y: 0.4, w: 0.02, h: 0.02 },
});

describe("FindingOverlay", () => {
  it("counts marks per angle, never summed across angles", () => {
    const report = { ...goldenFaceReport(), marks: [mark("front", 0.3), mark("front", 0.5), mark("left-45", 0.4)] };
    render(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }, { angle: "left-45", url: "l.jpg" }]} />);
    expect(screen.getByRole("button", { name: "Acne spots: 2 on this photo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "left-45" }));
    expect(screen.getByRole("button", { name: "Acne spots: 1 on this photo" })).toBeTruthy();
  });

  it("draws a circle per mark once the photo size is known, and hides a toggled kind", () => {
    const report = { ...goldenFaceReport(), marks: [mark("front", 0.3), mark("front", 0.5)] };
    const { container } = render(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }]} />);
    const img = screen.getByAltText("front photo");
    Object.defineProperty(img, "naturalWidth", { value: 1000 });
    Object.defineProperty(img, "naturalHeight", { value: 750 });
    fireEvent.load(img);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Acne spots: 2 on this photo" }));
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("says so when the detector ran and found nothing on a photo", () => {
    render(<FindingOverlay report={{ ...goldenFaceReport(), marks: [] }} images={[{ angle: "front", url: "f.jpg" }]} />);
    expect(screen.getByText("No spots marked on this photo.")).toBeTruthy();
  });

  it("says an angle was never examined instead of claiming zero spots", () => {
    const report: FaceReport = { ...goldenFaceReport(), marks: [], markedAngles: ["left-45"] };
    render(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }]} />);
    expect(screen.getByText("Not examined for spots.")).toBeTruthy();
    expect(screen.queryByText("No spots marked on this photo.")).toBeNull();
  });

  it("renders once images resolve after mount instead of staying blank forever", () => {
    const report = { ...goldenFaceReport(), marks: [mark("front", 0.3)] };
    const { rerender } = render(<FindingOverlay report={report} images={[]} />);
    expect(screen.queryByRole("region", { name: "Finding locations" })).toBeNull();
    rerender(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }]} />);
    expect(screen.getByRole("region", { name: "Finding locations" })).toBeTruthy();
    expect(screen.getByAltText("front photo")).toBeTruthy();
  });
});
