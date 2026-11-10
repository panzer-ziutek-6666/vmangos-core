import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItemFilters, ITEM_SORTS, PAGE_SIZE } from '../server/queries/db/itemFilters.js';

test('an empty query sorts by the default and asks for page 1', () => {
  const f = parseItemFilters({});
  assert.deepEqual(f.conditions, []);
  assert.deepEqual(f.params, []);
  assert.equal(f.sort, 'name');
  assert.equal(f.dir, 'asc');
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, PAGE_SIZE);
});

test('a name term becomes one bound LIKE, never interpolated', () => {
  const f = parseItemFilters({ q: 'thunder%_fury' });
  assert.equal(f.conditions.length, 1);
  assert.match(f.conditions[0], /t1\.name LIKE \?/);
  // The wildcards a person typed are matched literally, not as SQL wildcards.
  assert.deepEqual(f.params, ['%thunder\\%\\_fury%']);
});

test('quality, class, subclass and levels each bind their own parameter', () => {
  const f = parseItemFilters({ quality: '4', class: '2', subclass: '7', minlevel: '40', maxlevel: '60' });
  assert.equal(f.conditions.length, 5);
  assert.deepEqual(f.params, [4, 2, 7, 40, 60]);
});

// The trap this exists for: a column name cannot be a bound parameter, so the
// only safe sort is one that was already in the table.
test('an unknown sort key falls back to the default instead of reaching SQL', () => {
  const f = parseItemFilters({ sort: 'name); DROP TABLE item_template; --' });
  assert.equal(f.sort, 'name');
  assert.ok(Object.hasOwn(ITEM_SORTS, f.sort));
});

test('dir accepts only asc and desc', () => {
  assert.equal(parseItemFilters({ dir: 'desc' }).dir, 'desc');
  assert.equal(parseItemFilters({ dir: 'sideways' }).dir, 'asc');
});

test('a nonsense filter value is dropped, and the listview still renders', () => {
  const f = parseItemFilters({ quality: 'banana', minlevel: '-3', class: '' });
  assert.deepEqual(f.conditions, []);
  assert.deepEqual(f.params, []);
});

test('paging is clamped to a real page', () => {
  assert.equal(parseItemFilters({ page: '0' }).page, 1);
  assert.equal(parseItemFilters({ page: '-4' }).page, 1);
  assert.equal(parseItemFilters({ page: 'two' }).page, 1);
  assert.equal(parseItemFilters({ page: '7' }).page, 7);
});

test('applied carries back only what survived, for rebuilding the URL', () => {
  const f = parseItemFilters({ q: 'sword', quality: 'banana', page: '3' });
  assert.deepEqual(f.applied, { q: 'sword', sort: 'name', dir: 'asc', page: 3 });
});

test('a level 70 filter is kept, not silently dropped by a wrong bound', () => {
  const f = parseItemFilters({ minlevel: '70' });
  assert.equal(f.conditions.length, 1);
  assert.deepEqual(f.params, [70]);
  assert.deepEqual(f.applied, { minlevel: 70, sort: 'name', dir: 'asc', page: 1 });
});
