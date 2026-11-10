import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCharactersBody, renderCharacterBody, renderDeletedBody } from '../server/views/characters.js';

const ROW = {
  guid: 5, name: 'Thrall', race: 2, cls: 7, gender: 0, level: 60, online: true,
  account: 3, accountName: 'TOMEK', mapId: 1, mapName: 'Kalimdor',
  zoneId: 1637, zoneName: 'Orgrimmar', logoutTime: 0
};

const DETAIL = {
  ...ROW, online: false, money: 1234567, playedTimeTotal: 7325, createTime: 1756000000,
  positionX: 1.5, positionY: -2.5, positionZ: 3.5, renameFlagged: false,
  accountOnline: false, accountMuteTime: 0, accountGmLevel: 0,
  banActive: false, banReason: null, banBandate: null, banUnbandate: null, banPermanent: false
};

test('the list names the race and class rather than printing ids', () => {
  const html = renderCharactersBody({ rows: [ROW], search: '', includeBots: false, result: null, reachable: true });
  assert.match(html, /Thrall/);
  assert.match(html, /Orc/);
  assert.match(html, /Shaman/);
});

test('the list links each character to its detail page', () => {
  const html = renderCharactersBody({ rows: [ROW], search: '', includeBots: false, result: null, reachable: true });
  assert.match(html, /href="\/characters\/Thrall"/);
});

test('the list carries the bot toggle and the search box', () => {
  const hidden = renderCharactersBody({ rows: [], search: '', includeBots: false, result: null, reachable: true });
  assert.match(hidden, /\/characters\?bots=1/);
  assert.match(hidden, /name="search"/);
  const shown = renderCharactersBody({ rows: [], search: '', includeBots: true, result: null, reachable: true });
  assert.match(shown, /hide bot characters/);
});

test('the search box keeps the bot toggle state so one does not clear the other', () => {
  const html = renderCharactersBody({ rows: [], search: 'Thr', includeBots: true, result: null, reachable: true });
  assert.match(html, /name="bots" value="1"/);
  assert.match(html, /value="Thr"/);
});

test('the list says its location column is a save-timer snapshot', () => {
  const html = renderCharactersBody({ rows: [ROW], search: '', includeBots: false, result: null, reachable: true });
  assert.match(html, /last save/i);
});

test('a null row set renders an explanation, not a crash', () => {
  const html = renderCharactersBody({ rows: null, search: '', includeBots: false, result: null, reachable: true });
  assert.match(html, /not configured/i);
});

test('the detail page renders every action form when the character is online', () => {
  const html = renderCharacterBody({ character: { ...DETAIL, online: true }, result: null, reachable: true });
  for (const action of ['rename', 'level', 'revive', 'repairitems', 'kick', 'mute', 'unmute', 'ban', 'unban', 'hasitem', 'reputation', 'message', 'mail', 'items', 'money', 'erase']) {
    assert.match(html, new RegExp(`hx-post="/characters/${action}"`), `missing form for ${action}`);
  }
});

test('the four online-only actions are disabled for an offline character', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  // kick, repairitems, message and reputation all resolve their target with
  // the two-argument ExtractPlayerTarget, which finds only an online player.
  for (const action of ['kick', 'repairitems', 'message', 'reputation']) {
    const form = html.split(`hx-post="/characters/${action}"`)[1].split('</form>')[0];
    assert.match(form, /disabled/, `${action} must be disabled while the character is offline`);
  }
  assert.match(html, /only works while the character is online/i);
});

test('an online character can use the online-only actions', () => {
  const html = renderCharacterBody({ character: { ...DETAIL, online: true }, result: null, reachable: true });
  const form = html.split('hx-post="/characters/kick"')[1].split('</form>')[0];
  assert.doesNotMatch(form, /disabled/);
});

test('the rename button says what it actually does', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  assert.match(html, /next login/i);
});

test('the ban form says it bans the owning account and prints nothing', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  assert.match(html, /owning account/i);
  assert.match(html, /no output/i);
});

test('erase requires the name typed back', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  assert.match(html, /name="confirm"/);
});

test('every button is disabled when mangosd is unreachable', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: false });
  assert.doesNotMatch(html, /<button type="submit">/);
  assert.match(html, /not reachable/);
});

test('the detail page states the location save caveat and formats money as gold', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  assert.match(html, /123g 45s 67c/);
  assert.match(html, /last save/i);
});

test('the detail page renders the htmx target element', () => {
  const html = renderCharacterBody({ character: DETAIL, result: null, reachable: true });
  assert.match(html, /id="result"/);
});

test('the deleted panel explains why it is empty under CharDelete.Method 0', () => {
  const html = renderDeletedBody({ rows: [], search: '', result: null, reachable: true, charDeleteMethod: 0 });
  assert.match(html, /CharDelete\.Method/);
  assert.match(html, /completely removed/i);
});

test('the deleted panel warns that restore and delete act on every match', () => {
  const html = renderDeletedBody({
    rows: [{ guid: 9, deletedName: 'Ghost', deletedAccount: 3, deletedTime: 1756800000 }],
    search: 'Gh', result: null, reachable: true, charDeleteMethod: 1
  });
  assert.match(html, /every match/i);
  assert.match(html, /Ghost/);
});

test('the deleted panel requires the search typed back for both bulk actions', () => {
  const html = renderDeletedBody({ rows: [], search: 'Gh', result: null, reachable: true, charDeleteMethod: 1 });
  for (const action of ['deletedrestore', 'deleteddelete']) {
    const form = html.split(`hx-post="/characters/${action}"`)[1].split('</form>')[0];
    assert.match(form, /name="confirm"/, `${action} must ask for a confirmation`);
  }
});
