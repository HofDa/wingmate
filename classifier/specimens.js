// One statistical unit per animal. Exact repeated feature records are views,
// not additional observations. Ordering never depends on reference/archive IDs.
import { gpa } from "./morphometrics.js";

export const ANIMAL_POLICY = "mean-distinct-views-per-animal-v1";
export function viewKey(record, blocks) {
  return JSON.stringify({ version: record.features.version, scheme: blocks.includes("landmarks") ? record.features.landmarkScheme : undefined,
    blocks: blocks.map((b) => [b, record.features.blocks[b]]) });
}
export function distinctViews(refs, blocks) {
  const animals = new Map();
  for (const r of refs) {
    if (r.group === null || r.group === undefined || r.group === "") throw Error("Jede Referenz braucht eine stabile Exemplar-ID.");
    if (!animals.has(r.group)) animals.set(r.group, { label: r.species, views: new Map() });
    const animal = animals.get(r.group);
    if (animal.label !== r.species) throw Error(`Exemplar ${r.group} hat mehrere Taxa`);
    animal.views.set(viewKey(r, blocks), r);
  }
  return [...animals].sort(([a], [b]) => String(a).localeCompare(String(b)))
    .flatMap(([, animal]) => [...animal.views].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r));
}
export function animalReferences(refs, blocks) {
  const animals = new Map();
  for (const r of distinctViews(refs, blocks)) {
    if (!animals.has(r.group)) animals.set(r.group, []);
    animals.get(r.group).push(r);
  }
  return [...animals].map(([group, views]) => {
    const features = { ...views[0].features, blocks: {} };
    for (const b of blocks) {
      if (b === "landmarks") {
        const configs = views.map((r) => {
          const flat = r.features.blocks.landmarks;
          return Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
        });
        // Align views within this animal before averaging corresponding points.
        features.blocks[b] = gpa(configs).mean.flat();
      } else {
        features.blocks[b] = views[0].features.blocks[b].map((_, i) =>
          views.reduce((sum, r) => sum + r.features.blocks[b][i] / views.length, 0));
      }
    }
    return { ...views[0], id: String(group), group, features, viewCount: views.length };
  });
}
