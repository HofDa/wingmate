// Similarity-graph classification, calibrated open-set decisions and grouped
// leave-one-out evaluation. Pure functions; embeddings are arrays of equal length.
import { cosine } from "./embedding.js";

export const CLASSIFIER_DEFAULTS = Object.freeze({
  k: 7, // kNN graph out-degree
  alpha: 0.2, // restart probability of the random walk
  steps: 40,
  power: 3, // edge weight = sim^power (sharpens the neighbourhood)
  voteK: 5, // plain kNN baseline
  conformalM: 3, // nonconformity = 1 - mean of top-m same-label similarities
  epsilon: 0.1, // conformal significance level (target 90 % coverage)
  balanced: true, // divide label mass by the label's reference count (prior correction)
});

// Pairwise similarities plus each row's neighbours sorted by similarity.
export function similarityContext(embeddings) {
  const n = embeddings.length,
    sims = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    sims[i * n + i] = 1;
    for (let j = i + 1; j < n; j++)
      sims[i * n + j] = sims[j * n + i] = cosine(embeddings[i], embeddings[j]);
  }
  const order = Array.from({ length: n }, (_, i) => {
    const row = sims.subarray(i * n, (i + 1) * n);
    return Int32Array.from(
      Array.from({ length: n }, (_, j) => j)
        .filter((j) => j !== i)
        .sort((a, b) => row[b] - row[a] || a - b),
    );
  });
  return { n, sims, order, embeddings };
}
export function querySimilarities(ctx, query) {
  return Float32Array.from(ctx.embeddings, (e) => cosine(e, query));
}
const noneExcluded = (n) => new Uint8Array(n);
function sortedRefs(qs, excluded) {
  const idx = [];
  for (let i = 0; i < qs.length; i++) if (!excluded[i]) idx.push(i);
  return idx.sort((a, b) => qs[b] - qs[a] || a - b);
}

// Transition rows of the kNN graph over references + query (query = node n).
// Row format [[target, probability], ...] is shared with walk.js, so the
// walk view animates exactly the chain that is scored. Excluded references
// get an empty row and are never entered.
export function rwrTransitions(ctx, qs, excluded = noneExcluded(ctx.n), opts = {}) {
  const { k, power } = { ...CLASSIFIER_DEFAULTS, ...opts },
    n = ctx.n,
    q = n;
  const weight = (s) => Math.max(0, s) ** power + 1e-12;
  const normalize = (list) => {
    const total = list.reduce((s, e) => s + e[1], 0);
    return list.map(([j, w]) => [j, w / total]);
  };
  const P = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < n; i++) {
    if (excluded[i]) continue;
    const list = [],
      row = ctx.sims.subarray(i * n, (i + 1) * n);
    for (const j of ctx.order[i]) {
      if (list.length >= k) break;
      if (!excluded[j]) list.push([j, row[j]]);
    }
    // The query joins this reference's neighbourhood if it is closer than the k-th neighbour.
    if (list.length < k) list.push([q, qs[i]]);
    else if (qs[i] > list[k - 1][1]) list[k - 1] = [q, qs[i]];
    P[i] = normalize(list.map(([j, s]) => [j, weight(s)]));
  }
  const qRefs = sortedRefs(qs, excluded).slice(0, k);
  if (!qRefs.length) throw Error("Keine Referenzen verfügbar");
  P[q] = normalize(qRefs.map((j) => [j, weight(qs[j])]));
  return { P, query: q };
}
// Random walk with restart from the query. Label score = mass on references
// of that label after `steps` iterations.
export function rwrScores(ctx, labels, qs, excluded = noneExcluded(ctx.n), opts = {}) {
  const { alpha, steps, balanced } = { ...CLASSIFIER_DEFAULTS, ...opts },
    { P, query } = rwrTransitions(ctx, qs, excluded, opts);
  let p = new Float64Array(P.length);
  p[query] = 1;
  for (let step = 0; step < steps; step++) {
    const next = new Float64Array(P.length);
    next[query] = alpha;
    for (let i = 0; i < P.length; i++)
      if (p[i]) for (const [j, w] of P[i]) next[j] += (1 - alpha) * p[i] * w;
    p = next;
  }
  return normalizeScores(labels, excluded, (i) => p[i], balanced);
}
// Sum per label. With `balanced`, each label's mass is divided by its number
// of available references, so an abundant taxon does not win by sheer count.
function normalizeScores(labels, excluded, value, balanced) {
  const scores = {},
    counts = {};
  for (let i = 0; i < labels.length; i++) {
    if (excluded[i]) continue;
    counts[labels[i]] = (counts[labels[i]] || 0) + 1;
    const v = value(i);
    if (v) scores[labels[i]] = (scores[labels[i]] || 0) + v;
  }
  if (balanced) for (const key of Object.keys(scores)) scores[key] /= counts[key];
  const mass = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(scores)) scores[key] /= mass;
  return scores;
}
// Similarity-weighted vote of the voteK nearest references (baseline).
export function knnScores(ctx, labels, qs, excluded = noneExcluded(ctx.n), opts = {}) {
  const { voteK, balanced } = { ...CLASSIFIER_DEFAULTS, ...opts },
    top = new Set(sortedRefs(qs, excluded).slice(0, voteK));
  return normalizeScores(labels, excluded, (i) => (top.has(i) ? Math.max(1e-6, qs[i]) : 0), balanced);
}
export function argmax(scores) {
  let best = null,
    value = -Infinity;
  for (const [key, v] of Object.entries(scores))
    if (v > value || (v === value && key < best)) {
      best = key;
      value = v;
    }
  return best;
}
export function entropyBits(scores) {
  let h = 0;
  for (const p of Object.values(scores)) if (p > 0) h -= p * Math.log2(p);
  return h;
}

