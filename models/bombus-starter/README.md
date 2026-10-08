# Three-species Bombus starter

This optional frozen model identifies candidates among **B. cryptarum,
B. lucorum and B. terrestris** using 19 manually placed `bombus-19` landmarks.
Load it under **Referenzen → Modell trainieren → Bombus-Startmodell laden**.
No personal reference images are replaced or added. Selecting **Kein Modell**
returns to the local live comparison. Exported model JSON retains the citation,
source checksums, licence notice, adaptations and limitations.

The package uses 814 published wings from 423 animals (14 cryptarum, 62 lucorum,
347 terrestris). Both wings stay in one animal during splitting and evaluation.
Source landmarks are converted from y-up into the same base-left/anterior-up
handedness as the UI. Translation and uniform image scale are removed by
Procrustes; no source image normalization is asserted. The feature/preprocessing
version tags declare compatibility with current UI landmark coordinates.

It is a **development model**, not a general European bee classifier. It has no
independent final test, automatic landmark detector, paired WIP training, or
validation of the full image workflow. In particular, cryptarum provides only
two final calibration animals, below the nine required at epsilon 0.1. Therefore
the package cannot establish reliable exclusion of unknown bee species. A high
LDA posterior is conditional on the supported taxa and is not proof that the
animal belongs to them. Do not change epsilon merely to hide the data shortage.

Collection/session metadata were not verified and are left unknown. Future
external tests must contain new, independently labelled animals from separate
acquisition sessions, with matching landmark definitions and anatomical review.
The published source is already development data, including records used in
the repository's benchmark and browser fixtures.

Rebuild locally, without downloads:

```bash
npm run build:starter
```

The build verifies the archived publisher licence declaration and source MD5,
then fits all folds and the final model from the numeric data. Source SHA-256
checksums and the exact build recipe are embedded in the exported artifact.
`references.json` is the numeric build/evaluation database, not a QC-approved
image-reference import. `source-landmarks.csv` is the unchanged original CSV.

Read [NOTICE.md](NOTICE.md) for citation, adaptations and ODbL 1.0 terms. The
numeric model/reference database is distributed separately from the application
code. See [the development protocol](../../docs/model-development.md) for fitting
and evaluation assumptions.
