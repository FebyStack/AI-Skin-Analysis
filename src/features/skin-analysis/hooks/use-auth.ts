import { useState, useCallback } from "react";

export type AuthStatus = "unknown" | "logged-in" | "logged-out";

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("unknown");
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { authenticated: boolean };
        setStatus(data.authenticated ? "logged-in" : "logged-out");
      } else {
        setStatus("logged-out");
      }
    } catch {
      setStatus("logged-out");
    }
  }, []);

  const login = useCallback(async (password: string) => {
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setStatus("logged-in");
        return true;
      }
      setError("Invalid password");
      return false;
    } catch (err) {
      console.error("Login request failed:", err);
      setError("Cannot reach the server. Is it running?");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    // Clear the cookie by overwriting it with an expired one
    document.cookie = "session=; Path=/; Max-Age=0";
    setStatus("logged-out");
  }, []);

  return { status, error, checkSession, login, logout };
}
