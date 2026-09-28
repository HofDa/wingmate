// Landmark editor for one normalized wing image.
// - Main view: normalized image (standard orientation); tap/click places the
//   current landmark, dragging moves an existing one.
// - Loupe: the *original* full-resolution pixels rendered in the standard
//   orientation around the selected landmark; clicking in the loupe refines
//   the position (sub-pixel precision on large photos, usable on phones) and
//   moves on to the next open landmark.
// - Guide: mean shape of the scheme; with ≥ 2 points it is fitted to the
//   placed points and shows where the next landmark is expected; with ≥ 4
//   points large deviations are flagged (typical cause: swapped numbering).
// Points are stored in original pixel coordinates (see classifier/landmarks.js).
import { scheme, nextOpen, placed, isResolved, toNormalized, toOriginal } from "../classifier/landmarks.js";

const LOUPE = 220,
  ZOOM = 6,
  HIT = 14; // CSS pixels

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// Least-squares similarity (complex a, t) mapping guide -> placed points.
export function fitGuide(guide, points) {
  const pairs = points.map((p, i) => (p ? [guide[i], p] : null)).filter(Boolean);
  if (pairs.length < 2) return null;
  const n = pairs.length,
    gc = [0, 0],
    pc = [0, 0];
  for (const [g, p] of pairs) {
    gc[0] += g[0] / n;
    gc[1] += g[1] / n;
    pc[0] += p.x / n;
    pc[1] += p.y / n;
  }
  let re = 0,
    im = 0,
    norm = 0;
  for (const [g, p] of pairs) {
    const gx = g[0] - gc[0],
      gy = g[1] - gc[1],
      px = p.x - pc[0],
      py = p.y - pc[1];
    re += px * gx + py * gy;
    im += py * gx - px * gy;
    norm += gx * gx + gy * gy;
  }
  if (!norm) return null;
  const a = [re / norm, im / norm],
    map = ([x, y]) => ({
      x: a[0] * (x - gc[0]) - a[1] * (y - gc[1]) + pc[0],
      y: a[1] * (x - gc[0]) + a[0] * (y - gc[1]) + pc[1],
    });
  return { map, scale: Math.hypot(...a), n };
}
// Placed points whose distance to the fitted guide exceeds `tolerance` × the
// guide length (guide is unit length). Needs ≥ 4 points for a meaningful fit.
export function outliers(guide, points, tolerance = 0.12) {
  const fit = fitGuide(guide, points);
  if (!fit || fit.n < 4) return [];
  return points
    .map((p, i) => {
      if (!p) return null;
      const g = fit.map(guide[i]);
      return Math.hypot(g.x - p.x, g.y - p.y) > tolerance * fit.scale ? i : null;
    })
    .filter((i) => i !== null);
}

