import { useEffect } from "react";
import { SkinAnalysisPage } from "@/features/skin-analysis/SkinAnalysisPage";
import { LoginScreen } from "@/features/skin-analysis/components/auth/LoginScreen";
import { InviteDeniedScreen } from "@/features/skin-analysis/components/auth/InviteDeniedScreen";
import { LoadingState } from "@/features/skin-analysis/components/ui/LoadingState";
import { Boundary } from "@/features/skin-analysis/components/ui/Boundary";
import { useAuth } from "@/features/skin-analysis/hooks/use-auth";

export default function App() {
  const { status, role, error, inviteError, checkSession, login } = useAuth();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (status === "unknown") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-canvas">
        <LoadingState label="Checking your session…" />
      </main>
    );
  }

  // A refused scan link gets its own page — never the staff password prompt.
  if (inviteError) {
    return <InviteDeniedScreen message={inviteError} />;
  }

  if (status === "logged-out") {
    return <LoginScreen onLogin={login} error={error} />;
  }

  // Last line of defence. Anything that throws below this shows a readable
  // screen with a way out — never a black one.
  return (
    <Boundary
      fallback={(failure) => (
        <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
          <h1 className="font-serif text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="max-w-sm text-sm leading-relaxed text-ink-secondary">
            Any scan you completed was already saved. Reload to carry on.
          </p>
          <button onClick={() => window.location.reload()} className="btn-primary px-6">
            Reload
          </button>
          {/* Shown so a fault on someone's phone can be reported without a
              console. Selectable — the point is that it can be sent on. */}
          <details className="mt-2 w-full max-w-sm text-left">
            <summary className="cursor-pointer text-xs text-ink-tertiary">Technical details</summary>
            <p className="mt-2 select-all break-words rounded-xl border border-hairline bg-surface p-3 font-mono text-[11px] leading-relaxed text-ink-tertiary">
              {failure.message}
              {failure.where && <><br /><br />{failure.where}</>}
            </p>
          </details>
        </main>
      )}
    >
      <SkinAnalysisPage role={role ?? "clinic"} />
    </Boundary>
  );
}
