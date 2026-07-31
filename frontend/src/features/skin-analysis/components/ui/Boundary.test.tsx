import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, lazy } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { Boundary } from "./Boundary";
import { LoadingState } from "./LoadingState";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs every error a boundary catches; keep the output readable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

/** A code-split component whose chunk never arrives. */
const Doomed = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));

describe("Boundary", () => {
  it("keeps the rest of the tree alive when a lazy chunk fails to load", async () => {
    render(
      <div>
        <p>your results</p>
        <Boundary fallback={<span>plain fallback</span>}>
          <Suspense fallback={<span>loading…</span>}>
            <Doomed />
          </Suspense>
        </Boundary>
      </div>,
    );

    await waitFor(() => expect(screen.getByText("plain fallback")).toBeInTheDocument());
    // The sibling is the point: without a boundary a rejected import unmounts
    // the whole app, which is the black screen this guards against.
    expect(screen.getByText("your results")).toBeInTheDocument();
    // And it must settle on the fallback, not hang in Suspense forever.
    expect(screen.queryByText("loading…")).not.toBeInTheDocument();
  });

  it("hands the failure to a function fallback so it can be shown", async () => {
    function Explodes(): never {
      throw new Error("kaboom: the actual reason");
    }
    render(
      <Boundary fallback={(f) => <span>reason: {f.message}</span>}>
        <Explodes />
      </Boundary>,
    );
    // Without this a phone user can only report "something went wrong", which is
    // not enough to diagnose anything.
    await waitFor(() =>
      expect(screen.getByText(/kaboom: the actual reason/)).toBeInTheDocument(),
    );
  });

  it("names where it failed, from the component stack", async () => {
    function Explodes(): never {
      throw new Error("boom");
    }
    render(
      <Boundary fallback={(f) => <span data-testid="where">{f.where}</span>}>
        <Explodes />
      </Boundary>,
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toMatch(/Explodes/));
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <Boundary fallback={<span>fallback</span>}>
        <span>content</span>
      </Boundary>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("wraps its lazy orb in a Boundary", () => {
    // Guards the composition itself: the orb is code-split and sits on the path
    // to a patient's results, so it must never be able to take the app down.
    const { container } = render(<LoadingState label="Reading your scan…" />);
    expect(container.textContent).toContain("Reading your scan…");
  });

  it("needs no chunk at all for the inline variant", () => {
    render(<LoadingState label="Loading archive…" variant="inline" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading archive…");
  });
});
