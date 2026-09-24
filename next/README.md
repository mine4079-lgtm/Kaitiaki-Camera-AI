# Kaitiaki Next — isolated first build

This is a fresh app in `/next/` and **does not replace the original Kaitiaki or its models**.

## Current working functionality
- Local image / SD / HDD folder selection (where supported by browser).
- Read-only metadata import with IndexedDB checkpoints every 50 photos.
- Resume by relative filename, size and modified time; existing confirmed labels kept.
- Image result cards, full-photo human verification, filtering and CSV exports.
- Visible disclaimer: **no new AI inference is installed yet**; no fake predictions.
- Local-only storage, no image upload or source modification.

## Next phases
- Independent model training and offline inference; restrict auto-accept until non-target rejection tests pass.
- File reattachment tests and large batch testing on 8GB laptop.
- Future release as a fully separate repository when repository creation is available.

### Important
Do not clear the site data. Store CSV backups separately; metadata is saved only in this browser.
