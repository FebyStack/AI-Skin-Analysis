import { useState, type FormEvent } from "react";
import { Wordmark } from "../brand/Wordmark";

/**
 * The one marketing surface in an otherwise clinical tool, so it gets the full
 * editorial treatment the dense review screens deliberately don't:
 *
 *   Vibe   — Editorial Luxury × Ethereal Glass. Ambient champagne mesh over the
 *            OLED canvas, film grain to kill digital flatness, Didone display
 *            type. All drawn from the existing brand, not imported.
 *   Layout — Editorial Split: brand statement left, auth right; collapses to a
 *            single centred column below md.
 *   Craft  — Double-bezel card (outer tray + inner plate, concentric radii),
 *            button-in-button CTA, staggered blur-resolve entry.
 *
 * Texture layers are fixed + pointer-events-none so they never repaint with
 * content, and every animation is transform/opacity/filter on a handful of
 * nodes. The global prefers-reduced-motion rule flattens all of it.
 */
export function LoginScreen({
  onLogin,
  error,
}: {
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    await onLogin(password);
    setLoading(false);
  };

  const disabled = loading || password.length < 8;

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-canvas">
      {/* Ambient champagne mesh — radial, never a flat 45° fade. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -left-[15%] top-[-10%] h-[38rem] w-[38rem] animate-drift rounded-full bg-[radial-gradient(circle,rgba(201,162,75,0.16),transparent_66%)] blur-3xl" />
        <div
          className="absolute -right-[12%] bottom-[-18%] h-[34rem] w-[34rem] animate-drift rounded-full bg-[radial-gradient(circle,rgba(228,195,107,0.10),transparent_68%)] blur-3xl"
          style={{ animationDelay: "-9s" }}
        />
      </div>
      {/* Film grain */}
      <div aria-hidden className="grain pointer-events-none fixed inset-0 opacity-[0.05] mix-blend-overlay" />

      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-6xl items-center gap-10 px-6 py-12 md:grid-cols-[1.05fr_minmax(0,26rem)] md:gap-20 md:py-28">
        {/* ---------- Editorial half ---------- */}
        <section className="animate-reveal text-center md:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-surface/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-ink-secondary">
            <span className="h-1 w-1 rounded-full bg-gold" />
            Clinician access
          </span>

          <h1 className="mt-5 font-serif text-[clamp(2rem,7vw,4.6rem)] md:mt-7 font-semibold leading-[0.95] tracking-[-0.02em] text-ink [text-wrap:balance]">
            Skin analysis,
            <span className="block text-gold-gradient">measured not guessed.</span>
          </h1>

          <p className="mx-auto mt-6 hidden max-w-[46ch] text-[0.95rem] leading-relaxed text-ink-secondary md:mx-0 md:block">
            On-device analysis across eleven facial dimensions, reviewed by a clinician
            before it ever trains a model. Nothing leaves this machine unless you say so.
          </p>

          <div className="mt-10 hidden md:block">
            <Wordmark size="lg" />
          </div>
        </section>

        {/* ---------- Auth half: double-bezel card ---------- */}
        <section
          className="animate-reveal w-full max-w-sm justify-self-center md:justify-self-end"
          style={{ animationDelay: "140ms" }}
        >
          <div className="mb-6 flex justify-center md:hidden">
            <Wordmark size="sm" />
          </div>

          {/* Outer tray */}
          <div className="rounded-[2rem] border border-hairline bg-white/[0.04] p-2 shadow-card">
            {/* Inner plate — concentric radius: 2rem − 0.5rem tray padding */}
            <form
              onSubmit={handleSubmit}
              className="space-y-5 rounded-[1.5rem] bg-surface p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
              <div>
                <h2 className="font-serif text-[1.35rem] font-semibold tracking-tight text-ink">
                  Sign in
                </h2>
                <p className="mt-1 text-[0.8125rem] text-ink-secondary">
                  Enter the clinic password to continue.
                </p>
              </div>

              {error && (
                <p
                  className="rounded-xl border border-urgent-edge bg-urgent-surface p-3 text-sm text-urgent"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="field-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  minLength={8}
                  placeholder="Clinic password"
                  className="field"
                />
              </label>

              {/* Button-in-button: the arrow lives in its own circle, flush right,
                  and gains kinetic tension on hover. */}
              <button
                type="submit"
                disabled={disabled}
                className="group btn-primary w-full justify-between rounded-full py-3 pl-6 pr-2"
              >
                <span>{loading ? "Signing in…" : "Sign in"}</span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-gold-ink/10 transition-transform duration-500 ease-spring group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105">
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </button>

              <p className="text-[0.75rem] leading-relaxed text-ink-tertiary">
                First sign-in sets the password for this device.
              </p>
            </form>
          </div>

          <p className="mt-6 text-center text-[0.75rem] text-ink-tertiary md:text-right">
            Guidance only — not a diagnosis.
          </p>
        </section>
      </div>
    </main>
  );
}
