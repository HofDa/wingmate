# Validation run — wing-normalizer-0.2

Run date: 2026-09-27. All processing local; no image API used.

- 19/19 Node tests passed (`node tests/normalizer.test.js`).
- 36/36 real development images produced results in Chromium.
- Segmentation rules reported 2 GOOD, 34 REVIEW. This is a QC distribution,
  **not** 36 correct segmentations. Frames/uneven backgrounds sometimes produce
  incorrect masks; inspect overlays and correct masks before acceptance.
- Median preprocessing runtime: 609 ms in this run (hardware dependent,
  excludes decode and UI; source sizes range from publication crops to 9 MP).
- Browser checks passed: input, confirmation, accept, acceptance invalidation on
  flip, reset, same-image pair registration, clear, IndexedDB restore,
  re-acceptance, JSON export including mask runs. Identity mask IoU: 1.0.
- SHA-256 verified for every downloaded image/crop. Untouched landmark CSV MD5:
  `fd12bd4cfe2aa0e989472039497dfa34`, matching the Zenodo record.

For the controlled real-image perturbations, normalized mask IoU against the
baseline was 0.985–0.995 for rotations, 1.0 for translation, and 0.987–0.994 for
scale changes. A changed padding/background case fell to **0.612**: a known
failure caused by background differences / artificial composite boundaries.
All these perturbed cases reported REVIEW. These are consistency measurements,
not agreement against hand-labelled wing masks, and do not prove anatomical
correctness. Full results: `benchmark.json`, `real-invariance.json`.

Remaining scientific validation gaps: independently annotated contour ground
truth; independent captures of the same wing; controlled bee WIP/venation pairs;
calibrated orientation accuracy across genera; anterior/posterior detection.
No probabilities or successful biological pairing are inferred from these tests.
