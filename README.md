# Bee × Fly Connectome MVP

Lokaler Forschungsprototyp für Wildbienen-ID aus **Wing Interference Patterns (WIP)** und **Flügeladerung**.


**Benutzerhandbuch:** [docs/Benutzerhandbuch.md](docs/Benutzerhandbuch.md) – Bedienung Schritt für Schritt, Rig, Landmarken, Training, Fehlerbehebung.
**Modellentwicklung:** [docs/model-development.md](docs/model-development.md) – tierbasierte Auswertung, Distanzkalibrierung und unabhängige Tests.
**Optionales Startmodell:** [models/bombus-starter/README.md](models/bombus-starter/README.md) – Landmarken-LDA für drei Bombus-Arten, numerische Referenzdaten und ODbL-Zitation.
**Aufnahme-Rig zum Drucken:** [rig/README.md](rig/README.md) – parametrisches OpenSCAD-Modell, STL, Teileliste, Montage.

## Pipeline

1. Venationsbild und optional WIP desselben Vorderflügels, mit dokumentierter QC
2. Flügelmerkmale und optionale manuelle Landmarken im passenden anatomischen Schema
3. Ein Referenzprototyp pro Tier aus seinen unterschiedlichen Flügelansichten
4. Standard: Procrustes/PCA/LDA mit Landmarken, sonst Distanz-kNN auf standardisierten Merkmalen
5. Separate Tier-Kalibrierung anhand von Merkmalsdistanzen; live nur explorative Typikalität
6. Cosine-kNN, FlyHash und Random Walk als Entwicklungsvergleiche
7. Abschlusstest an unabhängigen Tieren und ungesehenen Taxa außerhalb der Entwicklung

## Start

Für ES-Module und Web Worker einen lokalen HTTP-Server im Projektordner starten:

```bash
python -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## GitHub Pages

Die veröffentlichte App: **https://hofda.github.io/wingmate/**.

Der Workflow `.github/workflows/pages.yml` testet bei jedem Push auf `master` die Anwendung, erstellt das statische `_site`-Artefakt und veröffentlicht es über GitHub Pages. In den Repository-Einstellungen ist **Pages → Source → GitHub Actions** erforderlich. Der Workflow kann auch manuell gestartet werden.

`npm run build:pages` erstellt das Artefakt lokal in einem leeren `_site`-Verzeichnis. Es enthält die Laufzeitdateien und Icons; Testdatensätze, Entwicklerwerkzeuge und lokale Zertifikate werden nicht als Website veröffentlicht. Die Service-Worker-Version wird aus dem Inhalt des Artefakts erzeugt, damit geänderte Deployments automatisch einen neuen Offline-Cache erhalten. `PWA_SITE_ROOT=_site node scripts/pwa-smoke.cjs` prüft das fertige Artefakt inklusive Unterverzeichnis-Hosting und Offline-Nutzung.

Die Online-App speichert ihre Referenzen und Exemplare separat von `localhost`, da Browserspeicher an die Herkunft gebunden ist. Referenzen bei Bedarf lokal exportieren und in der veröffentlichten App importieren.

Für das **Smartphone** (Kamera braucht HTTPS) im selben WLAN:

```bash
npm run serve:https     # druckt https://<LAN-IP>:8443; Zertifikatswarnung einmal bestätigen
```

## Bedienung

Die App hat vier Bereiche (unten am Handy, oben am Desktop):

- **Exemplar** – Venation (und optional WIP) per **Foto wählen** (am Handy: Kamera oder Galerie)
  oder **Live-Kamera** laden, dann unter **Prüfen & Landmarken** Maske und Orientierung prüfen
  (*Um 180° drehen*, *Spiegeln*, *Standard geprüft*) und Landmarken setzen. Seltenes liegt
  eingeklappt unter *Maske korrigieren*, *Export & Metadaten* und *Weitere Aktionen*.
- **Ergebnis** – Bestimmung (Ähnlichkeitsgraph, Procrustes + LDA, offene Menge); Einbettung und
  Random Walk eingeklappt.
- **Referenzen** – Sammlung (Export/Import), Live-Prüfung und **Modell trainieren**.
- **Einstellungen** – Aufnahme-Rig, Rechenraum/FlyWire, App-Installation, Methodik.

Die Leiste am unteren Rand zeigt für das aktuelle Exemplar den Stand (Bild · Geprüft · Landmarken)
und genau den nächsten Schritt: **Freigeben**, danach **Bestimmen** oder **Als Referenz …**
(Art, Exemplar-ID, Geschlecht, Serie/Fundort).

## Als PWA installieren und offline nutzen

Die App enthält ein Web-App-Manifest, Installationsicons und einen Service Worker. Nach dem ersten vollständigen Online-Aufruf meldet die Leiste **Offline bereit**. Danach funktionieren App-Start, lokale Bildverarbeitung, Klassifikation und Markov-Walks auch ohne Netzwerk. Referenzen bleiben im bestehenden `localStorage`, archivierte Exemplare in IndexedDB. Die Installation migriert keine Daten zwischen Browsern oder Geräten; Referenzen weiterhin regelmäßig exportieren.

- Desktop/Android: **App installieren** anklicken, sobald der Browser die Installation anbietet; alternativ das Browsermenü verwenden.
- iPhone/iPad: **Teilen → Zum Home-Bildschirm** verwenden.
- Für Geräte im Netzwerk und öffentliche Bereitstellung **HTTPS** verwenden. `http://localhost:8000` genügt für lokale Entwicklung; eine unverschlüsselte LAN-IP genügt nicht für den Service Worker.
- Die Dateien können ohne Build-Schritt auch in einem Unterverzeichnis bereitgestellt werden. Manifest, Start-URL und Cache sind relativ zum App-Verzeichnis.

