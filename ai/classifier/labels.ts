import type { Severity } from "../../shared/types";

export interface LabelInfo {
  id: string;
  label: string;
  severity: Severity;
  lesion?: boolean;
}

// Order is the model's output order — do not reorder without re-exporting the model.
export const LABELS: LabelInfo[] = [
  { id: "clear", label: "No notable condition", severity: "info" },
  { id: "acne", label: "Acne", severity: "mild" },
  { id: "rosacea", label: "Rosacea", severity: "mild" },
  { id: "eczema", label: "Eczema / atopic dermatitis", severity: "moderate" },
  { id: "contact-dermatitis", label: "Contact dermatitis", severity: "moderate" },
  { id: "psoriasis", label: "Psoriasis", severity: "moderate" },
  { id: "urticaria", label: "Urticaria / hives", severity: "moderate" },
  { id: "tinea", label: "Tinea / fungal infection", severity: "moderate" },
  { id: "hyperpigmentation", label: "Hyperpigmentation", severity: "mild" },
  { id: "vitiligo", label: "Vitiligo", severity: "mild" },
  { id: "wart", label: "Wart", severity: "mild" },
  { id: "suspicious-lesion", label: "Lesion needing evaluation", severity: "attention", lesion: true },
  { id: "pigmented-lesion", label: "Pigmented lesion needing evaluation", severity: "attention", lesion: true },
];

export const LESION_IDS = LABELS.filter((l) => l.lesion).map((l) => l.id);

export function labelAt(index: number): LabelInfo {
  const info = LABELS[index];
  if (!info) throw new Error(`No label at index ${index}`);
  return info;
}
