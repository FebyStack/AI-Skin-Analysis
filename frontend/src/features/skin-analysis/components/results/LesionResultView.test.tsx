import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LesionResultView } from "./LesionResultView";
import type { LesionAnalysis, LesionExplanation } from "@shared/lesion";

const analysis: LesionAnalysis = {
  lesions: [
    {
      bbox: null,
      detectorConfidence: null,
      localizationConfidence: 0.2,
      segmented: false,
      classification: {
        predicted: "MEL",
        confidence: 0.72,
        top: [
          { label: "MEL", confidence: 0.72 },
          { label: "NEV", confidence: 0.18 },
          { label: "BCC", confidence: 0.1 },
        ],
      },
    },
  ],
  wholeImageFallback: true,
  model: { classifier: "efficientnet_b1-isic2019", detector: "yolo11n-generic" },
};

const explanation: LesionExplanation = {
  patientSummary: "The analysis suggests melanoma features; a professional must confirm.",
  education: "Melanoma education text.",
  referral: { recommended: true, urgency: "urgent", reason: "possible melanoma" },
  disclaimer: "This is not a diagnosis.",
  source: "gemini",
  promptVersion: 1,
};

describe("LesionResultView", () => {
  it("shows the predicted class and top matches with confidences", () => {
    render(<LesionResultView analysis={analysis} explanation={explanation} />);
    expect(screen.getByRole("heading", { name: "MEL" })).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("NEV")).toBeInTheDocument();
  });

  it("shows the referral banner when recommended", () => {
    render(<LesionResultView analysis={analysis} explanation={explanation} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/see a professional/i);
  });

  it("always shows the disclaimer", () => {
    render(<LesionResultView analysis={analysis} explanation={explanation} />);
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
  });

  it("shows the offline banner for builtin explanations", () => {
    render(<LesionResultView analysis={analysis} explanation={{ ...explanation, source: "builtin" }} />);
    expect(screen.getByText(/built-in guidance/i)).toBeInTheDocument();
  });

  it("renders inconclusive headline when there is no prediction", () => {
    const inconclusive: LesionAnalysis = {
      ...analysis,
      lesions: [{ bbox: null, detectorConfidence: null, localizationConfidence: 0.2, segmented: false, classification: { predicted: null, confidence: 0, top: [] } }],
    };
    render(<LesionResultView analysis={inconclusive} explanation={explanation} />);
    expect(screen.getByRole("heading", { name: /inconclusive/i })).toBeInTheDocument();
  });

  it("does not show a referral banner when not recommended", () => {
    render(
      <LesionResultView
        analysis={analysis}
        explanation={{ ...explanation, referral: { recommended: false, urgency: "routine", reason: "n/a" } }}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a whole-photo caveat banner when the fallback was used", () => {
    render(<LesionResultView analysis={analysis} explanation={explanation} />);
    expect(screen.getByRole("status")).toHaveTextContent(/whole photo/i);
  });

  it("does not show the whole-photo caveat for a properly localized, high-confidence detection", () => {
    const localized: LesionAnalysis = {
      ...analysis,
      wholeImageFallback: false,
      lesions: [
        {
          bbox: [10, 10, 40, 40],
          detectorConfidence: 0.9,
          localizationConfidence: 0.9,
          segmented: true,
          classification: analysis.lesions[0].classification,
        },
      ],
    };
    render(<LesionResultView analysis={localized} explanation={explanation} />);
    expect(screen.queryByText(/whole photo/i)).toBeNull();
  });
});
