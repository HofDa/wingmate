// Plain-text attribution plus safe source/licence links for imported artifacts.
export function attributionNotice(attribution) {
  const p = document.createElement("p");
  p.className = "mini";
  p.dataset.modelAttribution = "";
  p.append(typeof attribution.citation === "string" ? attribution.citation : "Modelldaten: veröffentlichte Quelle.");
  for (const [label, value] of [["Quelle", attribution.sourceUrl], [attribution.license ?? "Lizenz", attribution.licenseUrl],
    ["Referenzdaten", attribution.databaseUrl]]) {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      const a = document.createElement("a");
      a.href = url.href;
      a.textContent = String(label);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      p.append(" · ", a);
    } catch { /* Invalid imported URLs stay inactive. */ }
  }
  if (typeof attribution.notice === "string") p.append(" ", attribution.notice);
  return p;
}
