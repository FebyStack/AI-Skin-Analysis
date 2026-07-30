import { Wordmark } from "../brand/Wordmark";

/**
 * Shown when a scan link is refused — forwarded to a second device, expired,
 * revoked, or used up.
 *
 * The patient used to land on the clinician password prompt with an error above
 * it, which reads as "you typed something wrong" and advertises the staff login
 * to whoever is holding a stale link. There is no password field here on
 * purpose: the only real next step is to ask the clinic for a new link.
 */
export function InviteDeniedScreen({ message }: { message: string }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-canvas px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/[0.05] blur-3xl"
      />
      <div className="grain" aria-hidden />

      <div className="relative w-full max-w-sm animate-reveal text-center">
        <div className="flex justify-center">
          <Wordmark size="sm" />
        </div>

        <div className="mt-8 rounded-[2rem] border border-hairline bg-white/[0.03] p-2">
          <div className="rounded-[1.5rem] bg-surface/60 p-6">
            <h1 className="font-serif text-[1.375rem] font-semibold leading-tight tracking-tight text-ink">
              This link can’t be used
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{message}</p>
            <p className="mt-4 border-t border-hairline pt-4 text-xs leading-relaxed text-ink-tertiary">
              Scan links are personal and work on one device. Contact the clinic and they can send
              you a new one.
            </p>
          </div>
        </div>

        <p className="mt-6 text-xs text-ink-tertiary">Guidance only — not a diagnosis.</p>
      </div>
    </main>
  );
}
