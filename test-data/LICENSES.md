# Dataset attribution and terms

The code's license does not replace the licenses on these research data.

## Zenodo subset (18 original PNG files, plus untouched landmark CSV)

Molasy, Bartłomiej; Tofilski, Adam (2026). *Fore wing images of Bombus cryptarum,
B. lucorum, and B. terrestris*. https://doi.org/10.5281/zenodo.19703357

The record declares **Open Database License (ODbL 1.0)**:
https://opendatacommons.org/licenses/odbl/1-0/
The retrieved record is preserved in `source-record.json`. Retain attribution and
ODbL notices when redistributing this subset; the extracted database remains
available under ODbL. This is the publisher's record-level license, not a claim
that these images are public domain. No original pixel files were modified.

The separately packaged [numeric Bombus starter](../models/bombus-starter/NOTICE.md)
uses this source's landmark coordinates only. Its unchanged source CSV, adapted
reference database and fitted numeric model database are distributed under ODbL
1.0 with source checksums, embedded attribution and a reproducible alteration
recipe. No original photographs are added to that starter package. ODbL's
database terms do not establish individual-image copyright permission.

## Spiesman et al. publication panels (18 derived crops)

Spiesman BJ, Gratton C, Gratton E, Hines H (2024). *Deep learning for identifying
bee species from images of wings and pinned specimens*. PLOS ONE 19(5): e0303383.
https://doi.org/10.1371/journal.pone.0303383

**CC BY 4.0**: https://creativecommons.org/licenses/by/4.0/
Source: S1 File, Fig S2, panels A–R. Article license evidence:
https://pmc.ncbi.nlm.nih.gov/articles/PMC11132477/

Changes: individual panels cropped from `sources/Spiesman-2024-S2.png`.
No color correction or resizing. Exact crop rectangles, source URLs, attribution
and SHA-256 checksums are in `metadata.json`. Panel labels remain present.
The separately linked GitHub image repository has no explicit license and its
standalone images were **not** copied.

## Apis mellifera numeric source

Pinned Zenodo record [18845767](https://doi.org/10.5281/zenodo.18845767),
Machlowska et al. (2026), v2: unchanged numeric CSVs and publisher metadata
are in `models/apis-source/`. The source and adapted reference collection
are provided under ODbL 1.0; [NOTICE](../models/apis-source/NOTICE.md) contains
the full attribution and applicable terms. No source images are included.
