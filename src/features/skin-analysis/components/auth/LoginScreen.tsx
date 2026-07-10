import { useState, type FormEvent } from "react";

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
    <main className="flex min-h-screen items-center justify-center bg-warm-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-warm-border bg-warm-surface p-8 shadow-lg"
      >
        <div className="text-center">
          <h1 className="text-xl font-bold text-stone-900">AI Skin Analysis</h1>
          <p className="mt-1 text-sm text-stone-500">Enter the clinic password to continue</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-center text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            minLength={8}
            placeholder="Clinic password"
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-clinical focus:ring-2 focus:ring-clinical/30"
          />
        </label>

        <button
          type="submit"
          disabled={loading || password.length < 8}
          className="w-full rounded-lg bg-clinical py-2.5 text-sm font-semibold text-white transition hover:bg-clinical/90 disabled:opacity-40"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-xs text-stone-400">
          First login sets the password for this device.
        </p>
      </form>
    </main>
  );
}
