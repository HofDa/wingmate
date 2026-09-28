// Feature standardisation and reservoir embeddings.
//
// FlyHash follows Dasgupta, Stevens & Navlakha (2017, Science 358:793):
// (1) centre the input, (2) expand with a sparse *binary* random projection
// (each Kenyon cell sums a few inputs), (3) winner-take-all keeps the top
// fraction of Kenyon cells as a binary tag. A dense Gaussian projection of the
// same size is provided as the LSH-style control.
export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Blocks present in every record, in a fixed order.
export const BLOCK_ORDER = ["landmarks", "size", "shape", "venation", "wip"];
// Landmark blocks are only comparable within one scheme.
export function commonBlocks(records) {
  return BLOCK_ORDER.filter(
    (b) =>
      records.every((r) => Array.isArray(r.blocks?.[b])) &&
      (b !== "landmarks" || new Set(records.map((r) => r.landmarkScheme)).size === 1),
  );
}

// Z-score each dimension on the reference set, then weight every block by
// 1/sqrt(dim) so that each modality contributes equally to distances
// regardless of how many dimensions it has.
export function fitStandardizer(records, blocks) {
  if (!records.length) throw Error("Keine Referenzen zum Standardisieren");
  if (!blocks.length) throw Error("Keine gemeinsamen Merkmalsblöcke");
  const layout = blocks.map((b) => ({
    block: b,
    dim: records[0].blocks[b].length,
  }));
  const dim = layout.reduce((s, l) => s + l.dim, 0),
    mean = new Float64Array(dim),
    sd = new Float64Array(dim),
    weight = new Float64Array(dim);
  for (const r of records) {
    const v = concat(r, layout);
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= records.length;
  for (const r of records) {
    const v = concat(r, layout);
    for (let i = 0; i < dim; i++) sd[i] += (v[i] - mean[i]) ** 2;
  }
  let offset = 0;
  for (const l of layout) {
    for (let i = offset; i < offset + l.dim; i++) {
      sd[i] = Math.sqrt(sd[i] / Math.max(1, records.length - 1));
      // Constant dimensions carry no information; weight 0 instead of dividing by ~0.
      weight[i] = sd[i] > 1e-9 ? 1 / Math.sqrt(l.dim) : 0;
    }
    offset += l.dim;
  }
  return standardizerFromParams({
    layout,
    mean: Float32Array.from(mean),
    sd: Float32Array.from(sd),
    weight: Float32Array.from(weight),
  });
}
// Rebuild a fitted standardizer from its (serialisable) parameters.
export function standardizerFromParams(params) {
  const { layout, mean, sd, weight } = params,
    dim = layout.reduce((s, l) => s + l.dim, 0);
  return {
    layout,
    dim,
    params,
    transform(record) {
      const v = concat(record, layout),
        out = new Float32Array(dim);
      for (let i = 0; i < dim; i++)
        out[i] = weight[i] ? ((v[i] - mean[i]) / sd[i]) * weight[i] : 0;
      return out;
    },
  };
}
function concat(record, layout) {
  const out = [];
  for (const { block, dim } of layout) {
    const b = record.blocks[block];
    if (!b || b.length !== dim)
      throw Error(`Merkmalsblock ${block} fehlt oder hat falsche Länge`);
    out.push(...b);
  }
  return out;
}

export function l2normalize(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / s);
}
export function cosine(a, b) {
  if (a.length !== b.length)
    throw Error(`Embedding-Dimensionen passen nicht (${a.length} ≠ ${b.length})`);
  let s = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return s / (Math.sqrt(aa * bb) || 1);
}

export const RESERVOIR_DEFAULTS = Object.freeze({
  kenyonCells: 2048,
  fanIn: 6,
  activeFraction: 0.05,
  seed: 1337,
});

