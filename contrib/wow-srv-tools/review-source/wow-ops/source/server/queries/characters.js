// Reads backing the Characters section (server/sections/characters.js). Like
// server/queries/bots.js these run on the `characters` pool and qualify the
// other two schemas by name - all four databases live on one MySQL server
// here, and the game server's own code assumes the same. Schema names come
// from the configured DSNs rather than being hardcoded, so an operator may
// name the databases anything.
function quoteIdentifier(name) {
  return `\`${String(name).replaceAll('`', '``')}\``;
}

// A page cap, not a pagination scheme. This realm has three human characters
// today; the cap exists so the page cannot grow unbounded as real players
// arrive, and MAX_LIMIT is the ceiling an operator can raise it to by hand.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

// CHARACTER_FLAG_RENAME, the bit .character rename sets
// (vmangos-core/src/game/Commands/CharacterCommands.cpp:1937). The detail
// view shows it so an operator can see that a rename was already requested
// and is waiting for the player's next login.
const CHARACTER_FLAG_RENAME = 0x1;

// characters.map, .zone and .position_* are written on the PlayerSave.Interval
// timer (900000 ms, mangosd.conf:404), so a location is a snapshot up to that
// far behind. characters.online moves at login and logout, so it is accurate
// to the second. The views must say which is which.
//
// map_template is keyed (entry, patch): the subquery collapses each entry to
// its highest patch row, exactly as server/queries/bots.js does. area_template
// is keyed on `entry` alone on this realm's world DB, so its join needs no
// such collapse. Both joins are LEFT: a character standing on a map or in a
// zone this world DB does not describe must still be listed, unnamed.
function mapAndZoneJoins(worldDb) {
  return `
    LEFT JOIN (
      SELECT m1.entry, m1.map_name
      FROM ${quoteIdentifier(worldDb)}.map_template m1
      WHERE m1.patch = (
        SELECT MAX(m2.patch) FROM ${quoteIdentifier(worldDb)}.map_template m2 WHERE m2.entry = m1.entry
      )
    ) mt ON mt.entry = ch.map
    LEFT JOIN ${quoteIdentifier(worldDb)}.area_template at ON at.entry = ch.zone`;
}

function listSql({ charactersDb, logonDb, worldDb, filters }) {
  return `
    SELECT
      ch.guid, ch.name, ch.race, ch.class, ch.gender, ch.level, ch.online,
      ch.account, a.username AS account_name,
      ch.map AS map_id, mt.map_name AS map_name,
      ch.zone AS zone_id, at.name AS zone_name,
      ch.logout_time
    FROM ${quoteIdentifier(charactersDb)}.characters ch
    JOIN ${quoteIdentifier(logonDb)}.account a ON a.id = ch.account
${mapAndZoneJoins(worldDb)}
    WHERE ch.deleted_name IS NULL${filters}
    ORDER BY ch.online DESC, ch.name ASC
    LIMIT ?
  `;
}

function mapRow(r) {
  return {
    guid: Number(r.guid),
    name: r.name,
    race: Number(r.race),
    cls: Number(r.class),
    gender: Number(r.gender),
    level: Number(r.level),
    online: Number(r.online) === 1,
    account: Number(r.account),
    accountName: r.account_name,
    mapId: Number(r.map_id),
    mapName: r.map_name ?? null,
    zoneId: Number(r.zone_id),
    zoneName: r.zone_name ?? null,
    logoutTime: Number(r.logout_time)
  };
}

// Returns null (never throws) when the `characters` pool is not configured or
// a schema name is missing: `characters` and `world` are optional at the
// config level, so a panel pointed only at `logon` simply cannot answer this.
//
// `ch.deleted_name IS NULL` excludes soft-deleted rows. Under
// CharDelete.Method = 1 a deleted character keeps its row with `name` emptied
// and `deleted_name` set, and such a row is not a living character.
export async function listCharacters(pools, config, { search = '', includeBots = false, limit } = {}) {
  const pool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  const logonDb = config?.mysql?.logon?.database;
  const worldDb = config?.mysql?.world?.database;
  const prefix = config?.bots?.accountPrefix;

  if (!pool || !charactersDb || !logonDb || !worldDb || !prefix) {
    return null;
  }

  let filters = '';
  const params = [];
  if (!includeBots) {
    filters += ' AND a.username NOT LIKE ?';
    params.push(`${prefix}%`);
  }
  if (search) {
    filters += ' AND ch.name LIKE ?';
    params.push(`${search}%`);
  }
  params.push(clampLimit(limit));

  const [rows] = await pool.query(listSql({ charactersDb, logonDb, worldDb, filters }), params);
  return rows.map(mapRow);
}

