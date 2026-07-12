import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { validateFaceReport, type FaceReport } from "../../../shared/face";
import { builtinFaceExplanation } from "../../../ai/llm/fallback/face-education";
import { compressToJpeg } from "../../utils/image";

async function walkInPatient(deps: AppDeps) {
  const list = await deps.patients.list();
  return (
    list.find((p) => p.externalRef === "walk-in") ??
    (await deps.patients.create({
      name: "Walk-in Patient",
      externalRef: "walk-in",
      notes: "Auto-created placeholder for walk-in scans",
      consentVersion: 1,
    }))
  );
}

interface IncomingImage {
  angle?: string;
  image?: string;
  mime?: string;
  quality?: { ok?: boolean; issues?: string[] };
}

const VALID_ANGLES = new Set(["front", "left-45", "right-45", "left-profile", "right-profile", "forehead", "chin"]);

export function createFaceScanRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  // Persist a completed face scan (client-computed report + captured angle images).
  // Server re-validates the report before saving and re-checks safety invariants.
  router.post("/api/face-scans", auth, async (req, res) => {
    const { report: reportBody, images } = req.body ?? {};

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

    const patient = await walkInPatient(deps);

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
      });
    }
    await deps.scans.addImages(scan.id, scanImages);

    // Best-effort online enhancement (fire-and-forget-ish): try it, but if it
    // fails, the builtin already saved.
    if (deps.faceExplain) {
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

  // History for a patient (walk-in alias resolves like /api/patients/:id/scans).
  router.get("/api/face-scans", auth, async (_req, res) => {
    const list = await deps.patients.list();
    const walkIn = list.find((p) => p.externalRef === "walk-in");
    if (!walkIn) {
      res.json({ scans: [] });
      return;
    }
    const scans = (await deps.scans.listByPatient(walkIn.id)).filter((s) => s.mode === "face");
    res.json({ scans });
  });

  router.get("/api/face-scans/:id", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    if (!scan || scan.mode !== "face") {
      res.status(404).json({ error: "not found" });
      return;
    }
    const { imageJpeg: _img, ...rest } = scan;
    const angles = await deps.scans.listImages(scan.id);
    res.json({ scan: rest, angles });
  });

  router.get("/api/face-scans/:id/images/:angle", auth, async (req, res) => {
    if (!VALID_ANGLES.has(req.params.angle)) {
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
    if (!scan || scan.mode !== "face" || !scan.report) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const report = scan.report as FaceReport;
    if (report.explanation?.source === "gemini") {
      res.json({ explanation: report.explanation }); // already upgraded
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
