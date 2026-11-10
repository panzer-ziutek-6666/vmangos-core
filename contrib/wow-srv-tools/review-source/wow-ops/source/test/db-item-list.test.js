import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItemListBody, renderItemListFragment, renderItemListSwap } from '../server/views/db/itemList.js';
import { parseItemFilters } from '../server/queries/db/itemFilters.js';

const ROWS = [{
  entry: 19019, name: 'Thunderfury', quality: 5, class: 2, subclass: 7,
  item_level: 80, required_level: 60, inventory_type: 13, set_id: 0,
  inventory_icon: 'INV_Sword_39'
}];

test('the page renders the element its own form targets', () => {
  const html = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(html, /hx-target="#listview"/);
  assert.match(html, /id="listview"/);
});

test('the form pushes the URL so a filtered view survives a reload', () => {
  const html = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(html, /hx-push-url="true"/);
  // It is a real GET form as well, so the page works with htmx unavailable.
  assert.match(html, /<form[^>]*method="get"[^>]*action="\/db\/items"/);
});

test('the filter form comes back filled in with what was applied', () => {
  const html = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({ q: 'thunder', quality: '5' }) });
  assert.match(html, /value="thunder"/);
  assert.match(html, /<option value="5" selected/);
});

test('a row shows its icon, its name in the quality colour, and links to the item', () => {
  const html = renderItemListFragment({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(html, /\/db\/art\/icons\/INV_Sword_39\.png/);
  assert.match(html, /class="q5"/);
  assert.match(html, /href="\/db\/item\/19019"/);
});

test('every item link asks for its tooltip once, on hover', () => {
  const html = renderItemListFragment({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(html, /hx-get="\/db\/tooltip\/item\/19019"/);
  assert.match(html, /hx-trigger="mouseenter once"/);
});

// hx-swap="afterend" left every fetched tooltip on the page forever, because
// nothing ever removed it (walk finding 1, 2026-09-22): hovering ten items
// left ten tooltips stacked over the rows. The fix swaps the fragment inside
// a positioned host span instead, and CSS shows/hides it on :hover, so the
// same "mouseenter once" fetch never needs a second request to reappear.
// Asserted on the anchor tag itself, not merely "somewhere in the page", so a
// hx-target on some other element can't pass this by accident.
test('the item link is wrapped in a tooltip host, and its hx-target names that host with a beforeend swap', () => {
  const html = renderItemListFragment({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  const hostMatch = html.match(/<span class="tooltip-host">(<a\b[^>]*>)/);
  assert.ok(hostMatch, 'the item link should be the first thing inside a span.tooltip-host');
  const anchorTag = hostMatch[1];
  assert.match(anchorTag, /hx-target="closest \.tooltip-host"/);
  assert.match(anchorTag, /hx-swap="beforeend"/);
});

test('the fragment is the listview alone, with no filter form around it', () => {
  const html = renderItemListFragment({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.doesNotMatch(html, /<form/);
});

test('the fragment carries exactly one #listview - htmx would nest a second one on swap otherwise', () => {
  const html = renderItemListFragment({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  const matches = html.match(/id="listview"/g) ?? [];
  assert.equal(matches.length, 1);
});

// A fragment that re-renders its own target id (#listview) must be swapped
// as outerHTML, or htmx's default innerHTML swap nests the fragment's own
// wrapper inside the element it just replaced, compounding on every submit.
test('the form that targets #listview swaps it as outerHTML, not the htmx default', () => {
  const html = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(html, /<form[^>]*hx-target="#listview"[^>]*hx-swap="outerHTML"/);
});

test('the item form offers every filter its parser accepts', () => {
  const html = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  for (const name of ['q', 'quality', 'minlevel', 'maxlevel', 'class', 'minilvl', 'maxilvl', 'slot']) {
    assert.match(html, new RegExp(`name="${name}"`), `${name} has a control`);
  }
});

test('the subclass control appears only once a class is chosen', () => {
  assert.doesNotMatch(renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({}) }), /name="subclass"/);
  assert.match(renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({ class: '2' }) }), /name="subclass"/);
});

// The form swaps only #listview, so the form itself is never re-rendered in
// place: the htmx response has to carry the subclass control out of band, or
// choosing a class never shows it (walk finding, 2026-09-23).
test('the htmx response carries the subclass control out of band', () => {
  const swap = renderItemListSwap({ rows: ROWS, total: 1, filters: parseItemFilters({ class: '2' }) });
  assert.match(swap, /<span id="subclass-control" hx-swap-oob="true"><label>subtype<select name="subclass">/);
  assert.match(swap, />Bow</);
  assert.equal((swap.match(/id="listview"/g) ?? []).length, 1);
});

test('clearing the class clears the subclass control too', () => {
  const swap = renderItemListSwap({ rows: ROWS, total: 1, filters: parseItemFilters({}) });
  assert.match(swap, /<span id="subclass-control" hx-swap-oob="true"><\/span>/);
});

test('the full page renders the wrapper once and never out of band', () => {
  const body = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({ class: '2' }) });
  assert.equal((body.match(/id="subclass-control"/g) ?? []).length, 1);
  assert.doesNotMatch(body, /hx-swap-oob/);
});

test('changing the class drops a subtype chosen under the old one', () => {
  const body = renderItemListBody({ rows: ROWS, total: 1, filters: parseItemFilters({ class: '2', subclass: '2' }) });
  assert.match(body, /<select name="class" onchange="const s = this.form.elements.subclass; if \(s\) s.value = &#39;&#39;;">/);
});
