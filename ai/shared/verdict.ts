import type { Finding, MergedFinding, Severity, Verdict } from "../../shared/types";
import type { AnalysisReport, WireFinding } from "../../shared/contract";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  mild: 1,
  moderate: 2,
  attention: 3,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// Independent-signals combination: agreement raises confidence, capped < 1.
export function combineConfidence(a: number, b: number): number {
  return Math.min(0.99, 1 - (1 - a) * (1 - b));
}

export function mergeFindings(
  classifier: Finding[],
  llm: WireFinding[],
): MergedFinding[] {
  const byId = new Map<string, MergedFinding>();

  for (const f of llm) {
    byId.set(f.id, {
      id: f.id,
      label: f.label,
      source: "llm",
      confidence: f.confidence,
      severity: f.severity,
      note: f.note,
      region: f.region,
      agreement: "llm-only",
      escalated: f.severity === "attention",
    });
  }

  for (const c of classifier) {
    const existing = byId.get(c.id);
    if (existing) {
      const severity = maxSeverity(existing.severity, c.severity);
      byId.set(c.id, {
        ...existing,
        agreement: "agree",
        confidence: combineConfidence(existing.confidence, c.confidence),
        severity,
        escalated: severity === "attention",
      });
    } else {
      byId.set(c.id, {
        ...c,
        agreement: "classifier-only",
        escalated: c.severity === "attention",
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
    return b.confidence - a.confidence;
  });
}

const PARTIAL_SUMMARY =
  "Partial analysis — the AI review is pending (offline or unavailable). " +
  "These are the on-device classifier's findings only; re-analyze when online.";

const INCONCLUSIVE_SUMMARY =
  "Inconclusive Analysis";

export const INCONCLUSIVE_DETAIL =
  "The uploaded image does not provide sufficient confidence for a reliable AI assessment. Capture another clear, well-lit image or consult a dermatologist.";

function normalizeConfidenceThreshold(threshold: number): number {
  if (!Number.isFinite(threshold)) return DEFAULT_CONFIDENCE_THRESHOLD;
  if (threshold > 1) return Math.min(1, Math.max(0, threshold / 100));
  return Math.min(1, Math.max(0, threshold));
}

export function parseConfidenceThreshold(raw: string | undefined): number {
  if (!raw) return DEFAULT_CONFIDENCE_THRESHOLD;
  const trimmed = raw.trim();
  const numeric = Number(trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed);
  return normalizeConfidenceThreshold(trimmed.endsWith("%") ? numeric / 100 : numeric);
}

export function configuredConfidenceThreshold(): number {
  return parseConfidenceThreshold(import.meta.env?.VITE_CONFIDENCE_THRESHOLD);
}

function isBelowConfidenceThreshold(findings: MergedFinding[], threshold: number): boolean {
  return findings.length === 0 || findings.every((finding) => finding.confidence < threshold);
}

function applyConfidencePolicy(verdict: Verdict, threshold: number): Verdict {
  const normalized = normalizeConfidenceThreshold(threshold);
  if (!isBelowConfidenceThreshold(verdict.findings, normalized)) {
    return { ...verdict, confidenceThreshold: normalized };
  }
  return {
    ...verdict,
    summary: INCONCLUSIVE_SUMMARY,
    inconclusive: true,
    confidenceThreshold: normalized,
  };
}

export function buildVerdict(
  report: AnalysisReport | null,
  classifierFindings: Finding[],
  confidenceThreshold = configuredConfidenceThreshold(),
): Verdict {
  if (!report) {
    return applyConfidencePolicy({
      summary: PARTIAL_SUMMARY,
      findings: mergeFindings(classifierFindings, []),
      disclaimerShown: true,
      degraded: "classifier-only",
    }, confidenceThreshold);
  }
  return applyConfidencePolicy({
    summary: report.summary,
    findings: mergeFindings(classifierFindings, report.findings),
    disclaimerShown: true,
    degraded: classifierFindings.length === 0 ? "llm-only" : undefined,
  }, confidenceThreshold);
}
