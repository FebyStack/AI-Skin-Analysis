import { Router, type Request, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { validateFaceReport, type CaptureInfo, type FaceReport } from "../../../shared/face";
import { builtinFaceExplanation } from "../../../ai/llm/fallback/face-education";
import { compressToJpeg } from "../../utils/image";
import { dHash } from "../../utils/image-hash";
import { resolveScanPatient } from "../patients/resolve";
import { inviteDeniedMessage, inviteState } from "../../../shared/invites";

interface IncomingImage {
  angle?: string;
  image?: string;
  mime?: string;
  quality?: { ok?: boolean; issues?: string[] };
  capture?: unknown;
}

/** Keep only the five known fields, bounded — the body is client-controlled. */
export function parseCapture(raw: unknown): CaptureInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
  const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 20000 ? (v as number) : 0);
  return { device: str(c.device), platform: str(c.platform), camera: str(c.camera), width: int(c.width), height: int(c.height) };
}

const VALID_ANGLES = new Set(["front", "left-45", "right-45", "left-profile", "right-profile", "forehead", "chin"]);

// Operator toggle: keep the offline builtin explanation even when Gemini is
// configured (privacy / no-cloud preference). Set PREFER_BUILTIN_EXPLANATION=1.
function preferBuiltin(): boolean {
  const v = process.env.PREFER_BUILTIN_EXPLANATION;
  return v === "1" || v === "true";
}

/**
 * Clinic staff see every scan; an invite link sees only what it created. 404
 * rather than 403 on a mismatch — a link holder should not be able to probe
 * which scan ids exist.
 */
function ownedBySession(req: Request, scan: { inviteId?: string | null }): boolean {
  if (req.session?.role !== "invite") return true;
  return scan.inviteId === req.session.inviteId;
}

