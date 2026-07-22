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
    <div className="card mx-auto max-w-md animate-rise p-6">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Before we scan</h2>
      <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-ink-secondary marker:text-gold [&>li]:list-disc [&>li]:ml-4">
        <li>Your photo is analyzed on your device; only an opt-in copy is sent to the AI service over a secure connection, and it is never stored.</li>
        <li>History, if you save it, stays on this device only.</li>
        <li><strong className="font-semibold text-ink">This is not a diagnosis.</strong> It helps you decide whether to see a professional.</li>
      </ul>
      <button onClick={accept} className="btn-primary mt-5 w-full">
        I understand — continue
      </button>
    </div>
  );
}
