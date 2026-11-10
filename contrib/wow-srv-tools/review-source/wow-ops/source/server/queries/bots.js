// Queries backing the Bots section (server/sections/bots.js) and the status
// strip's bot-character count (server/status.js): how many bot accounts and
// bot characters exist, where the online ones are, and which bot accounts
// are suspended. All four exports filter by the configured account prefix
// (config.bots.accountPrefix) so a bot is identified the same way
// everywhere on this realm - see server/queries/accounts.js for the
// corresponding human-account view.
//
// `characters`, `logon` (realmd) and `world` are three separate MySQL
// databases (server/db.js opens one pool per database), so none of this can
// be a normal cross-table JOIN through a single connection's default
// schema. Because all three live on the same MySQL server under the same
// credentials, a single query issued on one pool can still qualify another
// schema by name (`characters.characters`, `realmd.account`,
// `mangos.map_template`) - exactly what the game server's own code does (it
// also treats them as one MySQL instance). Doing that here means pulling
// aggregated rows straight out of MySQL instead of shipping 1000+ bot
// character rows into Node to join in memory. See the README's Bots section
// for what happens if that same-server assumption does not hold.
//
// The schema names are not hardcoded as `characters`/`realmd`/`mangos`:
// config.js lets an operator name these databases anything, so the names
// are read from the configured DSNs (config.mysql.<key>.database) and
// backtick-quoted as identifiers.
function quoteIdentifier(name) {
  return `\`${String(name).replaceAll('`', '``')}\``;
}

// characters.online is written at login and logout (unlike map/zone/position_*,
// which only move on the 15-minute player save timer), so unlike those
// columns it is accurate to the second - see server/status.js for why it is
// read from here instead of asking the game server directly.
//
// Returns null (never throws) when either the `characters` pool is not
// configured or the config does not carry both schema names - both `logon`
// and `characters` are optional at the config level (only `logon` is
// mandatory), so a panel that only points at `logon` simply cannot answer
// this question.
export async function countOnlineBots(pools, config) {
  const charactersPool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  const logonDb = config?.mysql?.logon?.database;
  const prefix = config?.bots?.accountPrefix;

  if (!charactersPool || !charactersDb || !logonDb || !prefix) {
    return null;
  }

  const sql = `
    SELECT COUNT(*) AS c
    FROM ${quoteIdentifier(charactersDb)}.characters ch
    JOIN ${quoteIdentifier(logonDb)}.account a ON a.id = ch.account
    WHERE ch.online = 1 AND a.username LIKE ?
  `;
  const [rows] = await charactersPool.query(sql, [`${prefix}%`]);
  const count = rows[0]?.c;
  return count === undefined ? null : Number(count);
}

// Bot accounts and online bot characters are two different figures and must
// never be conflated: on 2026-09-02 this realm had 120 accounts matching the
// prefix and 1000 online characters under them. A module bot is a Player
// object without a network session, so one account drives several bots at
// once. Presenting either number as "bots" alone is wrong.
export async function countBotAccounts(pools, config) {
  const logonPool = pools?.logon;
  const prefix = config?.bots?.accountPrefix;

  if (!logonPool || !prefix) {
    return null;
  }

  const [rows] = await logonPool.query(
    'SELECT COUNT(*) AS c FROM account WHERE username LIKE ?',
    [`${prefix}%`]
  );
  const count = rows[0]?.c;
  return count === undefined ? null : Number(count);
}

// Where the online bots were AT THEIR LAST SAVE. characters.map is written on
// the PlayerSave.Interval timer (900000 ms, mangosd.conf:404), so this is a
// snapshot up to that far behind - unlike characters.online, which moves at
// login and logout. The view must say so; see server/views/bots.js.
//
// map_template is keyed (entry, patch), exactly the trap quest_template
// carries: on this realm 18 entries hold more than one patch row, so joining
// on entry alone would multiply those maps' bot counts. The subquery collapses
// each entry to its highest patch. Map names do not change between patches, so
// this is equally correct and needs no configured running-patch value.
//
// The join to map_template is a LEFT JOIN on purpose: a map id with no
// template row (a character row pointing at a map this world DB does not
// carry) must still appear in the breakdown, as an unnamed row, rather than
// vanish from the totals.
function locationsSql(charactersDb, logonDb, worldDb) {
  return `
    SELECT ch.map AS map_id, mt.map_name AS map_name, mt.map_type AS map_type, COUNT(*) AS bots
    FROM ${quoteIdentifier(charactersDb)}.characters ch
    JOIN ${quoteIdentifier(logonDb)}.account a ON a.id = ch.account
    LEFT JOIN (
      SELECT m1.entry, m1.map_name, m1.map_type
      FROM ${quoteIdentifier(worldDb)}.map_template m1
      WHERE m1.patch = (
        SELECT MAX(m2.patch) FROM ${quoteIdentifier(worldDb)}.map_template m2 WHERE m2.entry = m1.entry
      )
    ) mt ON mt.entry = ch.map
    WHERE ch.online = 1 AND a.username LIKE ?
    GROUP BY ch.map, mt.map_name, mt.map_type
    ORDER BY bots DESC, ch.map ASC
  `;
}

export async function listBotLocations(pools, config) {
  const charactersPool = pools?.characters;
  const charactersDb = config?.mysql?.characters?.database;
  const logonDb = config?.mysql?.logon?.database;
  const worldDb = config?.mysql?.world?.database;
  const prefix = config?.bots?.accountPrefix;

  if (!charactersPool || !charactersDb || !logonDb || !worldDb || !prefix) {
    return null;
  }

  const [rows] = await charactersPool.query(locationsSql(charactersDb, logonDb, worldDb), [`${prefix}%`]);
  return rows.map((r) => ({
    mapId: Number(r.map_id),
    mapName: r.map_name ?? null,
    mapType: r.map_type === null || r.map_type === undefined ? null : Number(r.map_type),
    bots: Number(r.bots)
  }));
}

// Same most-recent-active-ban shape as server/queries/accounts.js: an account
// accumulates one account_banned row per ban, keyed (id, bandate), so joining
// without the MAX(bandate) subquery would return one row per historical ban.
// A ban whose unbandate equals its bandate is permanent.
const SUSPENDED_SQL = `
  SELECT a.username, b.bandate, b.unbandate, b.bannedby, b.banreason
  FROM account a
  JOIN account_banned b
    ON b.id = a.id
   AND b.active = 1
   AND b.bandate = (
     SELECT MAX(b2.bandate) FROM account_banned b2 WHERE b2.id = a.id AND b2.active = 1
   )
  WHERE a.username LIKE ?
  ORDER BY b.bandate DESC
`;

export async function listSuspendedBotAccounts(pools, config) {
  const logonPool = pools?.logon;
  const prefix = config?.bots?.accountPrefix;

  if (!logonPool || !prefix) {
    return null;
  }

  const [rows] = await logonPool.query(SUSPENDED_SQL, [`${prefix}%`]);
  return rows.map((r) => ({
    username: r.username,
    bandate: Number(r.bandate),
    unbandate: Number(r.unbandate),
    bannedby: r.bannedby,
    banreason: r.banreason,
    permanent: Number(r.unbandate) === Number(r.bandate)
  }));
}
