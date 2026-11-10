import test from 'node:test';
import assert from 'node:assert/strict';
import {
  talentPoints, parseBuild, canAdd, canRemove, encodeBuild, withRank, totalSpent, requiredLevel
} from '../server/dbLookups/talentRules.js';

// A small tree shaped like the real ones: rows 0-3, a 5-rank row-0 talent, a
// 3-rank row-0 talent, a row-1 talent needing the first at rank 5 (DBC
// prereq_rank 4), a row-2 talent and a row-3 one. Tree 2 is one talent.
const T = (id, row, column, n, prereq = null) => ({ id, row, column, ranks: Array.from({ length: n }, (_, i) => id * 10 + i + 1), prereq });
const TREES = [
  { id: 1, talents: [T(1, 0, 0, 5), T(2, 0, 1, 3), T(3, 1, 0, 1, { talentId: 1, rank: 4 }), T(4, 2, 1, 5), T(5, 3, 0, 1)] },
  { id: 2, talents: [T(6, 0, 0, 5)] }
];

// Player::CalculateTalentsPoints (vmangos-core/src/game/Objects/Player.cpp:20772-20776).
test('talent points are level minus nine times the rate, none below level 10', () => {
  assert.equal(talentPoints(60, 1), 51);
  assert.equal(talentPoints(9, 1), 0);
  assert.equal(talentPoints(60, 1.5), 76);
});

// M-3: CONFIG_FLOAT_RATE_TALENT is a float (World.cpp:545), not a double -
// double-precision `(level - 9) * rate` and the core's float multiply can
// truncate to different integers at a rate the float cannot hold exactly.
// Measured: at level 59, rate 0.58, plain double arithmetic trunc()s to 28;
// rounding both the rate and the product through Math.fround (the fix)
// gives 29, matching a same-precision float multiply.
test('talentPoints rounds through the same float the core reads from mangosd.conf', () => {
  assert.equal(talentPoints(59, 0.58), 29);
  assert.notEqual(Math.trunc(Math.max(0, 59 - 9) * 0.58), 29);
});

test('a build round-trips, trailing zeros and empty trees trimmed', () => {
  const s = parseBuild('53-2', TREES, 51);
  assert.deepEqual([...s.ranks], [[1, 5], [2, 3], [6, 2]]);
  assert.deepEqual(s.spent, [8, 2]);
  assert.equal(encodeBuild(s, TREES), '53-2');
  assert.equal(encodeBuild(parseBuild('', TREES, 51), TREES), '');
  assert.equal(encodeBuild(parseBuild('-5', TREES, 51), TREES), '-5');
});

// Row N needs N*5 points in the tree (Player.cpp:21022-21050); a prerequisite
// needs its talent at DependsOnRank+1 or more (:20998-21013).
test('row gating and prerequisites cut an impossible build back to its valid prefix', () => {
  assert.deepEqual([...parseBuild('031', TREES, 51).ranks], [[2, 3]]);
  assert.deepEqual([...parseBuild('401', TREES, 51).ranks], [[1, 4]]);
  assert.deepEqual([...parseBuild('5010', TREES, 51).ranks], [[1, 5], [3, 1]]);
  assert.deepEqual([...parseBuild('5315', TREES, 51).ranks], [[1, 5], [2, 3], [3, 1]]);
});

test('malformed builds never throw and keep what was valid before the fault', () => {
  assert.deepEqual([...parseBuild('5x3', TREES, 51).ranks], [[1, 5]]);
  assert.deepEqual([...parseBuild('9', TREES, 51).ranks], []);
  assert.deepEqual([...parseBuild('24', TREES, 51).ranks], [[1, 2], [2, 3]]);
  assert.deepEqual([...parseBuild(null, TREES, 51).ranks], []);
  assert.deepEqual([...parseBuild('5-5-5-5', TREES, 51).ranks], [[1, 5], [6, 5]]);
  assert.equal(totalSpent(parseBuild('53-5', TREES, 6)), 6);
});

test('canAdd follows rank maximum, total, row and prerequisite', () => {
  const s = parseBuild('53', TREES, 51);
  const [t1, t2, t3, t4] = TREES[0].talents;
  assert.equal(canAdd(s, TREES, 0, t1, 51), false);
  assert.equal(canAdd(s, TREES, 0, t2, 51), false);
  assert.equal(canAdd(s, TREES, 0, t3, 51), true);
  assert.equal(canAdd(s, TREES, 0, t4, 51), false);
  assert.equal(canAdd(s, TREES, 0, t3, 8), false);
});

// The client's refund rule: never strand a dependent below its required
// rank, never leave a spent talent's row requirement unmet.
test('canRemove refuses to strand a dependent', () => {
  const s = parseBuild('531', TREES, 51);
  const [t1, t2, t3, t4] = TREES[0].talents;
  assert.equal(canRemove(s, TREES, 0, t1), false);
  assert.equal(canRemove(s, TREES, 0, t2), true);
  assert.equal(canRemove(s, TREES, 0, t3), true);
  assert.equal(canRemove(s, TREES, 0, t4), false);
});

test('canRemove refuses to leave a spent row short', () => {
  const TREES_B = [{ id: 1, talents: [T(1, 0, 0, 5), T(2, 1, 0, 5)] }];
  const s = parseBuild('55', TREES_B, 51);
  assert.equal(canRemove(s, TREES_B, 0, TREES_B[0].talents[0]), false);
  assert.equal(canRemove(s, TREES_B, 0, TREES_B[0].talents[1]), true);
});

test('withRank returns the build one rank up or down, and requiredLevel is 9 plus points', () => {
  const s = parseBuild('53', TREES, 51);
  assert.equal(withRank(s, TREES, 3, +1), '531');
  assert.equal(withRank(s, TREES, 2, -1), '52');
  assert.equal(requiredLevel(s), 17);
  assert.equal(requiredLevel(parseBuild('', TREES, 51)), null);
});

// Ruling 1: requiredLevel takes the talent rate, so a rate-2 realm reaches
// the same spend in half the levels - 8 points spent needs 4 levels at rate
// 2 instead of 8 at rate 1.
test('requiredLevel divides spent points by the talent rate', () => {
  const s = parseBuild('53', TREES, 51);
  assert.equal(requiredLevel(s, 2), 13);
});
