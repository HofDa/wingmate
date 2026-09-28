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
// Ledoit–Wolf (2004) optimal shrinkage intensity towards a scaled identity for
// the covariance of already centred rows Z.
export function ledoitWolf(Z) {
  const n = Z.length,
    d = Z[0].length,
    S = new Float64Array(d * d);
  for (const z of Z)
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) S[a * d + b] += (z[a] * z[b]) / n;
  let trace = 0,
    frob = 0;
  for (let a = 0; a < d; a++) trace += S[a * d + a];
  const mu = trace / d;
  for (let a = 0; a < d; a++)
    for (let b = 0; b < d; b++) frob += (S[a * d + b] - (a === b ? mu : 0)) ** 2;
  let sq = 0;
  for (const v of S) sq += v * v;
  let beta = 0;
  for (const z of Z) {
    let norm2 = 0,
      quad = 0;
    for (let a = 0; a < d; a++) {
      norm2 += z[a] * z[a];
      let row = 0;
      for (let b = 0; b < d; b++) row += S[a * d + b] * z[b];
      quad += z[a] * row;
    }
    beta += norm2 * norm2 - 2 * quad + sq;
  }
  beta /= n * n;
  return frob > 0 ? Math.max(0, Math.min(1, Math.min(beta, frob) / frob)) : 1;
}
// Shrinkage LDA with equal class priors. Procrustes coordinates have 4 lost
// degrees of freedom (translation, scale, rotation), so the pooled covariance
// is singular and must be regularised; "auto" uses Ledoit–Wolf, which matters
// when there are few references per taxon.
export function fitLDA(X, labels, { shrinkage = "auto" } = {}) {
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
  if (shrinkage === "auto")
    shrinkage = ledoitWolf(X.map((x, i) => x.map((v, j) => v - means[labels[i]][j])));
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
  const scores = (x) =>
    model.map(({ taxon, w, bias }) => {
      let s = bias;
      for (let j = 0; j < d; j++) s += w[j] * x[j];
      return [taxon, s];
    });
  return {
    taxa,
    shrinkage,
    scores: (x) => Object.fromEntries(scores(x)),
    predict(x) {
      let best = null,
        value = -Infinity;
      for (const [taxon, s] of scores(x))
        if (s > value) {
          value = s;
          best = taxon;
        }
      return best;
    },
    // Posterior under the LDA model (shared covariance, equal priors). It is
    // conditional on the query belonging to one of the known taxa.
    predictProba(x) {
      const sc = scores(x),
        max = Math.max(...sc.map((e) => e[1])),
        exp = sc.map(([t, s]) => [t, Math.exp(s - max)]),
        total = exp.reduce((a, e) => a + e[1], 0);
      return Object.fromEntries(exp.map(([t, e]) => [t, e / total]));
    },
  };
}

