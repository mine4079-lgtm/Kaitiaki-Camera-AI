# Kaitiaki V2 isolated workspace

This directory is the start of the V2 implementation. It is not connected to the live Pages app or production Worker.

## Safety

- Do not add production credentials or secrets to this repository.
- Do not bind this app or Worker to the production D1 database.
- Create a new Cloudflare D1 database for V2 testing and record its database ID outside this repository.
- Apply `db/staging-schema.sql` only to that newly-created test database.
- Keep legacy source snapshots immutable. Import into staging first; do not directly overwrite V2 operational tables.
- Do not place private camera images or identifiable team data in Git.

## Migration sequence

1. Export a read-only snapshot from the current shared database using an authorised method.
2. Generate a manifest with export time, source table counts, row IDs, and checksums.
3. Import raw sightings and camera-check JSON into the staging tables.
4. Inventory image blobs separately and record whether each one was actually recovered.
5. Validate duplicate IDs, missing fields, missing dates, unresolved camera-check links, and source counts.
6. Only after validation, map reviewed rows into V2 operational tables.

The importer must use a stable source key and be idempotent. Re-running the same batch must not create duplicate source rows. A new snapshot is a new batch and must not erase the prior snapshot.

## Current limitation

No legacy data has been exported or copied yet. This repository currently contains only the staging schema and migration guidance. The production database has not been queried or changed by this V2 work.
