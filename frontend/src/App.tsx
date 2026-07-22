import { useEffect } from "react";
import { SkinAnalysisPage } from "@/features/skin-analysis/SkinAnalysisPage";
import { LoginScreen } from "@/features/skin-analysis/components/auth/LoginScreen";
import { useAuth } from "@/features/skin-analysis/hooks/use-auth";

export default function App() {
  const { status, error, checkSession, login } = useAuth();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (status === "unknown") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-canvas">
        <p className="text-sm text-ink-secondary">Checking session…</p>
      </main>
    );
  }

  if (status === "logged-out") {
    return <LoginScreen onLogin={login} error={error} />;
  }

  return <SkinAnalysisPage />;
}
