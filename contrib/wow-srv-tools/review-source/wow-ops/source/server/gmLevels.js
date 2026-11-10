// Account security levels, from vmangos-core/src/shared/Common.h:138-145
// (enum AccountTypes). The core's HandleAccountSetGmLevelCommand accepts
// SEC_PLAYER (0) through SEC_ADMINISTRATOR (6) inclusive
// (src/game/Commands/AccountCommands.cpp:89); SEC_CONSOLE (7) is not a
// settable account level. This is the single source of truth for the level
// names, shared by every place that renders a GM level.
export const GM_LEVELS = [
  { level: 0, name: 'player' },
  { level: 1, name: 'moderator' },
  { level: 2, name: 'ticketmaster' },
  { level: 3, name: 'gamemaster' },
  { level: 4, name: 'basic admin' },
  { level: 5, name: 'developer' },
  { level: 6, name: 'administrator' }
];

export function gmLevelName(level) {
  return GM_LEVELS.find((l) => l.level === Number(level))?.name ?? 'unknown';
}
