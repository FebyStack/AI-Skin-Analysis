import { useCallback, useEffect, useState } from "react";
import type { InviteState } from "@shared/invites";

export interface InviteAllowance {
  scansLeft: number;
  maxScans: number;
  state: InviteState;
}

/**
 * How many scans the current invite link has left. Display only — the server
 * spends the allowance when a scan is saved and refuses the request once it runs
 * out, so this can lag without letting anyone past the limit.
 */
export function useInviteAllowance(enabled: boolean) {
  const [allowance, setAllowance] = useState<InviteAllowance | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/auth/invite-status", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as { invite: InviteAllowance | null };
      setAllowance(body.invite);
    } catch {
      /* offline — leave the last known value */
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { allowance, refresh };
}
