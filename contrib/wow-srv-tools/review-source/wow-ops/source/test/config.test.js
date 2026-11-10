import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';
import { loadConfig } from '../server/config.js';

const valid = () => ({
  panel: { port: 8420 },
  soap: { host: '127.0.0.1', port: 7878, user: 'ops', pass: 'secret' },
  mysql: {
    logon:      { host: '127.0.0.1', port: 3306, user: 'mangos', password: 'mangos', database: 'realmd' },
    characters: { host: '127.0.0.1', port: 3306, user: 'mangos', password: 'mangos', database: 'characters' },
    world:      { host: '127.0.0.1', port: 3306, user: 'mangos', password: 'mangos', database: 'mangos' },
    logs:       { host: '127.0.0.1', port: 3306, user: 'mangos', password: 'mangos', database: 'logs' }
  },
  bots: { accountPrefix: 'RNDBOT' }
});

// The smallest object loadConfig accepts today - a panel, a soap and a
// logon database. Used only by the client/assets tests below, which care
// about those two optional sections and nothing else `valid()` sets up.
const minimalRaw = () => ({
  panel: { port: 8420 },
  soap: { host: '127.0.0.1', port: 7878, user: 'ops', pass: 'secret' },
  mysql: {
    logon: { host: '127.0.0.1', port: 3306, user: 'mangos', password: 'mangos', database: 'realmd' }
  }
});

test('accepts a complete config and freezes it', () => {
  const cfg = loadConfig(valid());
  assert.equal(cfg.panel.port, 8420);
  assert.equal(cfg.soap.user, 'ops');
  assert.equal(cfg.mysql.world.database, 'mangos');
  assert.ok(Object.isFrozen(cfg));
});

test('names the missing section', () => {
  const raw = valid();
  delete raw.soap;
  assert.throws(() => loadConfig(raw), /config: missing section "soap"/);
});

test('names the missing field', () => {
  const raw = valid();
  delete raw.soap.pass;
  assert.throws(() => loadConfig(raw), /config: soap\.pass is required/);
});

test('names a missing mandatory database', () => {
  const raw = valid();
  delete raw.mysql.logon;
  assert.throws(() => loadConfig(raw), /config: missing database "logon"/);
});

// Only `logon` is read at runtime today - Accounts, the only section built
// so far, is the only one that queries a pool. `characters`, `world` and
// `logs` are wired up for later sections and must not block boot when a
// config.json predates them or never needed them.
test('accepts a config with only the mandatory logon database', () => {
  const raw = valid();
  delete raw.mysql.characters;
  delete raw.mysql.world;
  delete raw.mysql.logs;
  const cfg = loadConfig(raw);
  assert.equal(cfg.mysql.logon.database, 'realmd');
  assert.equal(cfg.mysql.characters, undefined);
  assert.equal(cfg.mysql.world, undefined);
  assert.equal(cfg.mysql.logs, undefined);
});

test('still validates an optional database when it is present', () => {
  const raw = valid();
  delete raw.mysql.characters.port;
  assert.throws(() => loadConfig(raw), /config: mysql\.characters\.port must be a number/);
});

test('rejects a non-numeric port', () => {
  const raw = valid();
  raw.panel.port = '8420';
  assert.throws(() => loadConfig(raw), /config: panel\.port must be a number/);
});

test('rejects the unedited placeholder credentials', () => {
  const raw = valid();
  raw.soap.user = 'CHANGEME';
  assert.throws(() => loadConfig(raw), /config: soap\.user is still the placeholder/);
});

test('defaults the bot account prefix when the section is absent', () => {
  const raw = valid();
  delete raw.bots;
  assert.equal(loadConfig(raw).bots.accountPrefix, 'RNDBOT');
});

test('bots.playerSaveIntervalMs defaults to the mangosd.conf PlayerSave.Interval', () => {
  const cfg = loadConfig(valid());
  assert.equal(cfg.bots.playerSaveIntervalMs, 900000);
});

test('bots.playerSaveIntervalMs can be overridden', () => {
  const raw = valid();
  raw.bots = { playerSaveIntervalMs: 60000 };
  assert.equal(loadConfig(raw).bots.playerSaveIntervalMs, 60000);
});

