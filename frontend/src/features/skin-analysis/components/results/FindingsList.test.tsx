import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingsList } from "./FindingsList";
import type { MergedFinding } from "../../types";

const base: Omit<MergedFinding, "id" | "agreement" | "escalated"> = {
  label: "Mild acne",
  source: "llm",
  confidence: 0.7,
  severity: "mild",
};

describe("FindingsList", () => {
  it("shows an agreement badge when both AIs agree", () => {
    render(
      <FindingsList
        findings={[{ ...base, id: "acne", agreement: "agree", escalated: false }]}
      />,
    );
    expect(screen.getByText(/2 analyses agree/i)).toBeInTheDocument();
  });

  it("shows single-source badges", () => {
    render(
      <FindingsList
        findings={[
          { ...base, id: "a", agreement: "llm-only", escalated: false },
          { ...base, id: "b", agreement: "classifier-only", escalated: false },
        ]}
      />,
    );
    expect(screen.getByText(/AI analysis only/i)).toBeInTheDocument();
    expect(screen.getByText(/flagged by classifier/i)).toBeInTheDocument();
  });

  it("marks escalated findings with the professional-referral row style", () => {
    render(
      <FindingsList
        findings={[
          { ...base, id: "l", severity: "attention", agreement: "agree", escalated: true },
        ]}
      />,
    );
    expect(screen.getByText(/worth a professional look/i)).toBeInTheDocument();
  });
});
