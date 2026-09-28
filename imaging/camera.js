// Smartphone capture for a fixed rig: live preview with placement guide,
// focus / exposure / rig-drift meters, locked camera settings where the
// browser allows it (Chrome on Android), multi-frame averaging, rig
// calibration (empty backgrounds, grey card, ruler) and a native-camera
// fallback (iOS Safari exposes no manual camera controls to web pages).
import {
  createAccumulator,
  buildModalityProfile,
  createRigProfile,
  metricScaleFromPoints,
  flatFieldCorrect,
  driftCheck,
  sharpness,
  clippedFraction,
} from "./rig.js";
import {
  listRigs,
  saveRig,
  deleteRig,
  activeRig,
  activeRigId,
  setActiveRig,
  serializeRig,
  deserializeRig,
} from "./rig-store.js";

const root = document.querySelector("#captureCard"),
  rigRoot = document.querySelector("#rigCard");
// Settings that define the optical/radiometric state and are locked + stored in the rig.
const LOCKABLE = [
  ["focusMode", "focusDistance", "Fokus"],
  ["exposureMode", "exposureTime", "Belichtung"],
  ["whiteBalanceMode", "colorTemperature", "Weißabgleich"],
];
const NUMERIC = [
  ["focusDistance", "Fokusdistanz"],
  ["exposureTime", "Belichtungszeit"],
  ["exposureCompensation", "Belichtungskorrektur"],
  ["colorTemperature", "Farbtemperatur (K)"],
  ["iso", "ISO"],
  ["zoom", "Zoom"],
];
const STORED = ["width", "height", "focusMode", "focusDistance", "exposureMode", "exposureTime", "exposureCompensation", "whiteBalanceMode", "colorTemperature", "iso", "zoom", "torch"];

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const button = (text, onclick, className = "ghost") => el("button", { textContent: text, onclick, className, type: "button" });

let stream = null,
  track = null,
  meterTimer = null,
  bestSharpness = 0,
  busy = false;
const draft = { venation: null, wip: null, card: null, scale: null, scaleImage: null, points: [] };

// ---------- DOM ----------
const ui = {
  status: el("p", { className: "status", role: "status" }),
  video: el("video", { playsInline: true, muted: true, autoplay: true }),
  overlay: el("canvas"),
  device: el("select", { ariaLabel: "Kamera" }),
  target: el("select", { ariaLabel: "Zielbild" }),
  frames: el("select", { ariaLabel: "Mittelung" }),
  meters: el("div", { className: "cam-meters" }),
  controls: el("div", { className: "cam-controls" }),
  rigSelect: el("select", { ariaLabel: "Aktives Rig" }),
  rigInfo: el("p", { className: "mini" }),
  rigName: el("input", { type: "text", placeholder: "z. B. Pixel 8 + Clip-Makro, Durchlicht-LED A" }),
  steps: el("ul", { className: "cam-steps" }),
  scaleCanvas: el("canvas", { className: "cam-scale", hidden: true }),
  scaleMm: el("input", { type: "number", min: 0.01, step: 0.01, value: 1 }),
};
for (const [value, text] of [["venation", "Venation (Durchlicht)"], ["wip", "WIP (Auflicht, schwarz)"]])
  ui.target.add(new Option(text, value));
for (const n of [1, 4, 8, 16]) ui.frames.add(new Option(n === 1 ? "1 Frame" : `Mittel aus ${n}`, n));
ui.frames.value = 4;
ui.target.onchange = () => (bestSharpness = 0);

const preview = el("div", { className: "cam-preview" }, ui.video, ui.overlay),
  calibration = el(
    "details",
    { className: "disclosure-inline cam-calibration" },
    el("summary", { textContent: "Rig kalibrieren" }),
    el(
      "p",
      { className: "mini" },
      "Rig montiert, Licht an, Kamera fixiert. Jede Hintergrundaufnahme mittelt 16 Frames. Das Profil gilt nur für genau diese Auflösung, Zoomstufe und Beleuchtung.",
    ),
    el("label", {}, "Name des Rigs", ui.rigName),
    ui.steps,
    ui.scaleCanvas,
    el("label", {}, "Abstand der zwei Maßstabspunkte (mm)", ui.scaleMm),
    el("div", { className: "buttonrow" }, button("Rig speichern & aktivieren", saveDraft, "")),
  );
