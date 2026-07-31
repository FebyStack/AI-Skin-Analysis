import { useEffect } from "react";
import { SkinAnalysisPage } from "@/features/skin-analysis/SkinAnalysisPage";
import { LoginScreen } from "@/features/skin-analysis/components/auth/LoginScreen";
import { InviteDeniedScreen } from "@/features/skin-analysis/components/auth/InviteDeniedScreen";
import { LoadingState } from "@/features/skin-analysis/components/ui/LoadingState";
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

  return <SkinAnalysisPage role={role ?? "clinic"} />;
}
