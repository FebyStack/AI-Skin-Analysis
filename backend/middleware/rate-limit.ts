import type { NextFunction, Request, Response } from "express";

/**
 * Failure throttling for the unauthenticated endpoints.
 *
 * This became necessary the moment the app went on a public tunnel URL: the
 * shared clinic password is the only thing between the internet and the whole
 * record set, and until now it could be guessed without limit.
 *
 * Only FAILED attempts count, and a success clears the key — so a clinician who
 * knows the password is never locked out, while a guesser gets a handful of
 * tries per window.
 *
 * In-memory and therefore per-process: it resets on restart and does not span
 * multiple instances. That matches how this app is deployed (one process per
 * clinic) and is vastly better than nothing; a shared store is the upgrade path
 * if it ever runs replicated.
 */
export interface RateLimitOptions {
  /** Failures allowed inside the window before refusing. */
  max: number;
  windowMs: number;
}

interface Bucket {
  failures: number;
  /** When the window started, so it can roll rather than reset on a fixed clock. */
  since: number;
}

/**
 * Caller identity.
 *
 * Behind a tunnel every request arrives from localhost, so `req.ip` alone would
 * throttle the whole world as one bucket. Cloudflare sets `cf-connecting-ip`,
 * which is the reliable value when the app is reached through `make share`.
 * These headers ARE spoofable by anyone talking to the tunnel directly, so this
 * raises the cost of brute force rather than making it impossible — the real
 * defence is a long password.
 */
function callerKey(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

export interface FailureLimiter {
  /** Refuses with 429 when the key is over its budget. */
  guard: (req: Request, res: Response, next: NextFunction) => void;
  /** Call after a rejected attempt. */
  fail: (req: Request) => void;
  /** Call after an accepted attempt — clears the key. */
  succeed: (req: Request) => void;
}

export function createFailureLimiter(
  opts: RateLimitOptions,
  now: () => number = Date.now,
): FailureLimiter {
  const buckets = new Map<string, Bucket>();

  const current = (key: string): Bucket | undefined => {
    const b = buckets.get(key);
    if (!b) return undefined;
    if (now() - b.since >= opts.windowMs) {
      buckets.delete(key);
      return undefined;
    }
    return b;
  };

  return {
    guard(req, res, next) {
      // Opportunistic sweep so abandoned keys cannot grow without bound.
      if (buckets.size > 5_000) {
        for (const [k] of buckets) if (!current(k)) buckets.delete(k);
      }
      const b = current(callerKey(req));
      if (b && b.failures >= opts.max) {
        const retryMs = opts.windowMs - (now() - b.since);
        res.setHeader("Retry-After", String(Math.ceil(retryMs / 1000)));
        res.status(429).json({ error: "Too many attempts. Try again shortly." });
        return;
      }
      next();
    },

    fail(req) {
      const key = callerKey(req);
      const b = current(key);
      if (b) b.failures += 1;
      else buckets.set(key, { failures: 1, since: now() });
    },

    succeed(req) {
      buckets.delete(callerKey(req));
    },
  };
}
