// Training mode UI: readiness of the reference set, training in a worker,
// evaluation report, and management of frozen models.
import { loadModel, readiness, referenceFingerprint, READY_SPECIMENS } from "./classifier/model.js";
import {
  listModels,
  getModel,
  saveModel,
  deleteModel,
  activeModelId,
  setActiveModelId,
  serializeModel,
  deserializeModel,
} from "./classifier/model-store.js";

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const pct = (v) => (v === null || v === undefined ? "—" : (100 * v).toFixed(1) + " %");
function table(head, rows, className = "train-table") {
  const t = el("table", { className }),
    h = t.createTHead().insertRow();
  for (const c of head) h.append(el("th", { textContent: c }));
  const b = t.createTBody();
  for (const r of rows) {
    const tr = b.insertRow();
    for (const c of r) tr.insertCell().append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return t;
}

export function createTrainingView(root, { references, settings, preprocessingVersion, onChange }) {
  const ui = {
    readiness: el("div"),
    name: el("input", { type: "text", placeholder: "z. B. Bombus lucorum-Komplex, Rig A, 2026-10" }),
    train: el("button", { type: "button", textContent: "Trainieren" }),
    progress: el("progress", { max: 1, value: 0, hidden: true }),
    status: el("p", { className: "status", role: "status" }),
    select: el("select", { ariaLabel: "Aktives Modell" }),
    stale: el("p", { className: "status" }),
    report: el("div", { className: "train-report" }),
  };
  const say = (text, kind = "info") => {
    ui.status.textContent = text;
    ui.status.dataset.kind = kind;
  };
  let active = null,
    worker = null;

  root.append(
    el("h2", { id: "trainingTitle", textContent: "Modell trainieren" }),
    el(
      "p",
      { className: "mini" },
      "Training prüft jedes Verfahren per Kreuzvalidierung (Exemplare zusammen, Arten gleichmäßig verteilt), wählt das beste und friert es als Modell ein. Ist ein Modell aktiv, bestimmt „Bestimmen“ damit.",
    ),
    ui.readiness,
    el("div", { className: "buttonrow" }, el("label", { className: "grow" }, "Modellname", ui.name), ui.train),
    ui.progress,
    ui.status,
    el(
      "div",
      { className: "buttonrow" },
      el("label", { className: "grow" }, "Aktives Modell", ui.select),
      el("button", { type: "button", className: "ghost", textContent: "Exportieren", onclick: exportActive }),
      el("label", { className: "ghost filebutton" }, "Importieren", el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: importFile })),
      el("button", { type: "button", className: "ghost danger", textContent: "Löschen", onclick: removeActive }),
    ),
    ui.stale,
    ui.report,
  );

  function refs() {
    return references();
  }
  function renderReadiness() {
    const r = refs(),
      info = readiness(r),
      rows = Object.entries(info).map(([t, v]) => {
        const status = el("span", {
          className: "train-" + v.status,
          textContent: v.status === "ready" ? "✓ bereit" : v.status === "weak" ? `⚠ < ${READY_SPECIMENS} Exemplare` : "✗ < 5 Exemplare",
        });
        return [
          t,
          v.specimens,
          v.wings,
          `${v.withLandmarks}/${v.wings}`,
          [v.sexes.F ? `♀ ${v.sexes.F}` : "", v.sexes.M ? `♂ ${v.sexes.M}` : ""].filter(Boolean).join(" · ") || "—",
          v.series || "—",
          el("span", {}, status, v.warnings.length ? el("span", { className: "mini", textContent: " · " + v.warnings.join(" · ") }) : ""),
        ];
      });
    ui.readiness.replaceChildren(
      rows.length
        ? table(["Taxon", "Exemplare", "Flügel", "Landmarken", "Geschlecht", "Serien", "Status"], rows)
        : el("p", { className: "mini", textContent: "Noch keine Referenzen. Bestimmte Exemplare unter „3 · Referenzen“ speichern." }),
      el("p", {
        className: "mini",
        textContent:
          `Empfehlung: ≥ ${READY_SPECIMENS} Exemplare pro Art aus mehreren Serien/Fundorten, beide Geschlechter. Kreuzvalidierung sagt nur voraus, was die Referenzen abdecken: Auf den Bombus-Daten ergaben Referenzen aus einer einzigen Sammlung 100 % in der Kreuzvalidierung, aber 70 % auf anderen Sammlungen.`,
      }),
    );
    ui.train.disabled = !!worker || Object.keys(info).length < 2;
    renderStale();
  }
  function renderStale() {
    if (!active) {
      ui.stale.textContent = "Kein Modell aktiv – die Klassifikation rechnet live aus den aktuellen Referenzen.";
      ui.stale.dataset.kind = "";
      return;
    }
    const r = refs(),
      same = referenceFingerprint(r.map((x) => x.id)) === active.model.references.fingerprint;
    ui.stale.textContent = same
      ? `Modell passt zu den aktuellen ${r.length} Referenzen.`
      : `Referenzen haben sich seit dem Training geändert (jetzt ${r.length}, trainiert mit ${active.model.references.count}). Das Modell bleibt unverändert – für neue Referenzen neu trainieren.`;
    ui.stale.dataset.kind = same ? "ok" : "warn";
  }

  ui.train.onclick = () => {
    const r = refs();
    if (worker) return;
    const s = settings();
    if (s.mode === "graph") return say("Der FlyWire-Graphmodus ist explorativ und wird nicht eingefroren – Modus wechseln.", "error");
    worker = new Worker(new URL("./classifier/train-worker.js", import.meta.url), { type: "module" });
    ui.progress.hidden = false;
    ui.progress.value = 0;
    ui.train.disabled = true;
    say(`Trainiere mit ${r.length} Referenzen …`);
    const done = () => {
      worker.terminate();
      worker = null;
      ui.progress.hidden = true;
      renderReadiness();
    };
    worker.onmessage = async ({ data }) => {
      if (data.progress !== undefined) {
        ui.progress.value = data.progress;
        say(`Training: ${data.stage} …`);
        return;
      }
      done();
      if (data.error) return say(data.error, "error");
      try {
        await saveModel(data.model);
        await activate(data.model.id, data.model);
        say(`Modell „${data.model.name}“ trainiert, gespeichert und aktiviert.`, "ok");
      } catch (e) {
        say("Speichern fehlgeschlagen: " + e.message, "error");
      }
    };
    worker.onerror = (e) => {
      done();
      say("Training fehlgeschlagen: " + (e.message || "Worker-Fehler"), "error");
    };
    worker.postMessage({
      refs: r,
      settings: { ...s, name: ui.name.value.trim() || `Modell ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, preprocessingVersion },
    });
  };

  async function activate(id, known = null) {
    try {
      const model = id ? known ?? (await getModel(id)) : null;
      active = model ? loadModel(model) : null;
      setActiveModelId(active ? model.id : null);
    } catch (e) {
      active = null;
      setActiveModelId(null);
      say("Modell konnte nicht geladen werden: " + e.message, "error");
    }
    await renderModels();
    renderReport();
    renderStale();
    onChange(active);
  }
  async function renderModels() {
    const models = await listModels().catch(() => []);
    ui.select.replaceChildren(
      new Option("Kein Modell (live aus Referenzen)", ""),
      ...models.map((m) => new Option(`${m.name} · ${m.createdAt.slice(0, 10)} · ${m.references.count} Ref.`, m.id)),
    );
    ui.select.value = active?.model.id ?? "";
  }
  ui.select.onchange = () => activate(ui.select.value || null);

  function renderReport() {
    ui.report.replaceChildren();
    if (!active) return;
    const m = active.model,
      e = m.evaluation;
    const methodRows = (methods) =>
      Object.entries(methods).map(([k, v]) => [
        (k === m.primary ? "★ " : "") + v.name,
        pct(v.balancedAccuracy),
        pct(v.accuracy),
        `${v.evaluated}/${v.evaluated + v.skipped}`,
      ]);
    ui.report.append(
      el("h3", { textContent: `${m.name}` }),
      el("p", {
        className: "mini",
        textContent: `Trainiert ${m.createdAt.slice(0, 16).replace("T", " ")} · ${m.references.count} Referenzen · ${Object.keys(m.taxa).length} Taxa · Merkmale ${m.blocks.join(" + ")} · Reservoir ${m.reservoir.mode} · ★ = gewähltes Verfahren.`,
      }),
      el("h4", { textContent: `Kreuzvalidierung (${e.folds}-fach, ${e.protocol})` }),
      table(["Verfahren", "Balanciert", "Genauigkeit", "ausgewertet"], methodRows(e.methods)),
    );
    if (e.seriesTransfer)
      ui.report.append(
        el("h4", { textContent: `Transfer auf ungesehene Serien (${e.seriesTransfer.series} Serien, jeweils eine zurückgehalten)` }),
        table(["Verfahren", "Balanciert", "Genauigkeit", "ausgewertet"], methodRows(e.seriesTransfer.methods)),
        el("p", { className: "mini", textContent: "Liegt dieser Wert deutlich unter der Kreuzvalidierung, unterscheiden sich die Serien (Fundort, Sitzung, Aufnahme) stärker als die Arten – mehr Serien in die Referenzen aufnehmen." }),
      );
    else ui.report.append(el("p", { className: "mini", textContent: "Kein Serien-Transfertest: nicht alle Referenzen haben eine Serie/Fundort." }));
    if (e.ldaCalibration)
      ui.report.append(
        el("p", {
          className: "mini",
          textContent: `LDA-Kalibrierung (Kreuzvalidierung): angegeben im Mittel ${pct(e.ldaCalibration.meanTopProbability)}, tatsächlich richtig ${pct(e.ldaCalibration.balancedAccuracy)}, Brier ${e.ldaCalibration.brier.toFixed(3)}.`,
        }),
      );
    const c = e.conformal;
    ui.report.append(
      el("p", {
        className: "mini",
        textContent:
          `Offene Menge (ε = ${c.epsilon}): Abdeckung ${pct(c.coverage)}, fälschlich „unbekannt“ ${pct(c.falseUnknownRate)}, mittlere Setgröße ${c.meanSetSize?.toFixed(2) ?? "—"}. ` +
          `Zurückgehaltene Art als unbekannt erkannt: ${Object.entries(c.novelTaxon).map(([t, v]) => `${t} ${pct(v.flaggedUnknown)}${v.openSetValid ? "" : " (nicht kalibriert)"}`).join(", ")}.`,
      }),
    );
    const confusion = e.methods[m.primary].confusion,
      taxa = Object.keys(confusion).sort();
    ui.report.append(
      el("h4", { textContent: `Verwechslungsmatrix (${e.methods[m.primary].name}; Zeile = wahr, Spalte = vorhergesagt)` }),
      table(["", ...taxa], taxa.map((t) => [t, ...taxa.map((p) => confusion[t][p] || 0)]), "train-table confusion"),
    );
    const warnings = Object.entries(m.taxa).filter(([, v]) => v.warnings.length || v.status !== "ready");
    if (warnings.length)
      ui.report.append(
        el(
          "ul",
          { className: "mini" },
          ...warnings.map(([t, v]) => el("li", { textContent: `${t}: ${v.specimens} Exemplare${v.warnings.length ? " · " + v.warnings.join(" · ") : ""}` })),
        ),
      );
  }

  async function exportActive() {
    if (!active) return say("Kein Modell aktiv.", "error");
    const a = el("a", { download: `wingmate-model-${active.model.name.replace(/[^\w-]+/g, "_")}.json` });
    a.href = URL.createObjectURL(new Blob([serializeModel(active.model)], { type: "application/json" }));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importFile(e) {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const model = deserializeModel(await file.text());
      loadModel(model); // validate before storing
      await saveModel(model);
      await activate(model.id, model);
      say(`Modell „${model.name}“ importiert und aktiviert.`, "ok");
    } catch (err) {
      say(err.message, "error");
    }
    e.target.value = "";
  }
  async function removeActive() {
    if (!active || !confirm(`Modell „${active.model.name}“ löschen?`)) return;
    await deleteModel(active.model.id);
    await activate(null);
    say("Modell gelöscht.", "ok");
  }

  renderReadiness();
  activate(activeModelId());
  return { refresh: renderReadiness, get active() {
    return active;
  } };
}
