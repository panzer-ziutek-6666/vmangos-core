import test from 'node:test';
import assert from 'node:assert/strict';
import { listCharacters, getCharacter, listDeletedCharacters } from '../server/queries/characters.js';

function fakePools(capture, rows = []) {
  return {
    characters: {
      query: async (sql, params) => {
        capture.sql = sql;
        capture.params = params;
        return [rows];
      }
    }
  };
}

const CONFIG = {
  mysql: {
    characters: { database: 'characters' },
    logon: { database: 'realmd' },
    world: { database: 'mangos' }
  },
  bots: { accountPrefix: 'RNDBOT' }
};

test('bot characters are excluded unless asked for', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /a\.username NOT LIKE \?/);
  assert.ok(capture.params.includes('RNDBOT%'));
});

test('including bots drops the prefix filter and its parameter', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, { includeBots: true });
  assert.doesNotMatch(capture.sql, /username NOT LIKE/);
  assert.ok(!capture.params.includes('RNDBOT%'));
});

test('a search matches the character name as a prefix', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, { search: 'Thrall' });
  assert.match(capture.sql, /ch\.name LIKE \?/);
  assert.ok(capture.params.includes('Thrall%'));
});

test('the row cap is a bound parameter and defaults to 100', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /LIMIT \?/);
  assert.equal(capture.params.at(-1), 100);
});

test('an absurd limit is clamped rather than trusted', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, { limit: 100000 });
  assert.equal(capture.params.at(-1), 500);
});

test('map names collapse map_template to its highest patch row', async () => {
  // map_template is keyed (entry, patch) and 18 entries carry several patch
  // rows on this realm; joining on entry alone would duplicate a character.
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /MAX\(m2\.patch\)/);
});

test('the zone name comes from area_template, which has no patch key', async () => {
  const capture = {};
  await listCharacters(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /area_template/);
});

test('rows are mapped to numbers and nullable names stay null', async () => {
  const rows = [{
    guid: '5', name: 'Thrall', race: '2', class: '7', gender: '0', level: '60',
    online: '1', account: '3', account_name: 'TOMEK',
    map_id: '1', map_name: null, zone_id: '1637', zone_name: 'Orgrimmar',
    logout_time: '1756800000'
  }];
  const out = await listCharacters(fakePools({}, rows), CONFIG, {});
  assert.deepEqual(out[0], {
    guid: 5, name: 'Thrall', race: 2, cls: 7, gender: 0, level: 60,
    online: true, account: 3, accountName: 'TOMEK',
    mapId: 1, mapName: null, zoneId: 1637, zoneName: 'Orgrimmar',
    logoutTime: 1756800000
  });
});

test('a missing characters pool answers null instead of throwing', async () => {
  assert.equal(await listCharacters({}, CONFIG, {}), null);
});

test('a missing schema name answers null instead of building broken SQL', async () => {
  const capture = {};
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, world: {} } };
  assert.equal(await listCharacters(fakePools(capture), config, {}), null);
});

// ---- getCharacter -------------------------------------------------------

const CONFIG_WITH_REALM = { ...CONFIG, realm: { id: 1 } };

const DETAIL_ROW = {
  guid: '5', name: 'Thrall', race: '2', class: '7', gender: '0', level: '60',
  online: '0', account: '3', account_name: 'TOMEK',
  map_id: '1', map_name: 'Kalimdor', zone_id: '1637', zone_name: 'Orgrimmar',
  logout_time: '1756800000',
  money: '123456', played_time_total: '3600', create_time: '1756000000',
  position_x: '1.5', position_y: '-2.5', position_z: '3.5',
  character_flags: '0', account_online: '0', account_mutetime: '0', gmlevel: '0',
  ban_active: null, ban_reason: null, ban_bandate: null, ban_unbandate: null
};

test('the detail query looks a character up by exact name', async () => {
  const capture = {};
  await getCharacter(fakePools(capture, []), CONFIG_WITH_REALM, 'Thrall');
  assert.match(capture.sql, /ch\.name = \?/);
  assert.ok(capture.params.includes('Thrall'));
});

