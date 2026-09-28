export function orientation(mask, w, h) {
  let n = 0,
    cx = 0,
    cy = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      n++;
      cx += p % w;
      cy += Math.floor(p / w);
    }
  if (n < 8)
    throw Error(
      "Keine plausible Flügelfläche erkannt. Schwelle ändern oder manuelle Maske laden.",
    );
  cx /= n;
  cy /= n;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const x = (p % w) - cx,
        y = Math.floor(p / w) - cy;
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
  let angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  let lo = Infinity,
    hi = -Infinity;
  const points = [];
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const x = (p % w) - cx,
        y = Math.floor(p / w) - cy,
        u = x * c + y * s,
        v = -x * s + y * c;
      points.push([u, v]);
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
  const bins = Array.from({ length: 40 }, () => [Infinity, -Infinity]);
  for (const [u, v] of points) {
    const b = bins[Math.min(39, Math.floor(((u - lo) / (hi - lo)) * 40))];
    b[0] = Math.min(b[0], v);
    b[1] = Math.max(b[1], v);
  }
  const widths = bins.map((b) => Math.max(0, b[1] - b[0]));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const left = mean(widths.slice(3, 13)),
    right = mean(widths.slice(27, 37));
  const directionScore = Math.abs(left - right) / Math.max(left, right, 1);
  const autoFlipped180 = left > right;
  if (autoFlipped180) angle += Math.PI;
  const elongation =
    (xx + yy + Math.hypot(xx - yy, 2 * xy)) /
    Math.max(1, xx + yy - Math.hypot(xx - yy, 2 * xy));
  const point = (u) => ({ x: cx + u * c, y: cy + u * s });
  return {
    angle,
    centroid: { x: cx, y: cy },
    base: point(autoFlipped180 ? hi : lo),
    tip: point(autoFlipped180 ? lo : hi),
    axisLength: hi - lo,
    elongation,
    orientationConfidence:
      directionScore > 0.2 && elongation > 3 ? "medium" : "low",
    directionScore,
    autoFlipped180,
    widthProfile: widths,
  };
}
