// account_banned is keyed (id, bandate) (vmangos-core/sql/logon.sql:75) and an
// account accumulates a row per ban, so join only the most recent active one.
// A ban with unbandate equal to bandate is permanent.
//
// GM level does not live on `account.gmlevel` - that column is vestigial.
// AccountMgr::SetSecurity (vmangos-core/src/game/AccountMgr.cpp:213) writes
// only `account_access`, and the core's own account listing
// (AccountMgr.cpp:549) reads it back from there. account_access is keyed
// (id, RealmID) (vmangos-core/sql/logon.sql:64), so one account can hold
// both a wildcard row (RealmID = -1) and a realm-specific row at once; MAX()
// collapses that pair to one value instead of duplicating or hiding rows.
// COALESCE brings an account with no row at all back as 0, not null.
//
// This realm's `account` table has no `failed_logins` column. The live
// `realmd` database is a Nostalrius-era dump (it carries `nostalrius_token`,
// `geolock_pin`, `pass_verif`, `email_verif` and similar) that predates the
// `failed_logins` column declared in vmangos-core/sql/logon.sql:28, so the
// column is not selected here. This panel targets this realm's actual
// schema rather than the upstream baseline; do not add it back without
// confirming the column exists.

const SQL = `
  SELECT
    a.id, a.username, a.online, a.last_login, a.last_ip,
    a.locked, a.mutetime,
    COALESCE((
      SELECT MAX(aa.gmlevel) FROM account_access aa
      WHERE aa.id = a.id AND aa.RealmID IN (-1, ?)
    ), 0) AS gmlevel,
    b.active     AS ban_active,
    b.banreason  AS ban_reason,
    b.unbandate  AS ban_unbandate,
    b.bandate    AS ban_bandate
  FROM account a
  LEFT JOIN account_banned b
    ON b.id = a.id
   AND b.active = 1
   AND b.bandate = (
     SELECT MAX(b2.bandate) FROM account_banned b2 WHERE b2.id = a.id AND b2.active = 1
   )
`;

export async function listAccounts(pools, { includeBots = false, botPrefix = 'RNDBOT', realmId = 1 } = {}) {
  const where = includeBots ? '' : ' WHERE a.username NOT LIKE ?';
  const params = includeBots ? [realmId] : [realmId, `${botPrefix}%`];
  const [rows] = await pools.logon.query(`${SQL}${where} ORDER BY a.username`, params);

  return rows.map((r) => ({
    ...r,
    ban_permanent: r.ban_active === 1 ? Number(r.ban_unbandate) === Number(r.ban_bandate) : false
  }));
}
