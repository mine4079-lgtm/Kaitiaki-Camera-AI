-- Kaitiaki V2 isolated migration staging schema.
-- Apply ONLY to a newly-created V2 TEST D1 database.
-- Never apply this file to kaitiaki-team-db (production).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migration_batches (
  batch_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_snapshot_at TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created','loading','validated','rejected')),
  created_at TEXT NOT NULL,
  validated_at TEXT,
  notes TEXT
);

-- Immutable raw copies. Keep original JSON and source IDs exactly as exported.
CREATE TABLE IF NOT EXISTS legacy_sightings_raw (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES migration_batches(batch_id),
  raw_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, batch_id)
);

CREATE TABLE IF NOT EXISTS legacy_camera_checks_raw (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES migration_batches(batch_id),
  raw_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, batch_id)
);

-- Record image availability separately. Do not assume a file/blob exists
-- merely because the legacy row contains a filename or relative path.
CREATE TABLE IF NOT EXISTS legacy_image_inventory (
  source_system TEXT NOT NULL,
  source_sighting_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES migration_batches(batch_id),
  image_present INTEGER NOT NULL CHECK (image_present IN (0,1)),
  image_sha256 TEXT,
  image_type TEXT,
  byte_length INTEGER,
  recovery_location TEXT,
  inspection_note TEXT,
  PRIMARY KEY (source_system, source_sighting_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_sightings_batch
  ON legacy_sightings_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_legacy_checks_batch
  ON legacy_camera_checks_raw(batch_id);
CREATE INDEX IF NOT EXISTS idx_legacy_images_batch
  ON legacy_image_inventory(batch_id);
