# Animal-based model development

The implementation now follows the [model mathematics review](model-math-review.md). The supported statistical unit is an animal identified by a stable specimen ID. The biological reliability of the complete image workflow still requires independent data.

## Current behavior

- **Default method:** Procrustes/PCA/shrinkage-LDA when the selected inputs include complete, compatible landmarks; otherwise distance-kNN. The default reservoir setting is direct features. Cosine-kNN, the random-walk graph and optional random projections remain development comparators. A model's default method is fixed by this policy, rather than chosen from the highest cross-validation score. An explicit `primaryMethod` is available for controlled development experiments.
- **Reference representation:** exact repeated feature records within an animal are deduplicated. Non-landmark feature blocks are averaged across that animal's distinct views. Landmark views are Procrustes-aligned within the animal before computing its mean shape. Each resulting animal prototype contributes once to fitted GPA, scaling, PCA/LDA, covariance estimates, neighbor lists and graph topology. Prototypes use all selected blocks; views with missing required inputs are rejected rather than silently dropped.
- **Fitting order:** split whole animals into development folds and separate calibration groups first. Fit all learned transforms exclusively to the training animal prototypes. Queries and calibration wings use the frozen training transform. Nested LDA temperature fitting holds out training animals and refits alignment within each inner split.
- **Typicality:** the frozen model computes Euclidean distances in the unnormalized standardized feature space. A view's nonconformity is `1 + mean(distance to the nearest m same-taxon training animals)`, with default m = 3. One maximum view score per calibration animal enters the label-conditional split calibration. This retains feature magnitude even when the experimental similarity embedding discards it. Distance-kNN scores are relative similarity votes, not species probabilities.
- **Acquisition policy:** calibration uses all distinct recorded wing views of each animal; reference prototypes use their mean. A comparable single-wing query is conservative relative to the calibration maximum. Arbitrarily selecting or adding future views, changing acquisition conditions, or changing the number/type of calibration views does not establish exchangeability. Preserve a stated acquisition policy and verify coverage externally. The software cannot authenticate animal identities from IDs alone.
- **Development reporting:** each animal contributes one classification outcome, using the majority prediction across its distinct wings with a deterministic lexical taxon tie-break. Wing-level outcomes remain separately available in the exported report. Animal-level conformal sets are intersections of the view sets, matching maximum-view calibration. Balanced-accuracy intervals resample animals within each taxon; these are percentile bootstrap diagnostics conditional on the stored predictions, not full model-refitting uncertainty or an independent final test.
- **Degenerate inputs:** FlyHash rejects input dimensions at or below its fan-in; zero inputs produce empty tags. Noninformative feature sets and zero within-taxon variance produce actionable errors. LDA adds a small covariance floor proportional to training variance for otherwise singular covariance matrices.

The training input selector exposes complete-input, landmark-only, venation/outline and experimental paired venation/WIP contracts. Every reference must satisfy the chosen contract. WIP's biological identification value is not established by this repository.

## Model migration

The inference contract is `wingmate-model-3`, with an enforced animal-prototype policy, Euclidean calibration metric, one vector per training animal, and original-reference provenance. Existing v1/v2 models must be retrained. Current `wing-features-2` / `wing-normalizer-0.3` image references remain usable; this change does not require reprocessing their originals. Older image preprocessing still needs the previously documented reprocessing.

Training and calibration animals stay separate. Source hashes reused under different animal identities are rejected during training. The format stores all contributing training record IDs and the original reference provenance even though inference uses one animal prototype.

## Frozen external evaluation

An optional [three-species Bombus starter](../models/bombus-starter/README.md) is
bundled with the app. It is built from the pinned numeric Molasy & Tofilski
landmark database, not from source photographs. The unchanged CSV, adapted
reference database, publisher rights record, citation and ODbL notice accompany
the model. Export/import retains attribution; displayed predictions and external
test reports carry the same source notice. This is a development model with
insufficient cryptarum calibration and no independent final test. The other
European datasets discussed during research have not been downloaded or added.