root.append(
  el(
    "div",
    { className: "panel-head" },
    el("h3", { id: "captureTitle", textContent: "Live-Kamera" }),
    button("Schließen", closePanel),
  ),
  el(
    "p",
    { className: "mini" },
    "Flügel in den Rahmen legen: Basis links, Spitze rechts, Vorderrand oben. Android-Chrome fixiert Fokus, Belichtung und Weißabgleich; iOS Safari erlaubt das nicht – dort sichern Rig-Profil und Driftprüfung die Vergleichbarkeit.",
  ),
  el(
    "div",
    { className: "buttonrow cam-toolbar" },
    el("label", { className: "inline" }, "Bild für", ui.target),
    el("label", { className: "inline" }, "Mittelung", ui.frames),
    el("label", { className: "inline" }, "Kamera", ui.device),
    button("Kamera starten", start),
    button("Aufnehmen", captureSpecimen, ""),
  ),
  el("div", { className: "cam-layout" }, preview, el("div", {}, ui.meters, el("details", { className: "disclosure-inline" }, el("summary", { textContent: "Kameraeinstellungen" }), ui.controls))),
  ui.status,
  calibration,
);
// Rig management lives under Einstellungen; calibration needs the camera and
// therefore opens the live panel.
rigRoot.append(
  el("div", { className: "panel-head" }, el("h2", { id: "rigTitle", textContent: "Aufnahme-Rig" })),
  el("p", { className: "mini", textContent: "Ein kalibriertes Rig korrigiert Licht und Farbe, erkennt Staub und Drift und misst die Flügelgröße in mm." }),
  el(
    "div",
    { className: "buttonrow" },
    el("label", { className: "inline grow" }, "Aktives Rig", ui.rigSelect),
    button("Mit der Live-Kamera kalibrieren", () => openPanel(ui.target.value, { calibrate: true }), ""),
  ),
  ui.rigInfo,
  el(
    "div",
    { className: "buttonrow smallrow" },
    button("Exportieren", exportRig),
    el("label", { className: "ghost filebutton" }, "Importieren", el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: importRig })),
    button("Löschen", removeRig, "ghost danger"),
  ),
);
function openPanel(target, { calibrate = false } = {}) {
  window.wingShell?.show("exemplar");
  root.hidden = false;
  if (target) ui.target.value = target;
  bestSharpness = 0;
  calibration.open = calibrate;
  root.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!stream) start();
}
function closePanel() {
  stop();
  root.hidden = true;
}
for (const b of document.querySelectorAll("[data-live]")) b.addEventListener("click", () => openPanel(b.dataset.live));

