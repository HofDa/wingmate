# Apis mellifera numeric reference collection

Pinned source: [Machlowska et al. (2026), version 2](https://doi.org/10.5281/zenodo.18845767).
The source contains 29,043 worker fore wings from 1,342 colony samples across
BY, DE, ES, FR, GB, IE, LT, NL, NO and PL. This package includes only numeric
landmarks and metadata, with unchanged original CSV files in `originals/`.
No photographs or journal figures are included. See [NOTICE.md](NOTICE.md).

`references.json` contains one wing per colony, selected by the smallest
SHA-256 of `wingmate-apis-v1:<wing filename>`. All 1,342 colonies remain.
It preserves the original 38 coordinates (x1,y1,...,x19,y19), in pixels with
origin lower-left and y increasing upwards. `landmarkScheme` is explicitly
`apis-nawrocka-2018-19`, and `splitGroup` is the country-qualified colony ID.
This format is a published landmark collection, not an app feature export,
personal reference import or installable classifier.

Reproduce offline with `npm run build:apis-references`. The build verifies all
20 CSVs against the archived publisher MD5 manifest and records SHA-256 hashes
and attribution in the adapted collection. To fetch verified numeric originals,
run `python3 scripts/fetch-apis-data.py` (network required). Both recipes are
in the [source repository](https://github.com/HofDa/wingmate/tree/master/scripts).

Two German raw filenames (`DE-0003-14.dw.png`, `DE-0003-4.dw.png`) do not match
their metadata counterparts (which have `_0` suffixes). These two joins are
excluded without guessing a correction; `excludedJoins` records the discrepancy.
Other exact joins, finite integer coordinates and country-qualified colony IDs
are checked. Unexpected discrepancies fail the build.

The Apis and Bombus figures use different landmark numbering. Their anatomical
mapping must be independently verified before a shared feature adapter and
combined model can be built. A single named species provides no negative classes
for species discrimination. No subspecies labels, individual worker pairing or
sex distinctions beyond the publisher's worker description are inferred.

For future modelling, keep colonies together in training/calibration/test splits
and perform a country or acquisition holdout. Multiple wings within a colony are
not independent animals. The selected wings are an explicit colony-level sample,
not a prevalence estimate or an independently validated classifier. Combining
Apis from this study with Bombus from another also confounds species and source:
high internal accuracy alone would not establish acquisition transfer.

The app makes the small adapted collection and notices available offline. The
full unchanged numeric originals and archived record ship in the repository/site
but are not added to the app's offline cache.