Reserve an untouched test file of independently labelled animals before choosing features, parameters or models. Prefer separate acquisition sessions/collections. Keep whole unseen taxa out of training and calibration for the unknown-species test. Do not repeatedly tune on the resulting report.

Export a v3 model and a separate reference JSON file, then run:

```bash
node scripts/evaluate-model.mjs model.json independent-test-references.json report.json
```

The test file can be a reference-export object with a `references` array or a plain record array. Each record needs `id`, `specimenId` (or `group`), `species`, `features` and the matching `preprocessingVersion`; include acquisition `series` and source hashes where available. A novel taxon keeps its true expert label; do not relabel it as a supported species. All test records must satisfy the model's frozen input contract and feature version.

The evaluator never refits or recalibrates. It rejects detected overlap with training or calibration by animal ID, record ID, source-image hash or exact selected feature content. These checks inspect every original record before deduplication. It also rejects a test source image assigned to multiple animal IDs and missing true taxon labels. Identical features can also arise from distinct animals, so that conservative check requires a provenance review rather than changing IDs to bypass it. IDs and exact-source checks cannot prove the dataset was untouched during development.

The report includes SHA-256 fingerprints of both input files, supported-class animal recall/confusion, separate wing summaries, animal bootstrap intervals, known-class coverage/false rejection, and unknown-taxon rejection rates. Unknown-taxon rates are null if calibration is insufficient. LDA diagnostics include class-balanced Brier/mean-confidence values plus animal-level reliability bins and per-taxon confidence/accuracy; the latter use observed test prevalence and mean view posteriors. Shared acquisition-series IDs are reported for review. Report output cannot overwrite either input file.

## Current development benchmark

The regenerated landmark benchmark evaluates 814 wings from 423 animals, covering three Bombus taxa. It uses animal prototypes during fitting and animal outcomes during reporting:

| Method | Animal balanced accuracy |
| --- | --- |
| Procrustes + PCA + LDA | 89.65% |
| Random walk, direct features with cosine | 80.28% |
| Distance-kNN, direct standardized features | 78.47% |
| Cosine-kNN, direct features | 77.05% |

For LDA, the diagnostic balanced-accuracy interval is approximately 81.6–95.6%; recall is 85.7% for B. cryptarum, 88.7% for B. lucorum and 94.5% for B. terrestris. These animal-level results are not directly comparable to the old wing-level values. The method changes and statistical reporting unit both changed.

The benchmark still has zero animals with adequate calibration across every taxon, because B. cryptarum contains only 14 animals. The default 20% holdout needs at least 45 animals per taxon to obtain nine final calibration animals at epsilon 0.1. Nine only supplies the necessary p-value resolution. Neither synthetic outlier rejection nor the landmark benchmark demonstrates detection of actual unseen bee species.

Run `npm test` and `node scripts/audit-pipeline.mjs` for software checks. Regression cases cover radial outliers in all embedding modes, repeated-view invariance of fitting/calibration/graph and voting, animal-level evaluation, model export/import, legacy model rejection, source identity conflicts, degenerate numerical cases and frozen external-test overlap checks. Browser checks cover the training worker, input controls, model round trips, offline modules and updates.

## Apis reference collection

The pinned [Apis source](../models/apis-source/README.md) contains 29,043 wings
from 1,342 country-qualified colonies. Its adapted numeric collection preserves
original y-up coordinates and the separate Nawrocka (2018) landmark numbering,
with one reproducibly selected wing per colony and ODbL attribution. It is not
a feature export or an installable classifier. The UI offers a download that
also works offline. All unchanged numeric CSVs are included; photographs are
excluded. Two unmatched German filename joins are explicitly excluded.

Before combining it with Bombus, verify anatomical landmark homology, implement
and validate a common coordinate adapter, and freeze the new input contract.
Use colony-separated splits for Apis and country/acquisition holdouts; do not
interpret colony counts as independently sampled animal counts. Source-specific
acquisition may be confounded with species in a combined study. Neither this
collection nor internal cross-validation establishes transfer to app images.
