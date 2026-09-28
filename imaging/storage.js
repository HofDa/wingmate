// Local specimen archive. Original File objects, masks, transforms and normalized
// RGBA arrays are stored together, so manual corrections remain reproducible.
// Version 2 adds calibrated rig profiles, version 3 trained models.
export function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bee-wing-preprocessing", 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("specimens"))
        db.createObjectStore("specimens", { keyPath: "id" });
      if (!db.objectStoreNames.contains("rigs"))
        db.createObjectStore("rigs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("models"))
        db.createObjectStore("models", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveSpecimen(items, { rig = null } = {}) {
  const db = await database(),
    id = crypto.randomUUID();
  const record = {
    id,
    createdAt: new Date().toISOString(),
    rigProfileId: rig?.id ?? null,
    images: Object.fromEntries(
      Object.entries(items)
        .filter(([, i]) => i)
        .map(([type, i]) => [
          type,
          {
            sourceFile: i.sourceFile,
            sourceSha256: i.sha256,
            sourceName: i.name,
            capture: i.capture ?? null,
            landmarks: i.landmarks ?? null,
            metadata: i.result.metadata,
            mask: i.result.mask,
            normalized: i.result.normalized,
          },
        ]),
    ),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction("specimens", "readwrite");
    tx.objectStore("specimens").put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(id);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error("Speichern abgebrochen"));
    };
  });
}
export async function latestSpecimen() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("specimens", "readonly"),
      r = tx.objectStore("specimens").getAll();
    r.onsuccess = () => {
      const records = r.result.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      resolve(records[0] ?? null);
    };
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
