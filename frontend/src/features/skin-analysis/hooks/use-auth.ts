import { useState, useCallback } from "react";

export type AuthStatus = "unknown" | "logged-in" | "logged-out";
/** "invite" sessions came from a private scan link and see only the scan flow. */
export type SessionRole = "clinic" | "invite";

function inviteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("invite");
}

/** Drop the token from the address bar so it is not left in history, bookmarks
 *  or a shared screenshot. Only after it has been exchanged. */
function stripInviteToken(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("invite")) return;
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.toString());
}

/**
 * The redemption, shared across callers.
 *
 * StrictMode invokes mount effects twice. The first attempt used to strip the
 * token from the URL immediately, so the second pass saw no token and raced a
 * plain /api/auth/status against the still-in-flight exchange — the status call
 * went out before the session cookie landed and reported logged-out, dropping
 * the patient on the password screen. Caching the promise makes the second pass
 * await the same exchange instead of starting a competing one.
 */
let redemption: { token: string; res: Promise<Response> } | null = null;

function redeemInvite(token: string): Promise<Response> {
  // Keyed by token: caching only the promise meant a second, different link
  // pasted in the same page session got the FIRST link's stale result.
  if (redemption?.token !== token) {
    redemption = {
      token,
      res: fetch("/api/auth/invite", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    };
  }
  return redemption.res;
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("unknown");
  const [role, setRole] = useState<SessionRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A link that was refused. Kept apart from `error` so the app can show the
  // patient why their link failed instead of a clinician password prompt.
  const [inviteError, setInviteError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    // A link in the URL wins over any session already in the browser, so a
    // clinician can open a patient's link without their own login shadowing it.
    const token = inviteTokenFromUrl();
    if (token) {
      try {
        const res = await redeemInvite(token);
        if (res.ok) {
          stripInviteToken();
          setRole("invite");
          setStatus("logged-in");
          return;
        }
        const body = await res.clone().json().catch(() => ({}));
        stripInviteToken();
        setInviteError(body.error ?? "This link is not valid.");
        setStatus("logged-out");
        return;
      } catch {
        setInviteError("Cannot reach the server. Check your connection and reopen the link.");
        setStatus("logged-out");
        return;
      }
    }

    try {
      const res = await fetch("/api/auth/status", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { authenticated: boolean; role: SessionRole | null };
        setRole(data.role);
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
        setRole("clinic");
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

  const logout = useCallback(async () => {
    // Must go through the server: the cookie is HttpOnly, so assigning to
    // document.cookie cannot remove it and the session would stay live.
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(
      () => undefined,
    );
    redemption = null;
    setRole(null);
    setInviteError(null);
    setStatus("logged-out");
  }, []);

  return { status, role, error, inviteError, checkSession, login, logout };
}
