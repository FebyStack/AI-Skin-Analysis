import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MarkSpots } from "./MarkSpots";

const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect;

describe("MarkSpots", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method === "PUT" ? { ok: true, count: 1 } : { angles: [{ angle: "front", manualMarks: [] }] }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds a point where tapped and saves it", async () => {
    render(<MarkSpots scanId="s1" angle="front" src="f.jpg" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 marked"));
    const surface = screen.getByTestId("mark-surface");
    surface.getBoundingClientRect = () => rect;
    fireEvent.click(surface, { clientX: 50, clientY: 50 });
    expect(screen.getByRole("status").textContent).toBe("1 marked");
    fireEvent.click(screen.getByRole("button", { name: "Save marks" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved 1 spot."));
    const put = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ points: [{ kind: "acne", x: 0.25, y: 0.5 }] });
  });

  it("removes a point when tapped again", async () => {
    render(<MarkSpots scanId="s1" angle="front" src="f.jpg" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 marked"));
    const surface = screen.getByTestId("mark-surface");
    surface.getBoundingClientRect = () => rect;
    fireEvent.click(surface, { clientX: 50, clientY: 50 });
    fireEvent.click(surface, { clientX: 51, clientY: 50 });
    expect(screen.getByRole("status").textContent).toBe("0 marked");
  });
});