// Input -> Kenyon-cell connectivity. Each KC samples `fanIn` distinct inputs
// with weight 1 (binary). Sampling without replacement per KC.
export function flyProjection(inputDim, params = {}) {
  const { kenyonCells, fanIn, seed } = { ...RESERVOIR_DEFAULTS, ...params },
    k = Math.min(fanIn, inputDim),
    rnd = mulberry32(seed),
    idx = new Int32Array(kenyonCells * k),
    pool = Int32Array.from({ length: inputDim }, (_, i) => i);
  for (let c = 0; c < kenyonCells; c++)
    for (let j = 0; j < k; j++) {
      const r = j + Math.floor(rnd() * (inputDim - j));
      [pool[j], pool[r]] = [pool[r], pool[j]];
      idx[c * k + j] = pool[j];
    }
  return { kind: "fly", inputDim, kenyonCells, fanIn: k, idx, params };
}
// Dense Gaussian projection (classic LSH) as a non-biological control.
export function denseProjection(inputDim, params = {}) {
  const { kenyonCells, seed } = { ...RESERVOIR_DEFAULTS, ...params },
    rnd = mulberry32(seed ^ 0x9e3779b9),
    w = new Float32Array(kenyonCells * inputDim);
  for (let i = 0; i < w.length; i += 2) {
    const u = Math.max(1e-12, rnd()),
      v = rnd(),
      r = Math.sqrt(-2 * Math.log(u));
    w[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < w.length) w[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return { kind: "dense", inputDim, kenyonCells, w, params };
}
// Winner-take-all: the top `activeFraction` of cells become 1, all others 0.
// Ties are broken by cell index so the tag is deterministic.
export function project(projection, x, activeFraction = RESERVOIR_DEFAULTS.activeFraction) {
  if (x.length !== projection.inputDim)
    throw Error("Eingabedimension passt nicht zur Projektion");
  const n = projection.kenyonCells,
    act = new Float32Array(n);
  if (projection.kind === "fly") {
    const k = projection.fanIn;
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += x[projection.idx[c * k + j]];
      act[c] = s;
    }
  } else {
    const d = projection.inputDim;
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += projection.w[c * d + j] * x[j];
      act[c] = s;
    }
  }
  const keep = Math.max(1, Math.round(n * activeFraction)),
    order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => act[b] - act[a] || a - b,
    ),
    tag = new Float32Array(n);
  for (let i = 0; i < keep; i++) tag[order[i]] = 1;
  return tag;
}

// Optional connectome reservoir. Inputs are split into ON/OFF channels
// (max(0,x), max(0,-x)), injected into graph nodes by a fixed hash, and
// diffused along the directed, synapse-weighted edges with restart. The
// input-to-neuron assignment is arbitrary, so this is an exploratory
// topology test, not a model of any real sensory pathway.
export function graphReservoir(graph) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges))
    throw Error("Graph braucht nodes[] und edges[]");
  const n = graph.nodes.length,
    adj = Array.from({ length: n }, () => []);
  for (const e of graph.edges) {
    const s = +e[0],
      t = +e[1],
      w = +(e[2] ?? 1);
    if (Number.isInteger(s) && Number.isInteger(t) && s >= 0 && t >= 0 && s < n && t < n && w > 0)
      adj[s].push([t, w]);
  }
  for (const edges of adj) {
    const total = edges.reduce((s, e) => s + e[1], 0) || 1;
    for (const e of edges) e[1] /= total;
  }
  return { kind: "graph", n, adj };
}
export function graphEmbed(reservoir, x, { restart = 0.18, steps = 5, bins = 512 } = {}) {
  const { n, adj } = reservoir,
    source = new Float32Array(n);
  for (let i = 0; i < x.length; i++) {
    source[(Math.imul(2 * i + 1, 2654435761) >>> 0) % n] += Math.max(0, x[i]);
    source[(Math.imul(2 * i + 2, 2654435761) >>> 0) % n] += Math.max(0, -x[i]);
  }
  const total = source.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < n; i++) source[i] /= total;
  let a = source.slice();
  for (let step = 0; step < steps; step++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++)
      if (a[i]) {
        if (!adj[i].length) next[i] += a[i] * (1 - restart);
        else for (const [j, w] of adj[i]) next[j] += a[i] * (1 - restart) * w;
      }
    for (let i = 0; i < n; i++) next[i] += restart * source[i];
    a = next;
  }
  const sketch = new Float32Array(bins);
  for (let i = 0; i < n; i++)
    if (a[i]) sketch[(Math.imul(i + 11, 2246822519) >>> 0) % bins] += a[i];
  return l2normalize(sketch);
}

// One entry point for all modes. Returns a function x -> embedding.
export function makeEmbedder(mode, inputDim, params = {}, graph = null) {
  const p = { ...RESERVOIR_DEFAULTS, ...params };
  if (mode === "none") return (x) => l2normalize(x);
  if (mode === "fly") {
    const proj = flyProjection(inputDim, p);
    return (x) => project(proj, x, p.activeFraction);
  }
  if (mode === "dense") {
    const proj = denseProjection(inputDim, p);
    return (x) => project(proj, x, p.activeFraction);
  }
  if (mode === "graph") {
    if (!graph) throw Error("Kein FlyWire-Graph geladen");
    return (x) => graphEmbed(graph, x);
  }
  throw Error("Unbekannter Reservoir-Modus: " + mode);
}
