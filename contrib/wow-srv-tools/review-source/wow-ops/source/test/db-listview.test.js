import test from 'node:test';
import assert from 'node:assert/strict';
import { renderListview } from '../server/views/db/listview.js';

const COLUMNS = [
  { key: 'name', label: 'Name', sortable: true, cell: (r) => `<a href="/db/item/${r.entry}">${r.name}</a>` },
  { key: 'ilvl', label: 'Item level', sortable: true, cell: (r) => String(r.ilvl) },
  { key: 'slot', label: 'Slot', sortable: false, cell: (r) => r.slot }
];
// Full page for BASE: the count line is a claim about what was rendered, and in
// production rows.length equals pageSize on every non-final page (LIMIT pageSize OFFSET).
const FULL_PAGE = Array.from({ length: 50 }, (_, i) => ({
  entry: i + 1, name: `Item ${i + 1}`, ilvl: 20, slot: 'Main hand'
}));
// Single row for last-page test: shows the honest short final page.
const SINGLE_ROW = [{ entry: 1, name: 'Sword', ilvl: 20, slot: 'Main hand' }];
const BASE = {
  columns: COLUMNS, rows: FULL_PAGE, total: 3182, page: 2, pageSize: 50,
  sort: 'ilvl', dir: 'desc', href: (params) => `/db/items?${new URLSearchParams(params)}`
};

test('the element the listview swaps into is the one it renders', () => {
  assert.match(renderListview(BASE), /id="listview"/);
});

test('a sortable header links to the inverted direction; the active one is marked', () => {
  const html = renderListview(BASE);
  assert.match(html, /class="sorted-desc"/);
  assert.match(html, /href="[^"]*sort=ilvl[^"]*dir=asc/);
  // A column that is not the active sort links to its own default, descending
  // never being assumed for a name.
  assert.match(html, /href="[^"]*sort=name[^"]*dir=asc/);
});

test('a column that is not sortable renders no link', () => {
  const html = renderListview(BASE);
  assert.doesNotMatch(html, /sort=slot/);
});

test('the count line names the window and the true total', () => {
  assert.match(renderListview(BASE), /51.*100.*3182/s);
});

test('the last page reports the window it actually shows', () => {
  const html = renderListview({ ...BASE, page: 64, rows: SINGLE_ROW, total: 3182 });
  assert.match(html, /3151.*3151.*3182/s);
});

test('the first page offers no previous link and the last offers no next', () => {
  assert.doesNotMatch(renderListview({ ...BASE, page: 1 }), /rel="prev"/);
  assert.doesNotMatch(renderListview({ ...BASE, page: 64 }), /rel="next"/);
  assert.match(renderListview(BASE), /rel="prev"/);
  assert.match(renderListview(BASE), /rel="next"/);
});

test('no rows renders the empty note and no pager', () => {
  const html = renderListview({ ...BASE, rows: [], total: 0, page: 1 });
  assert.match(html, /No matches/);
  assert.doesNotMatch(html, /rel="next"/);
});

test('cells are inserted as the column built them, and labels are escaped', () => {
  const html = renderListview({
    ...BASE,
    columns: [{ key: 'name', label: '<b>x</b>', sortable: false, cell: () => '<i>kept</i>' }]
  });
  assert.match(html, /<i>kept<\/i>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
