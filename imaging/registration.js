import { apply, inverse, multiply } from "./matrix.js";
// Rigid + uniform-scale refinement. No shear or non-linear deformation.
export function register(reference, moving, width, height) {
  const stride = 8,
    boundary = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (
        moving[p] &&
        (!x ||
          !y ||
          x === width - 1 ||
          y === height - 1 ||
          !moving[p - 1] ||
          !moving[p + 1] ||
          !moving[p - width] ||
          !moving[p + width])
      )
        boundary.push([x, y]);
    }
  function matrix(a, s, tx, ty) {
    const c = Math.cos(a) * s,
      t = Math.sin(a) * s,
      cx = (width - 1) / 2,
      cy = (height - 1) / 2;
    return [
      c,
      -t,
      cx - c * cx + t * cy + tx,
      t,
      c,
      cy - t * cx - c * cy + ty,
      0,
      0,
      1,
    ];
  }
  function score(m) {
    for (const [x, y] of boundary) {
      const q = apply(m, x, y);
      if (q.x < 0 || q.y < 0 || q.x > width - 1 || q.y > height - 1) return -1;
    }
    const inv = inverse(m);
    let intersection = 0,
      union = 0;
    for (let y = 0; y < height; y += stride)
      for (let x = 0; x < width; x += stride) {
        const q = apply(inv, x, y),
          xx = Math.round(q.x),
          yy = Math.round(q.y),
          a = reference[y * width + x],
          b =
            xx >= 0 && yy >= 0 && xx < width && yy < height
              ? moving[yy * width + xx]
              : 0;
        if (a && b) intersection++;
        if (a || b) union++;
      }
    return union ? intersection / union : 0;
  }
  let p = [0, 1, 0, 0],
    best = score(matrix(...p));
  const initialIoU = best;
  for (const step of [
    [0.04, 0.04, 12, 12],
    [0.015, 0.015, 4, 4],
    [0.005, 0.005, 1, 1],
  ])
    for (let iter = 0; iter < 8; iter++) {
      let changed = false;
      for (let k = 0; k < 4; k++)
        for (const sign of [-1, 1]) {
          const q = p.slice();
          q[k] += step[k] * sign;
          if (
            Math.abs(q[0]) > 0.26 ||
            q[1] < 0.8 ||
            q[1] > 1.2 ||
            Math.abs(q[2]) > 64 ||
            Math.abs(q[3]) > 32
          )
            continue;
          const v = score(matrix(...q));
          if (v > best + 1e-8) {
            p = q;
            best = v;
            changed = true;
          }
        }
      if (!changed) break;
    }
  return {
    matrix: matrix(...p),
    initialIoU,
    maskIoU: best,
    status: best >= 0.9 ? "GOOD" : "REVIEW",
    method: "bounded-similarity-mask-IoU",
    anatomicalCorrespondence:
      "Contour alignment only; internal landmarks not verified",
    parameters: {
      samplingStride: stride,
      maxRotationRad: 0.26,
      scaleRange: [0.8, 1.2],
      translationBounds: [64, 32],
    },
  };
}
export function composeRegistration(metadata, registration) {
  const transformMatrix = multiply(
    registration.matrix,
    metadata.transformMatrix,
  );
  return {
    ...metadata,
    preRegistrationMatrix: metadata.transformMatrix,
    transformMatrix,
    inverseTransformMatrix: inverse(transformMatrix),
    registration,
    scale: Math.hypot(transformMatrix[0], transformMatrix[3]),
    translationX: transformMatrix[2],
    translationY: transformMatrix[5],
    rotationDeg:
      metadata.rotationDeg +
      ((metadata.mirrored ? -1 : 1) *
        Math.atan2(registration.matrix[3], registration.matrix[0]) *
        180) /
        Math.PI,
  };
}
