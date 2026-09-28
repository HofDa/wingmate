import test from 'node:test';
import assert from 'node:assert/strict';
import { traceWalk } from '../walk.js';

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
