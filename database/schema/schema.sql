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
