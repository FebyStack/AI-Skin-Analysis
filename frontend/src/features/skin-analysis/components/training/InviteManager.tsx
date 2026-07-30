import { useCallback, useEffect, useState } from "react";
import {
  CLAIM_WINDOW_MINUTES,
  DEFAULT_MAX_SCANS,
  DEFAULT_TTL_MINUTES,
  INVITE_STATE_LABEL,
  inviteUrl,
  isUsable,
  type Invite,
  type InviteState,
} from "@shared/invites";

type Row = Omit<Invite, "token" | "claimId"> & { state: InviteState; scansLeft: number };

/**
 * Links are built from the origin this page was opened on. Creating one from
 * localhost or a LAN address produces a URL that only resolves on this network —
 * it looks fine, sends fine, and fails for the patient. Worth interrupting for.
 */
function reachOnlyLocally(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
    origin,
  );
}

/** Whole minutes remaining, floored — never rounds up into a promise it can't keep. */
function minsLeft(at: number): string {
  const mins = Math.floor((at - Date.now()) / 60_000);
  return mins <= 0 ? "<1 min left" : `${mins} min left`;
}

const TONE: Record<InviteState, string> = {
  unopened: "text-gold",
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
  const localOnly = typeof window !== "undefined" && reachOnlyLocally(window.location.origin);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [label, setLabel] = useState("");
  const [maxScans, setMaxScans] = useState(DEFAULT_MAX_SCANS);
  const [ttl, setTtl] = useState(DEFAULT_TTL_MINUTES);
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
        body: JSON.stringify({ label, maxScans, ttlMinutes: ttl }),
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
        For patients who are not on the clinic network. A link opens on ONE device — the first to
        open it — so forwarding it does not work. It runs the scan flow and nothing else: no
        history, no queue, no other patients.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        It must be opened within the window below, and once opened that device has{" "}
        {CLAIM_WINDOW_MINUTES} minutes to finish its scans.
      </p>

      {localOnly && (
        <p className="mt-3 rounded-xl border border-soon-edge bg-soon-surface p-3 text-xs leading-relaxed text-soon">
          You opened this page on <span className="font-mono">{window.location.origin}</span>, which
          only works on this network. A link made here will not open for a remote patient — start{" "}
          <span className="font-mono">make share</span> and create the link from the public
          address instead.
        </p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto] sm:items-end">
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
        <label className="text-xs text-ink-secondary">
          Opens within
          <select
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            className="field-select mt-1 w-full"
          >
            <option value={15}>15 min</option>
            <option value={60}>1 hour</option>
            <option value={1440}>1 day</option>
          </select>
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
          <p className="mt-1 text-[11px] text-ink-secondary">
            Works on the first device that opens it. Send it to one person only.
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
            {r.expiresAt !== null && (r.state === "unopened" || r.state === "active") && (
              <span className="text-[11px] tabular-nums text-ink-tertiary">{minsLeft(r.expiresAt)}</span>
            )}
            <span className={`text-[11px] ${TONE[r.state]}`}>{INVITE_STATE_LABEL[r.state]}</span>
            {isUsable(r.state) && (
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