// ---------- camera ----------
const message = (text, kind = "info") => {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
};
async function start() {
  if (!navigator.mediaDevices?.getUserMedia)
    return message(
      window.isSecureContext
        ? "Dieser Browser bietet keinen Kamerazugriff. Native Kamera-Buttons verwenden."
        : "Kamera nur über HTTPS oder localhost verfügbar (npm run serve:https).",
      "error",
    );
  stop();
  const rig = await activeRig().catch(() => null),
    wanted = rig?.capture?.settings;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(ui.device.value ? { deviceId: { exact: ui.device.value } } : { facingMode: { ideal: "environment" } }),
        // The rig profile fixes the resolution; otherwise ask for the largest.
        width: wanted?.width ? { exact: wanted.width } : { ideal: 4096 },
        height: wanted?.height ? { exact: wanted.height } : { ideal: 3072 },
      },
    });
  } catch (e) {
    return message("Kamera konnte nicht geöffnet werden: " + e.message, "error");
  }
  track = stream.getVideoTracks()[0];
  ui.video.srcObject = stream;
  await ui.video.play().catch(() => {});
  await listDevices();
  if (wanted) await applySettings(wanted, true);
  renderControls();
  bestSharpness = 0;
  clearInterval(meterTimer);
  meterTimer = setInterval(updateMeters, 350);
  const s = track.getSettings();
  message(`Kamera aktiv: ${track.label || "Kamera"} · ${s.width}×${s.height}${wanted ? " · Rig-Einstellungen angewendet" : ""}.`, "ok");
}
function stop() {
  clearInterval(meterTimer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = track = null;
  ui.video.srcObject = null;
  ui.controls.replaceChildren();
}
async function listDevices() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"),
    current = track?.getSettings().deviceId;
  ui.device.replaceChildren(new Option("Rückkamera (auto)", ""));
  devices.forEach((d, i) => ui.device.add(new Option(d.label || `Kamera ${i + 1}`, d.deviceId)));
  if (current) ui.device.value = current;
}
const capabilities = () => (track?.getCapabilities ? track.getCapabilities() : {});
// Apply stored settings. Manual modes are set together with their values;
// unsupported keys are skipped rather than failing the whole call.
async function applySettings(settings, quiet = false) {
  const caps = capabilities(),
    failed = [];
  for (const [mode, value] of LOCKABLE) {
    if (!caps[mode]?.includes?.("manual") || settings[value] === undefined) continue;
    try {
      await track.applyConstraints({ advanced: [{ [mode]: "manual", [value]: settings[value] }] });
    } catch {
      failed.push(mode);
    }
  }
  for (const key of ["exposureCompensation", "iso", "zoom", "torch"])
    if (caps[key] !== undefined && settings[key] !== undefined)
      await track.applyConstraints({ advanced: [{ [key]: settings[key] }] }).catch(() => failed.push(key));
  if (!quiet && failed.length) message("Nicht übernommen: " + failed.join(", "), "warn");
  return failed;
}
// Freeze whatever auto mode converged to.
async function lockCurrent() {
  const s = track.getSettings(),
    failed = await applySettings(s);
  renderControls();
  const locked = LOCKABLE.filter(([mode]) => track.getSettings()[mode] === "manual").map(([, , label]) => label);
  message(
    locked.length
      ? `Fixiert: ${locked.join(", ")}.` + (failed.length ? ` Nicht möglich: ${failed.join(", ")}.` : "")
      : "Dieser Browser/diese Kamera erlaubt keine manuelle Steuerung. Rig-Driftprüfung beachten.",
    locked.length ? "ok" : "warn",
  );
}
function renderControls() {
  const caps = capabilities(),
    s = track?.getSettings() ?? {};
  ui.controls.replaceChildren();
  const anyManual = LOCKABLE.some(([mode]) => caps[mode]?.includes?.("manual"));
  ui.controls.append(
    el(
      "p",
      { className: "mini" },
      anyManual
        ? "Erst automatisch einpendeln lassen, dann fixieren. Fixierte Werte werden im Rig gespeichert."
        : "Keine manuellen Kamerasteuerungen verfügbar (z. B. iOS Safari, Desktop-Webcam).",
    ),
  );
  if (anyManual) ui.controls.append(button("Aktuelle Einstellungen fixieren", lockCurrent, ""));
  for (const [key, label] of NUMERIC) {
    const c = caps[key];
    if (!c || c.min === undefined || c.max === undefined || c.min === c.max) continue;
    const input = el("input", { type: "range", min: c.min, max: c.max, step: c.step || (c.max - c.min) / 100, value: s[key] ?? c.min }),
      value = el("span", { textContent: fmt(s[key]) });
    input.oninput = () => (value.textContent = fmt(+input.value));
    input.onchange = async () => {
      const mode = LOCKABLE.find(([, v]) => v === key)?.[0];
      await track
        .applyConstraints({ advanced: [{ ...(mode ? { [mode]: "manual" } : {}), [key]: +input.value }] })
        .catch((e) => message(`${label}: ${e.message}`, "error"));
      bestSharpness = 0;
    };
    ui.controls.append(el("label", {}, `${label} `, value, input));
  }
  if (caps.torch)
    ui.controls.append(
      el(
        "label",
        { className: "qc-check" },
        el("input", {
          type: "checkbox",
          checked: !!s.torch,
          onchange: (e) => track.applyConstraints({ advanced: [{ torch: e.target.checked }] }).catch(() => {}),
        }),
        " Taschenlampe (nur wenn das Rig sie als Lichtquelle nutzt)",
      ),
    );
}
const fmt = (v) => (v === undefined ? "—" : Math.abs(v) >= 100 ? Math.round(v) : (+v).toFixed(2));

