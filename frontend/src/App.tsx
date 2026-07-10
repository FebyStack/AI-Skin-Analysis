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
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-stone-400">Checking session…</p>
      </main>
    );
  }

  if (status === "logged-out") {
    return <LoginScreen onLogin={login} error={error} />;
  }

  return <SkinAnalysisPage />;
}
