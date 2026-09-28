# Bee × Fly Connectome MVP

Lokaler Forschungsprototyp für Wildbienen-ID aus **Wing Interference Patterns (WIP)** und **Flügeladerung**.

## Pipeline

1. Zwei Bilder desselben Vorderflügels (ideal: Reflexionslicht für WIP + Durchlicht für Aderung)
2. Transparente, leichte Bildmerkmale im Browser
3. Drosophila-inspiriertes Mushroom-Body-Reservoir (sparse expansion + Winner-take-all)
4. Optional: echter gerichteter FlyWire/Codex-Subgraph
5. Referenzgraph aus sicher bestimmten Exemplaren
6. Random Walk with Restart + Labelaggregation
7. Open-set-Heuristik für Exemplare außerhalb des bekannten Referenzraums

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

Nach einer Klassifikation zeigt **Random-Walk erkunden** die Markov-Kette auf dem Referenzgraphen. Mit **Abspielen**, **Pause**, **Zum Start** und dem Schrittregler lassen sich die Schritte 0–40 untersuchen. Die Knotengröße und Tabelle zeigen die exakte Wahrscheinlichkeitsverteilung einschließlich der Anfrage; Orange zeigt eine reproduzierbare Beispieltrajektorie mit 20 % Restart-Wahrscheinlichkeit. Die finalen Taxon-Scores werden weiterhin aus der Verteilung berechnet und auf die Referenzmasse normiert. Bei mehr als 36 Knoten zeigt der Graph eine Auswahl; die Tabelle und Berechnung enthalten alle Knoten. Änderungen an Eingaben, Referenzen oder Reservoir-Einstellungen setzen die Ansicht zurück. Dargestellt wird der Klassifikationsgraph, nicht die interne FlyWire-Propagation.

## Step 0 · Smartphone-Aufnahme & Rig (rig-profile-1)

Die Karte **0 · Aufnahme** (`imaging/camera.js`) nimmt direkt mit der Rückkamera auf: Live-Vorschau mit
Platzierungsrahmen (Basis links, Spitze rechts, anterior oben), Fokus-, Überbelichtungs- und
Rig-Abweichungsanzeige, Mittelung über 1–16 Frames (Rauschen ∝ 1/√N) und verlustfreie PNG-Übergabe
an die QC. Aufnahmemetadaten (Frames, Rauschen, Kameraeinstellungen, Rig-ID) werden mitarchiviert.

- **Android + Chrome:** Fokus, Belichtung, Weißabgleich, ISO, Zoom und Taschenlampe werden – soweit
  die Kamera sie anbietet – nach dem Einpendeln mit **Aktuelle Einstellungen fixieren** gesperrt, im
  Rig gespeichert und beim nächsten Start automatisch mit exakt derselben Auflösung wieder angewendet.
- **iPhone (Safari):** Web-Seiten erhalten keine manuelle Kamerasteuerung. Live-Aufnahme funktioniert,
  aber mit Automatik; alternativ **Native Kamera** (volle Auflösung, in der Kamera-App AE/AF-Sperre
  durch langes Tippen). Die Driftprüfung meldet dann abweichende Belichtung. iOS wechselt im
  Nahbereich teils automatisch das Objektiv; das verändert Maßstab und Licht – Profil erkennt das
  nur über Drift/Größe, daher Makro-Vorsatz fest auf die Hauptkamera.

### Rig kalibrieren

Unter **Neues Rig kalibrieren**, mit montiertem Rig, eingeschaltetem Licht und fixierter Kamera:

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
- Gespeichert wird in **Originalpixeln**; die Punkte bleiben bei Flip/Mirror/Schwelle/Neuberechnung
  gültig. Ins Archiv (IndexedDB), in den JSON-Export und als **Landmarken CSV**
  (`file,x1,y1,…`, y nach unten; `landmarksCsv(…, {yUp: true})` für die Konvention des Datensatzes)
  für MorphoJ/geomorph. Änderungen nach **Accept** heben die Freigabe auf.

**Schema** `bombus-19`: die 19 Landmarken des Molasy-&-Tofilski-Datensatzes (IdentiFly-Nummerierung).
Die Führung ist das Procrustes-Mittel aller 814 Flügel, nachgerechnet in `tests/landmarks.test.js`.
Achtung: die CSV des Datensatzes zählt **y von unten** (auf den 18 lokalen Bildern liegen die Punkte
nur so auf Aderkreuzungen). Für Gattungen mit anderer Aderung (z. B. 2 Submarginalzellen) ist ein
eigenes Schema nötig; Blöcke verschiedener Schemata werden nie verglichen.

**Klassifikation**: Vollständige Landmarken eines *orientierungsbestätigten* Bildes werden zum Block
`landmarks` (Standardansicht, damit linke und rechte Flügel nach Mirror vergleichbar sind –
Procrustes entfernt keine Spiegelung). Haben alle Referenzen Landmarken desselben Schemas, zeigt die
Ausgabe zusätzlich **Procrustes + LDA**: GPA (ohne Labels, inkl. Abfrage) → Hauptkomponenten
(bei wenigen Exemplaren höchstens (n − Taxa)/2) → LDA mit Ledoit–Wolf-Schrumpfung →
Wahrscheinlichkeiten per gruppiertem Leave-one-out **temperaturkalibriert**. Die Validierung listet
die LDA-Zeile zuerst. LDA wählt immer ein bekanntes Taxon; für Unbekannte gilt das konforme Set.

Warum kalibrieren: Unkalibriert nennt LDA auf den *Bombus*-Daten mit 3–10 Exemplaren/Art im Mittel
95–98 % Sicherheit, liegt aber nur zu 67–83 % richtig. Kalibriert (3 / 5 / 10 Exemplare): angegeben
58 / 67 / 77 %, tatsächlich 66 / 72 / 83 % richtig; Brier-Score jeweils besser.

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

