import { countOnlineBots } from './queries/bots.js';

// .server info returns prose (src/game/Commands/ServerCommands.cpp:302), not a
// structured response. Pull out the number worth having and fall back to
// null rather than throwing if the wording ever changes.
//
// The SOAP command here goes through the SOAP client's single, depth-one
// queue (server/soap.js): it is handed to the game server's world thread and
// waited on, so it costs world-tick time on a live server. The status strip
// polls this route every 5s from every open browser tab. Without a guard, a
// slow or hung mangosd -- where a single command can run to its 10s timeout
// -- would let a backlog of status polls occupy that queue ahead of an
// operator's own command. So reads are single-flighted per soap client
// (concurrent callers share one round trip instead of issuing more) and
// cached briefly (a read completed within STATUS_TTL_MS is served from cache
// instead of going back to the server at all).
//
// The bot count deliberately does NOT come from `.bot info`. This realm runs
// two unrelated bot subsystems. `.bot info` is
// ChatHandler::HandleBotInfoCommand (vmangos-core src/game/PlayerBots/
// PlayerBotMgr.cpp:760), which reports the core's own native PlayerBotMgr -
// a subsystem this realm does not use. The bots that actually run come from
// a separate module (src/modules/PlayerBots/playerbot/), which the core's
// PlayerBotMgr knows nothing about, so `.bot info` always answers
// "Total:0, Online : 0" here no matter how many module bots are up. The
// module's own stats commands need an in-world player (a SOAP command's
// handler has no session, so PlayerbotMgr.cpp:964-969 rejects it with
// "You may only add bots from an active session"), so those are not reachable
// this way either.
// `characters.characters.online` is the one source that is both accurate
// (written at login/logout, unlike the 15-minute-stale map/zone/position_*
// columns) and reachable without a session - see server/queries/bots.js. Do
// not switch this back to `.bot info`; it will silently read zero here.

const STATUS_TTL_MS = 3000;

// Keyed by the soap client instance rather than a fixed key, so distinct
// clients (as in tests, where each test builds its own fake) never share a
// cache entry or an in-flight read.
const inflightBySoap = new WeakMap();
const cacheBySoap = new WeakMap();

function matchNumber(text, re) {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

async function fetchStatus({ soap, pools, config }) {
  const result = await soap.execute('.server info');

  if (!result.ok && result.status !== 'failed') {
    return {
      reachable: false, uptime: null, playersOnline: null, botsOnline: null,
      queueDepth: soap.queueDepth(), error: result.output
    };
  }

  const text = result.output ?? '';
  const uptimeMatch = text.match(/uptime:\s*(.+)/i);

  // Never let a SQL hiccup take the whole status strip down with it - the
  // rest of the strip (uptime, real player count, queue depth) is still
  // worth showing even if the bot figure cannot be had right now.
  const botsOnline = await countOnlineBots(pools, config).catch(() => null);

  return {
    reachable: true,
    uptime: uptimeMatch ? uptimeMatch[1].trim() : null,
    // Real human sessions only - `.server info` counts network sessions, and
    // module bots drive Player objects without one, so they are not counted
    // here and never subtracted from this figure either.
    playersOnline: matchNumber(text, /Players online:\s*(\d+)/i),
    botsOnline,
    queueDepth: soap.queueDepth(),
    error: null
  };
}

export async function readStatus({ soap, pools, config }) {
  const cached = cacheBySoap.get(soap);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.result;
  }

  const existing = inflightBySoap.get(soap);
  if (existing) {
    return existing;
  }

  const promise = fetchStatus({ soap, pools, config })
    .then((result) => {
      cacheBySoap.set(soap, { result, at: Date.now() });
      return result;
    })
    .finally(() => {
      inflightBySoap.delete(soap);
    });

  inflightBySoap.set(soap, promise);
  return promise;
}
