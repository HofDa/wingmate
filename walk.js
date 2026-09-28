// Exact probability evolution and one illustrative trajectory on the same chain.
export function traceWalk(P, query, { steps = 40, restart = .2, random = Math.random } = {}) {
  let probability = new Float64Array(P.length);
  probability[query] = 1;
  const distributions = [probability];
  const path = [{ node: query, restarted: false }];
  for (let step = 0; step < steps; step++) {
    const next = new Float64Array(P.length);
    next[query] = restart;
    for (let i = 0; i < P.length; i++) {
      const edges = P[i].length ? P[i] : [[i, 1]];
      for (const [target, weight] of edges) next[target] += (1 - restart) * probability[i] * weight;
    }
    probability = next;
    distributions.push(next);
    const previous = path.at(-1).node;
    const restarted = random() < restart;
    let node = query;
    if (!restarted) {
      const edges = P[previous].length ? P[previous] : [[previous, 1]];
      let draw = random();
      node = edges.at(-1)[0];
      for (const [target, weight] of edges) {
        draw -= weight;
        if (draw < 0) { node = target; break; }
      }
    }
    path.push({ node, restarted });
  }
  return { distributions, path };
}

export function createWalkView(root) {
  const find = selector => root.querySelector(selector);
  const slider = find('[data-step]'), play = find('[data-play]');
  let run = null, timer = null;
  function pause() { clearInterval(timer); timer = null; play.textContent = 'Abspielen'; }
  function reset() {
    pause(); run = null;
    for (const control of root.querySelectorAll('button, input')) control.disabled = true;
    slider.value = 0;
    find('[data-counter]').textContent = 'Schritt 0 / 40';
    find('[data-graph]').replaceChildren();
    find('[data-nodes]').replaceChildren();
    find('[data-limit]').textContent = '';
    find('[data-status]').textContent = 'Nach einer Klassifikation erscheinen hier die Markov-Walks.';
  }
  function svgElement(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function render() {
    if (!run) return;
    const step = Number(slider.value), { P, query, labels, distributions, path } = run;
    const current = path[step], previous = path[Math.max(0, step - 1)];
    const probabilities = distributions[step];
    find('[data-counter]').textContent = `Schritt ${step} / ${path.length - 1}`;
    find('[data-status]').textContent = step === 0 ? 'Start am Anfrage-Knoten.' :
      `${current.restarted ? 'Restart' : 'Übergang'}: ${labels[previous.node]} → ${labels[current.node]}.`;
    // Keep large reference sets readable; all nodes remain in the calculation and table.
    const ranked = [...probabilities.keys()].sort((a, b) => probabilities[b] - probabilities[a]);
    const visible = [...new Set([query, previous.node, current.node, ...ranked])].slice(0, 36)
      .sort((a, b) => a === query ? -1 : b === query ? 1 : a - b);
    const positions = new Map(visible.map((node, i) => [node, node === query ? [360, 200] :
      [360 + 285 * Math.cos(2 * Math.PI * (i - 1) / (visible.length - 1)),
        200 + 150 * Math.sin(2 * Math.PI * (i - 1) / (visible.length - 1))]]));
    const svg = find('[data-graph]'); svg.replaceChildren();
    const defs = svgElement('defs', {});
    const marker = svgElement('marker', { id: 'walk-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#bc621b' }));
    defs.append(marker); svg.append(defs);
    function edge(from, to, active = false) {
      const a = positions.get(from), b = positions.get(to);
      if (!a || !b || from === to) return;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const radius = 9 + 24 * Math.sqrt(probabilities[to]);
      svg.append(svgElement('line', { x1: a[0], y1: a[1], x2: b[0] - (radius + 5) * Math.cos(angle), y2: b[1] - (radius + 5) * Math.sin(angle),
        stroke: active ? '#bc621b' : '#d7ddd8', 'stroke-width': active ? 3 : 1,
        ...(active ? { 'marker-end': 'url(#walk-arrow)', 'stroke-dasharray': current.restarted ? '7 5' : 'none' } : {}) }));
    }
    for (const from of visible) for (const [to] of P[from]) edge(from, to);
    if (step) edge(previous.node, current.node, true);
    for (const node of visible) {
      const [x, y] = positions.get(node);
      const circle = svgElement('circle', { cx: x, cy: y, r: 9 + 24 * Math.sqrt(probabilities[node]), fill: node === query ? '#17201b' : '#1f6e4b', stroke: node === current.node ? '#bc621b' : '#fff', 'stroke-width': node === current.node ? 4 : 2 });
      circle.append(svgElement('title', {}, `${labels[node]}: ${(probabilities[node] * 100).toFixed(2)} %`));
      svg.append(circle, svgElement('text', { x, y: y + 48, 'text-anchor': 'middle', fill: '#334039', 'font-size': 12 }, node === query ? 'Anfrage' : `#${node + 1}`));
    }
    find('[data-limit]').textContent = visible.length < P.length ? `Graph zeigt ${visible.length} von ${P.length} Knoten; die Tabelle enthält alle Knoten.` : `${P.length} Knoten · Kanten des Referenzgraphen`;
    const body = find('[data-nodes]'); body.replaceChildren();
    for (const node of ranked) {
      const row = document.createElement('tr');
      for (const value of [labels[node], `${(probabilities[node] * 100).toFixed(2)} %`, node === current.node ? '● Walker' : '']) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      body.append(row);
    }
  }
  slider.addEventListener('input', () => { pause(); render(); });
  find('[data-reset]').addEventListener('click', () => { pause(); slider.value = 0; render(); });
  play.addEventListener('click', () => {
    if (timer) { pause(); return; }
    if (Number(slider.value) === Number(slider.max)) slider.value = 0;
    render(); play.textContent = 'Pause';
    timer = setInterval(() => { slider.value = Number(slider.value) + 1; render(); if (slider.value === slider.max) pause(); }, 500);
  });
  reset();
  return { reset, show(data) {
    pause(); run = data;
    slider.max = data.path.length - 1; slider.value = 0;
    for (const control of root.querySelectorAll('button, input')) control.disabled = false;
    render();
  } };
}
