export function quality(mask, w, h, seg) {
  let area = 0,
    minX = w,
    minY = h,
    maxX = -1,
    maxY = -1,
    edge = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const x = p % w,
        y = Math.floor(p / w);
      area++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (!x || !y || x === w - 1 || y === h - 1) edge++;
    }
  const fraction = area / (w * h),
    large = seg.componentAreas.filter((n) => n >= area * 0.1),
    fragmentationScore = area
      ? 1 - area / (large.reduce((a, b) => a + b, 0) || area)
      : 1,
    reasons = [];
  if (seg.plausibleComponentFound === false)
    reasons.push("Keine plausible längliche Flügelkomponente");
  if (fraction < 0.025) reasons.push("Flügelfläche sehr klein");
  if (fraction > 0.8) reasons.push("Maske bedeckt fast das ganze Bild");
  if (edge) reasons.push("Flügel berührt den Bildrand");
  if (fragmentationScore > 0.12) reasons.push("Mehrere große Komponenten");
  if (seg.noise > 15) reasons.push("Unruhiger Hintergrund");
  const occupancy = area / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  if (occupancy < 0.18) reasons.push("Maske sehr dünn oder fragmentiert");
  return {
    wingArea: area,
    areaFraction: fraction,
    boundingBox: area
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
    maskConfidence: reasons.length ? "low" : "medium",
    maskConfidenceMeaning:
      "Unkalibrierte regelbasierte Bewertung, keine Wahrscheinlichkeit",
    edgeContact: edge > 0,
    edgeContactPixels: edge,
    fragmentationScore,
    status: reasons.length ? "REVIEW" : "GOOD",
    reasons,
  };
}
