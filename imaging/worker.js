import { preprocess } from "./pipeline.js";
import { register, composeRegistration } from "./registration.js";
import { resample } from "./normalization.js";
self.onmessage = ({ data: { id, image, options, reference } }) => {
  try {
    const { source, ...result } = preprocess(image, options, { keepSource: true });
    if (reference) {
      const registration = register(
        reference,
        result.normalized.mask,
        result.normalized.width,
        result.normalized.height,
      );
      result.metadata = composeRegistration(result.metadata, registration);
      result.normalized = resample(
        source,
        result.mask,
        result.analysis.width,
        result.analysis.height,
        result.metadata.transformMatrix,
        result.normalized.width,
        result.normalized.height,
      );
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