Neue Versionen werden im Hintergrund vollständig geladen. **Update laden** aktiviert die neue Version und lädt die Seite neu; vorher ungespeicherte Arbeit sichern. Ohne diesen Klick wartet ein Update, bis alle App-Fenster geschlossen sind. Gespeicherte Referenzen und Exemplare werden bei Updates nicht gelöscht. Nur die aufgelisteten App-Dateien werden gecacht; große Testdaten und importierte Graphdateien sind nicht Teil des Offline-Caches. Importierte Graphen und ungespeicherte Bilder müssen nach einem Neustart wie bisher erneut geladen werden.

Bei Änderungen an App-Dateien die `VERSION` in `sw.js` erhöhen und die vollständige Anwendung gemeinsam veröffentlichen. Neue Laufzeitmodule in `APP_FILES` aufnehmen. `sw.js` sollte vom Hosting ohne langfristigen HTTP-Cache ausgeliefert werden.

Prüfungen: `npm test`; mit installiertem Playwright und Chrome zusätzlich `node scripts/pwa-smoke.cjs` für Installierbarkeit, Offline-Reload, Worker, lokale Speicherung, Updates und Hosting im Unterverzeichnis. `node scripts/generate-pwa-icons.cjs` erzeugt die PNG-Icons aus `icons/wing.svg` erneut. Beide Browser-Skripte unterstützen `CHROME_PATH` für einen anderen Chrome-Pfad.

