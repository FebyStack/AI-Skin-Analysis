import { useState, type ReactNode } from "react";
import { hasValidConsent, recordConsent } from "../../privacy/consent";

export function ConsentGate({
  children,
  onAccept,
}: {
  children: ReactNode;
  onAccept?: () => void;
}) {
  const [accepted, setAccepted] = useState(hasValidConsent());

  if (accepted) return <>{children}</>;

  const accept = () => {
    recordConsent();
    setAccepted(true);
    onAccept?.();
  };

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-warm-border bg-warm-surface p-5">
      <h2 className="text-lg font-bold text-stone-900">Before we scan</h2>
      <ul className="mt-3 space-y-2 text-sm text-stone-600">
        <li>Your photo is analyzed on your device; only an opt-in copy is sent to the AI service over a secure connection, and it is never stored.</li>
        <li>History, if you save it, stays on this device only.</li>
        <li><strong>This is not a diagnosis.</strong> It helps you decide whether to see a professional.</li>
      </ul>
      <button
        onClick={accept}
        className="mt-4 w-full rounded-lg bg-clinical py-3 text-sm font-semibold text-white"
      >
        I understand — continue
      </button>
    </div>
  );
}
