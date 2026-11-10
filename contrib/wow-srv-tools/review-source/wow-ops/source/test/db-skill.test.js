import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSkillIndex, renderSkillPage } from '../server/views/db/skill.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

test('the index groups skill lines by category, in the category order', () => {
  const html = renderSkillIndex([{ id: 164, name: 'Blacksmithing', category: 11 }, { id: 8, name: 'Fire', category: 7 }]);
  assert.ok(html.indexOf('Class skills') < html.indexOf('Professions'));
  assert.match(html, /href="\/db\/skill\/8">Fire</);
});

test('a skill page lists what the line teaches, with skill-up range, classes and next rank', () => {
  const html = renderSkillPage({
    id: 8, name: 'Fire', category: 7, description: '',
    abilities: [{ spellId: 133, reqSkillValue: 1, minValue: 0, maxValue: 0, learnOnGetSkill: false, classMask: 128, raceMask: 0, supersededBy: 143 }],
    spellNames: new Map([[133, 'Fireball'], [143, 'Fireball']])
  });
  assert.match(html, /href="\/db\/spell\/133"\s+hx-get="\/db\/tooltip\/spell\/133"/);
  assert.match(html, /Mage/);
  assert.match(html, /href="\/db\/spell\/143"/);
  assert.match(html, /<a href="\/db\/skills">back to skills<\/a>/);
});

// vmangos-core/src/game/Objects/Player.cpp:5419-5421 (SkillGainChance) and
// :5941 (req_skill_value gates auto-learn, not a skill-up threshold).
// Blacksmithing's own top recipes on this realm read min 325 / max 350, not
// the req_skill_value the page used to show (as low as 1, topping out at 135).
test('the skill-up column reads min_value-max_value, not req_skill_value; req_skill_value only shows when auto-learned', () => {
  const html = renderSkillPage({
    id: 164, name: 'Blacksmithing', category: 11, description: '',
    abilities: [
      { spellId: 3564, reqSkillValue: 1, minValue: 325, maxValue: 350, learnOnGetSkill: false, classMask: 0, raceMask: 0, supersededBy: 0 },
      { spellId: 2660, reqSkillValue: 1, minValue: 0, maxValue: 0, learnOnGetSkill: true, classMask: 0, raceMask: 0, supersededBy: 0 }
    ],
    spellNames: new Map([[3564, 'Plans: Heavy Grinding Stone'], [2660, 'Smithing']])
  });
  assert.match(html, /<td>325–350<\/td><td>—<\/td>/);
  assert.doesNotMatch(html, />1<\/td>/);
  assert.match(html, /<td>—<\/td><td>auto-learned at 1<\/td>/);
});

test('routes: index and page on the browser chrome, unknown skill 404s', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const stub = dbStubPool({ skill_line_ability: [{ spell_id: 133, skill_id: 8, req_skill_value: 1, min_value: 0, max_value: 0, learn_on_get_skill: 0, class_mask: 128, race_mask: 0, superseded_by_spell: 0 }], skill_line: [{ id: 8, name: 'Fire', category_id: 7, description: '' }] });
  const { app, executeCalls } = dbApp({ world: stub.pool, config });
  t.after(() => app.close());
  const index = await app.inject({ method: 'GET', url: '/db/skills', headers: HEADERS });
  assert.match(index.body, /class="nav-item active" href="\/db\/skills"/);
  const page = await app.inject({ method: 'GET', url: '/db/skill/8', headers: HEADERS });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Fire/);
  const empty = dbApp({ world: dbStubPool({}).pool, config });
  t.after(() => empty.app.close());
  assert.equal((await empty.app.inject({ method: 'GET', url: '/db/skill/999', headers: HEADERS })).statusCode, 404);
  assert.equal((await empty.app.inject({ method: 'GET', url: '/db/skill/abc', headers: HEADERS })).statusCode, 400);
  assert.equal(executeCalls(), 0);
});

test('an empty index explains that the reference schema may not be built', () => {
  const html = renderSkillIndex([]);
  assert.match(html, /No skill lines found.*npm run import-dbc/s);
});

test('route: /db/skills with no dbcSchema configured renders the same explanation on the browser chrome', async (t) => {
  const stub = dbStubPool({});
  const { app } = dbApp({ world: stub.pool, config: CONFIG });
  t.after(() => app.close());
  const index = await app.inject({ method: 'GET', url: '/db/skills', headers: HEADERS });
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /class="nav-item active" href="\/db\/skills"/);
  assert.match(index.body, /No skill lines found.*npm run import-dbc/s);
});
