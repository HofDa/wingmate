# Bombus numeric reference/model database — attribution and licence

Contains information from **Fore wing images of Bombus cryptarum, B. lucorum,
and B. terrestris**, by Bartłomiej Molasy and Adam Tofilski (2026), Zenodo:
https://doi.org/10.5281/zenodo.19703357.

The publisher's archived record declares Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/.
Keep this notice and the licence URI when distributing the database.

The numeric database in `source-landmarks.csv`, `references.json` and
`model.json` is made available under ODbL 1.0, including any database rights
Wingmate's contributors hold in the adaptations. Attribution is embedded in
both JSON files. `source-record.json` preserves the publisher's rights record.
This notice does not change the licence of the separate application code.

The original landmark CSV is unchanged. Adaptations convert y-up coordinates
to the application's base-left/anterior-up view, group paired wings by animal,
and fit the versioned model. The entire adapted reference database is supplied
in machine-readable form, alongside the unchanged numeric source and the build
recipe (`scripts/build-bombus-starter.mjs`, `scripts/bombus-source.mjs`). Public
outputs using this database should retain an associated source/ODbL notice.

Machine-readable downloads: [adapted reference database](references.json),
[unchanged numeric source](source-landmarks.csv), [fitted model database](model.json)
and [archived publisher record](source-record.json). The code recipe is available
in the [Wingmate source repository](https://github.com/HofDa/wingmate/blob/master/scripts/build-bombus-starter.mjs).

Only numeric landmarks are packaged here. ODbL covers database rights; it does
not itself grant copyright permissions for individual photographs (section
2.4). This package includes no original photographs or publication figure crops.
Other datasets are not part of this package. Further adaptation or combination
must preserve applicable attribution and database obligations.

Citation: Molasy, B.; Tofilski, A. (2026). *Fore wing images of Bombus cryptarum,
B. lucorum, and B. terrestris*. Zenodo. https://doi.org/10.5281/zenodo.19703357.
The trained adaptation is a Wingmate development artifact; it is not an
author-endorsed or independently validated species identification service.
