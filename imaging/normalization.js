import { apply, inverse } from "./matrix.js";
// Keep signal measurements away from boundaries and their interpolation halo.
export function interiorMask(mask, width, height, radius = 2) {
  const out = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y++)
    for (let x = radius; x < width - radius; x++) {
      let inside = true;
      for (let dy = -radius; dy <= radius && inside; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          if (!mask[(y + dy) * width + x + dx]) { inside = false; break; }
      if (inside) out[y * width + x] = 1;
    }
  return out;
}
export function normalization(mask, w, h, o, params = {}) {
  const width = params.width ?? 1024,
    height = params.height ?? 512,
    margin = params.margin ?? 32;
  const angle = -o.angle + (params.flipped180 ? Math.PI : 0),
    c = Math.cos(angle),
    s = Math.sin(angle),
    mirror = params.mirrored ? -1 : 1;
  const a = c,
    b = -s,
    d = s * mirror,
    e = c * mirror;
  let rx = 0,
    ry = 0;
  const px = params.pixelScaleX ?? 1,
    py = params.pixelScaleY ?? 1,
    cx = (o.centroid.x + 0.5) * px - 0.5,
    cy = (o.centroid.y + 0.5) * py - 0.5;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const x = ((p % w) - o.centroid.x) * px,
        y = (Math.floor(p / w) - o.centroid.y) * py;
      rx = Math.max(rx, Math.abs(a * x + b * y) + Math.max(px, py));
      ry = Math.max(ry, Math.abs(d * x + e * y) + Math.max(px, py));
    }
  const scale = Math.min((width / 2 - margin) / rx, (height / 2 - margin) / ry),
    tx = (width - 1) / 2 - scale * (a * cx + b * cy),
    ty = (height - 1) / 2 - scale * (d * cx + e * cy);
  return {
    width,
    height,
    scale,
    rotationDeg: (angle * 180) / Math.PI,
    translationX: tx,
    translationY: ty,
    matrix: [a * scale, b * scale, tx, d * scale, e * scale, ty, 0, 0, 1],
  };
}
// Single RGB resampling from original; masks always nearest-neighbor.
export function resample(
  image,
  mask,
  maskWidth,
  maskHeight,
  matrix,
  width = 1024,
  height = 512,
) {
  const out = new Uint8ClampedArray(width * height * 4),
    outMask = new Uint8Array(width * height),
    signalMask = new Uint8Array(width * height),
    interior = interiorMask(mask, maskWidth, maskHeight),
    inv = inverse(matrix),
    { width: w, height: h, data } = image;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        q = apply(inv, x, y),
        mx = Math.round(((q.x + 0.5) * maskWidth) / w - 0.5),
        my = Math.round(((q.y + 0.5) * maskHeight) / h - 0.5);
      if (
        mx < 0 ||
        my < 0 ||
        mx >= maskWidth ||
        my >= maskHeight ||
        !mask[my * maskWidth + mx] ||
        q.x < 0 ||
        q.y < 0 ||
        q.x > w - 1 ||
        q.y > h - 1
      )
        continue;
      outMask[p] = 1;
      signalMask[p] = interior[my * maskWidth + mx];
      const x0 = Math.floor(q.x),
        y0 = Math.floor(q.y),
        fx = q.x - x0,
        fy = q.y - y0;
      for (let ch = 0; ch < 4; ch++) {
        let v = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            v +=
              data[
                (Math.min(h - 1, y0 + dy) * w + Math.min(w - 1, x0 + dx)) * 4 +
                  ch
              ] *
              (dx ? fx : 1 - fx) *
              (dy ? fy : 1 - fy);
        out[p * 4 + ch] = v;
      }
    }
  return { data: out, mask: outMask, signalMask, width, height };
}