// ---------- frames ----------
function nextFrame() {
  return new Promise((resolve) =>
    ui.video.requestVideoFrameCallback ? ui.video.requestVideoFrameCallback(() => resolve()) : setTimeout(resolve, 40),
  );
}
function readFrame(width = ui.video.videoWidth, height = ui.video.videoHeight) {
  const c = el("canvas", { width, height }),
    ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(ui.video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
async function grab(n) {
  if (!track || !ui.video.videoWidth) throw Error("Kamera ist nicht aktiv");
  const acc = createAccumulator(ui.video.videoWidth, ui.video.videoHeight);
  for (let i = 0; i < n; i++) {
    await nextFrame();
    acc.add(readFrame());
  }
  return acc.result();
}
function settingsSnapshot() {
  const s = track?.getSettings() ?? {};
  return Object.fromEntries(STORED.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
}
async function toFile(image, name) {
  const c = el("canvas", { width: image.width, height: image.height });
  c.getContext("2d").putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return new File([blob], name, { type: "image/png" });
}
async function exclusive(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    message(e.message, "error");
  } finally {
    busy = false;
  }
}
function captureSpecimen() {
  return exclusive(async () => {
    const n = +ui.frames.value,
      type = ui.target.value;
    message(`Nehme ${n} Frame(s) auf …`);
    const avg = await grab(n),
      stamp = new Date().toISOString(),
      rig = await activeRig().catch(() => null),
      file = await toFile(avg.image, `capture-${type}-${stamp.replace(/[:.]/g, "-")}.png`);
    await window.wingQC.load(type, file, {
      method: "video-frame-average",
      frames: avg.frames,
      temporalNoise: avg.temporalNoise,
      capturedAt: stamp,
      device: track.label || null,
      settings: settingsSnapshot(),
      rigProfileId: rig?.id ?? null,
    });
    message(`Aufnahme (${avg.image.width}×${avg.image.height}, ${avg.frames} Frames) übernommen – unten prüfen.`, "ok");
  });
}

// ---------- live meters ----------
async function updateMeters() {
  if (!track || !ui.video.videoWidth || busy) return;
  const w = ui.video.videoWidth,
    h = ui.video.videoHeight,
    small = readFrame(Math.round((320 * w) / Math.max(w, h)), Math.round((320 * h) / Math.max(w, h)));
  // Focus on the central guide region only.
  const mask = new Uint8Array(small.width * small.height);
  for (let y = Math.floor(small.height * 0.25); y < small.height * 0.75; y++)
    for (let x = Math.floor(small.width * 0.1); x < small.width * 0.9; x++) mask[y * small.width + x] = 1;
  const sharp = sharpness(small, mask);
  bestSharpness = Math.max(bestSharpness, sharp);
  const clipped = clippedFraction(small),
    rig = await activeRig().catch(() => null),
    modality = rig?.modalities?.[ui.target.value];
  let drift = "kein Rig aktiv";
  if (modality) {
    if (modality.sourceWidth !== w || modality.sourceHeight !== h) drift = `Auflösung ${w}×${h} ≠ Profil`;
    else {
      const bg = modality.background,
        frame = readFrame(bg.width, bg.height),
        corrected = modality.illumination ? flatFieldCorrect(frame, modality.illumination) : frame,
        d = driftCheck(corrected, bg, modality.stats?.temporalNoise);
      drift = `${d.medianDifference.toFixed(1)} / ${d.limit.toFixed(1)} ${d.status === "ok" ? "✓" : "⚠"}`;
    }
  }
  const pct = bestSharpness ? Math.round((100 * sharp) / bestSharpness) : 0;
  ui.meters.replaceChildren(
    meter("Fokus (vom Bestwert)", `${pct} %`, pct, pct < 80),
    meter("Überbelichtet", `${(100 * clipped).toFixed(1)} %`, Math.min(100, clipped * 1000), clipped > 0.005),
    meter("Rig-Abweichung", drift, null, drift.includes("⚠") || drift.includes("≠")),
  );
  drawGuide();
}
function meter(label, value, bar, warn) {
  return el(
    "div",
    { className: "metric" + (warn ? " warn" : "") },
    el("span", { textContent: label }),
    el("strong", { textContent: value }),
    ...(bar === null ? [] : [el("div", { className: "bartrack" }, el("div", { className: "barfill", style: `width:${bar}%` }))]),
  );
}
// Placement guide with the normalized 2:1 aspect: base left, tip right, anterior up.
function drawGuide() {
  const c = ui.overlay;
  c.width = ui.video.videoWidth;
  c.height = ui.video.videoHeight;
  const ctx = c.getContext("2d"),
    gw = c.width * 0.8,
    gh = Math.min(c.height * 0.8, gw / 2),
    x = (c.width - gw) / 2,
    y = (c.height - gh) / 2;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(255,215,0,.9)";
  ctx.lineWidth = Math.max(2, c.width / 400);
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(x, y, gw, gh);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,215,0,.95)";
  ctx.font = `${Math.round(c.width / 40)}px system-ui`;
  ctx.fillText("Basis", x + 10, y + gh / 2);
  ctx.textAlign = "right";
  ctx.fillText("Spitze", x + gw - 10, y + gh / 2);
  ctx.textAlign = "center";
  ctx.fillText("anterior", c.width / 2, y + ctx.lineWidth * 12);
}

// ---------- rig calibration ----------
const STEPS = [
  ["venation", "Venation-Hintergrund: leeres Rig im Durchlicht", "Pflicht für Venation"],
  ["wip", "WIP-Hintergrund: leeres Rig, schwarzer Hintergrund, Auflicht", "Pflicht für WIP"],
  ["card", "WIP-Graukarte an Flügelposition, Auflicht", "optional: Weißabgleich + Flat-Field für WIP"],
  ["scale", "Maßstab: Lineal/Objektmikrometer an Flügelposition", "optional: mm-Größe als Merkmal"],
];
function renderSteps() {
  ui.steps.replaceChildren(
    ...STEPS.map(([key, label, note]) => {
      const done = key === "scale" ? draft.scale : draft[key];
      const info =
        key === "scale"
          ? draft.scale
            ? `✓ ${draft.scale.micrometersPerPixel.toFixed(2)} µm/px`
            : draft.scaleImage
              ? `Zwei Punkte im Bild anklicken (${draft.points.length}/2)`
              : note
          : done
            ? `✓ ${done.image.width}×${done.image.height}, ${done.frames} Frames, Rauschen ${done.temporalNoise?.toFixed(2) ?? "—"}`
            : note;
      return el("li", {}, button(done ? "Neu aufnehmen" : "Aufnehmen", () => calibrate(key)), el("span", { textContent: ` ${label} — ${info}` }));
    }),
  );
}
function calibrate(key) {
  return exclusive(async () => {
    message("Kalibrieraufnahme …");
    const avg = await grab(key === "scale" ? 4 : 16);
    if (key !== "scale") {
      draft[key] = avg;
      draft.settings = settingsSnapshot();
      draft.device = track.label || null;
    } else {
      draft.scaleImage = avg.image;
      draft.scale = null;
      draft.points = [];
      drawScale();
    }
    renderSteps();
    message("Kalibrieraufnahme gespeichert (noch nicht im Rig).", "ok");
  });
}
function drawScale() {
  const img = draft.scaleImage,
    c = ui.scaleCanvas;
  if (!img) return (c.hidden = true);
  c.hidden = false;
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  ctx.fillStyle = ctx.strokeStyle = "#ff0055";
  ctx.lineWidth = Math.max(2, img.width / 500);
  for (const p of draft.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(4, img.width / 200), 0, Math.PI * 2);
    ctx.fill();
  }
  if (draft.points.length === 2) {
    ctx.beginPath();
    ctx.moveTo(draft.points[0].x, draft.points[0].y);
    ctx.lineTo(draft.points[1].x, draft.points[1].y);
    ctx.stroke();
  }
}
function updateScale() {
  if (draft.points.length !== 2) return;
  try {
    draft.scale = metricScaleFromPoints(draft.points[0], draft.points[1], +ui.scaleMm.value);
  } catch (e) {
    draft.scale = null;
    message(e.message, "error");
  }
  renderSteps();
}
ui.scaleCanvas.onclick = (e) => {
  const r = ui.scaleCanvas.getBoundingClientRect(),
    p = { x: ((e.clientX - r.left) * ui.scaleCanvas.width) / r.width, y: ((e.clientY - r.top) * ui.scaleCanvas.height) / r.height };
  draft.points = draft.points.length >= 2 ? [p] : [...draft.points, p];
  drawScale();
  updateScale();
};
ui.scaleMm.onchange = updateScale;
async function saveDraft() {
  try {
    if (draft.scale && draft.venation && (draft.scaleImage.width !== draft.venation.image.width || draft.scaleImage.height !== draft.venation.image.height))
      throw Error("Maßstabsaufnahme hat eine andere Auflösung als der Hintergrund");
    const profile = createRigProfile({
      name: ui.rigName.value,
      venation: draft.venation ? buildModalityProfile({ kind: "transmitted", background: draft.venation }) : null,
      wip: draft.wip ? buildModalityProfile({ kind: "reflected", background: draft.wip, illumination: draft.card }) : null,
      originalMetricScale: draft.scale,
      capture: { method: "video-frame-average", device: draft.device ?? null, settings: draft.settings ?? null },
    });
    await saveRig(profile);
    setActiveRig(profile.id);
    Object.assign(draft, { venation: null, wip: null, card: null, scale: null, scaleImage: null, points: [] });
    drawScale();
    renderSteps();
    message(`Rig „${profile.name}“ gespeichert und aktiviert.`, "ok");
  } catch (e) {
    message(e.message, "error");
  }
}

