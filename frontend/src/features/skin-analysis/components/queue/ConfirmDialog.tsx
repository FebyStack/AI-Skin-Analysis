import { useEffect, useRef } from "react";

/** Modal confirmation for destructive actions. Escape / backdrop cancels. */
export function ConfirmDialog({
  title,
  body,
  warning,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  warning?: string | null;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-sm p-5"
      >
        <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{body}</p>
        {warning && (
          <p className="mt-3 rounded-xl border border-soon-edge bg-soon-surface p-3 text-xs leading-relaxed text-soon">
            {warning}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary px-4">Cancel</button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="min-h-[40px] rounded-lg bg-urgent px-4 text-sm font-semibold text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
