import { randomBytes } from "node:crypto";

export interface PendingCapture {
  image: string; // base64
  mime: string;
  mode: "face" | "closeup";
}

const TTL_MS = 5 * 60 * 1000;

interface Session {
  createdAt: number;
  capture: PendingCapture | null;
  used: boolean;
}

// In-memory is correct here (not a prototype shortcut): sessions are
// ephemeral pairing state, meaningless across api restarts.
export class CaptureSessionStore {
  private sessions = new Map<string, Session>();
  constructor(private now: () => number) {}

  create(): { token: string } {
    const token = randomBytes(16).toString("hex");
    this.sessions.set(token, { createdAt: this.now(), capture: null, used: false });
    return { token };
  }

  submit(token: string, capture: PendingCapture): boolean {
    const s = this.sessions.get(token);
    if (!s || s.used || this.now() - s.createdAt > TTL_MS) return false;
    s.capture = capture;
    s.used = true;
    return true;
  }

  take(token: string): PendingCapture | null {
    const s = this.sessions.get(token);
    if (!s?.capture) return null;
    const capture = s.capture;
    this.sessions.delete(token);
    return capture;
  }
}
