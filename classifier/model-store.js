// Trained models: IndexedDB persistence, active model and JSON export.
import { database } from "../imaging/storage.js";
import { stringifyTyped, parseTyped } from "./typed-json.js";
import { MODEL_VERSION } from "./model.js";

const ACTIVE_KEY = "wingmate-active-model";
async function run(mode, fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("models", mode),
      request = fn(tx.objectStore("models"));
    tx.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || Error("Modellspeicher nicht verfügbar"));
    };
  });
}
export const listModels = async () =>
  ((await run("readonly", (s) => s.getAll())) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getModel = (id) => run("readonly", (s) => s.get(id));
export const saveModel = (model) => run("readwrite", (s) => s.put(model));
export const deleteModel = (id) => run("readwrite", (s) => s.delete(id));
export function activeModelId() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveModelId(id) {
  try {
    id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}
export const serializeModel = (model) => stringifyTyped(model);
export function deserializeModel(text) {
  const model = parseTyped(text);
  if (model?.version !== MODEL_VERSION) throw Error("Kein Modell der Version " + MODEL_VERSION);
  return model;
}
