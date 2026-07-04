import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentGate } from "./ConsentGate";

describe("ConsentGate", () => {
  beforeEach(() => localStorage.clear());

  it("shows the privacy explainer and blocks until accepted", async () => {
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept}>protected</ConsentGate>);
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /i understand/i }));
    expect(onAccept).toHaveBeenCalled();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
});