export function createFaceScanRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  // Persist a completed face scan (client-computed report + captured angle images).
  // Server re-validates the report before saving and re-checks safety invariants.
  router.post("/api/face-scans", auth, async (req, res) => {
    const { report: reportBody, images, patientId, consent } = req.body ?? {};

    // Server never trusts the client — re-run the contract validator.
    const validated = validateFaceReport(reportBody);
    if (!validated.ok) {
      res.status(400).json({ error: "invalid report", details: validated.errors });
      return;
    }
    let report: FaceReport = validated.report;

    if (typeof report.disclaimer !== "string" || report.disclaimer.length === 0) {
      res.status(400).json({ error: "invalid report", details: ["disclaimer required"] });
      return;
    }
    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: "at least one image is required" });
      return;
    }
    for (const img of images) {
      if (!VALID_ANGLES.has(String((img as IncomingImage).angle))) {
        res.status(400).json({ error: `invalid angle: ${(img as IncomingImage).angle}` });
        return;
      }
      if (typeof (img as IncomingImage).image !== "string" || !(img as IncomingImage).image!.length) {
        res.status(400).json({ error: "each image needs a base64 body" });
        return;
      }
    }

    // Save-first: attach the builtin explanation immediately so a failing Gemini
    // call can never invalidate the persisted scan.
    if (!report.explanation) {
      report = { ...report, explanation: builtinFaceExplanation(report) };
    }

    const patient = await resolveScanPatient(deps, patientId);
    if (!patient) {
      res.status(404).json({ error: "patient not found" });
      return;
    }

    // Spend the invite's scan allowance BEFORE writing anything. Doing it after
    // would let a crash mid-save hand back a free scan, and doing it in the UI
    // would not survive someone calling this endpoint directly.
    const inviteId = req.session?.role === "invite" ? req.session.inviteId : null;
    if (inviteId) {
      const spent = await deps.invites?.consume(inviteId);
      if (!spent) {
        const current = await deps.invites?.get(inviteId);
        const state = current ? inviteState(current, deps.now()) : "revoked";
        res.status(403).json({ error: inviteDeniedMessage(state), inviteState: state });
        return;
      }
      res.setHeader("x-scans-left", String(Math.max(0, spent.maxScans - spent.usedScans)));
    }

    // Compress the front angle (or first available) as the scan's headline image.
    const front =
      (images as IncomingImage[]).find((i) => i.angle === "front") ?? (images as IncomingImage[])[0];
    const compressedFront = await compressToJpeg(Buffer.from(String(front.image), "base64"));

    const scan = await deps.scans.create({
      patientId: patient.id,
      mode: "face",
      imageJpeg: compressedFront.jpeg,
      imageWidth: compressedFront.width,
      imageHeight: compressedFront.height,
      report,
      partial: false,
      classifierFindings: [],
      promptVersion: report.explanation?.promptVersion ?? null,
      inviteId,
    });

    // Compress and persist every angle.
    const scanImages = [];
    for (const img of images as IncomingImage[]) {
      const compressed = await compressToJpeg(Buffer.from(String(img.image), "base64"));
      scanImages.push({
        angle: String(img.angle),
        imageJpeg: compressed.jpeg,
        imageWidth: compressed.width,
        imageHeight: compressed.height,
        quality: img.quality ?? {},
        capture: parseCapture(img.capture),
      });
    }
    await deps.scans.addImages(scan.id, scanImages);

    // Two independent consents travel with the scan. Absent (older clients) is
    // treated as "analysis yes, training no" — never assume training consent.
    const scanConsent = {
      analysis: consent?.analysis !== false,
      training: consent?.training === true,
    };
    await deps.scans.setConsent(scan.id, scanConsent).catch(() => undefined);
    // Opening entries of the lifecycle timeline.
    await deps.scans.recordEvent(scan.id, "captured", { angles: images.length }).catch(() => undefined);
    if (report) {
      await deps.scans
        .recordEvent(scan.id, "analyzed", { model: report.modelVersions?.acne ?? null })
        .catch(() => undefined);
    }

    // ONLY training-consented scans enter the Training Queue. Without consent the
    // scan is still saved and shown in history — it just can never become
    // training data. The front image is fingerprinted for duplicate detection.
    if (scanConsent.training) {
      await deps.scans
        .enqueueForReview(scan.id, await dHash(compressedFront.jpeg))
        .catch(() => undefined);
    }

    // Best-effort online enhancement (fire-and-forget-ish): try it, but if it
    // fails, the builtin already saved. Skipped when the operator prefers builtin.
    if (deps.faceExplain && !preferBuiltin()) {
      const online = await deps.faceExplain(report).catch(() => null);
      if (online) {
        const upgraded: FaceReport = { ...report, explanation: online };
        await deps.scans.updateReport(scan.id, upgraded, online.promptVersion);
        report = upgraded;
      }
    }

    const { imageJpeg: _img, ...scanWire } = scan;
    res.json({ scan: { ...scanWire, report } });
  });

  // History for a patient. ?patientId=<id> scopes to that patient; omitted (or
  // "walk-in") falls back to the shared walk-in patient for back-compat.
  router.get("/api/face-scans", auth, async (req, res) => {
    // An invite link only ever sees the scans it created itself.
    if (req.session?.role === "invite") {
      const mine = (await deps.scans.listByInvite(req.session.inviteId)).filter(
        (s) => s.mode === "face",
      );
      res.json({ scans: mine });
      return;
    }
    const q = req.query.patientId;
    const patient =
      typeof q === "string" && q.length > 0 && q !== "walk-in"
        ? await deps.patients.get(q)
        : (await deps.patients.list()).find((p) => p.externalRef === "walk-in") ?? null;
    if (!patient) {
      res.json({ scans: [] });
      return;
    }
    const scans = (await deps.scans.listByPatient(patient.id)).filter((s) => s.mode === "face");
    res.json({ scans });
  });

  router.get("/api/face-scans/:id", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    if (!scan || scan.mode !== "face" || !ownedBySession(req, scan)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const { imageJpeg: _img, ...rest } = scan;
    const angles = await deps.scans.listImages(scan.id);
    // Manual marks are staff-only ground truth (spec: "pinpoints are staff-only") — an
    // invite session must never see them, even for the scan it created itself.
    const safeAngles =
      req.session?.role === "invite"
        ? angles.map(({ manualMarks: _mm, ...a }) => a)
        : angles;
    res.json({ scan: rest, angles: safeAngles });
  });

  router.get("/api/face-scans/:id/images/:angle", auth, async (req, res) => {
    if (!VALID_ANGLES.has(req.params.angle)) {
      res.status(404).end();
      return;
    }
    const owner = await deps.scans.get(req.params.id);
    if (!owner || !ownedBySession(req, owner)) {
      res.status(404).end();
      return;
    }
    const img = await deps.scans.getScanImage(req.params.id, req.params.angle);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "image/jpeg");
    res.send(Buffer.from(img.jpeg));
  });

  // Idempotent explanation upgrade: swap builtin → gemini once online. 503 offline.
  router.post("/api/face-scans/:id/enhance", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    if (!scan || scan.mode !== "face" || !scan.report || !ownedBySession(req, scan)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const report = scan.report as FaceReport;
    if (report.explanation?.source === "gemini") {
      res.json({ explanation: report.explanation }); // already upgraded
      return;
    }
    if (preferBuiltin()) {
      res.json({ explanation: report.explanation }); // operator prefers builtin — no upgrade
      return;
    }
    if (!deps.faceExplain) {
      res.status(503).json({ error: "offline" });
      return;
    }
    const explanation = await deps.faceExplain(report).catch(() => null);
    if (!explanation) {
      res.status(503).json({ error: "offline" });
      return;
    }
    const upgraded: FaceReport = { ...report, explanation };
    await deps.scans.updateReport(scan.id, upgraded, explanation.promptVersion);
    res.json({ explanation });
  });

  return router;
}
