CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  external_ref TEXT,
  notes TEXT NOT NULL DEFAULT '',
  consent_version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('face', 'closeup')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  image_jpeg BYTEA NOT NULL,
  image_width INT NOT NULL,
  image_height INT NOT NULL,
  report JSONB,
  partial BOOLEAN NOT NULL DEFAULT false,
  classifier_findings JSONB NOT NULL DEFAULT '[]',
  prompt_version INT
);

CREATE INDEX IF NOT EXISTS scans_patient_created ON scans (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Face-scan angles are stored as separate rows tied to the parent scan.
-- (Plan 12 — v3 face-analysis architecture.)
CREATE TABLE IF NOT EXISTS scan_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  angle TEXT NOT NULL CHECK (angle IN ('front','left-45','right-45','left-profile','right-profile','forehead','chin')),
  image_jpeg BYTEA NOT NULL,
  image_width INT NOT NULL,
  image_height INT NOT NULL,
  quality JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_images_scan ON scan_images (scan_id);

-- Clinician-assigned labels on scans → training data for the learned analyzers.
-- One label per (scan, dimension); upserted. dimension="acne" is the first user.
CREATE TABLE IF NOT EXISTS scan_labels (
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  label TEXT NOT NULL,
  labeled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_id, dimension)
);
CREATE INDEX IF NOT EXISTS scan_labels_dimension ON scan_labels (dimension);

-- Model registry for versioning, distribution, and rollback (Plan 13 Task 1).
CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  model_type TEXT NOT NULL CHECK (model_type IN ('landmarker', 'segmentation', 'classifier')),
  current_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INT,
  checksum TEXT,
  is_stable BOOLEAN NOT NULL DEFAULT false,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_id, version)
);

CREATE INDEX IF NOT EXISTS model_versions_model ON model_versions (model_id);
CREATE INDEX IF NOT EXISTS model_versions_current ON model_versions (is_current);
