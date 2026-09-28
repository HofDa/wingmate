// Rig profiles: IndexedDB persistence, active-profile selection and portable
// JSON export (typed arrays as base64).
import { database } from "./storage.js";
import { RIG_VERSION } from "./rig.js";

const ACTIVE_KEY = "wingmate-active-rig";
let cached = null;

async function run(mode, fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("rigs", mode),
      request = fn(tx.objectStore("rigs"));
    tx.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || Error("Rig-Speicher nicht verfügbar"));
    };
  });
}
export const listRigs = async () =>
  ((await run("readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.name.localeCompare(b.name));
export async function saveRig(profile) {
  await run("readwrite", (s) => s.put(profile));
  notify();
}
export async function deleteRig(id) {
  await run("readwrite", (s) => s.delete(id));
  if (activeRigId() === id) setActiveRig(null);
  else notify();
}
export function activeRigId() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveRig(id) {
  try {
    id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY);
  } catch {}
  notify();
}
export async function activeRig() {
  const id = activeRigId();
  if (!id) return null;
  if (cached?.id === id) return cached;
  cached = (await run("readonly", (s) => s.get(id))) ?? null;
  return cached;
}
function notify() {
  cached = null;
  window.dispatchEvent(new CustomEvent("wing-rig-change"));
}

// ---------- portable JSON ----------
const TYPED = { Float32Array, Uint8ClampedArray, Uint8Array };
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text),
    out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function serializeRig(profile) {
  return JSON.stringify(profile, (_, v) => {
    for (const [name, T] of Object.entries(TYPED))
      if (v instanceof T)
        return { $typed: name, base64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    return v;
  });
}
export function deserializeRig(text) {
  const profile = JSON.parse(text, (_, v) => {
    if (v && typeof v === "object" && typeof v.$typed === "string") {
      const T = TYPED[v.$typed];
      if (!T) throw Error("Unbekannter Array-Typ im Rig-Profil");
      const bytes = fromBase64(v.base64);
      return new T(bytes.buffer, 0, bytes.byteLength / T.BYTES_PER_ELEMENT);
    }
    return v;
  });
  if (profile?.version !== RIG_VERSION) throw Error("Kein Rig-Profil der Version " + RIG_VERSION);
  return profile;
}
