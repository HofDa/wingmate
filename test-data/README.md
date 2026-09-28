# Entwicklungsdatensatz

36 lokal gespeicherte Wildbienen-Vorderflügelbilder bzw. veröffentlichte Panels:

- **18 originale PNGs** aus Molasy & Tofilski (Zenodo 19703357): drei Bombus-Arten,
  beide Geschlechter, linke/rechte Seiten, 3488 × 2616 px, schwankende Helligkeit,
  Abrieb, Artefakte und häufig abgeschnittene Basis. In `difficult/`.
- **18 Panels A–R** aus Spiesman et al. (2024), Fig S2 im S1-Supplement:
  Agapostemon, Bombus, Ceratina, Lasioglossum. Crops aus dem publizierten Raster,
  ohne Resize/Farbänderungen; Beschriftungen bleiben erhalten. Panel F zeigt
  einen weitgehend vollständigen Flügel (`venation/`), andere sind angeschnitten
  oder beschädigt (`difficult/`). Keine unabhängig wiederholten Aufnahmen.

Die Originalbilder wurden visuell als Kontaktübersicht geprüft. Die automatische
Maske muss trotzdem pro Bild kontrolliert werden. Besonders Bilder mit Rahmen,
Schrift, starker Hintergrundvariation oder angeschnittener Kontur können große
Hintergrundflächen einschließen; `REVIEW` bedeutet **nicht freigegeben**.
Eine positive GOOD-Regelbewertung ist ebenfalls keine biologische Validierung.

`metadata.json` enthält Quelle, Autor, Lizenz, Taxon, soweit dokumentiert
Geschlecht/Seite, unbekannte Herkunft als null, Bildtyp, Zitat, Datum, Prüfsumme,
Schwierigkeitsmerkmale und exakte Ableitung. Geschlecht F/M im Zenodo-Satz stammt
aus Dateinamen, nicht aus eigener taxonomischer Überprüfung. Die CSV mit allen
19 Landmark-Koordinaten bleibt unverändert als `landmarks-original.csv` erhalten.
Links/rechts desselben Tieres sind keine Wiederholungsaufnahmen desselben Flügels.

## Reproduktion

```bash
python3 scripts/fetch-test-data.py
# Danach S1 File über den in metadata.json dokumentierten PLOS-Link laden:
python3 scripts/extract-publication-panels.py /path/to/supplement.docx
```

Erster Befehl benötigt nur Python-Standardbibliothek und lädt 18 ZIP-Mitglieder
über Byte-Ranges statt 2,7 GB Gesamtdaten. Zweiter benötigt Pillow. Die Auswahl
ist deterministisch (drei Positionen je Art/Geschlecht). Lizenzen und Attribution
stehen in `LICENSES.md`. Keine Dateien aus Quellen mit unklarer Lizenz kopiert.

`benchmark.json` protokolliert Verarbeitung/QC und Laufzeiten aller Bilder;
**keine** Segmentierungsgenauigkeit, da kuratierte Ground-Truth-Masken fehlen.
`real-invariance.json` untersucht kontrollierte geometrische Varianten eines
publizierten Bildes. Hintergrund-Padding erzeugt zusätzliche künstliche
Bildgrenzen; solche Fehler bleiben im Bericht sichtbar. Dies ist kein Test
unabhängiger Wiederholungsaufnahmen und keine externe Validierung.

WIP-Recherche und ausgeschlossene Quellen sind in `wip/README.md` und
`rejected/sources.json` dokumentiert. Der Dryad-Datensatz mit echten binären
Referenzmasken war recherchierbar, die Downloads wurden aber serverseitig
abgelehnt. Es werden keine Referenzmasken oder realen WIP-Paare vorgetäuscht.
