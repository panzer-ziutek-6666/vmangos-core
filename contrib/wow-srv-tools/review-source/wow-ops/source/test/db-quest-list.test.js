import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuestListBody, renderQuestListFragment } from '../server/views/db/questList.js';
import { parseQuestFilters } from '../server/queries/db/questFilters.js';

const ROW = { entry: 176, Title: 'Wanted: Hogger', QuestLevel: 11, MinLevel: 5, RequiredRaces: 77, ZoneOrSort: 12, Type: 1, RewXP: 1050, RewOrReqMoney: 12345, zone_name: 'Elwynn Forest' };
for (let i = 1; i <= 4; i++) { ROW[`RewItemId${i}`] = 0; ROW[`RewItemCount${i}`] = 0; }
for (let i = 1; i <= 6; i++) { ROW[`RewChoiceItemId${i}`] = 0; ROW[`RewChoiceItemCount${i}`] = 0; }
ROW.RewItemId1 = 2586; ROW.RewItemCount1 = 1;
ROW.RewChoiceItemId1 = 159; ROW.RewChoiceItemCount1 = 5;
const ITEMS = new Map([
  [2586, { name: 'Trousers', quality: 2, icon: 'INV_Pants_02' }],
  [159, { name: 'Water', quality: 1, icon: null }]
]);
const CATEGORIES = [{ id: 12, label: 'Elwynn Forest', group: 'Eastern Kingdoms' }, { id: -61, label: 'Warlock', group: 'Class' }];
const BASE = { rows: [ROW], total: 1, filters: parseQuestFilters({}), items: ITEMS, categories: CATEGORIES };

test('a row names level, required level, races, category and type', () => {
  const html = renderQuestListFragment(BASE);
  assert.match(html, /href="\/db\/quest\/176"/);
  assert.match(html, /hx-get="\/db\/tooltip\/quest\/176"/);
  assert.match(html, /<th>Races<\/th>/);
  for (const text of ['>11<', '>5<', 'Alliance', 'Elwynn Forest', 'Elite']) assert.ok(html.includes(text), text);
});

test('level 0 shows as the player\'s own level, not as 0', () => {
  const html = renderQuestListFragment({ ...BASE, rows: [{ ...ROW, QuestLevel: 0 }] });
  assert.match(html, />player&#39;s level</);
  assert.doesNotMatch(html, />0</);
});

test('rewards show item icons and quality links, choice items after fixed ones, then xp and money', () => {
  const html = renderQuestListFragment(BASE);
  assert.match(html, /\/db\/art\/icons\/INV_Pants_02\.png/);
  assert.match(html, /<a class="q2" href="\/db\/item\/2586"/);
  assert.ok(html.indexOf('/db/item/2586') < html.indexOf('/db/item/159'));
  assert.match(html, /×5/);
  assert.match(html, /1050 xp/);
  assert.match(html, /1g 23s 45c/);
});

test('a quest with no category, no restriction and no rewards shows dashes and Any', () => {
  const bare = { ...ROW, RequiredRaces: 0, ZoneOrSort: 0, zone_name: null, RewItemId1: 0, RewChoiceItemId1: 0, RewXP: 0, RewOrReqMoney: 0 };
  const html = renderQuestListFragment({ ...BASE, rows: [bare] });
  assert.match(html, />Any</);
  assert.ok((html.match(/>—</g) ?? []).length >= 2);
});

test('a required-money quest does not list its cost as a reward', () => {
  const html = renderQuestListFragment({ ...BASE, rows: [{ ...ROW, RewOrReqMoney: -500 }] });
  assert.doesNotMatch(html, /5s/);
});

test('the page carries the grouped category select and the other filters, targeting its own listview', () => {
  const html = renderQuestListBody(BASE);
  assert.match(html, /hx-target="#listview"/);
  assert.match(html, /id="listview"/);
  assert.match(html, /<optgroup label="Class"><option value="-61">Warlock<\/option><\/optgroup>/);
  for (const name of ['q', 'side', 'type', 'category', 'minlevel', 'maxlevel', 'minreq', 'maxreq']) {
    assert.match(html, new RegExp(`name="${name}"`), name);
  }
  assert.match(html, /<label>races<select name="side">/);
  assert.match(html, /open to Alliance races/);
  assert.match(html, /open to Horde races/);
  assert.match(html, /base values/);
});

test('the fragment carries exactly one listview and no form', () => {
  const html = renderQuestListFragment(BASE);
  assert.equal((html.match(/id="listview"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form/);
});