## Step 2 · Klassifikation (wing-features-1)

Code in `classifier/` (reine ES-Module, in Node getestet), UI in `app.js`, Markov-Ansicht in `walk.js`.

1. **Merkmale** (`features.js`) auf dem normalisierten 1024 × 512-Bild, nur Maskenpixel:
   Umrissprofil (66), Venation als HOG-artige Orientierungshistogramme + relative Dunkelheit
   je 8 × 4-Zelle ohne Konturrand (288), WIP als CIELAB je Zelle + chroma-gewichtetes
   Farbtonhistogramm (112). Keine Farbkorrektur; Aufnahmebedingungen müssen fix sein.
2. **Standardisierung** auf den Referenzen (z-Score, jeder Block gleich gewichtet).
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
5. **Open-set** über label-bedingte konforme Vorhersage (kNN-Nichtkonformität, Jackknife-
   Kalibrierung pro Exemplar). Leeres Vorhersage-Set = keinem Referenztaxon ähnlich. Bei
   ε = 0,1 braucht jedes Taxon ≥ 9 Referenzexemplare; darunter meldet die UI „nicht
   kalibriert“ statt einer Scheinsicherheit.
6. **Validierung** im UI: gruppiertes Leave-one-out (Exemplar-ID; linke/rechte Flügel eines
   Tieres gemeinsam), aktueller Modus gegen kNN und „kein Reservoir“.

### Benchmark auf realen Daten

`node scripts/landmark-benchmark.js --out test-data/landmark-benchmark.json` nutzt die
814 unveränderten Landmarkdatensätze (423 Exemplare, 3 *Bombus*-Arten, stark unbalanciert:
662/124/28) — prüft die **Klassifikationsstufe**, nicht die Bildmerkmale. Gruppiertes LOO:

| Verfahren | Genauigkeit | balanciert |
|---|---|---|
| Procrustes + LDA (Standard der geometrischen Morphometrie, Ledoit–Wolf) | 96,2 % | 92,6 % |
| Procrustes + PCA + LDA (App-Standard) | 96,1 % | 92,3 % |
| RWR · kein Reservoir | 86,0 % | 82,5 % |
| RWR · kein Reservoir, ohne Prior-Korrektur | 91,0 % | 55,2 % |
| RWR · FlyHash 2048 KC | 78,9 % | 81,2 % |
| RWR · dichte Zufallsprojektion | 85,3 % | 82,6 % |

Konform (ε = 0,1): Abdeckung 90 % wie angestrebt; eine zurückgehaltene Art wird aber nur
zu 14–44 % als unbekannt erkannt (kryptische Arten). **FlyHash schlägt die Kontrollen hier
nicht**, und LDA bleibt deutlich besser; ein Vorteil des Fly-Rechenraums ist also nicht belegt.

Mit nur **10 Exemplaren pro Art** als Referenz (20 Ziehungen, Rest als Abfrage) sinkt die balancierte
Genauigkeit auf 81,7 % ± 8,0 (Procrustes + PCA + LDA), kNN 75,7 %, RWR 69,7 % – realistisch für
einen ersten eigenen Datensatz kryptischer Arten.

### Tests

```bash
npm test                                           # Node: Normalisierung, Klassifikation, Walk
NODE_PATH=… node scripts/classifier-e2e.cjs        # Browser: QC → Referenzen → Klassifikation → Walk → Validierung
NODE_PATH=… node scripts/camera-e2e.cjs            # Browser, Fake-Kamera: Rig kalibrieren → Neustart → Aufnahme → QC
NODE_PATH=… node scripts/landmark-e2e.cjs          # Browser, 7 reale Flügel: 19 Landmarken per UI, Lupe, LDA, CSV
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
- Die offene-Art-Erkennung ist konform kalibriert, erkennt aber auf Landmarkdaten zurückgehaltene kryptische Arten nur selten; für Bildmerkmale ist sie noch nicht mit Leave-one-species-out geprüft.
- Die Mushroom-Body-Variante ist biologisch inspiriert; nur der importierte Graph verwendet reale FlyWire-Konnektivität.
- Vor einer wissenschaftlichen Aussage muss gegen starke Baselines verglichen werden: Procrustes+LDA/SVM, kNN, direkte CNN/ViT-Klassifikation, randomisiertes Reservoir und randomisierte FlyWire-Topologie.

## Sinnvoller erster Datensatz

Für einen Proof of Concept eher 5–10 gut abgesicherte Arten, mehrere Individuen pro Art, standardisierte WIP-Aufnahme und Durchlichtaufnahme desselben Flügels. Danach schwierige Artgruppen hinzufügen.

## Step 1 · Flügelnormalisierung (wing-normalizer-0.2)

Start jetzt **über HTTP**, da ES-Module und Web Worker verwendet werden:

```bash
npm run serve
# http://localhost:8000
npm test
```

Venation und/oder WIP hineinziehen. Die QC zeigt Original, echte Binärmaske,
normalisiertes Bild und Kontur/PCA/Schwerpunkt/Basis-/Spitzenkandidaten.
`Flip 180°` und `Mirror` korrigieren die Orientierung. Originalseite separat
angeben; vor `Accept` bestätigen: Basis links, Spitze rechts, anterior oben.
Schwelle ändern oder eine extern korrigierte Schwarzweißmaske importieren,
wenn die automatische Segmentierung nicht ausreicht. `Reset` verwirft die
Korrekturen, erhält aber die dokumentierte Originalseite.

`Accept` archiviert Originaldateien, Masken, normalisierte RGBA-Bilder und
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
