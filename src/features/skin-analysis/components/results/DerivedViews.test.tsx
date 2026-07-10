import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DerivedViews, DERIVED_LABELS } from "./DerivedViews";

describe("DerivedViews", () => {
  it("labels every view and states they are derived, not spectral", () => {
    render(<DerivedViews blob={new Blob(["x"], { type: "image/jpeg" })} />);
    for (const label of Object.values(DERIVED_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/derived from the visible-light photo/i)).toBeInTheDocument();
  });
});