// Mondrian (label-conditional) conformal prediction with a kNN
// nonconformity score. A label stays in the prediction set if the query is at
// least as typical as an epsilon fraction of that label's own references. An
// empty set means "not like any known taxon" – the open-set decision.
export function labelNonconformity(qs, labels, label, excluded, m = CLASSIFIER_DEFAULTS.conformalM, groups = null) {
  const byGroup = new Map();
  for (let i = 0; i < qs.length; i++)
    if (!excluded[i] && labels[i] === label) {
      const group = groups ? groups[i] : i;
      byGroup.set(group, Math.max(byGroup.get(group) ?? -Infinity, qs[i]));
    }
  const values = [...byGroup.values()];
  if (!values.length) return null;
  values.sort((a, b) => b - a);
  const top = values.slice(0, m);
  return 1 - top.reduce((s, v) => s + v, 0) / top.length;
}
// Jackknife calibration: each reference is scored against its own label with
// its whole specimen group held out (so a left/right wing pair cannot vouch
// for itself).
export function calibrate(ctx, labels, groups, opts = {}) {
  const { conformalM } = { ...CLASSIFIER_DEFAULTS, ...opts };
  const scores = Array.from({ length: ctx.n }, (_, i) => {
    const excluded = groupMask(groups, groups[i]);
    return labelNonconformity(ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n), labels, labels[i], excluded, conformalM, groups);
  });
  return specimenCalibration(scores, labels, groups, "grouped-jackknife-heuristic");
}
// One maximum score per independent animal. Duplicated views add no samples.
export function specimenCalibration(scores, labels, groups, protocol = "split-specimen-max") {
  const entries = new Map();
  groups.forEach((group, i) => {
    const previous = entries.get(group);
    if (previous && previous.label !== labels[i]) throw Error(`Exemplar ${group} hat mehrere Taxa`);
    if (scores[i] === null || !Number.isFinite(scores[i])) return;
    entries.set(group, { group, label: labels[i], score: Math.max(previous?.score ?? -Infinity, scores[i]) });
  });
  const rows = [...entries.values()];
  return { protocol, labels: rows.map((r) => r.label), groups: rows.map((r) => r.group), scores: rows.map((r) => r.score) };
}
export function splitCalibrate(ctx, labels, referenceGroups, embeddings, calibrationLabels, calibrationGroups, opts = {}) {
  if (calibrationGroups.some((g) => referenceGroups.includes(g))) throw Error("Training und Kalibrierung müssen getrennte Exemplare verwenden.");
  const { conformalM } = { ...CLASSIFIER_DEFAULTS, ...opts };
  const scores = embeddings.map((e, i) => labelNonconformity(
    querySimilarities(ctx, e), labels, calibrationLabels[i], noneExcluded(ctx.n), conformalM, referenceGroups,
  ));
  return specimenCalibration(scores, calibrationLabels, calibrationGroups);
}
export function conformalPredict(qs, labels, calibration, excluded = noneExcluded(qs.length), opts = {}) {
  const { conformalM, epsilon } = { ...CLASSIFIER_DEFAULTS, ...opts },
    minCalibration = Math.ceil(1 / epsilon) - 1,
    structured = calibration && !Array.isArray(calibration) && Array.isArray(calibration.scores),
    protocol = structured ? calibration.protocol : "legacy-heuristic",
    result = { pValues: {}, set: [], uncalibrated: [], counts: {}, epsilon, protocol };
  for (const label of [...new Set(labels)].sort()) {
    const a = labelNonconformity(qs, labels, label, excluded, conformalM, opts.referenceGroups);
    if (a === null) continue;
    const cal = [];
    const calLabels = structured ? calibration.labels : labels;
    const calScores = structured ? calibration.scores : calibration;
    for (let i = 0; i < calLabels.length; i++)
      if (calLabels[i] === label && Number.isFinite(calScores[i]) && (structured || !excluded[i])) cal.push(calScores[i]);
    result.counts[label] = cal.length;
    const p = (cal.filter((c) => c >= a - 1e-12).length + 1) / (cal.length + 1);
    result.pValues[label] = p;
    // With fewer than 1/epsilon - 1 calibration scores, p can never drop below
    // epsilon: the label can never be rejected. Report that explicitly.
    if (cal.length < minCalibration) result.uncalibrated.push(label);
    if (p > epsilon) result.set.push(label);
  }
  result.openSetValid = protocol === "split-specimen-max" && result.uncalibrated.length === 0 && Object.keys(result.pValues).length > 0;
  result.unknown = result.openSetValid && result.set.length === 0;
  return result;
}

