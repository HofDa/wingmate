// Classification stage: mask-aware features -> standardisation -> optional
// reservoir -> kNN graph + random walk with restart -> conformal open-set.
// References store raw feature blocks, never embeddings, so every
// classification re-embeds all references with the same settings.
import { VERSION as PREPROCESSING_VERSION } from "./imaging/pipeline.js";
import { extractFeatures, FEATURE_VERSION } from "./classifier/features.js";
import {
  commonBlocks,
  graphReservoir,
  mulberry32,
  RESERVOIR_DEFAULTS,
} from "./classifier/embedding.js";
import {
  querySimilarities,
  rwrScores,
  rwrTransitions,
  knnScores,
  distanceScores,
  argmax,
  entropyBits,
  calibrate,
  conformalPredict,
  CLASSIFIER_DEFAULTS,
} from "./classifier/classify.js";
import { pca2, fitCalibratedShapeLDA } from "./classifier/morphometrics.js";
import { attributionNotice } from "./attribution.js";
import { landmarkBlock } from "./classifier/landmarks.js";
import { createWalkView, traceWalk } from "./walk.js";
import { createTrainingView } from "./training.js";
import { fitReferenceSpace, evaluateReferences } from "./classifier/model.js";

const $ = (s) => document.querySelector(s);
const STORAGE_KEY = "wingmate-references-v2",
  LEGACY_KEY = "beeFlyRefs",
  REFERENCE_FORMAT = "bee-fly-reference-v2";
const state = {
  references: [],
  graph: null,
  graphInfo: null,
  query: null, // { features, preprocessing, specimenArchiveId }
  model: null, // active frozen model runtime (training mode) or null = live
};
let lastAcceptedArchive = null;

function message(target, text, kind = "info") {
  const el = $(target);
  el.textContent = text;
  el.dataset.kind = kind;
}
const footer = (text) => ($("#footerState").textContent = text);
const walkView = createWalkView($("#walkView"));

function reservoirSettings() {
  const int = (id, lo, hi, fallback) => {
    const v = parseInt($(id).value, 10);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  };
  return {
    mode: $("#reservoirMode").value,
    blocks: { venation: ["shape", "venation"], paired: ["shape", "venation", "wip"], landmarks: ["landmarks"] }[$("#featureMode").value],
    params: {
      kenyonCells: int("#reservoirSize", 128, 8192, RESERVOIR_DEFAULTS.kenyonCells),
      fanIn: int("#fanIn", 1, 30, RESERVOIR_DEFAULTS.fanIn),
      activeFraction: int("#activePct", 1, 30, 5) / 100,
      seed: RESERVOIR_DEFAULTS.seed,
    },
  };
}

// ---------- references ----------
const round = (v) => Number(v.toPrecision(5));
function compactFeatures(features) {
  return {
    version: features.version,
    ...(features.landmarkScheme ? { landmarkScheme: features.landmarkScheme } : {}),
    blocks: Object.fromEntries(
      Object.entries(features.blocks).map(([k, v]) => [k, v.map(round)]),
    ),
  };
}
const usable = (r) =>
  r.features?.version === FEATURE_VERSION &&
  r.preprocessingVersion === PREPROCESSING_VERSION &&
  typeof r.species === "string" &&
  r.species.trim();
const groupOf = (r) => r.specimenId || r.specimenArchiveId || r.id;

function saveRefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.references));
    return true;
  } catch (e) {
    message(
      "#refStatus",
      "Lokaler Speicher voll oder gesperrt – Referenzen bitte exportieren. (" + e.message + ")",
      "error",
    );
    return false;
  }
}
function loadRefs() {
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(x)) state.references = x;
  } catch {
    message("#refStatus", "Gespeicherte Referenzen unlesbar – ignoriert.", "error");
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length)
      message(
        "#refStatus",
        `${legacy.length} alte Referenzen (nur Embeddings, Format v1) gefunden. Sie sind mit den neuen Merkmalen nicht vergleichbar und werden nicht verwendet; bitte mit denselben Bildern neu anlegen.`,
        "warn",
      );
  } catch {}
}
let training = null;
function refreshReferences() {
  training?.refresh();
  window.dispatchEvent(new CustomEvent("wing-references-change", { detail: { count: state.references.length } }));
  const by = {};
  for (const r of state.references) by[r.species] = (by[r.species] || 0) + 1;
  const taxa = Object.keys(by).sort(),
    specimens = new Set(state.references.map(groupOf)).size;
  $("#refCount").textContent = state.references.length
    ? `${state.references.length} Referenzen · ${specimens} Exemplare · ${taxa.length} Taxa · Details unter „Modell trainieren“`
    : "Noch keine Referenzen. Ein sicher bestimmtes Exemplar unter „Exemplar“ freigeben und „Als Referenz …“ wählen.";
  const outdated = state.references.filter((r) => !usable(r)).length;
  if (outdated) $("#refCount").textContent += ` · ${outdated} Referenzen haben ältere Merkmale/Vorverarbeitung und müssen aus den Originalen neu verarbeitet werden.`;
  drawEmbedding();
}
function addReference() {
  const species = $("#speciesInput").value.trim();
  if (!species) return message("#refFormStatus", "Bitte Taxon/Art angeben.", "error");
  if (!state.query) return message("#refFormStatus", "Zuerst ein Exemplar in der QC akzeptieren.", "error");
  const specimenId = $("#specimenInput").value.trim();
  if (!specimenId) return message("#refFormStatus", "Bitte stabile Exemplar-ID angeben (dieselbe für alle Flügel eines Tieres).", "error");
  if (state.references.some((r) => r.specimenId === specimenId && r.species !== species))
    return message("#refFormStatus", "Diese Exemplar-ID hat bereits ein anderes Taxon.", "error");
  const hashes = Object.values(state.query.preprocessing?.images ?? {}).map((i) => i.sourceSha256).filter(Boolean);
  if (state.references.some((r) => r.specimenId !== specimenId && Object.values(r.preprocessing?.images ?? {}).some((i) => hashes.includes(i.sourceSha256))))
    return message("#refFormStatus", "Dieses Bild ist bereits unter einer anderen Exemplar-ID gespeichert. Identität prüfen.", "error");
  const archive = state.query.specimenArchiveId;
  if (archive && state.references.some((r) => r.specimenArchiveId === archive))
    return message("#refFormStatus", "Dieses akzeptierte Exemplar ist bereits eine Referenz.", "error");
  state.references.push({
    id: crypto.randomUUID(),
    species,
    specimenId,
    sex: $("#sexInput").value || null,
    series: $("#seriesInput").value.trim() || null,
    specimenArchiveId: archive,
    preprocessingVersion: PREPROCESSING_VERSION,
    preprocessing: state.query.preprocessing,
    features: compactFeatures(state.query.features),
    created: new Date().toISOString(),
  });
  if (saveRefs()) {
    message("#refFormStatus", "");
    window.dispatchEvent(new CustomEvent("wing-reference-added", { detail: { species } }));
  }
  walkView.reset();
  refreshReferences();
}
function exportRefs() {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            format: REFERENCE_FORMAT,
            featureVersion: FEATURE_VERSION,
            preprocessingVersion: PREPROCESSING_VERSION,
            references: state.references,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bee-fly-references.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importRefs(file) {
  const obj = JSON.parse(await file.text()),
    refs = Array.isArray(obj) ? obj : obj.references;
  if (!Array.isArray(refs)) throw Error("Kein gültiger Referenzdatensatz");
  const ok = refs.filter(usable),
    known = new Set(state.references.map((r) => r.id)),
    fresh = ok.filter((r) => !known.has(r.id));
  state.references.push(...fresh);
  saveRefs();
  walkView.reset();
  refreshReferences();
  const skipped = refs.length - ok.length;
  message(
    "#refStatus",
    `${fresh.length} Referenzen importiert` +
      (ok.length - fresh.length ? `, ${ok.length - fresh.length} bereits vorhanden` : "") +
      (skipped
        ? `, ${skipped} übersprungen (andere Merkmals-/Vorverarbeitungsversion oder alte Embedding-Referenzen)`
        : "") +
      ".",
    skipped ? "warn" : "ok",
  );
}

// ---------- embedding + classification ----------
// Build the comparison space from the references only (standardisation is
// fitted on references; the query never influences it).
function space(refs, extra = [], settings = reservoirSettings()) {
  const result = fitReferenceSpace(refs.map((r) => ({ ...r, group: groupOf(r) })), { ...settings, graph: state.graph });
  // Validate query compatibility without changing the fitted representation.
  extra.forEach((f) => result.toEmbedding(f));
  return { ...result, mode: settings.mode };
}
// Identification with the active frozen model (training mode).
function classifyWithModel() {
  const runtime = state.model,
    m = runtime.model;
  try {
    footer("Klassifiziere mit eingefrorenem Modell …");
    const r = runtime.classify(state.query.features, state.query.preprocessing?.version);
    renderResults({ scores: r.scores, knn: r.knn, conformal: r.conformal, best: r.best, n: runtime.labels.length + 1, blocks: m.blocks });
    showWalk(runtime.ctx, r.qs, runtime.labels, m.classifier);
    const box = ldaBox();
    if (r.lda) renderLDAProbabilities(box, r.lda.probabilities, r.lda.model, Math.min(...Object.values(m.taxa).map((t) => t.specimens)));
    else if (m.lda) box.append(note("mini", "Procrustes + LDA: Für dieses Exemplar fehlen vollständige Landmarken desselben Schemas."));
    if (m.attribution) box.append(attributionNotice(m.attribution));
    if (m.starter) box.append(note("warning", "Startmodell für drei Bombus-Arten. Ein hoher LDA-Wert bestätigt nicht die Zugehörigkeit zu diesen Arten; unbekannte Arten sind unzureichend kalibriert."));
    drawEmbedding({ embeddings: runtime.ctx.embeddings, labels: runtime.labels }, r.embedding);
    const primary = m.evaluation.methods[m.primary],
      pick = m.primary === "lda" ? r.lda?.probabilities : m.primary === "distance" ? r.distance : m.primary === "knn" ? r.knn : r.scores,
      top = pick ? Object.entries(pick).sort((a, b) => b[1] - a[1])[0] : null,
      inTraining =
        state.query.specimenArchiveId &&
        state.references.some((ref) => ref.specimenArchiveId === state.query.specimenArchiveId && m.references.ids?.includes(ref.id));
    message(
      "#classifyStatus",
      `Modell „${m.name}“ (${m.createdAt.slice(0, 10)}). Standardverfahren: ${primary.name} → ` +
        (r.conformal.unknown ? "keiner Referenzart ähnlich – Aufnahme und Referenzabdeckung prüfen" : top ? `${top[0]} (${(100 * top[1]).toFixed(0)} %${m.primary === "lda" ? "" : " relativer Ähnlichkeitsscore"})` : "nicht verfügbar für diese Aufnahme") +
        `; in der Entwicklungs-Kreuzvalidierung ${(100 * primary.balancedAccuracy).toFixed(1)} % balanciert richtig (kein unabhängiger Abschlusstest).` +
        (inTraining ? " Achtung: Dieses Exemplar war Teil des Trainings – das Ergebnis ist zu optimistisch." : ""),
      inTraining || r.conformal.unknown ? "warn" : "ok",
    );
    footer("Klassifikation abgeschlossen.");
  } catch (e) {
    message("#classifyStatus", e.message, "error");
    footer("Fehler.");
  }
}
function classify() {
  if (!state.query) return message("#classifyStatus", "Zuerst ein Exemplar in der QC akzeptieren.", "error");
  if (state.model) return classifyWithModel();
  const self = state.query.specimenArchiveId,
    specimen = state.references.find((r) => self && r.specimenArchiveId === self)?.specimenId || $("#specimenInput").value.trim(),
    refs = state.references.filter((r) => usable(r) && (!self || r.specimenArchiveId !== self) && (!specimen || r.specimenId !== specimen));
  const taxa = new Set(refs.map((r) => r.species));
  if (refs.length < 2 || taxa.size < 2)
    return message("#classifyStatus", "Mindestens zwei Taxa mit Referenzen nötig.", "error");
  try {
    footer("Berechne Embeddings und Random Walk …");
    const s = space(refs, [state.query.features]),
      q = s.toEmbedding(state.query.features),
      qs = querySimilarities(s.ctx, q),
      scores = rwrScores(s.ctx, s.labels, qs),
      knn = knnScores(s.ctx, s.labels, qs),
      distanceQs = querySimilarities(s.distanceCtx, s.toVector(state.query.features)),
      distance = distanceScores(s.distanceCtx, s.labels, distanceQs),
      conformal = conformalPredict(distanceQs, s.labels, calibrate(s.distanceCtx, s.labels, s.groups), undefined, { referenceGroups: s.groups }),
      best = Math.max(...qs);
    renderResults({ scores, knn, conformal, best, n: s.labels.length + 1, blocks: s.blocks });
    showWalk(s.ctx, qs, s.labels);
    const lda = renderLDA(refs);
    drawEmbedding(s, q);
    message(
      "#classifyStatus",
      (self && refs.length < state.references.length
        ? "Hinweis: Dieses Exemplar ist selbst Referenz und wurde für die Klassifikation ausgeschlossen. "
        : "") + `Live-Kandidat (${lda ? "Landmarken-LDA" : "Distanz-kNN"}): ${argmax(lda?.probabilities ?? distance)}. ` +
        `Merkmale: ${s.blocks.join(" + ")} · Modus: ${s.mode}. Live-Typikalität ist heuristisch; ein kalibriertes Modell benötigt getrennte Tiere.`,
      "ok",
    );
    footer("Klassifikation abgeschlossen.");
  } catch (e) {
    message("#classifyStatus", e.message, "error");
    footer("Fehler.");
  }
}
// Same transition rows as rwrScores; the sampled trajectory is seeded so a
// given query always shows the same illustrative walk.
function showWalk(ctx, qs, species, settings = CLASSIFIER_DEFAULTS) {
  const { alpha, steps } = settings,
    { P, query } = rwrTransitions(ctx, qs, undefined, settings),
    labels = [...species.map((t, i) => `${t} · #${i + 1}`), "Dein Exemplar"];
  walkView.show({
    P,
    query,
    labels,
    taxa: [...species, null],
    restart: alpha,
    ...traceWalk(P, query, { steps, restart: alpha, random: mulberry32(RESERVOIR_DEFAULTS.seed) }),
  });
}
// Results always belong to one query; drop them when the query changes.
function clearResults() {
  const box = $("#resultBars");
  box.classList.add("empty");
  box.textContent = "Noch nichts bestimmt. Unter „Exemplar“ ein Bild prüfen, freigeben und „Bestimmen“ wählen.";
  for (const id of ["#simMetric", "#entropyMetric", "#nodeMetric", "#knnMetric"]) $(id).textContent = "—";
  $("#predictionSet").textContent = "";
  const pill = $("#openSetPill");
  pill.textContent = "offene Menge: —";
  delete pill.dataset.kind;
  walkView.reset();
}
// Procrustes + LDA on landmarks: the geometric-morphometrics standard. Needs
// a landmark block of one scheme on every reference (and the query).
function landmarkRefs(refs, query = null) {
  if (!commonBlocks([...refs.map((r) => r.features), ...(query ? [query] : [])]).includes("landmarks")) return null;
  if (new Set(refs.map((r) => r.species)).size < 2) return null;
  const fitted = fitReferenceSpace(refs.map((r) => ({ ...r, group: groupOf(r) })), { mode: "none", blocks: ["landmarks"] });
  return { X: fitted.X, q: query ? fitted.landmarkVector(query) : null, labels: fitted.labels, groups: fitted.groups, configs: fitted.configs };
}
function ldaBox() {
  let box = $("#ldaResult");
  if (!box) {
    box = document.createElement("div");
    box.id = "ldaResult";
    $("#resultBars").before(box);
  }
  box.replaceChildren();
  return box;
}
const note = (className, textContent, kind = "") =>
  Object.assign(document.createElement("p"), { className, textContent, ...(kind ? { dataset: { kind } } : {}) });
// Live: fit Procrustes + LDA on the current references for this query.
function renderLDA(refs) {
  const box = ldaBox(),
    data = landmarkRefs(refs, state.query.features);
  if (!data) {
    const missing = refs.filter((r) => !r.features.blocks.landmarks).length;
    box.append(
      note(
        "mini",
        !state.query.features.blocks.landmarks
          ? "Procrustes + LDA: Für dieses Exemplar sind keine vollständigen Landmarken gesetzt (oder die Orientierung ist nicht bestätigt)."
          : `Procrustes + LDA: ${missing} Referenzen ohne vollständige Landmarken desselben Schemas.`,
      ),
    );
    return;
  }
  const model = fitCalibratedShapeLDA(data.X, data.labels, data.groups, { landmarkConfigs: data.configs }),
    specimens = {};
  data.groups.forEach((g, i) => (specimens[data.labels[i]] ??= new Set()).add(g));
  const probabilities = model.predictProba(data.q);
  renderLDAProbabilities(box, probabilities, model, Math.min(...Object.values(specimens).map((v) => v.size)));
  return { probabilities, model };
}
function renderLDAProbabilities(box, probabilities, model, fewest) {
  const proba = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  box.append(Object.assign(document.createElement("h3"), { textContent: "Procrustes + LDA (Landmarken)" }));
  for (const [label, p] of proba.slice(0, 5)) {
    const row = document.createElement("div"),
      track = document.createElement("div"),
      fill = document.createElement("div");
    row.className = "barrow";
    track.className = "bartrack";
    fill.className = "barfill";
    fill.style.width = (100 * p).toFixed(1) + "%";
    track.append(fill);
    row.append(
      Object.assign(document.createElement("strong"), { textContent: label }),
      track,
      Object.assign(document.createElement("span"), { className: "barpct", textContent: (100 * p).toFixed(1) + "%" }),
    );
    box.append(row);
  }
  box.append(
    note(
      "mini",
      `Posterior unter der Annahme, dass das Tier zu einem der ${model.taxa.length} Referenztaxa gehört. ` +
        `${model.components} Hauptkomponenten (${Math.round(100 * model.explainedVariance)} % Formvarianz), Ledoit–Wolf-Schrumpfung ${model.shrinkage.toFixed(2)}, ` +
        (model.temperature
          ? `Wahrscheinlichkeiten per Leave-one-out kalibriert (Temperatur ${model.temperature.toFixed(2)}). `
          : "zu wenige Referenzen zum Kalibrieren – Wahrscheinlichkeiten unkalibriert. ") +
        "LDA erkennt keine unbekannten Arten – dafür das konforme Set oben beachten.",
    ),
  );
  if (fewest < 5)
    box.append(
      note(
        "status",
        `Nur ${fewest} unabhängige Exemplar(e) im kleinsten Trainingstaxon. Die Wahrscheinlichkeiten sind bei so wenigen Tieren sehr unsicher; mehr unabhängige, repräsentative Referenzen ergänzen.`,
        "warn",
      ),
    );
}
function renderResults({ scores, knn, conformal, best, n, blocks }) {
  const box = $("#resultBars");
  box.classList.remove("empty");
  box.replaceChildren();
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  for (const [label, p] of sorted.slice(0, 8)) {
    const row = document.createElement("div"),
      name = document.createElement("strong"),
      track = document.createElement("div"),
      fill = document.createElement("div"),
      pct = document.createElement("span"),
      inSet = conformal.set.includes(label);
    row.className = "barrow";
    name.textContent = label;
    track.className = "bartrack";
    fill.className = "barfill";
    fill.style.width = (p * 100).toFixed(1) + "%";
    pct.className = "barpct";
    pct.textContent = (p * 100).toFixed(1) + "%";
    pct.title = `kNN ${(100 * (knn[label] || 0)).toFixed(1)} % · konformer p-Wert ${conformal.pValues[label]?.toFixed(3) ?? "—"}${inSet ? " · im Vorhersage-Set" : ""}`;
    if (inSet) row.classList.add("in-set");
    track.append(fill);
    row.append(name, track, pct);
    box.append(row);
  }
  $("#simMetric").textContent = (best * 100).toFixed(1) + " %";
  $("#entropyMetric").textContent = entropyBits(scores).toFixed(2) + " bit";
  $("#nodeMetric").textContent = String(n);
  $("#knnMetric").textContent = argmax(knn) ?? "—";
  const pct = Math.round((1 - conformal.epsilon) * 100),
    pill = $("#openSetPill"),
    set = $("#predictionSet");
  if (!conformal.openSetValid) {
    pill.textContent = "offene Menge: nicht kalibriert";
    pill.dataset.kind = "warn";
    set.textContent = conformal.protocol !== "split-specimen-max"
      ? "Live-Vergleich: Ähnlichkeiten sind explorativ. Für eine kalibrierte Vorhersagemenge ein Modell mit unabhängigen Kalibrierungsexemplaren trainieren."
      : `Kalibrierung unzureichend: ${conformal.uncalibrated.join(", ")} braucht mindestens ${Math.ceil(1 / conformal.epsilon) - 1} unabhängige Kalibrierungsexemplare pro Taxon. Kein belastbarer Ausschluss unbekannter Arten.`;
  } else if (conformal.unknown) {
    pill.textContent = "offene Menge: keiner Art ähnlich";
    pill.dataset.kind = "warn";
    set.textContent = `Vorhersage-Set (${pct} %) ist leer: Das Exemplar ist untypischer als ${pct} % der Referenzen jedes Taxons. Mögliches neues Taxon, Aufnahmefehler oder Referenzlücke.`;
  } else {
    pill.textContent = conformal.set.length === 1 ? "offene Menge: eindeutig" : "offene Menge: mehrdeutig";
    pill.dataset.kind = conformal.set.length === 1 ? "ok" : "warn";
    set.textContent = `Vorhersagemenge: {${conformal.set.join(", ")}}. Zielabdeckung ${pct} % bei vergleichbaren neuen Exemplaren; unabhängig kalibriert. Dies ist keine Wahrscheinlichkeit für die einzelne Art und keine Garantie, unbekannte Arten zu erkennen.`;
  }
  set.textContent += ` Merkmale: ${blocks.join(" + ")}.`;
}

// Grouped leave-one-out on the stored references for the current settings,
// against the no-reservoir control and a plain kNN vote.
function validate() {
  const refs = state.references.filter(usable),
    out = $("#validation");
  out.replaceChildren();
  if (new Set(refs.map((r) => r.species)).size < 2 || refs.length < 4)
    return message("#refStatus", "Validierung braucht ≥ 4 Referenzen aus ≥ 2 Taxa.", "error");
  try {
    const records = refs.map((r) => ({ ...r, group: r.specimenId }));
    const settings = { ...reservoirSettings(), graph: state.graph };
    const evaluation = evaluateReferences(records, settings);
    const rows = Object.values(evaluation.methods).map((r) => [r.name, r]);
    if (settings.mode !== "none") {
      const control = evaluateReferences(records, { ...settings, mode: "none" });
      rows.push(["RWR · kein Reservoir (Kontrolle)", control.methods.rwr]);
    }
    const table = document.createElement("table"),
      head = table.createTHead().insertRow();
    for (const h of ["Verfahren", "Genauigkeit", "Balanciert", "ausgewertet"]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.append(th);
    }
    const body = table.createTBody(),
      pct = (v) => (v === null ? "—" : (100 * v).toFixed(1) + " %");
    for (const [name, r] of rows) {
      const tr = body.insertRow();
      for (const v of [name, pct(r.accuracy), pct(r.balancedAccuracy), `${r.evaluated}/${r.evaluated + r.skipped}`])
        tr.insertCell().textContent = v;
    }
    const note = document.createElement("p");
    note.className = "mini";
    note.textContent =
      "Gruppierte Kreuzvalidierung: Alle Flügel eines Tieres bleiben zusammen. Ausrichtung, Skalierung und Kalibrierung werden ausschließlich auf den Trainingsgruppen angepasst. Entwicklungswerte ersetzen keinen unabhängigen Abschlusstest.";
    out.append(table, note);
    message("#refStatus", "Validierung abgeschlossen.", "ok");
  } catch (e) {
    message("#refStatus", e.message, "error");
  }
}

// ---------- plot ----------
const hashString = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
function drawEmbedding(s = null, query = null) {
  const c = $("#embeddingCanvas"),
    ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f7f8f6";
  ctx.fillRect(0, 0, c.width, c.height);
  let items = [];
  try {
    if (!s) {
      const refs = state.references.filter(usable);
      if (refs.length >= 2) s = space(refs);
    }
    if (s) {
      const vectors = query ? [...s.embeddings, query] : s.embeddings,
        coords = pca2(vectors);
      items = coords.map((xy, i) => ({ xy, label: s.labels[i] ?? "Abfrage", query: i === s.labels.length }));
    }
  } catch {}
  if (!items.length) {
    ctx.fillStyle = "#89958d";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Referenz-Embeddings erscheinen hier (ab 2 Referenzen).", c.width / 2, c.height / 2);
    return;
  }
  const xs = items.map((p) => p.xy[0]),
    ys = items.map((p) => p.xy[1]),
    [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
    pad = 45,
    labelRoom = 150; // keep text of right-most points inside the canvas
  for (const p of items) {
    const x = pad + ((p.xy[0] - x0) / (x1 - x0 || 1)) * (c.width - 2 * pad - labelRoom),
      y = pad + ((p.xy[1] - y0) / (y1 - y0 || 1)) * (c.height - 2 * pad);
    ctx.beginPath();
    ctx.arc(x, y, p.query ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = p.query ? "#111" : `hsl(${hashString(p.label) % 360} 45% 45%)`;
    ctx.fill();
    if (p.query) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = "#334039";
    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(p.label, x + 9, y + 4);
  }
}

// ---------- graph import ----------
async function importGraph(file) {
  const g = JSON.parse(await file.text());
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw Error("Graph braucht nodes[] und edges[]");
  if (g.nodes.length > 60000 || g.edges.length > 400000)
    throw Error("Für den Browser bitte ≤60.000 Knoten und ≤400.000 Kanten; mit prepare_flywire.py vorverarbeiten.");
  state.graph = graphReservoir(g);
  message(
    "#graphStatus",
    `FlyWire-Graph geladen: ${g.nodes.length.toLocaleString("de-DE")} Knoten, ${g.edges.length.toLocaleString("de-DE")} Kanten.`,
    "ok",
  );
  $("#reservoirMode").value = "graph";
  walkView.reset();
  updateMode();
}
function updateMode() {
  const m = $("#reservoirMode").value;
  $("#modeBadge").textContent = {
    fly: "FlyHash (Mushroom Body)",
    dense: "Dense random projection",
    graph: "FlyWire graph",
    none: "Direkte Merkmale (Standard)",
  }[m];
  for (const id of ["#reservoirSize", "#activePct"]) $(id).disabled = m === "none" || m === "graph";
  $("#fanIn").disabled = m !== "fly";
  walkView.reset();
  drawEmbedding();
}

// ---------- wiring ----------
function drawPlaceholder(canvas, title) {
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#f7f8f6";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = "#d5dbd6";
  c.setLineDash([7, 8]);
  c.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  c.setLineDash([]);
  c.fillStyle = "#839087";
  c.font = "600 18px system-ui";
  c.textAlign = "center";
  c.fillText(title, canvas.width / 2, canvas.height / 2);
}
window.addEventListener("wing-preprocessing-change", ({ detail }) => {
  state.query = null;
  clearResults();
  const images = {},
    normalized = {};
  if (detail.ready) {
    for (const [type, item] of Object.entries(detail.items))
      if (item) {
        normalized[type] = item.result.normalized;
        images[type] = { ...item.result.metadata, sourceSha256: item.sha256 };
      }
    try {
      // Prefer the venation measurement: transmitted light gives the cleanest outline.
      const features = extractFeatures(normalized, {
          metricSize: (images.venation ?? images.wip)?.metricSize ?? null,
        }),
        host = detail.items.venation ?? detail.items.wip,
        landmarks = landmarkBlock(host?.landmarks, host?.result?.metadata);
      if (landmarks) {
        features.blocks.landmarks = landmarks;
        features.landmarkScheme = host.landmarks.scheme;
      }
      const specimenArchiveId = Object.values(images)[0]?.specimenArchiveId ?? null;
      // A new animal must not inherit the previous reference form's identity.
      // Existing reference identity is recovered by archive ID during inference.
      if (specimenArchiveId !== lastAcceptedArchive) $("#specimenInput").value = "";
      lastAcceptedArchive = specimenArchiveId;
      state.query = {
        features,
        preprocessing: { version: PREPROCESSING_VERSION, images },
        specimenArchiveId,
      };
    } catch (e) {
      message("#classifyStatus", "Merkmalsextraktion fehlgeschlagen: " + e.message, "error");
    }
  }
  $("#addReferenceBtn").disabled = $("#classifyBtn").disabled = !state.query;
  const describe = (item, name) =>
    !item ? null : `${name} ${item.accepted ? "freigegeben" : item.result ? "wird geprüft" : item.error ? "fehlerhaft" : "wird verarbeitet"}`;
  $("#imageStatus").textContent =
    [describe(detail.items.venation, "Venation"), describe(detail.items.wip, "WIP")].filter(Boolean).join(" · ") || "Noch keine Bilder.";
});
$("#addReferenceBtn").disabled = $("#classifyBtn").disabled = true;
$("#addReferenceBtn").addEventListener("click", addReference);
$("#classifyBtn").addEventListener("click", classify);
$("#validateBtn").addEventListener("click", validate);
$("#exportBtn").addEventListener("click", exportRefs);
$("#reservoirMode").addEventListener("change", updateMode);
for (const id of ["#reservoirSize", "#activePct", "#fanIn"])
  $(id).addEventListener("change", () => {
    walkView.reset();
    drawEmbedding();
  });
$("#referenceInput").addEventListener("change", async (e) => {
  try {
    if (e.target.files[0]) await importRefs(e.target.files[0]);
  } catch (err) {
    message("#refStatus", err.message, "error");
  }
  e.target.value = "";
});
$("#graphInput").addEventListener("change", async (e) => {
  try {
    if (e.target.files[0]) await importGraph(e.target.files[0]);
  } catch (err) {
    message("#graphStatus", err.message, "error");
  }
});
$("#clearRefsBtn").addEventListener("click", () => {
  if (!confirm("Alle lokalen Referenzen löschen?")) return;
  state.references = [];
  saveRefs();
  walkView.reset();
  refreshReferences();
  message("#refStatus", "Referenzen gelöscht.", "ok");
});
$("#clearImagesBtn").addEventListener("click", () => {
  $("#wipInput").value = $("#venInput").value = "";
  drawPlaceholder($("#wipCanvas"), "Bild hierher ziehen");
  drawPlaceholder($("#venCanvas"), "Bild hierher ziehen");
});

drawPlaceholder($("#wipCanvas"), "Bild hierher ziehen");
drawPlaceholder($("#venCanvas"), "Bild hierher ziehen");
training = createTrainingView($("#trainingCard"), {
  references: () =>
    state.references.filter(usable).map((r) => ({
      id: r.id,
      species: r.species,
      group: r.specimenId,
      sex: r.sex ?? null,
      series: r.series ?? null,
      features: r.features,
      sourceHashes: Object.values(r.preprocessing?.images ?? {}).map((i) => i.sourceSha256).filter(Boolean),
    })),
  settings: reservoirSettings,
  preprocessingVersion: PREPROCESSING_VERSION,
  onChange: (runtime) => {
    state.model = runtime;
    clearResults();
    $("#classifyBtn").textContent = runtime ? "Mit Modell bestimmen" : "Bestimmen";
  },
});
loadRefs();
updateMode();
refreshReferences();
// Test hook for browser checks.
window.wingClassifier = { state, classify, validate, addReference };