test('bots.playerSaveIntervalMs rejects a non-positive value', () => {
  const raw = valid();
  raw.bots = { playerSaveIntervalMs: 0 };
  assert.throws(() => loadConfig(raw), /bots\.playerSaveIntervalMs must be a positive number/);
});

test('bots.playerSaveIntervalMs rejects a non-number', () => {
  const raw = valid();
  raw.bots = { playerSaveIntervalMs: '900000' };
  assert.throws(() => loadConfig(raw), /bots\.playerSaveIntervalMs must be a positive number/);
});

test('rejects an empty bot account prefix', () => {
  const raw = valid();
  raw.bots = { accountPrefix: '' };
  // An empty prefix turns every `username LIKE '<prefix>%'` filter into
  // `LIKE '%'`, matching every account - see server/queries/bots.js and
  // server/queries/accounts.js.
  assert.throws(() => loadConfig(raw), /config: bots\.accountPrefix is required/);
});

test('charDeleteMethod defaults to 0, the value this realm runs', () => {
  assert.equal(loadConfig(valid()).characters.charDeleteMethod, 0);
});

test('charDeleteMethod accepts 1 and rejects anything else', () => {
  const one = valid();
  one.characters = { charDeleteMethod: 1 };
  assert.equal(loadConfig(one).characters.charDeleteMethod, 1);

  const two = valid();
  two.characters = { charDeleteMethod: 2 };
  assert.throws(() => loadConfig(two), /charDeleteMethod/);

  // A string is refused rather than coerced: the value is copied out of
  // mangosd.conf by hand, and "0" quoted by mistake must be reported, not
  // accepted as a different type from the one the view compares by identity.
  const str = valid();
  str.characters = { charDeleteMethod: '0' };
  assert.throws(() => loadConfig(str), /charDeleteMethod/);
});

test('wowPatch defaults to 10, the patch this realm runs', () => {
  assert.equal(loadConfig(valid()).events.wowPatch, 10);
});

test('wowPatch accepts 0 through 10 and rejects anything else', () => {
  const zero = valid();
  zero.events = { wowPatch: 0 };
  assert.equal(loadConfig(zero).events.wowPatch, 0);

  const eleven = valid();
  eleven.events = { wowPatch: 11 };
  assert.throws(() => loadConfig(eleven), /wowPatch/);

  const text = valid();
  text.events = { wowPatch: '10' };
  assert.throws(() => loadConfig(text), /wowPatch/);
});

test('wowPatch is a realm fact and is read from realm.wowPatch', () => {
  const raw = valid();
  raw.realm = { id: 1, wowPatch: 8 };
  const cfg = loadConfig(raw);
  assert.equal(cfg.realm.wowPatch, 8);
});

test('events.wowPatch still works and still resolves for the events section', () => {
  // The Game events section shipped first and put the key under `events`. An
  // existing config.json must keep booting, and config.events.wowPatch must
  // keep answering, or that section silently loses its patch filter.
  const raw = valid();
  raw.events = { wowPatch: 5 };
  const cfg = loadConfig(raw);
  assert.equal(cfg.realm.wowPatch, 5);
  assert.equal(cfg.events.wowPatch, 5);
});

test('realm.wowPatch wins over the deprecated events.wowPatch', () => {
  const raw = valid();
  raw.realm = { id: 1, wowPatch: 9 };
  raw.events = { wowPatch: 3 };
  assert.equal(loadConfig(raw).realm.wowPatch, 9);
});

test('clientBuild defaults to 5875, the build this realm supports', () => {
  assert.equal(loadConfig(valid()).realm.clientBuild, 5875);
});

test('clientBuild must be a whole number', () => {
  const raw = valid();
  raw.realm = { id: 1, clientBuild: '5875' };
  assert.throws(() => loadConfig(raw), /clientBuild/);
});

test('the client and assets sections are optional', () => {
  const cfg = loadConfig(minimalRaw());
  assert.equal(cfg.client, null);
  assert.equal(cfg.assets, null);
});

