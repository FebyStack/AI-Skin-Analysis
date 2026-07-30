import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The scan is already saved by the time the report renders, so a render crash
 * must not read as "the scan is gone". Without this, a throw unmounts the tree
 * and the patient is looking at a black screen with no idea the visit was
 * recorded — and no error text to report back.
 */
export class ReportBoundary extends Component<
  { children: ReactNode; onViewHistory?: () => void },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("Report render failed:", err, info.componentStack);
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6 text-center">
        <h2 className="text-[1.0625rem] font-semibold text-ink">
          Your scan was saved, but this page could not be drawn
        </h2>
        <p className="text-sm text-ink-secondary">
          Nothing was lost — open your scan history to see the result.
        </p>
        <p className="rounded-xl border border-hairline bg-surface p-3 text-left font-mono text-[11px] text-ink-tertiary">
          {this.state.message}
        </p>
        {this.props.onViewHistory && (
          <button onClick={this.props.onViewHistory} className="btn-primary px-5">
            View scan history
          </button>
        )}
      </div>
    );
  }
}