// ---------- rig management ----------
async function refreshRigs() {
  const rigs = await listRigs().catch(() => []),
    id = activeRigId();
  ui.rigSelect.replaceChildren(new Option("Kein Rig (unkalibriert)", ""), ...rigs.map((r) => new Option(r.name, r.id)));
  ui.rigSelect.value = rigs.some((r) => r.id === id) ? id : "";
  const rig = rigs.find((r) => r.id === id);
  ui.rigInfo.textContent = rig
    ? [
        `Erstellt ${rig.createdAt.slice(0, 10)}`,
        rig.modalities.venation && `Venation ${rig.modalities.venation.sourceWidth}×${rig.modalities.venation.sourceHeight}`,
        rig.modalities.wip && `WIP ${rig.modalities.wip.sourceWidth}×${rig.modalities.wip.sourceHeight}${rig.modalities.wip.illumination ? " + Graukarte" : ""}`,
        rig.originalMetricScale ? `${rig.originalMetricScale.micrometersPerPixel.toFixed(2)} µm/px` : "ohne Maßstab",
        rig.capture?.settings ? "Kameraeinstellungen gespeichert" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Ohne Rig: Segmentierung über Randfarbe, keine Licht-/Farbkorrektur, keine mm-Größe.";
}
ui.rigSelect.onchange = () => setActiveRig(ui.rigSelect.value || null);
async function exportRig() {
  const rig = await activeRig();
  if (!rig) return message("Kein Rig aktiv.", "error");
  const a = el("a", { download: `rig-${rig.name.replace(/[^\w-]+/g, "_")}.json` });
  a.href = URL.createObjectURL(new Blob([serializeRig(rig)], { type: "application/json" }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importRig(e) {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const profile = deserializeRig(await file.text());
    await saveRig(profile);
    setActiveRig(profile.id);
    message(`Rig „${profile.name}“ importiert und aktiviert.`, "ok");
  } catch (err) {
    message(err.message, "error");
  }
  e.target.value = "";
}
async function removeRig() {
  const id = activeRigId();
  if (!id || !confirm("Aktives Rig-Profil löschen?")) return;
  await deleteRig(id);
  message("Rig gelöscht.", "ok");
}
window.addEventListener("wing-rig-change", refreshRigs);
renderSteps();
refreshRigs();
window.wingCamera = { start, stop, grab, draft, applySettings, openPanel };
