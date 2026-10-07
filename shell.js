// App shell: four views (hash routing) and the next-step bar that always
// shows the current specimen's state and exactly one obvious next action.
// It only reads the events emitted by qc-ui.js / app.js; processing logic
// stays in those modules.
import { placed, scheme } from "./classifier/landmarks.js";

const $ = (s) => document.querySelector(s);
const VIEWS = ["exemplar", "ergebnis", "referenzen", "einstellungen"];
const bar = $("#nextBar"),
  form = $("#refForm"),
  hint = $("#nextHint"),
  accept = $("#qcAccept"),
  classifyBtn = $("#classifyBtn"),
  refToggle = $("#refToggle");

function show(view, { focus = false } = {}) {
  if (!VIEWS.includes(view)) view = "exemplar";
  for (const section of document.querySelectorAll("main > .view")) section.hidden = section.dataset.view !== view;
  for (const link of document.querySelectorAll(".tabs a"))
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  // The next-step bar belongs to the specimen workflow only.
  bar.hidden = view !== "exemplar";
  document.body.dataset.view = view;
  $(".skip-link").href = `#h-${view}`;
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  if (focus) $(`#view-${view} h1`)?.focus({ preventScroll: true });
}
window.addEventListener("hashchange", () => show(location.hash.slice(1), { focus: true }));
for (const link of document.querySelectorAll(".tabs a, .brand"))
  link.addEventListener("click", (e) => {
    e.preventDefault();
    show(link.dataset.view ?? "exemplar", { focus: true });
    window.scrollTo({ top: 0 });
  });
for (const h of document.querySelectorAll("main > .view h1")) h.tabIndex = -1;
$(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  const heading = $(`#view-${document.body.dataset.view} h1`);
  heading.focus();
  heading.scrollIntoView({ block: "start" });
});

// ---------- next step ----------
let accepted = false;
function setStep(name, state, text = null) {
  const li = $(`#flowSteps [data-step="${name}"]`);
  li.dataset.state = state; // "done" | "active" | "todo"
  if (text !== null) $("#lmCount").textContent = text;
}
function closeForm() {
  form.hidden = true;
  refToggle.setAttribute("aria-expanded", "false");
}
window.addEventListener("wing-preprocessing-change", ({ detail }) => {
  const items = Object.values(detail.items).filter(Boolean),
    host = detail.items.venation ?? detail.items.wip,
    lm = host?.landmarks,
    lmTotal = lm ? scheme(lm.scheme).count : 0,
    lmDone = lm ? placed(lm) : 0,
    processing = items.some((i) => !i.result && !i.error),
    failed = items.some((i) => i.error),
    unconfirmed = items.some((i) => i.result && !i.options.standardConfirmed);
  accepted = items.length > 0 && items.every((i) => i.accepted);
  $("#clearImagesBtn").hidden = !items.length;
  $("#qcPanel").hidden = !items.length;
  $("#qcEmpty").hidden = !!items.length;
  for (const [type, input] of [["venation", "venInput"], ["wip", "wipInput"]]) {
    $("#" + input).closest(".dropzone").classList.toggle("has-image", !!detail.items[type]);
  }
  if (detail.items.wip) $("#wipUpload").open = true;

  setStep("image", items.length ? "done" : "active");
  setStep("qc", accepted ? "done" : items.length ? "active" : "todo");
  setStep("landmarks", lm && lmDone === lmTotal ? "done" : lmDone ? "active" : "todo", lm ? `${lmDone}/${lmTotal}` : "");

  accept.hidden = !items.length || accepted;
  classifyBtn.hidden = refToggle.hidden = !accepted;
  if (!accepted) closeForm();

  hint.textContent = !items.length
    ? "Venationsbild laden oder mit der Live-Kamera aufnehmen."
    : processing
      ? "Wird verarbeitet …"
      : failed
        ? "Verarbeitung fehlgeschlagen – unter „Prüfen“ Schwelle oder Maske korrigieren."
        : unconfirmed
          ? "Maske und Orientierung prüfen, dann „Standard geprüft“ ankreuzen."
          : !accepted
            ? "Geprüft. Freigeben speichert das Exemplar lokal."
            : lm && lmDone < lmTotal
              ? `Freigegeben. Landmarken ${lmDone}/${lmTotal} – für die Formanalyse vervollständigen, oder jetzt bestimmen.`
              : "Freigegeben. Bestimmen oder als Referenz speichern.";
});
refToggle.addEventListener("click", () => {
  const open = form.hidden;
  form.hidden = !open;
  refToggle.setAttribute("aria-expanded", String(open));
  if (open) $("#speciesInput").focus();
});
$("#refCancel").addEventListener("click", closeForm);
form.addEventListener("submit", (e) => e.preventDefault());
window.addEventListener("wing-reference-added", ({ detail }) => {
  closeForm();
  hint.textContent = `Als Referenz gespeichert: ${detail.species}. Nächstes Exemplar über „Neues Exemplar“.`;
});
window.addEventListener("wing-references-change", ({ detail }) => {
  $("#refTabCount").textContent = detail.count ? String(detail.count) : "";
  $("#referenceEmpty").hidden = detail.count > 0;
  $("#exportBtn").disabled = $("#clearRefsBtn").disabled = !detail.count;
});
// app.js registers its classify handler first (module order); then switch view.
classifyBtn.addEventListener("click", () => show("ergebnis"));

// app.js loaded the references before this module registered its listener.
$("#refTabCount").textContent = window.wingClassifier?.state.references.length || "";
const referenceCount = window.wingClassifier?.state.references.length || 0;
$("#referenceEmpty").hidden = referenceCount > 0;
$("#exportBtn").disabled = $("#clearRefsBtn").disabled = !referenceCount;
// Reserve the actual height, including the expanded reference form and
// wrapped mobile instructions, so the last control remains reachable.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--nextbar-height", `${bar.getBoundingClientRect().height}px`);
}).observe(bar);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !form.hidden) {
    closeForm();
    refToggle.focus();
  }
});
show(location.hash.slice(1) || "exemplar");
window.wingShell = { show };
