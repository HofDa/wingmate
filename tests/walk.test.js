import test from 'node:test';
import assert from 'node:assert/strict';
import { traceWalk, summarizeWalk, walkTransitions } from '../walk.js';

test('records all steps and matches the classifier recurrence', () => {
  const P = [[[1, .7], [2, .3]], [[0, 1]], [[0, .4], [1, .6]]];
  const { distributions, path } = traceWalk(P, 2);
  assert.equal(distributions.length, 41);
  assert.equal(path.length, 41);
  let expected = [0, 0, 1];
  for (let step = 0; step <= 40; step++) {
    assert.deepEqual([...distributions[step]], expected);
    assert.ok(Math.abs(expected.reduce((a, b) => a + b) - 1) < 1e-12);
    const next = [0, 0, .2];
    for (let i = 0; i < P.length; i++) for (const [j, w] of P[i]) next[j] += .8 * expected[i] * w;
    expected = next;
  }
});

test('sampled walks follow edges and distinguish restart events', () => {
  const P = [[[1, 1]], [[0, 1]]];
  assert.deepEqual(traceWalk(P, 0, { steps: 2, random: () => .5 }).path,
    [{ node: 0, restarted: false }, { node: 1, restarted: false }, { node: 0, restarted: false }]);
  assert.deepEqual(traceWalk(P, 0, { steps: 1, random: () => 0 }).path[1], { node: 0, restarted: true });
});

test('dangling nodes retain mass between restarts', () => {
  const { distributions, path } = traceWalk([[]], 0, { random: () => .5 });
  assert.ok(distributions.every(p => p[0] === 1));
  assert.ok(path.every(p => p.node === 0));
});

test('restart breaks a periodic chain and approaches its analytical stationary distribution', () => {
  // Without restart this two-node chain alternates forever. With restart r,
  // its stationary masses are 1/(2-r) and (1-r)/(2-r).
  const P = [[[1, 1]], [[0, 1]]], restart = .2;
  const { distributions } = traceWalk(P, 0, { restart, random: () => .5 });
  for (let step = 0; step < distributions.length; step++) {
    const expectedQuery = 1 / (2 - restart) +
      (1 - 1 / (2 - restart)) * (-(1 - restart)) ** step;
    assert.ok(Math.abs(distributions[step][0] - expectedQuery) < 1e-12);
    assert.ok(Math.abs(distributions[step][1] - (1 - expectedQuery)) < 1e-12);
  }
  const final = distributions.at(-1);
  assert.ok(Math.abs(final[0] - 1 / (2 - restart)) < 6e-5);
  assert.notEqual(final[0], 1 / (2 - restart));
});

test('restart endpoints preserve mass and have the expected trajectories', () => {
  const P = [[[1, 1]], [[0, 1]]];
  const noRestart = traceWalk(P, 0, { steps: 3, restart: 0, random: () => .5 });
  assert.deepEqual(noRestart.distributions.map(p => [...p]), [[1, 0], [0, 1], [1, 0], [0, 1]]);
  assert.ok(noRestart.path.every(p => !p.restarted));
  const onlyRestart = traceWalk(P, 0, { steps: 3, restart: 1, random: () => .5 });
  assert.ok(onlyRestart.distributions.every(p => p[0] === 1 && p[1] === 0));
  assert.ok(onlyRestart.path.slice(1).every(p => p.node === 0 && p.restarted));
});

test('presentation separates query mass, taxon mass and balanced scores', () => {
  const summary = summarizeWalk([.1, .2, .3, .4], 3, ['A', 'A', 'B', null], [0, 0, 0, 1]);
  assert.ok(Math.abs(summary.referenceMass - .6) < 1e-12);
  assert.equal(summary.queryMass, .4);
  assert.ok(Math.abs(summary.moved - .6) < 1e-12);
  assert.equal(summary.rows[0].count, 2);
  assert.equal(summary.rows[1].count, 1);
  assert.ok(Math.abs(summary.rows[0].mass - .3) < 1e-12);
  assert.ok(Math.abs(summary.rows[0].score - 1 / 3) < 1e-12);
  assert.ok(Math.abs(summary.rows[1].score - 2 / 3) < 1e-12);
  const start = summarizeWalk([0, 0, 0, 1], 3, ['A', 'A', 'B', null]);
  assert.equal(start.referenceMass, 0);
  assert.equal(start.moved, 0);
  assert.ok(start.rows.every(row => row.mass === 0 && row.score === 0));
});

test('node inspector merges ordinary return edges with the restart probability', () => {
  const transitions = walkTransitions([[[0, .4], [1, .6]], [[0, 1]]], 0, 0);
  assert.deepEqual(transitions.map(([target]) => target), [0, 1]);
  assert.ok(Math.abs(transitions[0][1] - .52) < 1e-12);
  assert.ok(Math.abs(transitions[1][1] - .48) < 1e-12);
  assert.deepEqual(walkTransitions([[]], 0, 0), [[0, 1]]);
  assert.deepEqual(walkTransitions([[[1, 1]], [[0, 1]]], 0, 0, 1), [[0, 1]]);
});
