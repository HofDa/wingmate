import { VERSION } from "./pipeline.js";
import { saveSpecimen, latestSpecimen } from "./storage.js";
import { activeRig } from "./rig-store.js";
import { createLandmarkEditor } from "./landmark-ui.js";
import { emptyLandmarks, placed, landmarksCsv, scheme, toNormalized } from "../classifier/landmarks.js";
const $ = (s) => document.querySelector(s);
const items = { venation: null, wip: null };
let worker,
  sequence = 0,
  revision = 0,
  busy = false;
const loadRevisions = { venation: 0, wip: 0 };
const pending = new Map();
function compute(image, options, reference) {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
    worker.onerror = () => {
      for (const p of pending.values())
        p.reject(
          Error(
            "Bild-Worker konnte nicht ausgeführt werden. Anwendung über localhost öffnen.",
          ),
        );
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, image, options, reference });
  });
}
function canvas(image) {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d").putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return c;
}
function maskCanvas(mask, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < mask.length; p++) {
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = mask[p] * 255;
    data[p * 4 + 3] = 255;
  }
  return canvas({ data, width: w, height: h });
}
async function decode(file) {
  const bitmap = await createImageBitmap(file, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close();
    throw Error(
      "Bild größer als 40 Megapixel. Bitte vorher verlustfrei verkleinern.",
    );
  }
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return c.getContext("2d").getImageData(0, 0, c.width, c.height);
}
function emit() {
  window.dispatchEvent(
    new CustomEvent("wing-preprocessing-change", {
      detail: {
        ready:
          !busy &&
          Object.values(items).some(Boolean) &&
          Object.values(items)
            .filter(Boolean)
            .every((i) => i.accepted),
        items,
      },
    }),
  );
}
function invalidate() {
  revision++;
  for (const item of Object.values(items)) if (item) item.accepted = false;
  emit();
}
function view(title, c) {
  const f = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = title;
  f.append(caption, c);
  return f;
}
function overlay(item) {
  const r = item.result,
    c = canvas(r.analysis),
    ctx = c.getContext("2d"),
    w = c.width,
    h = c.height,
    o = r.orientation;
  ctx.fillStyle = "#ff6b35";
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (
        r.mask[p] &&
        (!r.mask[p - 1] || !r.mask[p + 1] || !r.mask[p - w] || !r.mask[p + w])
      )
        ctx.fillRect(x, y, 1, 1);
    }
  const line = (a, b, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  line(o.base, o.tip, "#00cfff");
  const dot = (p, color, label) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.fillText(label, p.x + 6, p.y - 5);
  };
  dot(o.centroid, "#ff0055", "C");
  dot(o.base, "#ffd700", "Basis?");
  dot(o.tip, "#ffd700", "Spitze?");
  if ($("#qcDebug").checked) {
    const q = r.metadata.maskQuality.boundingBox;
    ctx.strokeStyle = "#ffd700";
    ctx.strokeRect(q.x, q.y, q.width, q.height);
    const d = o.axisLength / 5;
    line(
      {
        x: o.centroid.x - Math.sin(o.angle) * d,
        y: o.centroid.y + Math.cos(o.angle) * d,
      },
      {
        x: o.centroid.x + Math.sin(o.angle) * d,
        y: o.centroid.y - Math.cos(o.angle) * d,
      },
      "#bb66ff",
    );
  }
  return c;
}
function render() {
  const box = $("#qcImages");
  box.replaceChildren();
  for (const [type, item] of Object.entries(items)) {
    if (!item) continue;
    const article = document.createElement("article");
    article.className = "qc-item";
    const title = document.createElement("h3");
    title.textContent = `${type === "wip" ? "WIP" : "Venation"} · ${item.name}`;
    article.append(title);
    if (!item.result) {
      const p = document.createElement("p");
      p.textContent = item.error || "Verarbeitung …";
      article.append(p);
      if (item.error) {
        const reset = document.createElement("button");
        reset.textContent = "Korrekturen zurücksetzen";
        reset.className = "ghost";
        reset.onclick = () => {
          item.options = { originalSide: item.options.originalSide };
          recalculate();
        };
        article.append(reset);
        const threshold = document.createElement("label");
        threshold.textContent = "Schwelle korrigieren (1–255)";
        const number = document.createElement("input");
        number.type = "number";
        number.min = 1;
        number.max = 255;
        number.value = item.options.parameters?.threshold ?? 15;
        number.onchange = () => {
          item.options.parameters = {
            threshold: Math.max(1, Math.min(255, +number.value)),
          };
          recalculate();
        };
        threshold.append(number);
        article.append(threshold);
        const label = document.createElement("label");
        label.textContent =
          "Korrigierte binäre Maske in Originalgröße importieren";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png";
        input.onchange = async () => {
          try {
            if (!input.files[0]) return;
            const m = await decode(input.files[0]);
            if (m.width !== item.image.width || m.height !== item.image.height)
              throw Error("Maske muss die Originalgröße haben.");
            const ratio = Math.min(1, 640 / Math.max(m.width, m.height)),
              w = Math.round(m.width * ratio),
              h = Math.round(m.height * ratio),
              mask = new Uint8Array(w * h);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                const p =
                  (Math.floor(((y + 0.5) * m.height) / h) * m.width +
                    Math.floor(((x + 0.5) * m.width) / w)) *
                  4;
                mask[y * w + x] =
                  m.data[p] > 127 && m.data[p + 3] > 127 ? 1 : 0;
              }
            item.options.manualMask = mask;
            await recalculate();
          } catch (e) {
            $("#qcStatus").textContent = e.message;
          }
        };
        label.append(input);
        article.append(label);
      }
      box.append(article);
      continue;
    }
    const r = item.result,
      m = r.metadata,
      q = m.maskQuality;
    const el = (tag, props = {}, ...children) => {
      const e = Object.assign(document.createElement(tag), props);
      e.append(...children);
      return e;
    };
    const button = (text, onclick, className = "ghost") =>
      el("button", { type: "button", textContent: text, onclick, className, disabled: busy });
    // Plain-language verdict first; the rule details follow in small print.
    const orientationSure = m.orientationConfidence !== "low";
    article.append(
      el("p", {
        className: q.status === "GOOD" && orientationSure ? "qc-good" : "qc-review",
        textContent:
          (q.status === "GOOD" ? "Maske plausibel" : "Maske prüfen") +
          (orientationSure ? " · Orientierung wahrscheinlich richtig" : " · Orientierung unsicher") +
          (item.accepted ? " · freigegeben" : ""),
      }),
    );
    const size = m.metricSize,
      cq = m.captureQuality;
    article.append(
      el("p", {
        className: "mini",
        textContent: [
          q.reasons.length ? "Hinweise: " + q.reasons.join(", ") : null,
          item.rigNote,
          size &&
            `Länge ${size.wingLengthMm.toFixed(2)} mm · Fläche ${size.wingAreaMm2.toFixed(2)} mm²${size.reliable ? "" : " (unsicher: Randkontakt)"}`,
          cq && `Schärfe ${cq.sharpnessInWing.toFixed(1)} · gesättigt ${(100 * cq.clippedFractionInWing).toFixed(2)} %`,
          m.rigDrift?.medianDifference != null &&
            `Rig-Abweichung ${m.rigDrift.medianDifference.toFixed(1)} (Grenze ${m.rigDrift.limit.toFixed(1)})`,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    const grid = el("div", { className: "qc-grid" });
    grid.append(
      view("Original", canvas(item.image)),
      view("Maske", maskCanvas(r.mask, r.analysis.width, r.analysis.height)),
      view("Normalisiert", canvas(r.normalized)),
      view("Kontur & Achse", overlay(item)),
    );
    article.append(grid);

    // Orientation: the one decision the user must make per image.
    const select = el("select", { disabled: busy });
    for (const [value, text] of [
      ["unknown", "unbekannt"],
      ["left", "links"],
      ["right", "rechts"],
    ])
      select.add(new Option(text, value));
    select.value = item.options.originalSide ?? "unknown";
    select.onchange = () => {
      item.options.originalSide = select.value;
      recalculate();
    };
    const check = el("input", { type: "checkbox", checked: !!item.options.standardConfirmed, disabled: busy });
    check.onchange = () => {
      item.options.standardConfirmed = check.checked;
      recalculate();
    };
    article.append(
      el(
        "fieldset",
        { className: "qc-orient" },
        el("legend", { textContent: "Orientierung" }),
        el(
          "div",
          { className: "buttonrow" },
          button("Um 180° drehen", () => {
            item.options.flipped180 = !item.options.flipped180;
            item.options.standardConfirmed = false;
            recalculate();
          }),
          button("Spiegeln", () => {
            item.options.mirrored = !item.options.mirrored;
            item.options.standardConfirmed = false;
            recalculate();
          }),
          el("label", { className: "inline" }, "Originalseite", select),
        ),
        el("label", { className: "qc-check" }, check, " Standard geprüft: Basis links, Spitze rechts, Vorderrand oben"),
      ),
    );
    if (type === landmarkHost()) article.append(landmarkSection(item));

    // Corrections and exports are rarely needed: folded away.
    const threshold = el("input", {
      type: "number",
      min: 1,
      max: 255,
      value: item.options.parameters?.threshold ?? "",
      disabled: busy,
      placeholder: "automatisch",
    });
    threshold.onchange = () => {
      item.options.parameters = {
        threshold: threshold.value ? Math.max(1, Math.min(255, +threshold.value)) : null,
      };
      recalculate();
    };
    const file = el("input", { type: "file", accept: "image/png,image/bmp", disabled: busy });
    file.onchange = async () => {
      try {
        if (!file.files[0]) return;
        const im = await decode(file.files[0]);
        if (
          !(
            (im.width === r.analysis.width &&
              im.height === r.analysis.height) ||
            (im.width === item.image.width && im.height === item.image.height)
          )
        )
          throw Error("Maskenmaße passen nicht zum Original/Analysebild.");
        const mask = new Uint8Array(r.mask.length);
        for (let y = 0; y < r.analysis.height; y++)
          for (let x = 0; x < r.analysis.width; x++) {
            const p =
              (Math.min(
                im.height - 1,
                Math.floor(((y + 0.5) * im.height) / r.analysis.height),
              ) *
                im.width +
                Math.min(
                  im.width - 1,
                  Math.floor(((x + 0.5) * im.width) / r.analysis.width),
                )) *
              4;
            mask[y * r.analysis.width + x] =
              im.data[p] > 127 && im.data[p + 3] > 127 ? 1 : 0;
          }
        item.options.manualMask = mask;
        recalculate();
      } catch (e) {
        $("#qcStatus").textContent = e.message;
      }
    };
    article.append(
      el(
        "details",
        { className: "disclosure-inline" },
        el("summary", { textContent: "Maske korrigieren" }),
        el("label", {}, "Segmentierungsschwelle (RGB-Abstand, leer = automatisch)", threshold),
        el("label", {}, "Korrigierte Maske importieren (schwarz/weiß, Größe wie Original oder Analysemaske)", file),
        el(
          "div",
          { className: "buttonrow" },
          button("Alle Korrekturen zurücksetzen", () => {
            item.options = { originalSide: item.options.originalSide };
            recalculate();
          }),
        ),
      ),
      el(
        "details",
        { className: "disclosure-inline" },
        el("summary", { textContent: "Export & Metadaten" }),
        el(
          "div",
          { className: "buttonrow smallrow" },
          button("Normalisiertes Bild (PNG)", () => download(canvas(r.normalized).toDataURL(), "normalized-" + type + ".png")),
          button("Maske (PNG)", () =>
            download(maskCanvas(r.mask, r.analysis.width, r.analysis.height).toDataURL(), "mask-" + type + ".png"),
          ),
        ),
        el("p", {
          className: "mini",
          textContent: `Fläche ${q.wingArea} Analysepixel · Randkontakt ${q.edgeContact ? "ja" : "nein"} · Fragmentierung ${q.fragmentationScore.toFixed(3)} · Maskenvertrauen ${q.maskConfidence} (regelbasiert, keine Wahrscheinlichkeit).`,
        }),
        el("pre", { textContent: JSON.stringify(m, null, 2) }),
      ),
    );
    box.append(article);
  }
  const align = $("#qcAlignment");
  align.replaceChildren();
  if (items.venation?.result && items.wip?.result) {
    const a = items.venation.result.normalized,
      b = items.wip.result.normalized;
    const data = new Uint8ClampedArray(a.data.length);
    for (let p = 0; p < a.mask.length; p++) {
      data[p * 4] = a.mask[p] * 230;
      data[p * 4 + 1] = b.mask[p] * 200;
      data[p * 4 + 2] = b.mask[p] * 230;
      data[p * 4 + 3] = 255;
    }
    align.append(
      view(
        "VENATION / WIP ALIGNMENT · rot = Venation, cyan = WIP, weiß = Überlappung",
        canvas({ ...a, data }),
      ),
    );
    const p = document.createElement("p"),
      reg = items.wip.result.metadata.registration;
    p.textContent = reg
      ? `Mask IoU ${reg.maskIoU.toFixed(3)} · ${reg.status}. Konturabgleich; innere anatomische Entsprechung muss geprüft werden.`
      : "Registrierung ausstehend";
    align.append(p);
  }
  updateButtons();
}
function updateButtons() {
  $("#qcAccept").disabled =
    busy ||
    !Object.values(items).some(Boolean) ||
    Object.values(items)
      .filter(Boolean)
      .some((i) => !i.result || !i.options.standardConfirmed);
  $("#qcRecalculate").disabled = busy;
  $("#qcRestore").disabled = busy;
  $("#qcExport").disabled =
    busy ||
    !Object.values(items)
      .filter(Boolean)
      .every((i) => i.result) ||
    !Object.values(items).some(Boolean);
  const host = items[landmarkHost()];
  $("#qcLandmarkCsv").disabled = busy || !host?.landmarks || !placed(host.landmarks);
}
// Landmarks belong to the specimen and are placed on one image: venation if
// present (veins are sharpest in transmitted light), otherwise WIP.
const landmarkHost = () => (items.venation ? "venation" : items.wip ? "wip" : null);
let landmarkOpen = false;
function landmarkSection(item) {
  const details = document.createElement("details"),
    summary = document.createElement("summary"),
    s = scheme(item.landmarks.scheme),
    label = () =>
      `Landmarken · ${placed(item.landmarks)} / ${s.count} gesetzt${item.result.metadata.standardConfirmed ? "" : " · Standardorientierung noch nicht bestätigt"}`;
  details.className = "lm-details";
  details.open = landmarkOpen;
  summary.textContent = label();
  details.append(summary);
  const note = document.createElement("p");
  note.className = "mini";
  note.textContent = `${s.name}. ${s.note} Die Punkte bleiben beim Drehen, Spiegeln und Neuberechnen gültig.`;
  details.append(note);
  let editor = null;
  const open = () => {
    if (editor) return;
    editor = createLandmarkEditor({
      normalized: item.result.normalized,
      original: item.image,
      metadata: item.result.metadata,
      landmarks: item.landmarks,
      onChange: () => {
        summary.textContent = label();
        landmarksChanged();
      },
    });
    details.append(editor.element);
  };
  details.ontoggle = () => {
    landmarkOpen = details.open;
    if (details.open) open();
  };
  if (details.open) open();
  return details;
}
// Changing landmarks after Accept makes the archived record stale.
function landmarksChanged() {
  const wasAccepted = Object.values(items).some((i) => i?.accepted);
  for (const i of Object.values(items)) if (i) i.accepted = false;
  if (wasAccepted) $("#qcStatus").textContent = "Landmarken geändert – bitte erneut freigeben.";
  updateButtons();
  emit();
}
// The active rig is applied only when its profile matches the image size;
// otherwise the image is processed without correction and the reason is shown.
function rigOptions(item, type, rig) {
  const options = { ...item.options, capture: item.capture ?? null },
    modality = rig?.modalities?.[type];
  item.rigNote = null;
  if (!rig) return options;
  if (!modality) {
    item.rigNote = `Rig „${rig.name}“ hat kein ${type === "wip" ? "WIP" : "Venation"}-Profil – ohne Korrektur verarbeitet.`;
    return options;
  }
  if (modality.sourceWidth !== item.image.width || modality.sourceHeight !== item.image.height) {
    item.rigNote = `Rig „${rig.name}“ nicht angewendet: Bild ${item.image.width}×${item.image.height}, Profil ${modality.sourceWidth}×${modality.sourceHeight}.`;
    return options;
  }
  item.rigNote = `Rig „${rig.name}“ angewendet (${modality.illumination ? "Flat-Field + " : ""}Hintergrundmodell).`;
  return {
    ...options,
    rig: { ...modality, id: rig.id, name: rig.name },
    originalMetricScale: options.originalMetricScale ?? rig.originalMetricScale ?? null,
  };
}
async function recalculate() {
  invalidate();
  const ticket = revision;
  for (const i of Object.values(items)) if (i) i.result = null;
  busy = true;
  emit();
  render();
  $("#qcStatus").textContent = "Lokale Verarbeitung …";
  try {
    const rig = await activeRig().catch(() => null);
    for (const type of ["venation", "wip"]) {
      const item = items[type];
      if (!item) continue;
      const result = await compute(
        item.image,
        rigOptions(item, type, rig),
        type === "wip" ? items.venation?.result?.normalized.mask : null,
      );
      if (ticket !== revision) return;
      item.result = result;
      item.error = null;
    }
  } catch (e) {
    if (ticket === revision) {
      $("#qcStatus").textContent = e.message;
      for (const i of Object.values(items))
        if (i && !i.result) i.error = e.message;
    }
  } finally {
    if (ticket === revision) {
      busy = false;
      render();
      emit();
      if (
        Object.values(items)
          .filter(Boolean)
          .every((i) => i.result)
      )
        $("#qcStatus").textContent =
          "Bereit: Maske und Orientierung unten prüfen.";
    }
  }
}
async function load(type, file, capture = null) {
  if (!file) return;
  const loadTicket = ++loadRevisions[type];
  invalidate();
  busy = true;
  emit();
  render();
  try {
    const [image, hash] = await Promise.all([
      decode(file),
      file.arrayBuffer().then((b) => crypto.subtle.digest("SHA-256", b)),
    ]);
    if (loadTicket !== loadRevisions[type]) return;
    const preview = $(type === "wip" ? "#wipCanvas" : "#venCanvas"),
      ctx = preview.getContext("2d"),
      scale = Math.min(
        preview.width / image.width,
        preview.height / image.height,
      );
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.drawImage(
      canvas(image),
      (preview.width - image.width * scale) / 2,
      (preview.height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    items[type] = {
      image,
      sourceFile: file,
      name: file.name,
      capture,
      landmarks: emptyLandmarks(),
      options: {},
      result: null,
      accepted: false,
      sha256: Array.from(new Uint8Array(hash), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join(""),
    };
    await recalculate();
  } catch (e) {
    busy = false;
    render();
    emit();
    $("#qcStatus").textContent = e.message;
  }
}
function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
for (const [type, id] of [
  ["venation", "venInput"],
  ["wip", "wipInput"],
]) {
  const input = $("#" + id);
  input.addEventListener("change", () => load(type, input.files[0]));
  const zone = input.closest(".dropzone");
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    load(type, e.dataTransfer.files[0]);
  });
}
$("#qcRecalculate").onclick = recalculate;
window.addEventListener("wing-rig-change", () => {
  if (Object.values(items).some(Boolean)) recalculate();
});
$("#qcDebug").onchange = render;
$("#qcAccept").onclick = async () => {
  const ticket = revision;
  busy = true;
  render();
  emit();
  try {
    for (const i of Object.values(items))
      if (i) i.result.metadata.acceptedAt = new Date().toISOString();
    const id = await saveSpecimen(items);
    if (ticket !== revision) return;
    for (const i of Object.values(items))
      if (i) {
        i.accepted = true;
        i.result.metadata.specimenArchiveId = id;
      }
    $("#qcStatus").textContent =
      "Freigegeben und lokal archiviert (Original, Maske, normalisiertes Bild, Transformation).";
  } catch (e) {
    $("#qcStatus").textContent =
      "Lokales Speichern fehlgeschlagen: " +
      e.message +
      " — PNG und Metadaten bitte exportieren.";
  } finally {
    if (ticket === revision) {
      busy = false;
      render();
      emit();
    }
  }
};
$("#qcRestore").onclick = async () => {
  try {
    const saved = await latestSpecimen();
    if (!saved) {
      $("#qcStatus").textContent = "Noch kein Exemplar archiviert.";
      return;
    }
    revision++;
    items.wip = items.venation = null;
    for (const [type, entry] of Object.entries(saved.images)) {
      const image = await decode(entry.sourceFile),
        m = entry.metadata;
      items[type] = {
        image,
        sourceFile: entry.sourceFile,
        name: entry.sourceName,
        sha256: entry.sourceSha256,
        capture: entry.capture ?? null,
        landmarks: entry.landmarks ?? emptyLandmarks(),
        accepted: false,
        result: null,
        options: {
          parameters: m.parameters,
          manualMask: m.manualMask ? entry.mask : undefined,
          mirrored: m.mirrored,
          flipped180: m.flipped180,
          originalSide: m.originalSide,
          originalMetricScale: m.originalMetricScale,
          standardConfirmed: m.standardConfirmed,
        },
      };
    }
    await recalculate();
  } catch (e) {
    $("#qcStatus").textContent = e.message;
  }
};

$("#qcExport").onclick = () => {
  const specimen = {
    preprocessing: {
      version: VERSION,
      images: Object.fromEntries(
        Object.entries(items)
          .filter(([, i]) => i)
          .map(([type, i]) => [
            type,
            {
              ...i.result.metadata,
              sourceFile: i.name,
              sourceSha256: i.sha256,
              landmarks: i.landmarks && placed(i.landmarks)
                ? {
                    ...i.landmarks,
                    coordinateSpace: "original-pixels (y down)",
                    normalized: toNormalized(i.landmarks, i.result.metadata),
                  }
                : null,
              mask: {
                width: i.result.analysis.width,
                height: i.result.analysis.height,
                encoding: "binary-run-length",
                runs: rle(i.result.mask),
              },
            },
          ]),
      ),
    },
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(specimen, null, 2)], { type: "application/json" }),
  );
  download(url, "wing-preprocessing.json");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("#qcLandmarkCsv").onclick = () => {
  const item = items[landmarkHost()];
  if (!item) return;
  const csv = landmarksCsv([{ file: item.name, landmarks: item.landmarks, height: item.image.height }]),
    url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  download(url, item.name.replace(/\.[^.]+$/, "") + "-landmarks.csv");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function rle(mask) {
  const runs = [];
  let value = 0,
    n = 0;
  for (const p of mask) {
    if (p === value) n++;
    else {
      runs.push(n);
      value = p;
      n = 1;
    }
  }
  runs.push(n);
  return runs;
}
$("#clearImagesBtn").addEventListener("click", () => {
  revision++;
  loadRevisions.wip++;
  loadRevisions.venation++;
  busy = false;
  items.wip = items.venation = null;
  render();
  emit();
  $("#qcStatus").textContent = "Noch kein Bild geladen.";
});
window.wingQC = {
  get items() {
    return items;
  },
  load,
  recalculate,
};
render();
