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

-- Training Queue: review state for every completed scan. The AI prediction is
-- NOT copied here — it already lives immutably in scans.report, and the
-- human-verified labels live in scan_labels, so the two can never overwrite
-- each other. This table only tracks where a sample is in review.
CREATE TABLE IF NOT EXISTS training_queue (
  scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'needs_expert')),
  note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_queue_status ON training_queue (status, created_at DESC);

-- Added after the initial queue release; ALTERs keep existing installs working.
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- Excluded from training even when approved (e.g. a near-duplicate kept on file).
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS skip_training BOOLEAN NOT NULL DEFAULT false;
-- Perceptual dHash of the front image + the closest earlier scan for this patient.
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS image_hash TEXT;
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS duplicate_of UUID;
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS similarity REAL;
-- Whether this sample has already been consumed by a training export.
ALTER TABLE training_queue ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ;

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

-- Per-scan consent. Two independent decisions: analysis is required to scan at
-- all, training consent is optional and is what gates entry to the Training
-- Queue. Defaults are deliberately asymmetric — an old scan predates the
-- training question, so it must NOT be assumed to have consented.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS consent_analysis BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS consent_training BOOLEAN NOT NULL DEFAULT false;

-- Immutable dataset snapshots. A version is never rewritten: creating v2 leaves
-- v1 exactly as it was, so any model stays reproducible from its dataset.
-- Rollback just moves `is_current`.
CREATE TABLE IF NOT EXISTS dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  image_count INT NOT NULL DEFAULT 0,
  note TEXT,
  is_current BOOLEAN NOT NULL DEFAULT false,
  -- Frozen membership: [{scanId, labels:{dimension:label}}]
  manifest JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS dataset_versions_current ON dataset_versions (is_current);

-- One row per trained model, with the dataset it came from and its metrics.
-- deployment: candidate | production | archived. Only one production at a time.
CREATE TABLE IF NOT EXISTS model_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dataset_version TEXT,
  macro_f1 REAL,
  acne_f1 REAL,
  skintype_f1 REAL,
  size_bytes BIGINT,
  deployment TEXT NOT NULL DEFAULT 'candidate'
    CHECK (deployment IN ('candidate', 'production', 'archived'))
);
CREATE INDEX IF NOT EXISTS model_releases_deployment ON model_releases (deployment, trained_at DESC);

-- Image lifecycle + audit trail. One append-only row per event, so a scan's
-- history (captured → analysed → reviewed → approved → dataset → trained) and
-- every consistency warning share the same log and can never disagree.
CREATE TABLE IF NOT EXISTS scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  actor TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_events_scan ON scan_events (scan_id, at);
CREATE INDEX IF NOT EXISTS scan_events_kind ON scan_events (kind, at DESC);

-- Archive instead of destroy: a deleted image is hidden for a retention window
-- and can be restored, then purged. NULL = live.
ALTER TABLE scan_images ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS scan_images_archived ON scan_images (archived_at);

-- Scan invites: a private link giving an outside patient a limited number of
-- scans and nothing else. The quota lives here rather than in the token so it
-- can be counted and revoked; the token is only a lookup key.
CREATE TABLE IF NOT EXISTS scan_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  max_scans INT NOT NULL DEFAULT 2 CHECK (max_scans > 0),
  used_scans INT NOT NULL DEFAULT 0 CHECK (used_scans >= 0),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_invites_token_idx ON scan_invites(token);

-- Which invite produced a scan, so an invite session can be scoped to only the
-- scans it created (and so the clinic can audit where a scan came from).
ALTER TABLE scans ADD COLUMN IF NOT EXISTS invite_id UUID REFERENCES scan_invites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS scans_invite_idx ON scans(invite_id);