test('the detail query reads the GM level from account_access, not account.gmlevel', async () => {
  // account.gmlevel is vestigial: AccountMgr::SetSecurity writes only
  // account_access (vmangos-core/src/game/AccountMgr.cpp:213).
  const capture = {};
  await getCharacter(fakePools(capture, []), CONFIG_WITH_REALM, 'Thrall');
  assert.match(capture.sql, /account_access/);
  // Lookbehind so the aa.gmlevel this query DOES select does not satisfy
  // the check: the column being ruled out is the account alias's own.
  assert.doesNotMatch(capture.sql, /(?<!a)a\.gmlevel/);
});

test('the detail query joins only the most recent active ban', async () => {
  const capture = {};
  await getCharacter(fakePools(capture, []), CONFIG_WITH_REALM, 'Thrall');
  assert.match(capture.sql, /MAX\(b2\.bandate\)/);
});

test('an unknown character is null, not an empty object', async () => {
  assert.equal(await getCharacter(fakePools({}, []), CONFIG_WITH_REALM, 'Nobody'), null);
});

test('the detail row carries the ban state and the rename flag', async () => {
  const rows = [{ ...DETAIL_ROW, character_flags: '1', ban_active: '1', ban_reason: 'testing', ban_bandate: '100', ban_unbandate: '200' }];
  const out = await getCharacter(fakePools({}, rows), CONFIG_WITH_REALM, 'Thrall');
  assert.equal(out.name, 'Thrall');
  assert.equal(out.money, 123456);
  assert.equal(out.banActive, true);
  assert.equal(out.banPermanent, false);
  assert.equal(out.renameFlagged, true);
});

test('a permanent ban is one whose unbandate equals its bandate', async () => {
  const rows = [{ ...DETAIL_ROW, ban_active: '1', ban_reason: 'cheating', ban_bandate: '100', ban_unbandate: '100' }];
  const out = await getCharacter(fakePools({}, rows), CONFIG_WITH_REALM, 'Thrall');
  assert.equal(out.banPermanent, true);
  assert.equal(out.renameFlagged, false);
});

test('an account with no ban row reads as not banned rather than as a stale ban', async () => {
  const rows = [{ ...DETAIL_ROW, online: '1', account_online: '1', gmlevel: '6' }];
  const out = await getCharacter(fakePools({}, rows), CONFIG_WITH_REALM, 'Thrall');
  assert.equal(out.banActive, false);
  assert.equal(out.banPermanent, false);
  assert.equal(out.banBandate, null);
  assert.equal(out.accountGmLevel, 6);
});

// ---- listDeletedCharacters ---------------------------------------------

test('deleted characters are the rows with a deleted_time', async () => {
  const capture = {};
  await listDeletedCharacters(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /deleted_time IS NOT NULL/);
});

test('the deleted search is a prefix on deleted_name, matching the core', async () => {
  // The core searches deleted_name LIKE CONCAT(search, '%')
  // (vmangos-core/src/game/Commands/CharacterCommands.cpp:1378), so the panel
  // must preview exactly the rows .character deleted delete would hit.
  const capture = {};
  await listDeletedCharacters(fakePools(capture), CONFIG, { search: 'Thr' });
  assert.match(capture.sql, /deleted_name LIKE \?/);
  assert.ok(capture.params.includes('Thr%'));
});

test("the deleted listing is capped at the core's own 50", async () => {
  // GetDeletedCharacterInfoList uses LIMIT 0,50, so previewing more rows than
  // that would promise an action the server will not take.
  const capture = {};
  await listDeletedCharacters(fakePools(capture), CONFIG, {});
  assert.equal(capture.params.at(-1), 50);
});

test('deleted rows map their three columns', async () => {
  const rows = [{ guid: '9', deleted_name: 'Ghost', deleted_account: '3', deleted_time: '1756800000' }];
  const out = await listDeletedCharacters(fakePools({}, rows), CONFIG, {});
  assert.deepEqual(out, [{ guid: 9, deletedName: 'Ghost', deletedAccount: 3, deletedTime: 1756800000 }]);
});

test('a missing characters pool answers null for the deleted listing too', async () => {
  assert.equal(await listDeletedCharacters({}, CONFIG, {}), null);
});
