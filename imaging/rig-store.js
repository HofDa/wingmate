// Rig profiles: IndexedDB persistence, active-profile selection and portable
// JSON export (typed arrays as base64).
import { database } from "./storage.js";
import { RIG_VERSION } from "./rig.js";
import { stringifyTyped, parseTyped } from "../classifier/typed-json.js";

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
export const serializeRig = (profile) => stringifyTyped(profile);
export function deserializeRig(text) {
  const profile = parseTyped(text);
  if (profile?.version !== RIG_VERSION) throw Error("Kein Rig-Profil der Version " + RIG_VERSION);
  return profile;
}
