import React, { Component, lazy, type ReactNode } from "react";

/**
 * Catches render and lazy-chunk failures under it.
 *
 * `lazy()` + `Suspense` handles the WAITING but not the FAILING: if a dynamic
 * import rejects — a dropped chunk fetch on mobile, a stale cached shell
 * pointing at hashes that no longer exist — the component throws, and with no
 * boundary above it React unmounts the whole tree. The user gets a black screen
 * with no way back. That is exactly what happened after a scan: the orb's chunk
 * failed, and the report never rendered.
 *
 * Anything decorative that is code-split MUST sit under one of these.
 */
export interface BoundaryFailure {
  message: string;
  /** First frames of the component stack — enough to name the culprit. */
  where: string;
}

export class Boundary extends Component<
  {
    children: ReactNode;
    /** A node, or a function that receives the failure so it can be displayed. */
    fallback: ReactNode | ((failure: BoundaryFailure) => ReactNode);
    onError?: (err: unknown) => void;
  },
  { failure: BoundaryFailure | null }
> {
  state: { failure: BoundaryFailure | null } = { failure: null };

  static getDerivedStateFromError(err: unknown) {
    return {
      failure: {
        message: err instanceof Error ? err.message : String(err),
        where: "",
      },
    };
  }

  componentDidCatch(err: unknown, info: { componentStack?: string | null }) {
    console.error("Boundary caught:", err, info.componentStack);
    // A phone has no console. Carrying the top of the component stack into the
    // UI is the difference between "something went wrong" and a diagnosis.
    const where = (info.componentStack ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" ← ");
    this.setState((s) => ({ failure: s.failure ? { ...s.failure, where } : s.failure }));
    this.props.onError?.(err);
  }

  render() {
    const { failure } = this.state;
    if (!failure) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(failure) : fallback;
  }
}

/**
 * `lazy()` with one retry.
 *
 * A dynamic import that fails is cached as failed by the browser, so React will
 * not try again on re-render — one dropped packet permanently costs you the
 * chunk for that page load. Retrying once with a cache-busting query recovers
 * the common case: a blip on a phone pulling a chunk through a tunnel.
 *
 * The Boundary is still required. This makes success likelier; it does not make
 * failure survivable.
 */
// `any` matches React's own LazyExoticComponent constraint; narrowing it here
// would reject every component that takes props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends React.ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    load().catch(async (err) => {
      await new Promise((r) => setTimeout(r, 600));
      return load().catch(() => {
        throw err; // second failure — let the Boundary show the fallback
      });
    }),
  );
}
