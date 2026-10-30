# Kaitiaki Camera AI V2 — foundation and migration rules

Status: planning/foundation only. This branch is separate from the live `main` branch.

## Non-negotiable safety rules

1. The current Pages app and production Worker/D1 remain live and unchanged while V2 is built.
2. V2 development and testing must use a separate Worker and a separate D1 database. A preview binding is not isolation if it points to the production database.
3. Never delete or rewrite legacy sightings, images, classifications, verification decisions, or camera-check reports as part of migration.
4. Never infer missing capture dates or uncertain camera-check links. Preserve the original value and flag uncertainty for review.
5. Do not force report totals to match. Reports must be derived transparently from eligible records and explain exclusions.
6. Import must be repeatable (idempotent), auditable, and reversible. Preserve legacy IDs and source provenance.
7. Do not require staff to reprocess SD cards. Include shared records and any recoverable device-local records in the migration assessment.

## Confirmed current-app inventory

- Main field UI: `next/index.html` (currently a large single HTML file with embedded styles and scripts).
- Shared backend: `next/cloud-worker/src/index.js` (currently a large single Worker file).
- Worker config: `next/cloud-worker/wrangler.jsonc`.
- UI modules already loaded separately include `cloud-ui.js`, `shared-ui.js`, `project-lead.js`, and `camera-report.js`.
- Browser storage uses IndexedDB for local records and localStorage for device/team settings and camera register/check data.
- The current Worker uses D1 tables `sightings` and `camera_checks`.
- Current Wrangler config and its preview D1 binding point at the same production database ID. This is not a safe isolated V2 test environment.

## V2 code boundaries

Keep modules small and independently testable:

- `app/`: app startup, routing, shared state and configuration.
- `scan/`: folder/SD-card selection, file discovery, import queue, checkpoints and resume.
- `classification/`: AI requests, response validation, confidence rules and retry handling.
- `review/`: human verification, corrections, back navigation and keyboard controls.
- `storage/`: IndexedDB schema, migrations, image/blob handling and export/import.
- `sync/`: offline queue, conflict policy, idempotency and retry/backoff.
- `reports/`: camera-check records, eligibility rules, monthly totals and audit explanations.
- `access/`: team and Project Lead permissions.
- `cloud-worker/`: API routes, validation, authentication and database access.

The interface should retain the simple field workflow that the team already knows. The V2 app must not be deployed over the current Pages app until acceptance testing is complete.

## Legacy-data migration design

### Stage A — read-only inventory

Record table schemas, row counts, date coverage, image/blob availability, ID patterns, local IndexedDB stores, localStorage keys, and export formats. Do not alter production data.

### Stage B — immutable test snapshot

Create a controlled snapshot of legacy shared data and, where available and authorised, representative device-local exports. Keep an untouched raw copy. Use a separate test D1 database and separate Worker credentials/bindings. Never point V2 tests at production D1.

### Stage C — staging import

Load legacy rows into staging tables with source system, source table, source ID, import batch ID, and raw payload. Preserve source IDs. Validate counts and required fields before creating V2 records. Do not silently discard rows with missing dates or links.

### Stage D — explicit mapping and review

Map legacy fields to V2 fields with a documented mapping. Classifications, human verification, timestamps, camera-check references, and image references must be retained. Conflicts and uncertain links go to a review queue; they are not auto-corrected.

### Stage E — repeatability and acceptance

Run the same import twice and prove that the second run creates no duplicates or unintended changes. Compare per-camera, per-check, per-label, verification, date-coverage and image-availability totals against the immutable source snapshot. Explain every difference. Test offline operation, pause/resume, reconnect, multi-device sync, permissions, reports and exports.

## Known audit fixtures to include in tests

- TPAC3A Check #2 (2026-10-07): saved report total 16; linked Possum records 16; all 16 dated in 2026; September 4 and October 12. Preserve as a known-good fixture.
- TPAC3A Check #1 (2026-10-27): saved report total 16 but currently no linked sightings. Keep this discrepancy visible; do not assume it is the same set as Check #2.
- OXIC1 Check #1 (2026-09-30): report images 6; linked Possum records 53; all 53 missing capture dates. Keep as a mismatch fixture; do not invent dates or force totals.
- Other mismatch fixtures: MTC01, MTC02, OXIC3 and TPAC3.

These fixtures are regression tests, not instructions to repair production records.

## Completion gates before cutover

- Separate V2 Worker and D1 confirmed by database ID.
- Legacy snapshot captured and checksum/count manifest recorded.
- Import mapping reviewed; dry-run differences explained.
- Repeated import proven idempotent.
- No legacy classifications, verification decisions, images or reports lost.
- Offline scan, checkpoint/resume, sync retry and conflict handling pass.
- Camera-check reports reconcile transparently without forced totals.
- Team and Project Lead permissions pass.
- Team tests V2 while the old app remains available.
- A rollback path is documented and the old app remains available until the team approves cutover.

## Current state

Only this foundation document and the isolated development branch have been created. No production app, Worker, D1 database, shared record, image or classification has been changed. No production data has yet been copied into a test environment.
