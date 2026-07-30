import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_MAX_SCANS,
  DEFAULT_TTL_DAYS,
  INVITE_STATE_LABEL,
  inviteUrl,
  type Invite,
  type InviteState,
} from "@shared/invites";

type Row = Omit<Invite, "token"> & { state: InviteState; scansLeft: number };

const TONE: Record<InviteState, string> = {
  active: "text-ok",
  exhausted: "text-ink-tertiary",
  expired: "text-ink-tertiary",
  revoked: "text-urgent",
};

/**
 * Create and revoke private scan links for patients who are not on the clinic's
 * network. The token is shown ONCE, at creation — it is not stored anywhere
 * retrievable, so a lost link has to be replaced rather than looked up.
 */
export function InviteManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [label, setLabel] = useState("");
  const [maxScans, setMaxScans] = useState(DEFAULT_MAX_SCANS);
  const [fresh, setFresh] = useState<{ url: string; label: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invites", { credentials: "include" });
      setRows(res.ok ? ((await res.json()).invites as Row[]) : []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setMsg("");
    setCopied(false);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, maxScans, ttlDays: DEFAULT_TTL_DAYS }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg(body.error ?? "Could not create the link.");
        return;
      }
      // window.location.origin is whatever host the clinic is reachable on —
      // localhost, the LAN IP, or a tunnel hostname — so the link works wherever
      // this page was opened from.
      setFresh({ url: inviteUrl(window.location.origin, body.token), label: label || null });
      setLabel("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/invites/${id}/revoke`, { method: "POST", credentials: "include" });
    await load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      setMsg("Could not copy — select the link and copy it manually.");
    }
  };

  return (
    <section className="card p-5">
      <h3 className="text-base font-semibold text-ink">Private scan links</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        For patients who are not on the clinic network. A link runs the scan flow and nothing else —
        no history, no queue, no other patients — and stops working once its scans are used.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
        <label className="text-xs text-ink-secondary">
          Who it's for
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Ana Beltran, follow-up"
            className="field mt-1 w-full"
          />
        </label>
        <label className="text-xs text-ink-secondary">
          Scans
          <input
            type="number"
            min={1}
            max={50}
            value={maxScans}
            onChange={(e) => setMaxScans(Number(e.target.value))}
            className="field mt-1 w-full tabular-nums"
          />
        </label>
        <button onClick={create} disabled={busy} className="btn-primary px-4">
          Create link
        </button>
      </div>

      {fresh && (
        <div className="mt-4 rounded-xl border border-gold/40 bg-gold/[0.06] p-3">
          <p className="text-xs font-medium text-gold-bright">
            Copy this now — it is not shown again.
          </p>
          <p className="mt-2 break-all font-mono text-[11px] text-ink">{fresh.url}</p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={copy} className="btn-secondary min-h-[32px] px-3 text-xs">
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              onClick={() => setFresh(null)}
              className="min-h-[32px] px-2 text-xs text-ink-tertiary hover:text-ink"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {msg && <p className="mt-3 text-xs text-urgent">{msg}</p>}

      <ul className="mt-4 space-y-2">
        {rows === null && <li className="text-xs text-ink-tertiary">Loading…</li>}
        {rows?.length === 0 && <li className="text-xs text-ink-tertiary">No links yet.</li>}
        {rows?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {r.label ?? "Unlabelled link"}
            </span>
            <span className="text-[11px] tabular-nums text-ink-tertiary">
              {r.usedScans}/{r.maxScans} used
            </span>
            <span className={`text-[11px] ${TONE[r.state]}`}>{INVITE_STATE_LABEL[r.state]}</span>
            {r.state === "active" && (
              <button
                onClick={() => revoke(r.id)}
                className="min-h-[28px] rounded-lg border border-urgent-edge bg-urgent-surface px-2 text-[11px] font-medium text-urgent"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
