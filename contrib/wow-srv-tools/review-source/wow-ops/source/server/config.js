import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `logon` is mandatory: Accounts and the Bots section's account queries both
// need it. `characters` and `world` are read by the Bots section but stay
// optional, because a panel pointed only at `logon` should still boot and
// still serve Accounts - the Bots section degrades to an explanatory note
// instead. `logs` is not read at runtime yet.
const MANDATORY_DB_KEYS = ['logon'];
const OPTIONAL_DB_KEYS = ['characters', 'world', 'logs'];
// Exported so tools/import-dbc.js can recognise a realm database by name
// without hardcoding a second copy of this list.
export const DB_KEYS = [...MANDATORY_DB_KEYS, ...OPTIONAL_DB_KEYS];
const DB_FIELDS = ['host', 'port', 'user', 'password', 'database'];

function requireSection(raw, name) {
  if (!raw[name] || typeof raw[name] !== 'object') {
    throw new Error(`config: missing section "${name}"`);
  }
  return raw[name];
}

function requireString(path, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`config: ${path} is required`);
  }
  if (value === 'CHANGEME') {
    throw new Error(`config: ${path} is still the placeholder from config.example.json`);
  }
  return value;
}

function requireNumber(path, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`config: ${path} must be a number`);
  }
  return value;
}

function requirePositiveNumber(path, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`config: ${path} must be a positive number`);
  }
  return value;
}

// WowPatch from the realm's mangosd.conf (0-10, mapping to WOW_PATCH_102
// through WOW_PATCH_112). It is a fact about the realm, not about any one
// section: game_event rows are filtered by it, and every template table in the
// world DB is keyed (entry, patch) and read by the core as "the highest patch
// not above this one" (vmangos-core/src/shared/Database/SQLStorageImpl.h:364).
// The panel cannot read mangosd.conf, so the operator states it; this realm
// runs 10 (mangosd.conf:559).
//
// It shipped as `events.wowPatch` with the Game events section. That key is
// still accepted so an existing config.json keeps booting, but `realm.wowPatch`
// is the name now and wins when both are present.
function requireWowPatch(value) {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error('config: realm.wowPatch must be a whole number from 0 to 10');
  }
  return value;
}

// SUPPORTED_CLIENT_BUILD from the core's CMake configuration - 5875 for
// 1.12.1. `faction`, `faction_template` and `spell_template` are keyed
// (id, build) and hold rows for eleven builds, so every name lookup in the
// Database section pins this value; without it a join fans out elevenfold and
// can show a name from the wrong client.
function requireClientBuild(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('config: realm.clientBuild must be a whole number');
  }
  return value;
}

function requireCharDeleteMethod(value) {
  if (value !== 0 && value !== 1) {
    throw new Error('config: characters.charDeleteMethod must be 0 or 1');
  }
  return value;
}

// The client install and the server's extracted DBC directory. Absent for a
// panel that only operates the realm; required by the offline tools under
// tools/, which are the only readers. Kept out of the mysql section on
// purpose: these are filesystem paths on the machine running the panel, and
// they are the reason config.json is gitignored.
function optionalClient(raw) {
  if (!raw.client) return null;
  return Object.freeze({
    dataDir: requireString('client.dataDir', raw.client.dataDir),
    dbcDir: requireString('client.dbcDir', raw.client.dbcDir)
  });
}

// Where extract-art.js writes PNGs and, later, where the browser serves them
// from. One root for both so a re-extraction cannot leave the served copy
// stale. `port` is serve-assets.js's own bind port, separate from
// `panel.port` so the two Fastify instances - the panel and the offline
// asset server - never fight over the same one.
//
// The root is resolved here, once, because the three tools that read it
// disagree about a relative path: extract-art.js and contact-sheet.js resolve
// one against whatever directory they were run from, while @fastify/static
// refuses it outright, with a stack trace naming an option rather than the
// config key. Resolving centrally makes all three agree, and makes the served
// copy the same directory the extraction wrote.
function optionalAssets(raw) {
  if (!raw.assets) return null;
  return Object.freeze({
    root: resolve(requireString('assets.root', raw.assets.root)),
    port: requirePositiveNumber('assets.port', raw.assets.port ?? 8421)
  });
}

// The server's extracted terrain (`maps/` beside `vmaps/` and `mmaps/` in the
// directory mangosd's DataDir names). Only the zone pages read it: neither the
// creature nor the gameobject table stores a zone, and the core answers that
// question from these files (vmangos-core/src/game/Maps/GridMap.cpp:257-266).
// Absent, a zone page still renders its map, sub-areas and quests, with a note
// where the spawn lists would be. Resolved here for the same reason as
// assets.root: a relative path means whatever directory the panel started in.
function optionalTerrain(raw) {
  if (!raw.terrain) return null;
  return Object.freeze({ mapsDir: resolve(requireString('terrain.mapsDir', raw.terrain.mapsDir)) });
}

