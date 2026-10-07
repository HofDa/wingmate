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

// Presentation values use the exact distribution; scores follow the
// classifier's reference-count correction and exclude the query's mass.
export function summarizeWalk(probability, query, taxa, previous = probability) {
  const byTaxon = new Map();
  for (let node = 0; node < probability.length; node++) {
    if (node === query) continue;
    const name = taxa[node];
    if (!byTaxon.has(name)) byTaxon.set(name, { name, count: 0, mass: 0, score: 0 });
    const row = byTaxon.get(name);
    row.count++;
    row.mass += probability[node];
  }
  const rows = [...byTaxon.values()];
  const correctedMass = rows.reduce((sum, row) => sum + row.mass / row.count, 0);
  for (const row of rows) row.score = correctedMass ? row.mass / row.count / correctedMass : 0;
  return {
    rows, queryMass: probability[query],
    referenceMass: rows.reduce((sum, row) => sum + row.mass, 0),
    // Total variation: mass that must move to obtain the new distribution.
    moved: probability.reduce((sum, mass, node) => sum + Math.abs(mass - previous[node]), 0) / 2,
  };
}

export function walkTransitions(P, node, query, restart = .2) {
  const targets = new Map([[query, restart]]);
  for (const [target, weight] of P[node].length ? P[node] : [[node, 1]])
    targets.set(target, (targets.get(target) || 0) + (1 - restart) * weight);
  return [...targets].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

export function createWalkView(root) {
  const find = selector => root.querySelector(selector);
  const slider = find('[data-step]'), play = find('[data-play]');
  const colors = ['#1f6e4b', '#356ca0', '#8656a2', '#a05c25', '#287c85', '#994c65'];
  const number = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (value, exact = false) => exact ? `${(value * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %` :
    value > 0 && value < .001 ? '< 0,1 %' : `${number.format(value * 100)} %`;
  const delta = value => Math.abs(value) < .00005 ? '—' : `${value > 0 ? '+' : '−'}${number.format(Math.abs(value) * 100)} pp`;
  const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let run = null, timer = null, selected = null, rankedNodes = [], taxonColors = new Map();
  let narrowGraph = false;
  function pause() {
    clearInterval(timer); timer = null;
    play.textContent = run && Number(slider.value) === run.path.length - 1 ? 'Erneut abspielen' : 'Abspielen';
  }
  function reset() {
    pause(); run = null; selected = null;
    for (const control of root.querySelectorAll('button, input')) control.disabled = true;
    find('[data-content]').hidden = true;
    find('[data-empty]').hidden = false;
    slider.value = 0;
    find('[data-counter]').textContent = 'Schritt 0 / 40';
    for (const selector of ['[data-graph]', '[data-nodes]', '[data-taxa]', '[data-transitions]']) find(selector).replaceChildren();
    find('[data-limit]').textContent = '';
    find('[data-status]').textContent = 'Nach einer Bestimmung kannst du hier die Berechnung erkunden.';
  }
  function svgElement(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function select(node, keyboard = false) {
    pause(); selected = node; render();
    if (keyboard) find(`[data-node="${node}"]`)?.focus();
  }
  function render() {
    if (!run) return;
    const step = Number(slider.value), { P, query, labels, taxa, distributions, path, restart } = run;
    const current = path[step], previous = path[Math.max(0, step - 1)];
    const probabilities = distributions[step], before = distributions[Math.max(0, step - 1)];
    const showExample = find('[data-example]').checked;
    const summary = summarizeWalk(probabilities, query, taxa, before);
    find('[data-counter]').textContent = `Schritt ${step} / ${path.length - 1}`;
    slider.setAttribute('aria-valuetext', `Schritt ${step} von ${path.length - 1}`);
    find('[data-prev]').disabled = step === 0;
    find('[data-next]').disabled = step === path.length - 1;
    find('[data-reset]').disabled = step === 0;
    find('[data-end]').disabled = step === path.length - 1;
    if (!timer) play.textContent = step === path.length - 1 ? 'Erneut abspielen' : 'Abspielen';
    find('[data-query-mass]').textContent = pct(summary.queryMass);
    find('[data-ref-mass]').textContent = pct(summary.referenceMass);
    find('[data-change]').textContent = step === 0 ? '—' : pct(summary.moved);
    find('[data-status]').hidden = !showExample;
    find('[data-status]').textContent = step === 0 ? 'Beispielpfad: Start bei deinem Exemplar.' :
      `Beispielpfad · ${current.restarted ? 'Rücksprung' : 'Übergang'}: ${labels[previous.node]} → ${labels[current.node]}.`;

    const taxonBody = find('[data-taxa]'); taxonBody.replaceChildren();
    for (const row of summary.rows) {
      const tr = document.createElement('tr'), nameCell = document.createElement('th');
      nameCell.scope = 'row';
      const swatch = el('i', 'taxon-swatch'); swatch.style.background = taxonColors.get(row.name);
      swatch.setAttribute('aria-hidden', 'true');
      const name = el('span', 'taxon-name', row.name); name.prepend(swatch);
      nameCell.append(name, el('small', '', `${row.count} ${row.count === 1 ? 'Referenz' : 'Referenzen'}`));
      tr.append(nameCell);
      const massCell = document.createElement('td'), track = el('div', 'bartrack');
      const fill = el('div', 'barfill'); fill.style.width = `${100 * row.mass}%`; fill.style.background = taxonColors.get(row.name);
      track.setAttribute('aria-hidden', 'true'); track.append(fill);
      massCell.append(el('span', 'walk-value', pct(row.mass)), track);
      tr.append(massCell, el('td', 'walk-score', summary.referenceMass ? pct(row.score) : '—'));
      taxonBody.append(tr);
    }
    find('[data-score-note]').textContent = summary.referenceMass === 0 ?
      'Am Start liegt die gesamte Wahrscheinlichkeit bei deinem Exemplar. Sobald sie die Referenzen erreicht, erscheinen die Scores.' :
      `Exemplar + Referenzen = 100 %. ${step === path.length - 1 ? 'Diese Scores entsprechen den Random-Walk-Balken im Ergebnis.' : '„Zum Ergebnis“ zeigt die Scores des letzten Schritts.'} Ähnlichkeitsscores sind keine Bestimmungssicherheit.`;

    // Layout and subset stay fixed across steps to preserve spatial context.
    const visible = [query, ...rankedNodes.slice(0, narrowGraph ? 12 : 24)
      .sort((a, b) => taxa[a].localeCompare(taxa[b]) || a - b)];
    const center = narrowGraph ? 180 : 360;
    const refs = visible.filter(node => node !== query);
    const positions = new Map([[query, [center, 230]], ...refs.map((node, i) => [node,
      [center + (narrowGraph ? 120 : 292) * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / refs.length),
        220 + 160 * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / refs.length)]] )]);
    const svg = find('[data-graph]');
    const focusedNode = svg.contains(document.activeElement) ? document.activeElement.dataset.node : null;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${narrowGraph ? 360 : 720} 460`);
    svg.setAttribute('aria-label', `Referenzgraph bei Schritt ${step}. Knoten auswählen für Übergangschancen.`);
    const defs = svgElement('defs', {});
    for (const [id, color] of [['walk-arrow', '#bc621b'], ['walk-edge-arrow', '#83988a']]) {
      const marker = svgElement('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
      marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })); defs.append(marker);
    }
    svg.append(defs);
    const radius = node => (narrowGraph ? 9 : 12) + (narrowGraph ? 18 : 24) * Math.sqrt(probabilities[node]);
    function edge(from, to, active = false, chance = 0) {
      const a = positions.get(from), b = positions.get(to);
      if (!a || !b) return;
      const style = {
        fill: 'none', stroke: active ? '#bc621b' : '#83988a', 'stroke-width': active ? 3 : 1 + 2 * chance,
        'marker-end': active ? 'url(#walk-arrow)' : 'url(#walk-edge-arrow)',
        'stroke-dasharray': (active ? current.restarted : to === query && restart > 0) ? '7 5' : 'none',
      };
      let element;
      if (from === to) {
        const offset = radius(to) / Math.sqrt(2), reach = radius(to) + 38;
        element = svgElement('path', { d: `M ${a[0] - offset} ${a[1] - offset} C ${a[0] - reach} ${a[1] - reach}, ${a[0] + reach} ${a[1] - reach}, ${a[0] + offset} ${a[1] - offset}`, ...style });
      } else {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]), start = radius(from) + 2, end = radius(to) + 5;
        element = svgElement('line', { x1: a[0] + start * Math.cos(angle), y1: a[1] + start * Math.sin(angle),
          x2: b[0] - end * Math.cos(angle), y2: b[1] - end * Math.sin(angle), ...style });
      }
      element.append(svgElement('title', {}, active ? 'Übergang des Beispielpfads' : `${labels[from]} → ${labels[to]}: ${pct(chance, true)}`));
      svg.append(element);
    }
    for (const [target, chance] of walkTransitions(P, selected, query, restart)) edge(selected, target, false, chance);
    if (step && showExample) edge(previous.node, current.node, true);
    for (const node of visible) {
      const [x, y] = positions.get(node);
      const group = svgElement('g', { tabindex: 0, role: 'button', 'data-node': node, 'aria-pressed': node === selected,
        'aria-label': `${labels[node]}, ${pct(probabilities[node], true)}. Übergänge ansehen.` });
      const circle = svgElement('circle', { cx: x, cy: y, r: radius(node), fill: node === query ? '#17201b' : taxonColors.get(taxa[node]),
        stroke: showExample && node === current.node ? '#bc621b' : node === selected ? '#17201b' : '#fff', 'stroke-width': node === selected || showExample && node === current.node ? 4 : 2 });
      group.append(circle, svgElement('text', { x, y: y + radius(node) + 20, 'text-anchor': 'middle', fill: '#334039', 'font-size': 12 },
        `${node === query ? 'Dein Exemplar' : `#${node + 1}`} · ${pct(probabilities[node])}`));
      group.addEventListener('click', () => select(node));
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node, true); } });
      svg.append(group);
    }
    if (focusedNode !== null) find(`[data-node="${focusedNode}"]`)?.focus();
    const omitted = probabilities.reduce((sum, value, node) => sum + (positions.has(node) ? 0 : value), 0);
    find('[data-limit]').textContent = `${visible.length} von ${P.length} Knoten sichtbar${visible.length < P.length ? ` · ${pct(omitted)} auf weiteren Knoten` : ''}. Positionen bleiben gleich. Pfeile zeigen Übergänge des gewählten Knotens.${showExample && !positions.has(current.node) ? ' Der Beispielpfad liegt gerade außerhalb der Auswahl.' : ''}`;

    find('[data-selected-title]').textContent = labels[selected];
    find('[data-selected-mass]').textContent = `${pct(probabilities[selected], true)} der Verteilung${selected === query ? ' · Startpunkt der Berechnung' : ` · ${taxa[selected]}`}`;
    const transitions = find('[data-transitions]'); transitions.replaceChildren();
    for (const [target, chance] of walkTransitions(P, selected, query, restart)) {
      const button = el('button', 'walk-transition'); button.type = 'button';
      const label = el('span', '', labels[target]);
      if (target === query && restart > 0) label.append(el('small', '', `inkl. ${pct(restart)} Rücksprung`));
      button.append(label, el('strong', '', pct(chance)));
      button.addEventListener('click', () => { select(target); find('[data-selected-title]').focus({ preventScroll: true }); });
      transitions.append(button);
    }
    const ranked = [...probabilities.keys()].sort((a, b) => probabilities[b] - probabilities[a] || a - b);
    const body = find('[data-nodes]'); body.replaceChildren();
    for (const node of ranked) {
      const row = document.createElement('tr'), nameCell = document.createElement('th'); nameCell.scope = 'row';
      const button = el('button', 'walk-node-link', labels[node]); button.type = 'button';
      button.setAttribute('aria-label', `${labels[node]}: Übergänge ansehen`);
      button.addEventListener('click', () => {
        select(node);
        find('[data-selected-title]').focus({ preventScroll: true });
        find('[data-selected-title]').scrollIntoView({ block: 'nearest' });
      });
      nameCell.append(button); row.append(nameCell, el('td', '', pct(probabilities[node], true)),
        el('td', '', delta(probabilities[node] - before[node])), el('td', '', showExample && node === current.node ? '● Hier' : '—'));
      row.dataset.selected = String(node === selected);
      body.append(row);
    }
  }
  function move(step) { pause(); if (run) { slider.value = Math.max(0, Math.min(run.path.length - 1, step)); render(); } }
  slider.addEventListener('input', () => move(Number(slider.value)));
  find('[data-reset]').addEventListener('click', () => move(0));
  find('[data-prev]').addEventListener('click', () => move(Number(slider.value) - 1));
  find('[data-next]').addEventListener('click', () => move(Number(slider.value) + 1));
  find('[data-end]').addEventListener('click', () => move(run.path.length - 1));
  find('[data-example]').addEventListener('change', () => { pause(); render(); });
  root.addEventListener('toggle', () => { if (!root.open) pause(); });
  const view = root.closest('.view');
  if (view) new MutationObserver(() => { if (view.hidden) pause(); }).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(([entry]) => {
    if (!entry.contentRect.width) return;
    const narrow = entry.contentRect.width < 440;
    if (narrow !== narrowGraph) { narrowGraph = narrow; render(); }
  }).observe(find('.walk-map'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  play.addEventListener('click', () => {
    if (!run) return;
    if (timer) { pause(); return; }
    if (Number(slider.value) === Number(slider.max)) slider.value = 0;
    render(); play.textContent = 'Pause';
    timer = setInterval(() => { slider.value = Number(slider.value) + 1; render(); if (slider.value === slider.max) pause(); }, 1000);
  });
  reset();
  return { reset, show(data) {
    pause();
    run = { ...data, restart: data.restart ?? .2, taxa: data.taxa ?? data.labels.map((label, node) => node === data.query ? null : label.split(' · #')[0]) };
    selected = data.query;
    find('[data-selected-title]').tabIndex = -1;
    const taxa = [...new Set(run.taxa.filter((_, node) => node !== data.query))].sort((a, b) => a.localeCompare(b));
    taxonColors = new Map(taxa.map((name, i) => [name, colors[i % colors.length]]));
    const final = data.distributions.at(-1);
    rankedNodes = [...final.keys()].filter(node => node !== data.query).sort((a, b) => final[b] - final[a] || a - b);
    slider.max = data.path.length - 1; slider.value = 0;
    find('[data-content]').hidden = false; find('[data-empty]').hidden = true;
    find('[data-rule]').textContent = `Pro Schritt: ${pct(1 - run.restart)} folgen den Ähnlichkeiten · ${pct(run.restart)} springen zu deinem Exemplar zurück. Insgesamt bleiben es immer 100 %.`;
    for (const control of root.querySelectorAll('button, input')) control.disabled = false;
    render();
  } };
}
