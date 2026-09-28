// Runs trainModel off the main thread (cross-validation refits many models).
import { trainModel } from "./model.js";
self.onmessage = ({ data: { refs, settings } }) => {
  try {
    const model = trainModel(refs, settings, (progress, stage) => self.postMessage({ progress, stage }));
    self.postMessage({ model });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
