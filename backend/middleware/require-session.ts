import type { NextFunction, Request, Response } from "express";
import { isValidSession, parseCookies } from "../modules/auth/service";

export function requireSession(secret: string, now: () => number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)["session"];
    if (!isValidSession(token, secret, now())) {
      res.status(401).json({ error: "login required" });
      return;
    }
    next();
  };
}
