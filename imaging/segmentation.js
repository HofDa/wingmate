export function components(mask, w, h) {
  const seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length),
    groups = [];
  for (let p = 0; p < mask.length; p++)
    if (mask[p] && !seen[p]) {
      let head = 0,
        end = 1;
      queue[0] = p;
      seen[p] = 1;
      const pixels = [];
      while (head < end) {
        const q = queue[head++];
        pixels.push(q);
        const x = q % w,
          y = Math.floor(q / w);
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const xx = x + dx,
            yy = y + dy,
            i = yy * w + xx;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[i] && !seen[i]) {
            seen[i] = 1;
            queue[end++] = i;
          }
        }
      }
      groups.push(pixels);
    }
  return groups.sort((a, b) => b.length - a.length);
}
function morph(mask, w, h, r, dilate) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let value = dilate ? 0 : 1;
      outer: for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const xx = x + dx,
            yy = y + dy;
          const v =
            xx >= 0 && xx < w && yy >= 0 && yy < h ? mask[yy * w + xx] : 0;
          if (dilate ? v : !v) {
            value = dilate ? 1 : 0;
            break outer;
          }
        }
      out[y * w + x] = value;
    }
  return out;
}
export function fillHoles(mask, w, h) {
  const background = Uint8Array.from(mask, (v) => 1 - v);
  for (const group of components(background, w, h)) {
    if (
      !group.some(
        (p) => p % w === 0 || p % w === w - 1 || p < w || p >= w * (h - 1),
      )
    )
      for (const p of group) mask[p] = 1;
  }
  return mask;
}
const median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)];
export function segment({ data, width: w, height: h }, params = {}) {
  // Use the dominant border color cluster rather than averaging wing and
  // background when a clipped wing occupies part of the image perimeter.
  // Sample an inset band to avoid one-pixel publication frames.
  const border = [],
    histogram = new Uint32Array(4096);
  const inset = Math.max(2, Math.round(Math.min(w, h) * 0.025));
  const colorBin = (p) =>
    (data[p * 4] >> 4) * 256 +
    (data[p * 4 + 1] >> 4) * 16 +
    (data[p * 4 + 2] >> 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge >= inset && edge < inset + 3) {
        const p = y * w + x;
        if (data[p * 4 + 3] > 127) {
          border.push(p);
          histogram[colorBin(p)]++;
        }
      }
    }
  if (!border.length)
    for (let p = 0; p < w * h; p++) {
      border.push(p);
      histogram[colorBin(p)]++;
    }
  let mode = 0;
  for (let i = 1; i < histogram.length; i++)
    if (histogram[i] > histogram[mode]) mode = i;
  const samples = border.filter((p) => colorBin(p) === mode);
  const bg = [0, 1, 2].map((c) => median(samples.map((p) => data[p * 4 + c])));
  // With a calibrated rig, compare every pixel with the empty-rig image at the
  // same position instead of one border colour (handles vignetting and static
  // dust); noise is then measured on the whole border band.
  const model = params.backgroundImage ?? null;
  if (model && (model.width !== w || model.height !== h))
    throw Error("Hintergrundmodell hat falsche Größe");
  const ref = model ? model.data : null,
    distance = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++)
    distance[p] =
      Math.hypot(
        data[p * 4] - (ref ? ref[p * 4] : bg[0]),
        data[p * 4 + 1] - (ref ? ref[p * 4 + 1] : bg[1]),
        data[p * 4 + 2] - (ref ? ref[p * 4 + 2] : bg[2]),
      ) / Math.sqrt(3);
  const noise = median((model ? border : samples).map((p) => distance[p]));
  const threshold =
    params.threshold ??
    (model ? Math.max(5, noise * 3 + 3) : Math.max(9, noise * 3 + 5));
  let mask = Uint8Array.from(distance, (v, p) =>
    v > threshold && data[p * 4 + 3] > 127 ? 1 : 0,
  );
  const radius =
    params.closeRadius ?? Math.max(1, Math.round(Math.max(w, h) / 250));
  // Pad before closing so true edge contact is preserved.
  const pad = radius * 2,
    pw = w + pad * 2,
    ph = h + pad * 2,
    padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++)
    padded.set(mask.subarray(y * w, (y + 1) * w), (y + pad) * pw + pad);
  const closed = morph(
    morph(padded, pw, ph, radius, true),
    pw,
    ph,
    radius,
    false,
  );
  for (let y = 0; y < h; y++)
    mask.set(
      closed.subarray((y + pad) * pw + pad, (y + pad) * pw + pad + w),
      y * w,
    );
  mask = fillHoles(mask, w, h);
  const groups = components(mask, w, h);
  // Reject compact debris and almost full-frame components when a larger
  // plausible elongated wing exists. If nothing is plausible, preserve the
  // largest candidate for visual correction and force REVIEW downstream.
  const plausible = groups.filter((group) => {
    if (group.length < w * h * 0.005 || group.length > w * h * 0.8)
      return false;
    let cx = 0,
      cy = 0;
    for (const p of group) {
      cx += p % w;
      cy += Math.floor(p / w);
    }
    cx /= group.length;
    cy /= group.length;
    let xx = 0,
      xy = 0,
      yy = 0;
    for (const p of group) {
      const x = (p % w) - cx,
        y = Math.floor(p / w) - cy;
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
    const delta = Math.hypot(xx - yy, 2 * xy),
      elongation = (xx + yy + delta) / Math.max(1, xx + yy - delta);
    return elongation >= 2 && elongation <= 100;
  });
  const selected = plausible[0] ?? groups[0];
  mask.fill(0);
  if (selected) for (const p of selected) mask[p] = 1;
  return {
    mask,
    plausibleComponentFound: plausible.length > 0,
    componentAreas: groups.map((g) => g.length),
    background: bg,
    backgroundModel: model ? "rig-per-pixel" : "dominant-16-level-RGB-bin-inset-border",
    threshold,
    closeRadius: radius,
    noise,
  };
}
