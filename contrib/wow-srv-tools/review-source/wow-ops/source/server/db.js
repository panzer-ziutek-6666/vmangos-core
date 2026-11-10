import mysql from 'mysql2/promise';

const KEYS = ['logon', 'characters', 'world', 'logs'];

export function createPools(mysqlConfig) {
  const pools = {};
  for (const key of KEYS) {
    // config.js only requires `logon`; the other three are optional and may
    // simply be absent, in which case there is nothing to build a pool from.
    if (!mysqlConfig[key]) continue;
    pools[key] = mysql.createPool({
      ...mysqlConfig[key],
      waitForConnections: true,
      connectionLimit: 4,
      // Reads, plus one deliberate exception: the realm registry
      // (server/queries/realms.js) writes realmd.realmlist through the logon
      // pool. Everything mangosd itself caches in memory is still written
      // over SOAP, because a SQL write behind a running world server would
      // not take effect until a reload.
      namedPlaceholders: false
    });
  }
  pools.closeAll = () => Promise.all(KEYS.filter((k) => pools[k]).map((k) => pools[k].end()));
  return pools;
}