// Eigen-decomposition of a symmetric d × d matrix (cyclic Jacobi). Returns
// eigenvalues (descending) and eigenvectors as rows.
export function symmetricEigen(A, d) {
  const a = Float64Array.from(A),
    v = new Float64Array(d * d);
  for (let i = 0; i < d; i++) v[i * d + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) off += a[p * d + q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < d; p++)
      for (let q = p + 1; q < d; q++) {
        const apq = a[p * d + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * d + q] - a[p * d + p]) / (2 * apq),
          t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)),
          c = 1 / Math.sqrt(t * t + 1),
          sn = t * c;
        for (let k = 0; k < d; k++) {
          const akp = a[k * d + p],
            akq = a[k * d + q];
          a[k * d + p] = c * akp - sn * akq;
          a[k * d + q] = sn * akp + c * akq;
        }
        for (let k = 0; k < d; k++) {
          const apk = a[p * d + k],
            aqk = a[q * d + k];
          a[p * d + k] = c * apk - sn * aqk;
          a[q * d + k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < d; k++) {
          const vkp = v[k * d + p],
            vkq = v[k * d + q];
          v[k * d + p] = c * vkp - sn * vkq;
          v[k * d + q] = sn * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: d }, (_, i) => i).sort((i, j) => a[j * d + j] - a[i * d + i]);
  return {
    values: order.map((i) => a[i * d + i]),
    vectors: order.map((i) => Array.from({ length: d }, (_, k) => v[k * d + i])),
  };
}
// Principal-component basis of the rows of X (centred on their mean).
export function pcaBasis(X, k) {
  const n = X.length,
    d = X[0].length,
    mean = new Float64Array(d),
    cov = new Float64Array(d * d);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  for (const x of X)
    for (let a = 0; a < d; a++) for (let b = a; b < d; b++) cov[a * d + b] += ((x[a] - mean[a]) * (x[b] - mean[b])) / Math.max(1, n - 1);
  for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) cov[a * d + b] = cov[b * d + a];
  const { values, vectors } = symmetricEigen(cov, d),
    basis = vectors.slice(0, k);
  return {
    k: basis.length,
    explained: values.slice(0, k).reduce((a, b) => a + b, 0) / (values.reduce((a, b) => a + Math.max(0, b), 0) || 1),
    project: (x) => basis.map((w) => w.reduce((s, wj, j) => s + wj * (x[j] - mean[j]), 0)),
  };
}
// How many principal components LDA may use: Procrustes coordinates lose 4
// dimensions; with few specimens use at most (n − taxa) / 2 components so the
// pooled covariance is estimated from several samples per dimension.
export function ldaComponents(n, taxa, d) {
  return Math.max(1, Math.min(d - 4, Math.floor((n - taxa) / 2)));
}
// Procrustes coordinates -> PCA (few components when data are scarce) ->
// shrinkage LDA. This is the usual small-sample practice in geometric
// morphometrics (LDA on principal components / relative warps).
export function fitShapeLDA(X, labels, { components = "auto", shrinkage = "auto" } = {}) {
  const taxa = new Set(labels).size,
    k = components === "auto" ? ldaComponents(X.length, taxa, X[0].length) : components,
    pca = pcaBasis(X, k),
    lda = fitLDA(X.map(pca.project), labels, { shrinkage });
  return {
    ...lda,
    components: pca.k,
    explainedVariance: pca.explained,
    scores: (x) => lda.scores(pca.project(x)),
    predict: (x) => lda.predict(pca.project(x)),
    predictProba: (x) => lda.predictProba(pca.project(x)),
  };
}
export function softmax(scores, temperature = 1) {
  const entries = Object.entries(scores),
    max = Math.max(...entries.map((e) => e[1])),
    exp = entries.map(([t, s]) => [t, Math.exp((s - max) / temperature)]),
    total = exp.reduce((a, e) => a + e[1], 0);
  return Object.fromEntries(exp.map(([t, e]) => [t, e / total]));
}
// Temperature scaling (Guo et al. 2017) fitted on grouped leave-one-out
// discriminant scores of the references themselves: T > 1 softens
// overconfident posteriors. Loss is class-balanced negative log-likelihood.
export function fitTemperature(looScores, labels) {
  const counts = {};
  labels.forEach((l) => (counts[l] = (counts[l] || 0) + 1));
  const loss = (T) =>
    looScores.reduce((a, s, i) => (s ? a - Math.log(Math.max(1e-12, softmax(s, T)[labels[i]] ?? 1e-12)) / counts[labels[i]] : a), 0);
  let lo = Math.log(0.05),
    hi = Math.log(100);
  for (let it = 0; it < 80; it++) {
    const m1 = lo + (hi - lo) / 3,
      m2 = hi - (hi - lo) / 3;
    if (loss(Math.exp(m1)) < loss(Math.exp(m2))) hi = m2;
    else lo = m1;
  }
  return Math.exp((lo + hi) / 2);
}
// Shape LDA with posteriors calibrated by temperature scaling on grouped
// leave-one-out over the references (specimen groups held out together).
export function fitCalibratedShapeLDA(X, labels, groups, options = {}) {
  const model = fitShapeLDA(X, labels, options),
    loo = X.map((x, i) => {
      const keep = X.map((_, j) => j).filter((j) => groups[j] !== groups[i]),
        taxa = new Set(keep.map((j) => labels[j]));
      if (!taxa.has(labels[i]) || taxa.size < 2 || taxa.size !== new Set(labels).size) return null;
      return fitShapeLDA(keep.map((j) => X[j]), keep.map((j) => labels[j]), options).scores(x);
    }),
    usable = loo.filter(Boolean).length,
    temperature = usable >= 4 ? fitTemperature(loo, labels) : null;
  return {
    ...model,
    temperature,
    calibrationQueries: usable,
    predictProba: (x) => softmax(model.scores(x), temperature ?? 1),
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