export function groupMask(groups, group) {
  return Uint8Array.from(groups, (g) => (g === group ? 1 : 0));
}

// Grouped leave-one-out: every query is classified with its complete specimen
// group removed from the reference set. `method` is "rwr" or "knn".
export function leaveOneOut(ctx, labels, groups, method = "rwr", opts = {}) {
  const score = method === "knn" ? knnScores : rwrScores;
  const predictions = [];
  for (let i = 0; i < ctx.n; i++) {
    const excluded = groupMask(groups, groups[i]);
    if (!labels.some((l, j) => !excluded[j] && l === labels[i])) {
      predictions.push(null); // taxon has no other specimen: cannot be evaluated
      continue;
    }
    const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n);
    predictions.push(argmax(score(ctx, labels, qs, excluded, opts)));
  }
  return summarize(labels, predictions);
}
export function summarize(labels, predictions) {
  const taxa = [...new Set(labels)].sort(),
    confusion = Object.fromEntries(taxa.map((t) => [t, {}]));
  let correct = 0,
    evaluated = 0;
  for (let i = 0; i < labels.length; i++) {
    const p = predictions[i];
    if (p === null || p === undefined) continue;
    evaluated++;
    if (p === labels[i]) correct++;
    confusion[labels[i]][p] = (confusion[labels[i]][p] || 0) + 1;
  }
  const recall = {};
  for (const t of taxa) {
    const row = confusion[t],
      total = Object.values(row).reduce((a, b) => a + b, 0);
    if (total) recall[t] = (row[t] || 0) / total;
  }
  const r = Object.values(recall);
  return {
    evaluated,
    skipped: labels.length - evaluated,
    accuracy: evaluated ? correct / evaluated : null,
    balancedAccuracy: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null,
    recall,
    confusion,
  };
}

// Conformal behaviour under grouped leave-one-out (known taxa) and
// leave-one-taxon-out (simulated novel taxon).
export function conformalEvaluation(ctx, labels, groups, opts = {}) {
  let covered = 0,
    known = 0,
    emptyKnown = 0,
    setSize = 0;
  for (let i = 0; i < ctx.n; i++) {
    const excluded = groupMask(groups, groups[i]);
    const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n),
      heldOutCalibration = calibrateWithout(ctx, labels, groups, excluded, opts),
      r = conformalPredict(qs, labels, heldOutCalibration, excluded, { ...opts, referenceGroups: groups });
    if (!(labels[i] in r.pValues)) continue;
    known++;
    if (r.set.includes(labels[i])) covered++;
    if (!r.set.length) emptyKnown++;
    setSize += r.set.length;
  }
  const novel = {};
  for (const taxon of [...new Set(labels)].sort()) {
    const excluded = Uint8Array.from(labels, (l) => (l === taxon ? 1 : 0));
    if (excluded.every(Boolean)) continue;
    const calibration = calibrateWithout(ctx, labels, groups, excluded, opts);
    // Calibration must not see the held-out taxon either.
    let detected = 0,
      total = 0,
      valid = true;
    for (let i = 0; i < ctx.n; i++) {
      if (!excluded[i]) continue;
      const qs = ctx.sims.subarray(i * ctx.n, (i + 1) * ctx.n),
        r = conformalPredict(qs, labels, calibration, excluded, opts);
      valid &&= r.openSetValid;
      total++;
      if (r.unknown) detected++;
    }
    novel[taxon] = { queries: total, flaggedUnknown: detected / total, openSetValid: valid };
  }
  return {
    protocol: "grouped-jackknife-heuristic",
    epsilon: { ...CLASSIFIER_DEFAULTS, ...opts }.epsilon,
    knownQueries: known,
    coverage: known ? covered / known : null,
    falseUnknownRate: known ? emptyKnown / known : null,
    meanSetSize: known ? setSize / known : null,
    novelTaxon: novel,
  };
}
function calibrateWithout(ctx, labels, groups, excluded, opts) {
  const indices = labels.map((_, i) => i).filter((i) => !excluded[i]);
  const sub = similarityContext(indices.map((i) => ctx.embeddings[i]));
  return calibrate(sub, indices.map((i) => labels[i]), indices.map((i) => groups[i]), opts);
}
