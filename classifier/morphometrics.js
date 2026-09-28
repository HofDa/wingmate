// Geometric-morphometrics baseline: generalized Procrustes analysis of
// landmark configurations and linear discriminant analysis, the standard
// approach for wing-based bee identification (e.g. IdentiFly / DrawWing).

// config: [[x,y], ...]. Returns a centred, unit-centroid-size copy.
export function centreAndScale(config) {
  const n = config.length;
  let cx = 0,
    cy = 0;
  for (const [x, y] of config) {
    cx += x / n;
    cy += y / n;
  }
  let size = 0;
  for (const [x, y] of config) size += (x - cx) ** 2 + (y - cy) ** 2;
  size = Math.sqrt(size) || 1;
  return { shape: config.map(([x, y]) => [(x - cx) / size, (y - cy) / size]), centroidSize: size };
}
// Optimal rotation (no reflection) of `shape` onto `target`; both centred.
export function rotateOnto(shape, target) {
  let num = 0,
    den = 0;
  for (let i = 0; i < shape.length; i++) {
    const [x, y] = shape[i],
      [u, v] = target[i];
    num += x * v - y * u;
    den += x * u + y * v;
  }
  const t = Math.atan2(num, den),
    c = Math.cos(t),
    s = Math.sin(t);
  return shape.map(([x, y]) => [c * x - s * y, s * x + c * y]);
}
export function procrustesDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i][0] - b[i][0]) ** 2 + (a[i][1] - b[i][1]) ** 2;
  return Math.sqrt(d);
}
// Generalized Procrustes analysis. Unsupervised: uses no labels.
export function gpa(configs, { iterations = 20, tolerance = 1e-10 } = {}) {
  let shapes = configs.map((c) => centreAndScale(c).shape),
    mean = shapes[0];
  for (let it = 0; it < iterations; it++) {
    shapes = shapes.map((s) => rotateOnto(s, mean));
    const next = mean.map((_, i) => [
      shapes.reduce((a, s) => a + s[i][0], 0) / shapes.length,
      shapes.reduce((a, s) => a + s[i][1], 0) / shapes.length,
    ]);
    const normalized = centreAndScale(next).shape,
      change = procrustesDistance(normalized, mean);
    mean = rotateOnto(normalized, mean);
    if (change < tolerance) break;
  }
  shapes = shapes.map((s) => rotateOnto(s, mean));
  return { shapes, mean, flat: shapes.map((s) => s.flat()) };
}

// Symmetric positive-definite solve via Cholesky.
function cholesky(a, d) {
  const l = new Float64Array(d * d);
  for (let i = 0; i < d; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i * d + j];
      for (let k = 0; k < j; k++) s -= l[i * d + k] * l[j * d + k];
      if (i === j) {
        if (s <= 0) throw Error("Kovarianzmatrix nicht positiv definit");
        l[i * d + i] = Math.sqrt(s);
      } else l[i * d + j] = s / l[j * d + j];
    }
  return l;
}
function solve(l, d, b) {
  const y = new Float64Array(d),
    x = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * d + k] * y[k];
    y[i] = s / l[i * d + i];
  }
  for (let i = d - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < d; k++) s -= l[k * d + i] * x[k];
    x[i] = s / l[i * d + i];
  }
  return x;
}
// Shrinkage LDA with equal class priors. Procrustes coordinates have 4 lost
// degrees of freedom (translation, scale, rotation), so the pooled covariance
// is singular and must be regularised.
export function fitLDA(X, labels, { shrinkage = 0.1 } = {}) {
  const d = X[0].length,
    taxa = [...new Set(labels)].sort(),
    means = {},
    counts = {};
  for (const t of taxa) {
    means[t] = new Float64Array(d);
    counts[t] = 0;
  }
  X.forEach((x, i) => {
    counts[labels[i]]++;
    for (let j = 0; j < d; j++) means[labels[i]][j] += x[j];
  });
  for (const t of taxa) for (let j = 0; j < d; j++) means[t][j] /= counts[t];
  const cov = new Float64Array(d * d);
  X.forEach((x, i) => {
    const m = means[labels[i]];
    for (let a = 0; a < d; a++)
      for (let b = 0; b <= a; b++) cov[a * d + b] += (x[a] - m[a]) * (x[b] - m[b]);
  });
  const dof = Math.max(1, X.length - taxa.length);
  let trace = 0;
  for (let a = 0; a < d; a++) {
    for (let b = 0; b <= a; b++) cov[b * d + a] = cov[a * d + b] /= dof;
    trace += cov[a * d + a];
  }
  for (let a = 0; a < d; a++)
    for (let b = 0; b < d; b++)
      cov[a * d + b] = (1 - shrinkage) * cov[a * d + b] + (a === b ? (shrinkage * trace) / d : 0);
  const l = cholesky(cov, d),
    model = taxa.map((t) => {
      const w = solve(l, d, means[t]);
      let b = 0;
      for (let j = 0; j < d; j++) b += w[j] * means[t][j];
      return { taxon: t, w, bias: -0.5 * b };
    });
  return {
    taxa,
    predict(x) {
      let best = null,
        value = -Infinity;
      for (const { taxon, w, bias } of model) {
        let s = bias;
        for (let j = 0; j < d; j++) s += w[j] * x[j];
        if (s > value) {
          value = s;
          best = taxon;
        }
      }
      return best;
    },
  };
}

// First two principal components (power iteration with deflation), used only
// for the 2D display of embeddings.
export function pca2(vectors) {
  const n = vectors.length,
    d = vectors[0]?.length ?? 0;
  if (n < 2 || !d) return vectors.map(() => [0, 0]);
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const centred = vectors.map((v) => Float64Array.from(v, (x, j) => x - mean[j])),
    components = [];
  for (let c = 0; c < 2; c++) {
    let w = Float64Array.from({ length: d }, (_, j) => Math.sin(j * 12.9898 + c * 78.233));
    for (let it = 0; it < 60; it++) {
      const next = new Float64Array(d);
      for (const x of centred) {
        let s = 0;
        for (let j = 0; j < d; j++) s += x[j] * w[j];
        for (let j = 0; j < d; j++) next[j] += s * x[j];
      }
      for (const prev of components) {
        let s = 0;
        for (let j = 0; j < d; j++) s += next[j] * prev[j];
        for (let j = 0; j < d; j++) next[j] -= s * prev[j];
      }
      const norm = Math.hypot(...next) || 1;
      w = next.map((x) => x / norm);
    }
    components.push(w);
  }
  return centred.map((x) =>
    components.map((w) => x.reduce((s, v, j) => s + v * w[j], 0)),
  );
}
