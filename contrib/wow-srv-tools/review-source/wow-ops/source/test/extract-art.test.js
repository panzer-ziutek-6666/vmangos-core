import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFailures } from '../tools/extract-art.js';

test('failures are summarized by reason, largest group first', () => {
  const summary = summarizeFailures([
    { name: 'a.blp', reason: 'not in any archive' },
    { name: 'b.blp', reason: 'compression 0x8' },
    { name: 'c.blp', reason: 'not in any archive' },
    { name: 'd.blp', reason: 'not in any archive' }
  ]);
  assert.deepEqual(summary.map((group) => [group.reason, group.count]), [
    ['not in any archive', 3],
    ['compression 0x8', 1]
  ]);
});

// The point of the summary is that a rare reason survives a run dominated by
// one common one - a single unsupported codec among twenty thousand
// by-design misses is the finding, and truncating a flat list hides it.
test('a rare reason is not buried by a common one', () => {
  const failures = [];
  for (let i = 0; i < 1000; i++) failures.push({ name: `item${i}.blp`, reason: 'not in any archive' });
  failures.push({ name: 'odd.blp', reason: 'blp unsupported type 2' });
  const summary = summarizeFailures(failures);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary[1], { reason: 'blp unsupported type 2', count: 1, examples: ['odd.blp'] });
});

test('each reason carries at most three examples', () => {
  const failures = [];
  for (let i = 0; i < 10; i++) failures.push({ name: `x${i}.blp`, reason: 'not in any archive' });
  const [group] = summarizeFailures(failures);
  assert.deepEqual(group.examples, ['x0.blp', 'x1.blp', 'x2.blp']);
});

test('no failures summarize to nothing', () => {
  assert.deepEqual(summarizeFailures([]), []);
});
