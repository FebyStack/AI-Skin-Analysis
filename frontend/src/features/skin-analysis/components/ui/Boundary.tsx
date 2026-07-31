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
export class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError?: (err: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("Boundary caught:", err);
    this.props.onError?.(err);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
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
