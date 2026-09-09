# Phase 2 — Folder-Based Bulk Training Import

## Purpose
Use an existing classified image collection on a local hard drive without uploading the original files to GitHub or forcing the user to classify thousands of images one at a time.

## Planned workflow

1. Select the top-level folder containing the existing classified folders.
2. Read immediate subfolder names as proposed labels.
3. Scan image files without modifying or moving the originals.
4. Display counts by proposed class before importing.
5. Allow the human reviewer to confirm or correct labels.
6. Only confirmed/verified records enter the separate training dataset.
7. Keep ordinary monitoring records separate.
8. Preserve useful source metadata such as original filename and source folder.
9. Process large collections in batches so the browser does not need to render all images simultaneously.

## Important safeguards

- Do not copy the hard-drive dataset into the Git repository.
- Do not alter, rename, move, or delete source images.
- Do not automatically treat folder names as verified truth; they are proposed classifications until confirmed by the reviewer/workflow.
- Do not change the working Phase 1 collection, review, offline/online, or CSV functionality.
- Avoid loading tens of thousands of image blobs into localStorage.
- Prefer IndexedDB or another appropriate local persistent store for large browser-side training data.

## Initial known dataset

The user reports an existing classified export folder containing approximately:

- 48,000 possum images
- 12,000 rat images
- 5,000 non-target/native bird and other images

These figures are user-reported and should be re-counted by the importer rather than hard-coded.
