// Row-major homogeneous matrices; pixel centers have integer coordinates.
export const apply = (m, x, y) => ({
  x: m[0] * x + m[1] * y + m[2],
  y: m[3] * x + m[4] * y + m[5],
});
export function multiply(a, b) {
  return Array.from({ length: 9 }, (_, i) => {
    let s = 0;
    for (let k = 0; k < 3; k++)
      s += a[Math.floor(i / 3) * 3 + k] * b[k * 3 + (i % 3)];
    return s;
  });
}
export function inverse(m) {
  const d = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(d) < 1e-12) throw Error("Singular transform");
  return [
    m[4] / d,
    -m[1] / d,
    (m[1] * m[5] - m[4] * m[2]) / d,
    -m[3] / d,
    m[0] / d,
    (m[3] * m[2] - m[0] * m[5]) / d,
    0,
    0,
    1,
  ];
}