// The owning account's GM level comes from account_access, not from
// account.gmlevel - that column is vestigial, and AccountMgr::SetSecurity
// (vmangos-core/src/game/AccountMgr.cpp:213) writes only account_access. The
// table is keyed (id, RealmID) so an account can hold both a wildcard row
// (-1) and a realm row at once; MAX() collapses that pair to one value.
//
// The ban join takes only the most recent active ban: account_banned is keyed
// (id, bandate) and accumulates a row per ban, so an unqualified join would
// return one row per historical ban.
function detailSql({ charactersDb, logonDb, worldDb }) {
  return `
    SELECT
      ch.guid, ch.name, ch.race, ch.class, ch.gender, ch.level, ch.online,
      ch.account, a.username AS account_name,
      ch.map AS map_id, mt.map_name AS map_name,
      ch.zone AS zone_id, at.name AS zone_name,
      ch.logout_time, ch.money, ch.played_time_total, ch.create_time,
      ch.position_x, ch.position_y, ch.position_z, ch.character_flags,
      a.online AS account_online, a.mutetime AS account_mutetime,
      COALESCE((
        SELECT MAX(aa.gmlevel) FROM ${quoteIdentifier(logonDb)}.account_access aa
        WHERE aa.id = a.id AND aa.RealmID IN (-1, ?)
      ), 0) AS gmlevel,
      b.active AS ban_active, b.banreason AS ban_reason,
      b.bandate AS ban_bandate, b.unbandate AS ban_unbandate
    FROM ${quoteIdentifier(charactersDb)}.characters ch
    JOIN ${quoteIdentifier(logonDb)}.account a ON a.id = ch.account
${mapAndZoneJoins(worldDb)}
    LEFT JOIN ${quoteIdentifier(logonDb)}.account_banned b
      ON b.id = a.id
     AND b.active = 1
     AND b.bandate = (
       SELECT MAX(b2.bandate) FROM ${quoteIdentifier(logonDb)}.account_banned b2
       WHERE b2.id = a.id AND b2.active = 1
     )
    WHERE ch.name = ? AND ch.deleted_name IS NULL
    LIMIT 1
  `;
}

export async function getCharacter(pools, config, name) {
  const pool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  const logonDb = config?.mysql?.logon?.database;
  const worldDb = config?.mysql?.world?.database;

  if (!pool || !charactersDb || !logonDb || !worldDb || !name) {
    return null;
  }

  const realmId = config?.realm?.id ?? 1;
  const [rows] = await pool.query(detailSql({ charactersDb, logonDb, worldDb }), [realmId, name]);
  const r = rows[0];
  if (!r) return null;

  const banActive = Number(r.ban_active) === 1;
  return {
    ...mapRow(r),
    money: Number(r.money),
    playedTimeTotal: Number(r.played_time_total),
    createTime: Number(r.create_time),
    positionX: Number(r.position_x),
    positionY: Number(r.position_y),
    positionZ: Number(r.position_z),
    renameFlagged: (Number(r.character_flags) & CHARACTER_FLAG_RENAME) !== 0,
    accountOnline: Number(r.account_online) === 1,
    accountMuteTime: Number(r.account_mutetime),
    accountGmLevel: Number(r.gmlevel),
    banActive,
    banReason: r.ban_reason ?? null,
    banBandate: banActive ? Number(r.ban_bandate) : null,
    banUnbandate: banActive ? Number(r.ban_unbandate) : null,
    // Guarded on banActive so an account with no ban row at all reads as "not
    // banned" rather than as "not permanently banned" - the same trap
    // server/views/accounts.js documents for its ban cell.
    banPermanent: banActive && Number(r.ban_unbandate) === Number(r.ban_bandate)
  };
}

// The core's own preview limit. GetDeletedCharacterInfoList
// (vmangos-core/src/game/Commands/CharacterCommands.cpp:1369-1378) selects
// LIMIT 0,50, and .character deleted restore|delete act on exactly that set -
// so listing more rows here would promise an action the server will not take,
// and listing fewer would hide one it will.
const DELETED_LIMIT = 50;

export async function listDeletedCharacters(pools, config, { search = '' } = {}) {
  const pool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  if (!pool || !charactersDb) return null;

  // The core searches deleted_name LIKE CONCAT(search, '%')
  // (CharacterCommands.cpp:1378), so the panel previews the same prefix match
  // the destructive commands will run.
  const filter = search ? ' AND deleted_name LIKE ?' : '';
  const params = search ? [`${search}%`, DELETED_LIMIT] : [DELETED_LIMIT];

  const [rows] = await pool.query(`
    SELECT guid, deleted_name, deleted_account, deleted_time
    FROM ${quoteIdentifier(charactersDb)}.characters
    WHERE deleted_time IS NOT NULL${filter}
    ORDER BY deleted_time DESC
    LIMIT ?
  `, params);

  return rows.map((r) => ({
    guid: Number(r.guid),
    deletedName: r.deleted_name,
    deletedAccount: Number(r.deleted_account),
    deletedTime: Number(r.deleted_time)
  }));
}