Installationsvoraussetzungen: [MDN – Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Alle Bilder und Referenzen bleiben lokal. Referenzen werden im Browser-`localStorage` gespeichert und können als JSON exportiert werden.

Nach einer Klassifikation erklärt **Wie entsteht das Ergebnis? · Markov-Kette** die Berechnung. Mit **Abspielen**, **Zurück**, **Weiter**, **Zum Start**, **Zum Ergebnis** und dem Schrittregler lassen sich die Schritte 0–40 untersuchen. Drei Kennzahlen zeigen die Wahrscheinlichkeit beim eigenen Exemplar, bei den Referenzen und den seit dem letzten Schritt verschobenen Anteil. Die Artentabelle trennt die rohe Wahrscheinlichkeit von den nach Referenzzahl ausgeglichenen Ähnlichkeitsscores; die Scores des letzten Schritts entsprechen den Random-Walk-Balken im Ergebnis.

Im Graphen bleiben Positionen und Farben während der Wiedergabe gleich. Ein Klick auf einen Knoten (oder Tab und Enter) zeigt seine Übergangschancen einschließlich des 20-%-Rücksprungs. **Beispielpfad anzeigen** schaltet einen reproduzierbaren simulierten Weg ein: Orange zeigt den Weg, gestrichelt einen Rücksprung. Dieser einzelne Weg bestimmt nicht die berechnete Verteilung. Bei großen Sammlungen zeigt der Graph bis zu 25 Knoten am Desktop bzw. 13 auf schmalen Ansichten; **Alle Knoten · genaue Werte** enthält sämtliche Knoten, Wahrscheinlichkeiten und Änderungen in Prozentpunkten. Änderungen an Eingaben, Referenzen oder Reservoir-Einstellungen setzen die Ansicht zurück. Dargestellt wird der Klassifikationsgraph, nicht die interne FlyWire-Propagation.

## Step 0 · Smartphone-Aufnahme & Rig (rig-profile-1)

**Live-Kamera** an einem Bildfeld (`imaging/camera.js`) nimmt direkt mit der Rückkamera auf: Live-Vorschau mit
Platzierungsrahmen (Basis links, Spitze rechts, anterior oben), Fokus-, Überbelichtungs- und
Rig-Abweichungsanzeige, Mittelung über 1–16 Frames (Rauschen ∝ 1/√N) und verlustfreie PNG-Übergabe
an die QC. Aufnahmemetadaten (Frames, Rauschen, Kameraeinstellungen, Rig-ID) werden mitarchiviert.

- **Android + Chrome:** Fokus, Belichtung, Weißabgleich, ISO, Zoom und Taschenlampe werden – soweit
  die Kamera sie anbietet – nach dem Einpendeln mit **Aktuelle Einstellungen fixieren** gesperrt, im
  Rig gespeichert und beim nächsten Start automatisch mit exakt derselben Auflösung wieder angewendet.
- **iPhone (Safari):** Web-Seiten erhalten keine manuelle Kamerasteuerung. Live-Aufnahme funktioniert,
  aber mit Automatik; alternativ **Foto wählen** → Kamera-App (volle Auflösung, dort AE/AF-Sperre
  durch langes Tippen). Die Driftprüfung meldet dann abweichende Belichtung. iOS wechselt im
  Nahbereich teils automatisch das Objektiv; das verändert Maßstab und Licht – Profil erkennt das
  nur über Drift/Größe, daher Makro-Vorsatz fest auf die Hauptkamera.

### Rig kalibrieren

Unter **Rig kalibrieren** im Live-Kamera-Bereich (oder *Einstellungen → Mit der Live-Kamera kalibrieren*), mit montiertem Rig, eingeschaltetem Licht und fixierter Kamera:

1. **Venation-Hintergrund** – leerer Objektträger im Durchlicht (16 Frames gemittelt).
2. **WIP-Hintergrund** – leer, schwarzer Hintergrund, Auflicht.
3. **WIP-Graukarte** (optional) – neutrale Graukarte an der Flügelposition, Auflicht.
4. **Maßstab** (optional) – Lineal/Objektmikrometer an der Flügelposition, zwei Punkte anklicken, mm eingeben.

Das Profil (`imaging/rig.js`, IndexedDB, als JSON export-/importierbar) wird angewendet, wenn die
Bildgröße exakt passt; sonst verarbeitet die QC ohne Korrektur und sagt warum. Mit Profil:

- **Flat-Field-Korrektur** `out = in × Ziel / Beleuchtung(x,y,Kanal)` aus dem geglätteten leeren
  Durchlichtbild bzw. der Graukarte: entfernt Vignettierung, ungleichmäßiges Licht und Farbstich
  (Referenz wird neutralgrau). Gesättigte Sensorwerte bleiben gesättigt. Die Originaldatei wird
  unverändert archiviert; die Korrektur steht in `radiometricCorrection`.
- **Hintergrundmodell pro Pixel** für die Segmentierung statt einer Randfarbe; statischer Staub auf
  Glas/Diffusor hebt sich auf, die Schwelle folgt dem gemessenen Rauschen.
- **Driftprüfung** (Randband gegen Profil): verschobenes Rig oder anderes Licht → REVIEW und
  Rückfall auf die Randfarben-Segmentierung statt eines stillen Fehlers.
- **Absolute Größe**: Mit Maßstab und ohne Randkontakt speichert `metricSize` Flügellänge (mm) und
  -fläche (mm²); der Klassifikator nutzt sie als Block `size` (log), sobald alle Referenzen sie haben.
  Die Normalisierung auf 1024 × 512 entfernt Größe weiterhin.
- Unabhängig vom Rig: Sättigung im Flügel (> 0,5 %) → REVIEW; Schärfe (Laplace-Varianz) wird gespeichert.

In einer synthetischen Prüfung (starke Vignettierung, Farbstich, Staubfleck am Flügelrand) steigt die
Masken-IoU mit Profil auf > 0,95 und liegt deutlich über der Randfarben-Segmentierung
(`tests/rig.test.js`). Das ist ein Modelltest, keine Validierung an echten Rig-Aufnahmen.

### Hinweise für den Aufsatz

- Flügel flach zwischen Objektträger und Deckglas (ein Tropfen 70 % Ethanol hilft beim Glätten) in
  einem festen Schlitz auf Fokusebene; Aufnahme immer derselben Seite bzw. Spiegelung in der QC.
- Venation: gleichmäßiges, diffuses Durchlicht (LED-Panel + Opal-Diffusor), Konstantstrom-LEDs ohne
  PWM – PWM erzeugt mit dem Rolling Shutter Streifen, die keine Flat-Field-Korrektur entfernt.
- WIP: lichtschluckender schwarzer Untergrund (Velours/Flock), Auflicht unter festem Winkel; WIP-Farben
  hängen von Licht- und Blickwinkel ab, daher beides mechanisch fixieren. Gehäuse geschlossen halten,
  damit kein Umgebungslicht einfällt.
- Hohe Farbwiedergabe (CRI ≥ 90) und nach Wechsel von Lampe, Diffusor, Vorsatzlinse oder Telefon
  neu kalibrieren. Die Rig-Abweichung in der Vorschau zeigt, wann das nötig ist.

## Landmarken setzen (Procrustes + LDA)

In der QC-Karte des Venation-Bildes (ohne Venation: WIP) öffnet **Landmarken** den Editor
(`imaging/landmark-ui.js`, Schema/Koordinaten in `classifier/landmarks.js`):

- **Tippen/Klicken** setzt die aktuelle Landmarke und springt zur nächsten offenen. Ein Punkt wird
  nur verschoben, wenn man ihn *zieht* – so lassen sich eng benachbarte Landmarken (1/2, 16/17)
  setzen. Ein Klick auf einen anderen Punkt wählt ihn aus.
- **Lupe**: zeigt die *Originalpixel* (volle Kameraauflösung) in Standardorientierung, 6-fach.
  Ein Klick dort verfeinert die gewählte Landmarke und geht weiter – grob tippen, fein setzen,
  auch am Handy. Pfeiltasten verschieben um 0,25 px (Shift: 2 px), `n`/`p` wechseln, Strg+Z.
- **Führung**: Übersicht des mittleren Musters mit der aktuellen Nummer. Ab 2 Punkten wird es an
  die gesetzten Punkte angepasst und zeigt gestrichelt, wo die nächsten erwartet werden. Ab 4
  Punkten werden starke Abweichungen orange markiert (typisch: vertauschte Nummern).
- **Fehlt (beschädigt)** markiert eine nicht bestimmbare Landmarke; unvollständige Sätze gehen
  nicht in die Klassifikation ein.
- Gespeichert wird in **Originalpixeln**; die Punkte bleiben bei Drehen/Spiegeln/Schwelle/Neuberechnung
  gültig. Ins Archiv (IndexedDB), in den JSON-Export und als **Landmarken als CSV** (*Weitere Aktionen*)
  (`file,x1,y1,…`, y nach unten; `landmarksCsv(…, {yUp: true})` für die Konvention des Datensatzes)
  für MorphoJ/geomorph. Änderungen nach **Freigeben** heben die Freigabe auf.

**Schema** `bombus-19`: die 19 Landmarken des Molasy-&-Tofilski-Datensatzes (IdentiFly-Nummerierung).
Die Führung ist das Procrustes-Mittel aller 814 Flügel, nachgerechnet in `tests/landmarks.test.js`.
Achtung: die CSV des Datensatzes zählt **y von unten** (auf den 18 lokalen Bildern liegen die Punkte
nur so auf Aderkreuzungen). Für Gattungen mit anderer Aderung (z. B. 2 Submarginalzellen) ist ein
eigenes Schema nötig; Blöcke verschiedener Schemata werden nie verglichen.

**Klassifikation**: Vollständige Landmarken eines *orientierungsbestätigten* Bildes werden zum Block
`landmarks` (Standardansicht, damit linke und rechte Flügel nach dem Spiegeln vergleichbar sind –
Procrustes entfernt keine Spiegelung). Haben alle Referenzen Landmarken desselben Schemas, zeigt die
Ausgabe zusätzlich **Procrustes + LDA**: GPA (nur auf Trainingsreferenzen; Abfrage an feste Mittelform angepasst) → Hauptkomponenten
(bei wenigen Exemplaren höchstens (n − Taxa)/2) → LDA mit Ledoit–Wolf-Schrumpfung →
Wahrscheinlichkeiten per gruppiertem Leave-one-out **temperaturkalibriert**. Die Validierung listet
die LDA-Zeile zuerst. LDA wählt immer ein bekanntes Taxon; für Unbekannte gilt das konforme Set.

Die Temperatur wird nur aus den Trainingsgruppen geschätzt. Auch in dieser inneren
Validierung wird die Procrustes-Ausrichtung neu angepasst. Entwicklungswerte ersetzen
keinen Test an unabhängigen Tieren oder eine Prüfung der Erkennung unbekannter Arten.

## Training (Modell einfrieren)

Unter **Referenzen → Modell trainieren** (`classifier/model.js`, läuft im Worker):

1. **Bereitschaft** je Art: Exemplare, Flügel, Landmarken, Geschlecht, Serien; Warnung bei
   < 10 Exemplaren, nur einem Geschlecht oder nur einer Serie/Fundort.
2. **Trainieren** reserviert je Taxon standardmäßig 20 % der unabhängigen Tiere für die
   Kalibrierung (mindestens zwei Tiere bleiben im Training). Diese Tiere beeinflussen keine
   Anpassung von Ausrichtung, Standardisierung, PCA oder LDA. Ein fester FlyHash lernt keine
   Bildmerkmale. Fehlende Modalitäten erfordern eine explizite Wahl des Eingabemodus.
3. **Bewertung** aller Verfahren mit denselben stratifizierten, nach Exemplar gruppierten
   5 Falten, mit neu angepasster Pipeline pro Trainingsfold. Landmarken-LDA ist Standard,
   sonst Distanz-kNN; andere Verfahren bleiben Vergleiche. Jedes Tier zählt einmal, Flügelwerte
   stehen getrennt im Export. Die Intervalle resampeln Tiere. Das sind Entwicklungswerte, kein unabhängiger Abschlusstest. Haben alle Referenzen eine Serie,
   zusätzlich **Transfer auf ungesehene Serien** (jeweils eine Serie zurückgehalten).
4. Das Modell wird gespeichert (IndexedDB), ist exportier-/importierbar (`wingmate-model-3`,
   JSON) und bestimmt, solange aktiv, alle neuen Tiere; neue Flügel richtet es per Procrustes an
   der gespeicherten Mittelform aus. Geänderte Referenzen werden angezeigt – dann neu trainieren.

Serien/Geschlecht müssen die spätere Anwendung abdecken. Stabile Exemplar-IDs sind Pflicht,
damit linke/rechte Flügel eines Tieres im selben Split bleiben. Alte Modelle benötigen neues
Training. Bildreferenzen aus `wing-features-1` / `wing-normalizer-0.2` müssen aus den archivierten
Originalen neu verarbeitet werden; Dateien und Archive werden nicht gelöscht.

## Echte FlyWire-Daten

Codex bietet für FlyWire-FAFB öffentliche Daten-Downloads und exportierbare Connectivity-Tabellen. Für den Browser sollte nicht das komplette Netzwerk geladen werden, sondern ein Subgraph (z. B. Mushroom Body / Kenyon-cell-bezogene Zellen).

1. Connectivity-CSV aus Codex/FlyWire exportieren.
2. Falls gewünscht, zusätzlich eine Liste erlaubter Root IDs erstellen.
3. CSV kompakt konvertieren:

```bash
python prepare_flywire.py connections.csv flywire-subgraph.json \
  --source-col pre_root_id \
  --target-col post_root_id \
  --weight-col syn_count \
  --min-weight 5 \
  --max-nodes 20000 \
  --max-edges 150000
```

Falls die CSV andere Spaltennamen verwendet, diese per `--source-col`, `--target-col`, `--weight-col` angeben.

Danach `flywire-subgraph.json` im UI unter **FlyWire-Subgraph importieren** laden.

## Step 2 · Klassifikation (wing-features-2)

Code in `classifier/` (reine ES-Module, in Node getestet), UI in `app.js`, Markov-Ansicht in `walk.js`.

1. **Merkmale** (`features.js`) auf dem auf 256 × 128 verkleinerten Normalbild, mit separater
   Innenmaske gegen interpolierte Konturränder. Gleichförmige Membranen erzeugen keine Adermerkmale:
   Umrissprofil (66), Venation als HOG-artige Orientierungshistogramme + relative Dunkelheit
   je 8 × 4-Zelle ohne Konturrand (288), WIP als CIELAB je Zelle + chroma-gewichtetes
   Farbtonhistogramm (112). Keine Farbkorrektur; Aufnahmebedingungen müssen fix sein.
2. **Standardisierung** auf einem Prototyp je Trainingstier (z-Score, jeder Block gleich gewichtet).
   Identische Wiederholungen werden entfernt, unterschiedliche Ansichten innerhalb eines Tieres gemittelt.
   Referenzen speichern **Merkmale, keine Embeddings**; bei jeder Klassifikation wird
   alles mit denselben Einstellungen neu eingebettet (alte v1-Embedding-Referenzen werden
   erkannt und nicht verwendet).
3. **Reservoir** (`embedding.js`): FlyHash nach Dasgupta et al. 2017 (zentrieren, dünne
   *binäre* Projektion mit Fan-in 6, Top-5 %-Winner-take-all), dichte Zufallsprojektion als
   LSH-Kontrolle, „kein Reservoir“, optional FlyWire-Graph (explorativ: Merkmal→Neuron-
   Zuordnung ist willkürlich).
4. **Random Walk with Restart** auf dem kNN-Graphen (k = 7, Restart 0,2, 40 Schritte).
   Die Masse je Taxon wird durch dessen Referenzzahl geteilt, sonst gewinnt das häufigste
   Taxon. `rwrTransitions` liefert dieselbe Übergangsmatrix an die Markov-Ansicht; ein Test
   prüft, dass `traceWalk` exakt die bewertete Verteilung reproduziert.
5. **Open-set** im eingefrorenen Modell: label-bedingte Split-Kalibrierung gegen getrennte
   Tiere. Der Score misst euklidische Distanzen in den standardisierten Merkmalen ohne
   L2-Normalisierung; damit bleiben extreme Abweichungen entlang bekannter Richtungen sichtbar.
   Mehrere Flügel eines Kalibrierungstieres ergeben nur einen (maximalen) Score; auch die
   Nachbarschaft zählt Tiere, nicht doppelte Flügel. Bei ε = 0,1 sind mindestens neun unabhängige
   **Kalibrierungstiere je Taxon** für die nötige p-Wert-Auflösung erforderlich. Darunter meldet
   die UI unzureichende Kalibrierung. Live-Jackknife bleibt ausdrücklich explorativ und darf keine
   kalibrierte Abdeckung oder belastbare Erkennung unbekannter Arten behaupten.
6. **Validierung** im UI: gruppierte Kreuzvalidierung mit vollständiger Anpassung innerhalb der
   Trainingsgruppen, aktueller Modus gegen kNN und „kein Reservoir“. Bilderpaare erfordern eine
   Bestätigung desselben Flügels und der inneren Korrespondenz. QC-Hinweise benötigen eine
   dokumentierte Freigabebegründung; ein plausibler Umriss allein belegt keine brauchbare Aderung.

### Benchmark auf realen Daten

`node scripts/landmark-benchmark.js --out test-data/landmark-benchmark.json` nutzt
814 Landmarkdatensätze (423 Exemplare, 3 *Bombus*-Arten). Version 3 prüft die
**Klassifikationsstufe** mit Tierprototypen, Tierergebnissen und Bootstrap-Intervallen in
identischen fünf gruppierten Folds, getrennter Tier-Kalibrierung und
Procrustes/Skalierung/PCA/LDA ausschließlich im Trainingsfold. Die innere Temperaturkalibrierung
hält ebenfalls ganze Tiere zurück und passt die Ausrichtung neu an.

Die frühere Tabelle mit globaler Procrustes-/z-Score-Anpassung wurde entfernt. Die aktuellen
Messwerte und das genaue Protokoll stehen in `test-data/landmark-benchmark.json`. Sie belegen
keine Genauigkeit der vollständigen Bildpipeline und keinen Nutzen echter gepaarter Bee-WIP-Daten.
Der [Auditbericht](docs/pipeline-audit.md) dokumentiert die verbleibenden Daten- und Forschungsaufgaben.

### Tests

```bash
npm test                                           # Node: Normalisierung, Klassifikation, Walk
NODE_PATH=… node scripts/markov-ui-e2e.cjs        # Browser: Markov-Anzeige, Daten, Steuerung, Desktop/Handy
NODE_PATH=… node scripts/classifier-e2e.cjs        # Browser: QC → Referenzen → Klassifikation → Walk → Validierung
NODE_PATH=… node scripts/camera-e2e.cjs            # Browser, Fake-Kamera: Rig kalibrieren → Neustart → Aufnahme → QC
NODE_PATH=… node scripts/landmark-e2e.cjs          # Browser, 7 reale Flügel: 19 Landmarken per UI, Lupe, LDA, CSV
NODE_PATH=… node scripts/training-e2e.cjs          # Browser: Training im Worker, Bericht, Modell bestimmen, Export/Import
```

Der Landmarken-E2E klickt die publizierten Landmarken durch die Oberfläche, prüft den exakten
Koordinatenweg (Klick → Standardansicht → Originalpixel, auch mit Flip/Mirror), dass die Punkte
auf Aderkreuzungen des angezeigten Bildes liegen, sowie LDA-Ergebnis, Validierung und CSV-Export.
Er misst nicht, wie genau ein Mensch klickt.

Der Klassifikations-E2E prüft Verdrahtung und Konsistenz auf den Entwicklungsbildern, keine
Genauigkeit. Der Kamera-E2E erzeugt synthetische Y4M-Videos (leeres Rig / Rig mit Flügel inkl.
Vignettierung, Farbstich, Rauschen) und prüft Flat-Field, Hintergrundmodell, Drift, Masken-IoU > 0,95
und die mm-Länge. Beide brauchen einen Server auf `127.0.0.1:8000`.

## Was noch nicht „Publikationsniveau“ ist

- Die WIP- und Aderungsfeatures sind bewusst leichtgewichtig und interpretierbar. Für ernsthafte Taxonomie sollten CNN/ViT-Embeddings bzw. automatische Landmark-Erkennung ergänzt werden.
- Das eingefrorene Modell nutzt getrennte Kalibrierungstiere; die Live-Bestimmung bleibt heuristisch. Die Erkennung unbekannter Arten braucht einen separaten Test mit zurückgehaltenen Taxa.
- Die Mushroom-Body-Variante ist biologisch inspiriert; nur der importierte Graph verwendet reale FlyWire-Konnektivität.
- Vor einer wissenschaftlichen Aussage muss gegen starke Baselines verglichen werden: Procrustes+LDA/SVM, kNN, direkte CNN/ViT-Klassifikation, randomisiertes Reservoir und randomisierte FlyWire-Topologie.

## Sinnvoller erster Datensatz

Für einen Proof of Concept eher 5–10 gut abgesicherte Arten, mehrere Individuen pro Art, standardisierte WIP-Aufnahme und Durchlichtaufnahme desselben Flügels. Danach schwierige Artgruppen hinzufügen.

## Step 1 · Flügelnormalisierung (wing-normalizer-0.3)

Start jetzt **über HTTP**, da ES-Module und Web Worker verwendet werden:

```bash
npm run serve
# http://localhost:8000
npm test
```

Venation und/oder WIP hineinziehen. Die QC zeigt Original, echte Binärmaske,
normalisiertes Bild und Kontur/PCA/Schwerpunkt/Basis-/Spitzenkandidaten.
*Um 180° drehen* und *Spiegeln* korrigieren die Orientierung. Originalseite separat
angeben; vor *Freigeben* bestätigen: Basis links, Spitze rechts, Vorderrand oben.
Schwelle ändern oder eine extern korrigierte Schwarzweißmaske importieren,
wenn die automatische Segmentierung nicht ausreicht. `Reset` verwirft die
Korrekturen, erhält aber die dokumentierte Originalseite.

*Freigeben* archiviert Originaldateien, Masken, normalisierte RGBA-Bilder und
Metadaten lokal in IndexedDB. `Letztes Exemplar öffnen` lädt sie erneut zur QC.
PNG- und JSON-Exporte sind portable Ergebnisse; Browserdaten können vom Benutzer
oder Browser gelöscht werden. JSON enthält auch die Analysemaske als binäre
Lauflängencodierung (beginnt mit Anzahl der Nullen). Feature-Referenzen enthalten
die Vorverarbeitungsversion, Transformationen und Archiv-ID. Alte Referenzen
werden nicht automatisch mit neuen Koordinaten verglichen.

### Verfahren und Koordinaten

- Deterministische Segmentierung auf höchstens 640 px langer Analyseachse:
  dominante Randfarbe, RGB-Abstand, morphologisches Schließen, Lochfüllung,
  größte plausible längliche Komponente. Keine rechteckige Ersatzmaske.
- PCA bestimmt die Längsachse; ein Querschnittsbreitenprofil vergleicht beide
  Enden. Dies ist eine **ungeprüfte Heuristik**, keine anatomische Garantie.
  `orientationConfidence` und `maskConfidence` sind Kategorien, keine
  statistischen Wahrscheinlichkeiten. Symmetrische/abgeschnittene Flügel prüfen.
- Standardcanvas 1024 × 512, mindestens 32 px Rand, Maskenschwerpunkt exakt bei
  (511.5, 255.5). Einheitliche Skalierung ohne Stretching. Die ausgewählte
  Analyseauflösung begrenzt die Konturgenauigkeit; Original-RGB bleibt erhalten.
- Matrizen: zeilenweise 3 × 3, Spaltenvektor `[x,y,1]`. Pixelzentren liegen bei
  ganzzahligen Koordinaten; Originalkoordinaten beziehen sich auf das durch den
  Browser decodierte, EXIF-orientierte Bild. `inverseTransformMatrix` führt zurück.
- RGB wird einmal direkt aus dem Original bilinear resampelt, die Maske per
  nearest-neighbor. Außerhalb der Maske ist Alpha 0. Keine Farbverbesserung,
  Weißabgleich, Histogrammänderung oder WIP-Klassifikation. Browser-Decodierung
  ist keine kontrollierte wissenschaftliche Farbkalibrierung; Originaldateien
  werden unverändert archiviert.
- `scale` ist Pixelnormalisierung, keine Körpergröße. `originalMetricScale`
  bleibt separat und standardmäßig `null`; die API kann z. B.
  `{micrometersPerPixel: 2.5, source: 'stage micrometer'}` erhalten.
- Flächen/Bounding Box in `maskQuality` sind ausdrücklich Analysepixel;
  `wingAreaOriginalPixels` rechnet die Fläche zurück. Originalmaße, Randkontakt,
  Fragmentierung, effektive Parameter und Version werden gespeichert.
- WIP wird über binäre Flügelform auf die normalisierte Venation registriert:
  begrenzte Rotation, uniforme Skalierung und Translation, keine Scherung oder
  nichtlineare Verformung. Registrierung speichert ihre eigene Matrix und die
  zusammengesetzte Original→Referenz-Matrix. Referenz und Moving müssen dasselbe
  Individuum und denselben Vorderflügel zeigen. Eine hohe Mask-IoU belegt keine
  genaue Übereinstimmung innerer Ader-Landmarks.

Die Rechenlogik liegt in `imaging/{segmentation,quality,orientation,normalization,
registration,pipeline,matrix}.js`, der Worker in `worker.js`, UI und Speicherung
in `qc-ui.js` / `storage.js`. Reservoir, FlyWire und Random-Walk-Verfahren wurden
für diesen Schritt nicht erweitert.

### Entwicklungsdaten und Validierung

Siehe [Datensatzdokumentation](test-data/README.md),
[Lizenzen](test-data/LICENSES.md), [Metadaten](test-data/metadata.json) und
[Benchmark](test-data/benchmark.json). 36 reale Aufnahmen/Publikationsausschnitte
sind lokal enthalten. Die ausgeschnittenen Panels sind **keine Rohaufnahmen**.
Viele Bilder enthalten angeschnittene Basen, Schäden, Text oder Hintergrund-
artefakte und sind ausdrücklich schwierige Fälle. Es handelt sich um einen
Entwicklungsdatensatz, keine unabhängige wissenschaftliche Validierung.

Die Node-Tests verwenden analytische Flügelformen und prüfen Rotation 0/25/90/180°,
Translation, Objekt- und Rasterauflösung, Hintergrundhelligkeit, Spiegelung,
Determinismus, Rücktransformation, Maskenkorrektur, Lochfüllung, Artefakte,
WIP-RGB-Erhalt und Registrierung.

Browserprüfungen benötigen Playwright und Chromium (nicht für den App-Betrieb):

```bash
# Bei Bedarf NODE_PATH auf eine vorhandene Playwright-Installation setzen.
node scripts/browser-benchmark.cjs
node scripts/real-invariance.cjs
```

Ein geeignetes reales, kontrolliertes Wildbienen-WIP/Venation-Paar ist derzeit
nicht enthalten. WIP-Farberhalt wird synthetisch geprüft; biologische Paar-
registrierung und vollautomatische Seiten-/Basisbestimmung bleiben zu validieren.
## Apis mellifera reference data

An optional [honeybee numeric collection](models/apis-source/README.md) now
ships alongside the Bombus starter: 29,043 source wings from 1,342 colonies in
ten countries, under [ODbL 1.0 with attribution](models/apis-source/NOTICE.md).
The adapted collection selects one wing per colony; unchanged source CSVs,
publisher checksums and an offline build recipe are included. Rebuild with
`npm run build:apis-references`. The training panel offers the collection download.
Its Nawrocka (2018) numbering differs from the Bombus guide, so this is reference
data pending a verified anatomical mapping, rather than a combined classifier.
