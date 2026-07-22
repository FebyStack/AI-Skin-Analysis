import { useState, type FormEvent } from "react";
import { Wordmark } from "../brand/Wordmark";

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

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex justify-center">
          <Wordmark size="lg" />
        </div>

        <form onSubmit={handleSubmit} className="card space-y-5 p-8">
          <div className="text-center">
            <h1 className="text-[1.0625rem] font-semibold text-ink">Clinician sign-in</h1>
            <p className="mt-1 text-[0.8125rem] text-ink-secondary">
              Enter the clinic password to continue
            </p>
          </div>

          {error && (
            <p
              className="rounded-xl border border-urgent-edge bg-urgent-surface p-3 text-center text-sm text-urgent"
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

          <button type="submit" disabled={loading || password.length < 8} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p className="text-center text-xs text-ink-tertiary">
            First login sets the password for this device.
          </p>
        </form>
      </div>
    </main>
  );
}