test('the client section requires both directories', () => {
  const raw = { ...minimalRaw(), client: { dataDir: 'X' } };
  assert.throws(() => loadConfig(raw), /client\.dbcDir is required/);
});

test('a configured client and asset root survive loading', () => {
  const raw = {
    ...minimalRaw(),
    client: { dataDir: 'CLIENT/Data', dbcDir: 'SERVER/dbc' },
    assets: { root: 'ASSETS' }
  };
  const cfg = loadConfig(raw);
  assert.equal(cfg.client.dataDir, 'CLIENT/Data');
  assert.equal(cfg.client.dbcDir, 'SERVER/dbc');
  assert.ok(cfg.assets.root.endsWith('ASSETS'));
});

// The three tools that read this root disagree about relative paths -
// extract-art and contact-sheet resolve one against the working directory,
// @fastify/static refuses it outright with a stack trace naming an option
// rather than the config key. Resolving here makes all three agree, and
// makes the served copy the same directory the extraction wrote.
test('a relative asset root is resolved to an absolute path', () => {
  const raw = { ...minimalRaw(), assets: { root: 'assets-out' } };
  assert.ok(isAbsolute(loadConfig(raw).assets.root));
});

test('an already absolute asset root is left alone', () => {
  const absolute = resolve('assets-out');
  const raw = { ...minimalRaw(), assets: { root: absolute } };
  assert.equal(loadConfig(raw).assets.root, absolute);
});

test('assets.port defaults to 8421 when the section omits it', () => {
  const raw = { ...minimalRaw(), assets: { root: 'ASSETS' } };
  assert.equal(loadConfig(raw).assets.port, 8421);
});

test('assets.port can be overridden', () => {
  const raw = { ...minimalRaw(), assets: { root: 'ASSETS', port: 9000 } };
  assert.equal(loadConfig(raw).assets.port, 9000);
});

test('the dbc schema name defaults to dbc', () => {
  const cfg = loadConfig(minimalRaw());
  assert.equal(cfg.mysql.dbcSchema, 'dbc');
});

test('the dbc schema name can be overridden', () => {
  const raw = minimalRaw();
  raw.mysql.dbcSchema = 'reference';
  assert.equal(loadConfig(raw).mysql.dbcSchema, 'reference');
});

test('an empty dbc schema name is refused', () => {
  const raw = minimalRaw();
  raw.mysql.dbcSchema = '';
  assert.throws(() => loadConfig(raw), /mysql\.dbcSchema is required/);
});

test('the schema name is not mistaken for a database connection', () => {
  const cfg = loadConfig(minimalRaw());
  assert.equal(typeof cfg.mysql.logon, 'object');
  assert.equal(typeof cfg.mysql.dbcSchema, 'string');
});

test('assets.port rejects a non-positive value', () => {
  const raw = { ...minimalRaw(), assets: { root: 'ASSETS', port: 0 } };
  assert.throws(() => loadConfig(raw), /assets\.port must be a positive number/);
});

test('the terrain section is optional', () => {
  assert.equal(loadConfig(minimalRaw()).terrain, null);
});

test('a configured maps directory is resolved to an absolute path', () => {
  const cfg = loadConfig({ ...minimalRaw(), terrain: { mapsDir: 'SERVER/maps' } });
  assert.ok(cfg.terrain.mapsDir.endsWith('maps'));
  assert.ok(cfg.terrain.mapsDir.length > 'SERVER/maps'.length);
});

test('a terrain section without mapsDir is refused', () => {
  assert.throws(() => loadConfig({ ...minimalRaw(), terrain: {} }), /terrain\.mapsDir is required/);
});

// Rate.Talent from the realm's mangosd.conf (World.cpp:545, default 1; this
// realm runs 1). The panel cannot read mangosd.conf.
test('realm.talentRate defaults to 1 and must be positive', () => {
  assert.equal(loadConfig(minimalRaw()).realm.talentRate, 1);
  const raw = minimalRaw();
  raw.realm = { ...(raw.realm ?? {}), talentRate: 0 };
  assert.throws(() => loadConfig(raw), /talentRate/);
});
