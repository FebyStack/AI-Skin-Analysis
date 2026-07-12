// Pre-authored offline lesion education. Same shape as the Gemini explanation,
// source:"builtin". Reviewed once (doctor sign-off recommended); versioned like prompts.
// Language rules: suggestive framing only, no certainty, no treatment, always a disclaimer.
import {
  hasMalignantSignal,
  type LesionAnalysis,
  type LesionExplanation,
  type ReferralUrgency,
} from "../../../shared/lesion";

export const BUILTIN_LESION_VERSION = 1;

export const LESION_DISCLAIMER =
  "This is not a diagnosis. It is an automated visual assessment of a single image and can be wrong. " +
  "Only a qualified professional examining you in person can diagnose a skin condition.";

interface ClassContent { name: string; summary: string; education: string; urgency: ReferralUrgency }

// 6-class PAD-UFES/ISIC scheme.
const CONTENT: Record<string, ClassContent> = {
  MEL: {
    name: "melanoma",
    summary: "The analysis suggests features that can be associated with melanoma, a serious skin cancer. This needs prompt professional evaluation.",
    education: "Melanoma arises from pigment cells. Warning signs include asymmetry, irregular borders, multiple colours, growth in diameter, and change over time (the ABCDE rule). Early professional assessment matters greatly.",
    urgency: "urgent",
  },
  SCC: {
    name: "squamous cell carcinoma",
    summary: "The analysis suggests features that can be associated with squamous cell carcinoma, a common skin cancer. A professional should assess this soon.",
    education: "Squamous cell carcinoma often appears as a firm, scaly, or crusted bump, sometimes tender, usually on sun-exposed skin. It is generally treatable, especially when assessed early.",
    urgency: "urgent",
  },
  BCC: {
    name: "basal cell carcinoma",
    summary: "The analysis suggests features that can be associated with basal cell carcinoma, the most common and typically slow-growing skin cancer. Professional assessment is recommended.",
    education: "Basal cell carcinoma often looks like a pearly bump, a flat scar-like patch, or a sore that heals and reopens. It grows slowly and rarely spreads, but should be treated.",
    urgency: "soon",
  },
  ACK: {
    name: "actinic keratosis",
    summary: "The analysis suggests features consistent with actinic keratosis, a sun-damage change a professional should look at.",
    education: "Actinic keratoses are rough, scaly patches from long-term sun exposure. A small share can progress toward skin cancer over time, which is why they are usually checked and often treated.",
    urgency: "soon",
  },
  SEK: {
    name: "seborrheic keratosis",
    summary: "The analysis suggests features consistent with a seborrheic keratosis, a common non-cancerous skin growth.",
    education: "Seborrheic keratoses are very common with age — often waxy, 'stuck-on'-looking patches. They are harmless, but any growth that changes, bleeds, or looks unusual deserves a professional look.",
    urgency: "routine",
  },
  NEV: {
    name: "nevus (mole)",
    summary: "The analysis suggests features consistent with a nevus, a common mole.",
    education: "Moles are clusters of pigment cells and are usually harmless. Watch for change: new asymmetry, border irregularity, colour variation, growth, itching, or bleeding are reasons to see a professional.",
    urgency: "routine",
  },
};

export function builtinLesionExplanation(analysis: LesionAnalysis): LesionExplanation {
  const predicted = analysis.lesions[0]?.classification.predicted ?? null;
  const malignantSeen = hasMalignantSignal(analysis);
  const c = (predicted && CONTENT[predicted]) || null;

  if (!c) {
    // Unknown/blank prediction → inconclusive guidance, still safe.
    return {
      patientSummary:
        "The analysis was inconclusive — it could not confidently suggest a specific category for this spot. This is neither reassurance nor a warning.",
      education:
        "If you are concerned about this spot — especially if it is new, changing, itching, or bleeding — see a professional regardless of an automated result.",
      referral: {
        recommended: true,
        urgency: malignantSeen ? "soon" : "routine",
        reason: "Inconclusive automated analysis — professional evaluation is the reliable next step.",
      },
      disclaimer: LESION_DISCLAIMER,
      source: "builtin",
      promptVersion: BUILTIN_LESION_VERSION,
    };
  }

  const recommended = malignantSeen || c.urgency !== "routine";
  return {
    patientSummary: c.summary,
    education: c.education,
    referral: {
      recommended,
      urgency: c.urgency,
      reason: recommended
        ? `The suggested category (${c.name}) or a possibility in the top results warrants an in-person professional check.`
        : "No urgent signal from this analysis — mention it at your next routine visit, and sooner if it changes.",
    },
    disclaimer: LESION_DISCLAIMER,
    source: "builtin",
    promptVersion: BUILTIN_LESION_VERSION,
  };
}
