// Analytic wing silhouette used by the imaging and classifier tests.
export function fixture({
  angle = 0,
  dx = 0,
  dy = 0,
  scale = 1,
  bg = 240,
  mirror = false,
  wip = false,
} = {}) {
  const width = 360,
    height = 360,
    data = new Uint8ClampedArray(width * height * 4),
    c = Math.cos((angle * Math.PI) / 180),
    s = Math.sin((angle * Math.PI) / 180);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const xx = (x - 180 - dx) / scale,
        yy = (y - 180 - dy) / scale,
        u = xx * c + yy * s,
        v = (-xx * s + yy * c) * (mirror ? -1 : 1),
        t = (u + 110) / 220,
        half =
          t > 0 && t < 1
            ? 50 * Math.sin(Math.PI * t) ** 0.65 * (0.3 + 0.7 * t)
            : 0,
        center = 8 * Math.sin(t * Math.PI);
      const inside = t > 0 && t < 1 && Math.abs(v - center) < half,
        p = (y * width + x) * 4;
      data[p] = inside ? 100 : bg;
      data[p + 1] = inside ? (wip ? 65 : 100) : bg;
      data[p + 2] = inside ? (wip ? 185 : 100) : bg;
      data[p + 3] = 255;
    }
  return { data, width, height };
}
