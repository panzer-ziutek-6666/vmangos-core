import test from 'node:test';
import assert from 'node:assert/strict';
import { textFilter, numberRangeFilter, selectFilter, filterForm, groupedSelectFilter } from '../server/views/db/filterControls.js';

test('a text filter comes back carrying the value that was applied', () => {
  const html = textFilter({ name: 'q', label: 'name', value: 'hogger', placeholder: 'name' });
  assert.match(html, /name="q"/);
  assert.match(html, /value="hogger"/);
});

test('a value is escaped where it is reflected into the attribute', () => {
  const html = textFilter({ name: 'q', label: 'name', value: '"><script>x</script>', placeholder: '' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&gt;/);
});

test('a number range renders both bounds and keeps the ones that were applied', () => {
  const html = numberRangeFilter({ minName: 'minlevel', maxName: 'maxlevel', label: 'level', min: 0, max: 255, applied: { minlevel: 40 } });
  assert.match(html, /name="minlevel"[^>]*value="40"/);
  assert.match(html, /name="maxlevel"[^>]*value=""/);
  // The control must not refuse a value the parser accepts.
  assert.match(html, /max="255"/);
});

test('a select marks the applied option and offers an any option first', () => {
  const html = selectFilter({ name: 'rank', label: 'rank', value: '1', options: [{ value: 0, label: 'Normal' }, { value: 1, label: 'Elite' }] });
  assert.match(html, /<option value="">any<\/option>/);
  assert.match(html, /<option value="1" selected/);
  assert.doesNotMatch(html, /<option value="0" selected/);
});

// The trap this project has already paid for: a form whose hx-target names an
// element the page never renders is inert, and curl cannot see it.
test('the form targets the listview and swaps it whole', () => {
  const html = filterForm({ action: '/db/npcs', target: '#listview', controls: '<i>c</i>' });
  assert.match(html, /<form[^>]*method="get"[^>]*action="\/db\/npcs"/);
  assert.match(html, /hx-target="#listview"[^>]*hx-swap="outerHTML"|hx-swap="outerHTML"[^>]*hx-target="#listview"/);
  assert.match(html, /hx-push-url="true"/);
  assert.match(html, /<i>c<\/i>/);
});

test('a grouped select renders optgroups, skips empty groups, and re-selects the value', () => {
  const html = groupedSelectFilter({
    name: 'category', label: 'category', value: -61,
    groups: [
      { label: 'Eastern Kingdoms', options: [{ value: 12, label: 'Elwynn Forest' }] },
      { label: 'Kalimdor', options: [] },
      { label: 'Class', options: [{ value: -61, label: 'Warlock' }] }
    ]
  });
  assert.match(html, /<optgroup label="Eastern Kingdoms"><option value="12">Elwynn Forest<\/option><\/optgroup>/);
  assert.doesNotMatch(html, /Kalimdor/);
  assert.match(html, /<option value="-61" selected>Warlock<\/option>/);
  assert.match(html, /<option value="">any<\/option>/);
});
