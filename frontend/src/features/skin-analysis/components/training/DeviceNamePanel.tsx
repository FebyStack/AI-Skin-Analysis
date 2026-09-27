import { useState } from "react";
import {
  DEVICE_NAME_MAX,
  currentPlatform,
  getDeviceName,
  setDeviceName,
} from "../capture/capture-info";

/**
 * Names this browser's device once ("Clinic iPad 1"). Every scan then records it next to
 * the auto-detected platform, camera and resolution, so accuracy can be compared per
 * device as clinic hardware changes. Stored on this device only — set it on each one.
 */
export function DeviceNamePanel() {
  const [saved, setSaved] = useState(getDeviceName);
  const [name, setName] = useState(saved);
  const [status, setStatus] = useState<"idle" | "saved" | "blocked">("idle");
  const dirty = name.trim() !== saved;

  function save() {
    if (!setDeviceName(name)) {
      setStatus("blocked");
      return;
    }
    setSaved(getDeviceName());
    setName(getDeviceName());
    setStatus("saved");
  }

  return (
    <section className="card p-5">
      <h3 className="text-base font-semibold text-ink">This device</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        Give each clinic phone or tablet its own name. Scans from it are tagged with the name, so model
        accuracy can be checked per device when cameras or rooms change. Only saved on this device.
      </p>
      <p className="mt-2 text-xs text-ink-secondary">
        Detected automatically: <span className="font-mono text-ink">{currentPlatform()}</span>
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="min-w-[12rem] flex-1 text-xs text-ink-secondary">
          Device name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setStatus("idle");
            }}
            maxLength={DEVICE_NAME_MAX}
            placeholder="e.g. Clinic iPad 1"
            className="field mt-1 w-full"
          />
        </label>
        <button type="submit" className="btn-primary px-4" disabled={!dirty}>
          Save
        </button>
      </form>

      <p className="mt-2 min-h-[1rem] text-xs" role="status" aria-live="polite">
        {status === "saved" && (
          <span className="text-ink-secondary">
            {saved ? `Saved — scans from this device are tagged "${saved}".` : "Name cleared."}
          </span>
        )}
        {status === "blocked" && (
          <span className="text-urgent">This browser blocks saving (private browsing?). Use a normal window.</span>
        )}
        {status === "idle" && !saved && <span className="text-ink-tertiary">Not named yet.</span>}
      </p>
    </section>
  );
}