export function loadConfig(raw, { readOnly = false } = {}) {
  if (typeof readOnly !== 'boolean') {
    throw new Error('config: readOnly must be a boolean');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('config: expected an object');
  }

  const panel = requireSection(raw, 'panel');
  const soap = readOnly ? null : requireSection(raw, 'soap');
  const mysql = requireSection(raw, 'mysql');

  const cfg = {
    panel: { port: requireNumber('panel.port', panel.port) },
    soap: readOnly ? null : {
      host: requireString('soap.host', soap.host),
      port: requireNumber('soap.port', soap.port),
      user: requireString('soap.user', soap.user),
      pass: requireString('soap.pass', soap.pass)
    },
    mysql: {},
    // How stale the Bots section's location breakdown can be. mangosd writes
    // characters.map/zone/position_* only on the player save timer
    // (PlayerSave.Interval, 900000 ms in mangosd.conf:404), and
    // characters.characters carries no save timestamp of its own, so the age
    // of any individual row cannot be known - only this bound on it. The
    // panel does not read mangosd.conf, so the value lives here.
    bots: {
      // `??` lets null/undefined through to the 'RNDBOT' default but not an
      // empty string, so the default is applied first and the result is run
      // through requireString like every other config string - an operator
      // who sets accountPrefix to "" would otherwise get a config that loads
      // clean and a `WHERE username LIKE '%'` filter that matches everyone
      // (see server/queries/accounts.js and server/queries/bots.js).
      accountPrefix: requireString('bots.accountPrefix', raw.bots?.accountPrefix ?? 'RNDBOT'),
      playerSaveIntervalMs: requirePositiveNumber('bots.playerSaveIntervalMs', raw.bots?.playerSaveIntervalMs ?? 900000)
    },
    realm: {
      id: requireNumber('realm.id', raw.realm?.id ?? 1),
      wowPatch: requireWowPatch(raw.realm?.wowPatch ?? raw.events?.wowPatch ?? 10),
      clientBuild: requireClientBuild(raw.realm?.clientBuild ?? 5875),
      // Rate.Talent from mangosd.conf (vmangos-core/src/game/World.cpp:545,
      // default 1): the talent calculator's total is (level - 9) * rate
      // (Player.cpp:20774-20775). This realm runs 1 (mangosd.conf:2864).
      talentRate: requirePositiveNumber('realm.talentRate', raw.realm?.talentRate ?? 1)
    },
    // CharDelete.Method from the realm's mangosd.conf: 0 removes a deleted
    // character's row outright, 1 unlinks and keeps it. The panel cannot read
    // mangosd.conf, so the operator states it here. It changes nothing but
    // what the deleted-characters page says about being empty - and this
    // realm runs 0 (mangosd.conf:3134), which is why that page has nothing to
    // list. Not coerced: a quoted "0" is a mistake worth reporting, since the
    // view compares it by identity.
    characters: { charDeleteMethod: requireCharDeleteMethod(raw.characters?.charDeleteMethod ?? 0) },
    client: optionalClient(raw),
    assets: optionalAssets(raw),
    terrain: optionalTerrain(raw)
  };

  for (const key of DB_KEYS) {
    const db = mysql[key];
    if (!db || typeof db !== 'object') {
      if (MANDATORY_DB_KEYS.includes(key)) {
        throw new Error(`config: missing database "${key}"`);
      }
      continue;
    }
    const entry = {};
    for (const field of DB_FIELDS) {
      entry[field] = field === 'port'
        ? requireNumber(`mysql.${key}.port`, db.port)
        : requireString(`mysql.${key}.${field}`, db[field]);
    }
    cfg.mysql[key] = Object.freeze(entry);
  }

  // The reference schema written by tools/import-dbc.js. Not a connection: the
  // importer reuses the world connection's host and credentials and swaps the
  // database name for this, so no second credential enters config.json. It
  // lives under mysql because that is where the reader looks for a schema name,
  // but it is a string beside four objects - DB_KEYS is what keeps the loop
  // above from treating it as a connection.
  cfg.mysql.dbcSchema = requireString('mysql.dbcSchema', mysql.dbcSchema ?? 'dbc');

  // The Game events section reads config.events.wowPatch. It is the same
  // number as realm.wowPatch and always will be; this keeps that section
  // working without a second copy of the resolution rule.
  cfg.events = { wowPatch: cfg.realm.wowPatch };

  Object.freeze(cfg.panel);
  if (cfg.soap) Object.freeze(cfg.soap);
  Object.freeze(cfg.mysql);
  Object.freeze(cfg.bots);
  Object.freeze(cfg.realm);
  Object.freeze(cfg.characters);
  Object.freeze(cfg.events);
  return Object.freeze(cfg);
}

export function readConfigFile(path, options = {}) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`config: ${path} not found. Copy config.example.json to config.json and edit it.`);
    }
    throw err;
  }
  return loadConfig(JSON.parse(text), options);
}
