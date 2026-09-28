// JSON with typed arrays (Float32Array, Uint8ClampedArray, …) encoded as
// base64, so fitted models and rig profiles can be exported as one file.
const TYPED = { Float32Array, Float64Array, Int32Array, Uint8ClampedArray, Uint8Array };
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text),
    out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function stringifyTyped(value, space) {
  return JSON.stringify(
    value,
    (_, v) => {
      for (const [name, T] of Object.entries(TYPED))
        if (v instanceof T) return { $typed: name, base64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      return v;
    },
    space,
  );
}
export function parseTyped(text) {
  return JSON.parse(text, (_, v) => {
    if (v && typeof v === "object" && typeof v.$typed === "string") {
      const T = TYPED[v.$typed];
      if (!T) throw Error("Unbekannter Array-Typ: " + v.$typed);
      const bytes = fromBase64(v.base64);
      return new T(bytes.buffer, 0, bytes.byteLength / T.BYTES_PER_ELEMENT);
    }
    return v;
  });
}
