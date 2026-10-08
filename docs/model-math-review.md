# Model and mathematics review

Reviewed 2026-10-08 at commit `2b9741e`. Purpose: identification of bee species from venation images, optional paired WIP images, and manually placed landmarks. This review records the behavior before remediation. The subsequent changes and current protocol are documented in [model-development.md](model-development.md).

The numerical foundations are reasonable for a research prototype. The repository does not yet establish reliable species identification from new wing photographs, calibrated species probabilities under transfer, or reliable rejection of unseen species. The strongest current evidence supports the landmark classifier within the three tested Bombus taxa.

## Findings, ordered by consequence

### High: angular similarity can hide extreme feature outliers

[Embedding](../classifier/embedding.js) uses L2 normalization for the direct baseline and fixed-rank winner-take-all tags for FlyHash and dense projections. All three representations are invariant to positive rescaling of an already standardized feature vector. The conformal score uses similarity in that representation, so it cannot recover discarded magnitude.

A controlled probe trained on 45 independent animals per class, with two-dimensional shape features `[v, 0]`, using values from −2.44 to 2.89. Each class had nine separate calibration animals. A query at `v = 1972.31`, constructed by extending a known-class direction 1,000-fold from the fitted training mean, received best similarity 1 in every mode. Direct and dense modes returned the singleton set B with p-value 1; FlyHash returned both classes with p-values 1. Every mode reported `openSetValid: true` and `unknown: false`.

This is a synthetic counterexample, not a bee accuracy estimate. It exposes an architectural limitation of using angular similarity alone for unfamiliar-input detection. The conformal coverage theorem is not contradicted: it does not guarantee power against arbitrary outliers or unseen classes.

Recommendation: compare distances in the fitted, unnormalized feature space, including a regularized Mahalanobis or distance baseline where appropriate. Calibrate the resulting score with separate animals. Test unfamiliar species and acquisition failures explicitly; adding a distance threshold without recalibration would not preserve the existing coverage construction automatically.

### High: there is still no end-to-end or unknown-species validation

The stored [landmark benchmark](../test-data/landmark-benchmark.json) evaluates 814 wings from 423 animals, representing only three Bombus taxa. It contains `validQueries: 0`, `coverage: null`, and an empty `novelTaxon` result. The least represented taxon, B. cryptarum, has 14 animals; the default final 20% split supplies only two calibration animals. With that split policy, at least 45 animals per taxon are needed to obtain nine calibration animals in the final model. Nine is only the p-value resolution needed to reject at epsilon 0.1, not an adequacy or accuracy guarantee.

There is no independent final test after method selection, no complete image-to-identification accuracy benchmark, and no suitable real paired bee WIP/venation dataset in [the WIP notes](../test-data/wip/README.md). None of these gaps can be filled by checking matrix algebra or synthetic fixtures.

Recommendation: reserve independent animals and acquisition sessions before development; test the selected complete pipeline on them once. Evaluate unseen taxa separately. Measure modality ablations on the same paired animals before claiming WIP improves identification.

### Medium: animals define splits and calibration, but wings still define fitting and performance

[Model fitting and evaluation](../classifier/model.js) correctly keep an animal's wings together in each split. However, scaling, GPA, PCA/LDA and the reference graph still use individual wing records. [Metric summaries](../classifier/classify.js) also count wings. An animal with more records has more influence, and the effective independent sample size is smaller than the number of wings used by the PCA component heuristic and covariance fitting.

In a six-reference synthetic kNN probe, duplicating one B reference twelve times changed B's normalized score from 0.607 to 1, because duplicate records occupied all five nearest-neighbor slots. Class-count balancing did not eliminate this effect. The specimen-aware conformal neighborhood is protected against exact repetition; the ordinary kNN/graph stages are not.

Recommendation: specify the prediction unit and acquisition policy. Use equal-animal weighting or an explicit multi-view representation for fitting, select neighbors by animal, report animal-level performance, and bootstrap confidence intervals by animal rather than wing. Keep wing-level metrics as separately labelled descriptive results.

### Medium: degenerate inputs can create hashes or abort LDA fitting

[FlyHash projection](../classifier/embedding.js) samples `min(fanIn, inputDim)` distinct coordinates per cell. If input dimension is at most the default fan-in of six, every cell samples every coordinate, so their sums are mathematically identical. The output is determined by tie order or numerical rounding, rather than a useful projection. A zero vector nevertheless receives 13 active bits with 256 cells and 5% activity.

The default image descriptors have substantially more dimensions, so this is chiefly an edge case for small custom feature contracts such as size-only input. It must still be rejected or handled explicitly if that contract is supported.

[Automatic shrinkage LDA](../classifier/morphometrics.js) also fails on zero within-class covariance: shrinkage toward a scaled identity leaves an all-zero covariance all zero. Four identical two-dimensional rows with two labels produce “Kovarianzmatrix nicht positiv definit”.