export function createLandmarkEditor({ normalized, original, metadata, landmarks, onChange }) {
  const s = scheme(landmarks.scheme),
    root = el("div", { className: "lm-editor" }),
    main = el("canvas", { width: normalized.width, height: normalized.height, tabIndex: 0, className: "lm-main" }),
    loupe = el("canvas", { width: LOUPE, height: LOUPE, className: "lm-loupe" }),
    guideCanvas = el("canvas", { width: 260, height: 110, className: "lm-guide" }),
    status = el("p", { className: "mini", role: "status" }),
    warn = el("p", { className: "status", role: "status" });
  const base = el("canvas", { width: normalized.width, height: normalized.height }),
    src = el("canvas", { width: original.width, height: original.height });
  base.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(normalized.data), normalized.width, normalized.height), 0, 0);
  src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(original.data), original.width, original.height), 0, 0);
  let current = Math.max(0, nextOpen(landmarks)),
    dragging = null,
    hover = null;
  const undo = [];
  const snapshot = () => {
    undo.push(landmarks.points.map((p) => (p ? { ...p } : p)));
    if (undo.length > 100) undo.shift();
  };
  const changed = () => {
    draw();
    onChange?.(landmarks);
  };
  const norm = () => toNormalized(landmarks, metadata);
  const setPoint = (i, q) => (landmarks.points[i] = toOriginal(q, metadata));
  const advance = () => {
    const next = nextOpen(landmarks, current + 1);
    if (next >= 0) current = next;
  };

  function toCanvas(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width - 0.5, y: ((e.clientY - r.top) * canvas.height) / r.height - 0.5 };
  }
  // Canvas pixels per CSS pixel; 1 while the editor is not laid out yet.
  const cssScale = () => {
    const w = main.getBoundingClientRect().width;
    return w > 0 ? main.width / w : 1;
  };
  function hit(q) {
    const pts = norm(),
      limit = HIT * cssScale();
    let best = -1,
      d = limit;
    pts.forEach((p, i) => {
      if (!p) return;
      const dd = Math.hypot(p.x - q.x, p.y - q.y);
      if (dd < d) {
        d = dd;
        best = i;
      }
    });
    return best;
  }
  // Click vs. drag: pressing near a point only moves it once the pointer
  // travels a few pixels. A plain click places the current landmark when it
  // is still unset (neighbouring landmarks such as 1/2 or 16/17 can be only
  // a few pixels apart), otherwise selects the clicked point or moves the
  // current one there.
  let press = null;
  main.addEventListener("pointerdown", (e) => {
    main.focus({ preventScroll: true });
    const q = toCanvas(e, main);
    press = { q, candidate: hit(q), moved: false, clientX: e.clientX, clientY: e.clientY };
    main.setPointerCapture(e.pointerId);
  });
  main.addEventListener("pointermove", (e) => {
    hover = toCanvas(e, main);
    if (press && !press.moved && press.candidate >= 0 && Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > 4) {
      press.moved = true;
      snapshot();
      current = dragging = press.candidate;
    }
    if (dragging !== null) setPoint(dragging, hover);
    draw();
  });
  main.addEventListener("pointerup", () => {
    const p = press;
    press = null;
    if (!p) return;
    if (dragging !== null) {
      dragging = null;
      changed();
      return;
    }
    if (landmarks.points[current] !== undefined && p.candidate >= 0 && p.candidate !== current) {
      current = p.candidate;
      draw();
      return;
    }
    snapshot();
    setPoint(current, p.q);
    advance();
    changed();
  });
  main.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });
  // Loupe: centred on the selected landmark (or its predicted position);
  // a click there moves the selected landmark with loupe precision.
  let loupeCentre = null;
  loupe.addEventListener("pointerdown", (e) => {
    if (!loupeCentre) return;
    e.preventDefault();
    const l = toCanvas(e, loupe);
    snapshot();
    setPoint(current, { x: loupeCentre.x + (l.x + 0.5 - LOUPE / 2) / ZOOM, y: loupeCentre.y + (l.y + 0.5 - LOUPE / 2) / ZOOM });
    // Refined: continue with the next open landmark, keep keyboard focus.
    advance();
    main.focus({ preventScroll: true });
    changed();
  });
  main.addEventListener("keydown", (e) => {
    const p = norm()[current],
      step = e.shiftKey ? 2 : 0.25;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge && p) {
      snapshot();
      setPoint(current, { x: p.x + nudge[0], y: p.y + nudge[1] });
      changed();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "z") actions.undo();
    else if (e.key === "Delete" || e.key === "Backspace") actions.clear();
    else if (e.key === "n") actions.next();
    else if (e.key === "p") actions.prev();
    else return;
    e.preventDefault();
  });

  const actions = {
    prev: () => {
      current = (current + s.count - 1) % s.count;
      draw();
    },
    next: () => {
      current = (current + 1) % s.count;
      draw();
    },
    missing: () => {
      snapshot();
      landmarks.points[current] = null;
      advance();
      changed();
    },
    clear: () => {
      snapshot();
      landmarks.points[current] = undefined;
      changed();
    },
    undo: () => {
      if (!undo.length) return;
      landmarks.points = undo.pop();
      changed();
    },
    reset: () => {
      snapshot();
      landmarks.points = landmarks.points.map(() => undefined);
      current = 0;
      changed();
    },
  };
  const btn = (text, fn, title) => el("button", { type: "button", className: "ghost", textContent: text, onclick: fn, title });
  root.append(
    el(
      "div",
      { className: "buttonrow smallrow" },
      btn("◀ Vorige", actions.prev, "Taste p"),
      btn("Nächste ▶", actions.next, "Taste n"),
      btn("Fehlt (beschädigt)", actions.missing, "Landmarke nicht bestimmbar"),
      btn("Punkt löschen", actions.clear, "Entf"),
      btn("Rückgängig", actions.undo, "Strg+Z"),
      btn("Alle löschen", actions.reset),
    ),
    status,
    warn,
    el("div", { className: "lm-layout" }, main, el("div", { className: "lm-side" }, loupe, guideCanvas, el("p", { className: "mini", textContent: "Lupe: Originalpixel, Klick verfeinert die gewählte Landmarke. Pfeiltasten verschieben um 0,25 px (Shift: 2 px)." }))),
  );

  function draw() {
    const ctx = main.getContext("2d"),
      pts = norm(),
      fit = fitGuide(s.guide, pts),
      bad = new Set(outliers(s.guide, pts)),
      r = Math.max(4, 5 * cssScale());
    ctx.clearRect(0, 0, main.width, main.height);
    ctx.drawImage(base, 0, 0);
    ctx.font = `600 ${Math.round(12 * cssScale())}px system-ui`;
    ctx.lineWidth = Math.max(1.5, 1.5 * cssScale());
    if (fit)
      s.guide.forEach((g, i) => {
        if (pts[i] !== undefined) return;
        const q = fit.map(g);
        ctx.strokeStyle = i === current ? "rgba(0,207,255,.95)" : "rgba(0,207,255,.35)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 1.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    pts.forEach((p, i) => {
      if (!p) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bad.has(i) ? "#ff6b35" : i === current ? "#ffd700" : "#ff0055";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(i + 1), p.x + r + 2, p.y - r);
    });
    // Loupe centre: hover on main, else selected point, else its prediction.
    const selected = pts[current] || (fit ? fit.map(s.guide[current]) : null);
    loupeCentre = hover ?? selected;
    drawLoupe(pts, bad);
    drawGuide(pts, bad);
    const done = placed(landmarks),
      missing = landmarks.points.filter((p) => p === null).length;
    status.textContent = `Landmarke ${current + 1} / ${s.count} setzen · ${done} gesetzt${missing ? ` · ${missing} als fehlend markiert` : ""}${isResolved(landmarks) ? " · vollständig bearbeitet" : ""}`;
    warn.textContent = bad.size
      ? `Auffällig weit vom mittleren Muster: ${[...bad].map((i) => i + 1).join(", ")} – Nummerierung/Position prüfen (kann bei anderen Arten normal sein).`
      : "";
    warn.dataset.kind = bad.size ? "warn" : "";
  }
  function drawLoupe(pts, bad) {
    const ctx = loupe.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    if (!loupeCentre) return;
    const m = metadata.transformMatrix,
      c = loupeCentre,
      h = LOUPE / 2;
    // original -> normalized (m) -> loupe: zoom around the centre.
    ctx.setTransform(ZOOM * m[0], ZOOM * m[3], ZOOM * m[1], ZOOM * m[4], ZOOM * (m[2] - c.x) + h, ZOOM * (m[5] - c.y) + h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    pts.forEach((p, i) => {
      if (!p) return;
      const x = (p.x - c.x) * ZOOM + h,
        y = (p.y - c.y) * ZOOM + h;
      if (x < -10 || y < -10 || x > LOUPE + 10 || y > LOUPE + 10) return;
      ctx.strokeStyle = bad.has(i) ? "#ff6b35" : i === current ? "#ffd700" : "#ff0055";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "600 11px system-ui";
      ctx.fillText(String(i + 1), x + 8, y - 6);
    });
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(h, 0);
    ctx.lineTo(h, LOUPE);
    ctx.moveTo(0, h);
    ctx.lineTo(LOUPE, h);
    ctx.stroke();
  }
  function drawGuide(pts, bad) {
    const ctx = guideCanvas.getContext("2d"),
      W = guideCanvas.width,
      pad = 14,
      k = W - 2 * pad;
    ctx.clearRect(0, 0, W, guideCanvas.height);
    ctx.fillStyle = "#f6f7f5";
    ctx.fillRect(0, 0, W, guideCanvas.height);
    ctx.font = "600 10px system-ui";
    s.guide.forEach(([gx, gy], i) => {
      const x = pad + gx * k,
        y = pad + gy * k;
      ctx.beginPath();
      ctx.arc(x, y, i === current ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === current ? "#ffd700" : bad.has(i) ? "#ff6b35" : pts[i] ? "#1f6e4b" : pts[i] === null ? "#bbb" : "#fff";
      ctx.fill();
      ctx.strokeStyle = "#334039";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#334039";
      ctx.fillText(String(i + 1), x + 6, y - 4);
    });
    ctx.fillStyle = "#6f7a73";
    ctx.fillText("Basis", 2, guideCanvas.height - 4);
    ctx.textAlign = "right";
    ctx.fillText("distal", W - 2, guideCanvas.height - 4);
    ctx.textAlign = "left";
  }
  draw();
  // Marker sizes depend on the displayed size: redraw once laid out and on resize.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => draw()).observe(main);
  return { element: root, redraw: draw, select: (i) => ((current = i), draw()) };
}