Recommendation: reject noninformative and degenerate feature sets clearly, guard the sparse projection's low-dimensional case, and define a scale-aware covariance floor or a deliberate insufficient-data outcome for LDA.

### Medium: displayed confidence is not independently established

LDA implements equal class priors and shared covariance. Temperature fitting uses grouped inner held-out predictions with class-balanced log loss; this is a reasonable development procedure, but the resulting probabilities refer to that balanced population and known classes. Actual field prevalence may differ. A close mean confidence and mean accuracy does not establish reliability at every confidence level or for each taxon.

The stored benchmark's mean top probability is 88.2%, versus 86.8% balanced accuracy, with Brier score 0.161. Those are development diagnostics, not prospective probability calibration. The graph's normalized, class-count-balanced scores are relative similarity scores rather than posterior species probabilities. An empty conformal set can indicate poor acquisition or missing reference diversity as well as an unfamiliar species.

Recommendation: validate reliability curves, per-taxon calibration, proper scores and selective error rates on independent animals. Tune any deployment priors within a stated protocol. Define the same view-selection/aggregation policy for calibration and future queries; animal-max calibration is conservative for a comparable single view but does not justify arbitrary future view selection or acquisition changes.

## What is mathematically sound

The reviewed generalized Procrustes rotation, centering and centroid-size normalization have the expected form and preserve reflection as a separate anatomical decision. PCA and the LDA discriminants implement the usual linear algebra. LDA uses a pooled within-class covariance and shrinkage toward a scaled identity; its equal-prior coefficients are `w_k = Sigma^-1 mu_k` and `b_k = -0.5 mu_k^T w_k`. This agrees with the [standard LDA formulation](https://scikit-learn.org/stable/modules/lda_qda.html).

Independent NumPy checks on controlled matrices gave:

| Check | Observed discrepancy |
| --- | --- |
| 38-dimensional symmetric eigenvalues versus NumPy `eigh` | Maximum absolute error 6.93e-14 |
| Eigenvector equation, relative matrix residual | 5.33e-15 |
| Eigenvector orthogonality | Maximum error 7.33e-15 |
| LDA coefficients versus an independently constructed pooled/shrunk covariance solve, fixed shrinkage 0.2 | Maximum error 1.14e-7, consistent with stored Float32 coefficients |
| Random-walk transition row sums | Maximum error 2.22e-16 |
| 40-step reference scores versus a direct stationary-system solve | L1 difference 2.42e-7 on the probe |

The random walk is `p_next = alpha e_query + (1-alpha) P^T p`. At the default alpha 0.2 it is mass-preserving and contractive for the valid stochastic rows. The worst-case node-distribution L1 bound after 40 steps is `2 * 0.8^40 = 0.000265846`. This bound concerns numerical convergence, not identification accuracy. Changing alpha requires revisiting the iteration budget.

The frozen split-calibration p-value `(1 + number of calibration scores >= query score) / (n + 1)` has the standard finite-sample form, with one maximum score per calibration animal and disjoint training animals. Its statistical interpretation still requires a fixed scoring protocol and comparable independent animals. Known-class set coverage does not imply unknown-species detection power. See [Angelopoulos and Bates](https://arxiv.org/abs/2107.07511), particularly class-conditional prediction and outlier detection.

Temperature scaling is an established calibration approach, but transfer of its empirical performance to this application must be measured: [Guo et al.](https://proceedings.mlr.press/v70/guo17a.html).

## Evidence for choosing a method

These are stored development results, evaluated on held-out animal groups but summarized over wings. The benchmark was inspected rather than regenerated in this review.

| Method | Balanced accuracy |
| --- | --- |
| Procrustes + PCA + LDA | 86.85% |
| kNN, direct standardized coordinates with cosine | 80.05% |
| Random walk, direct coordinates with cosine | 79.07% |
| Random walk, FlyHash 2,048 cells | 79.20% |
| Random walk, FlyHash 4,096 cells | 79.68% |

LDA's overall accuracy is 94.84%, but its B. cryptarum recall is 75%; the abundant B. terrestris records make overall accuracy look substantially stronger than balanced accuracy. No uncertainty intervals are supplied, and this comparison does not establish a statistically significant method advantage or performance on other genera.

My assessment is to retain Procrustes/PCA/shrinkage-LDA as the primary development baseline for the anatomically compatible Bombus landmark workflow. Keep kNN and the graph as comparators until an independent study shows value. The stored results do not demonstrate that FlyHash or the graph adds a material identification benefit, and FlyHash is a fixed random embedding rather than a learned image encoder.

Wing-image identification itself is plausible: [Spiesman et al.](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0303383) studied a CNN on 1,069 wing images covering 18 species from four genera. That supports testing learned image features, but validates neither this implementation nor its WIP fusion.

The existing pipeline audit probes were rerun, along with the Node test suite. Numerical agreement and software tests support implementation correctness on their covered cases; the application needs the independent biological evaluation above before reliable deployment claims are warranted.
