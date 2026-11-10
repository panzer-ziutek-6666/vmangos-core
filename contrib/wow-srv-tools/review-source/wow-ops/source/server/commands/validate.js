// Argument rules come from the core's own parser. ExtractQuotedArg
// (vmangos-core/src/game/Chat/Chat.cpp:2901) scans to the first matching guard
// character and has no escape mechanism, so a value containing one cannot be
// made safe by quoting - it can only be rejected.

const MAX_ACCOUNT_STR = 16; // src/game/AccountMgr.h:47
const GUARDS = [`'`, '"', '[', ']'];

// Maximum ban duration: 10 years, to stay well below the core's uint32 wrap point.
// TimeStringToSecs (src/shared/Util.cpp:252) accumulates in uint32, which wraps on
// overflow. A genuinely unbounded ban is expressed as permanent/0, so any finite
// duration beyond ten years is an error (likely a typo) and must be rejected.
const MAX_BAN_SECONDS = 315360000;

export function assertSafeArg(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  for (const guard of GUARDS) {
    if (value.includes(guard)) {
      throw new Error(`${label} contains a quote character (${guard}), which the server cannot escape`);
    }
  }
  if (/\s/.test(value)) {
    throw new Error(`${label} contains whitespace, which would split it into two arguments`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains a control character`);
  }
  return value;
}

export function assertAccountName(value) {
  assertSafeArg(value, 'account');
  if (value.length > MAX_ACCOUNT_STR) {
    throw new Error(`account name is longer than ${MAX_ACCOUNT_STR} characters, which the server rejects`);
  }
  return value;
}

export function assertPassword(value) {
  assertSafeArg(value, 'password');
  if (value.length > MAX_ACCOUNT_STR) {
    throw new Error(`password is longer than ${MAX_ACCOUNT_STR} characters, which the server rejects`);
  }
  return value;
}

const UNITS = { d: 86400, h: 3600, m: 60, s: 1 };

// Mirrors TimeStringToSecs (src/shared/Util.cpp:252), but throws where the core
// silently returns 0 - because the core reads 0 as a permanent ban.
export function parseBanDuration(value) {
  if (typeof value !== 'string') {
    throw new Error('duration is required');
  }
  const text = value.trim().toLowerCase();
  if (text === '0' || text === 'permanent') {
    return { seconds: 0, permanent: true };
  }
  if (!/^(\d+[dhms])+$/.test(text)) {
    throw new Error(
      'duration must be digits followed by d, h, m or s (for example 30d or 1d12h). ' +
      'The server reads anything it cannot parse as a permanent ban.'
    );
  }
  let seconds = 0;
  for (const [, digits, unit] of text.matchAll(/(\d+)([dhms])/g)) {
    seconds += Number(digits) * UNITS[unit];
  }
  if (seconds === 0) {
    throw new Error('duration resolves to zero seconds, which the server reads as a permanent ban');
  }
  if (seconds > MAX_BAN_SECONDS) {
    throw new Error(
      'duration exceeds the maximum of ' +
      `${MAX_BAN_SECONDS} seconds (10 years), which the server cannot represent without wrapping to permanent`
    );
  }
  return { seconds, permanent: false };
}

export function quoteArg(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('reason is required');
  }
  for (const guard of GUARDS) {
    if (value.includes(guard)) {
      throw new Error(`reason contains a quote character (${guard}), which the server cannot escape`);
    }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('reason contains a control character');
  }
  return `"${value}"`;
}

// Rest-of-line arguments. .server set motd, .announce and .notify all take
// the raw remainder of the command line (vmangos-core/src/game/Commands/
// ServerCommands.cpp:46, 55, 325), so quote characters need no escaping and
// must not be rejected - an announcement containing a quotation mark is
// ordinary. What cannot pass is anything that would break the single-line
// SOAP command, or a control character that would reach a player's chat frame.
const MAX_MESSAGE = 255;

// Checked by code point rather than by a regex carrying a literal control
// range, which is invisible in the source and in a diff.
function hasControlCharacter(value) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function assertMessageText(value, label = 'message') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value.length > MAX_MESSAGE) {
    throw new Error(`${label} is longer than ${MAX_MESSAGE} characters`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must be one line; a SOAP command cannot carry a line break`);
  }
  if (hasControlCharacter(value)) {
    throw new Error(`${label} contains a control character`);
  }
  return value;
}

// The delay argument of the .server shutdown family, in seconds
// (ExtractUInt32, ServerCommands.cpp:417). Capped at a day: a longer delay is
// a typo, and the countdown lives only in memory anyway.
const MAX_SHUTDOWN_DELAY = 86400;

export function assertShutdownDelay(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`delay must be a whole number of seconds between 0 and ${MAX_SHUTDOWN_DELAY}`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`delay must be a whole number of seconds between 0 and ${MAX_SHUTDOWN_DELAY}`);
  }
  const seconds = Number(text);
  if (seconds > MAX_SHUTDOWN_DELAY) {
    throw new Error(`delay must be a whole number of seconds between 0 and ${MAX_SHUTDOWN_DELAY}`);
  }
  return String(seconds);
}

// .server plimit takes either a named minimum security level or a signed
// integer, and stores a named level as its negation (ServerCommands.cpp:
// 352-360). That means a negative number typed into the count field would
// silently set a security level instead - so numbers are non-negative here
// and a level is chosen by name.
const PLIMIT_NAMES = ['reset', 'player', 'moderator', 'gamemaster', 'administrator'];

export function assertPlimitValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('player limit must be a name (reset, player, moderator, gamemaster, administrator) or a number of 0 or more');
  }
  const text = value.trim().toLowerCase();
  if (PLIMIT_NAMES.includes(text)) return text;
  if (/^\d+$/.test(text)) return text;
  throw new Error('player limit must be a name (reset, player, moderator, gamemaster, administrator) or a number of 0 or more');
}

export const PLIMIT_NAME_LIST = PLIMIT_NAMES;

// MAX_PLAYER_NAME, the client's own limit (vmangos-core/src/game/ObjectMgr.h:402).
// normalizePlayerName (ObjectMgr.cpp:64-82) upper-cases the first letter and
// lower-cases the rest itself, so the panel does not normalise case - it only
// rejects what a single command-line argument cannot carry.
const MAX_CHARACTER_NAME = 12;

export function assertCharacterName(value) {
  assertSafeArg(value, 'character name');
  if (value.length > MAX_CHARACTER_NAME) {
    throw new Error(`character name is longer than ${MAX_CHARACTER_NAME} characters, which the server rejects`);
  }
  return value;
}

// .mute multiplies its argument by MINUTE into a time_t
// (AccountCommands.cpp:1134). Ten years of minutes is far below the uint32
// wrap point and far beyond any real mute; anything longer is a typo.
const MAX_MUTE_MINUTES = 5256000;

export function assertMuteMinutes(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new Error('mute duration must be a whole number of minutes');
  }
  const minutes = Number(text);
  if (minutes < 1) {
    throw new Error('mute duration must be at least 1 minute; use unmute to lift a mute');
  }
  if (minutes > MAX_MUTE_MINUTES) {
    throw new Error(`mute duration exceeds the maximum of ${MAX_MUTE_MINUTES} minutes`);
  }
  return text;
}

// A quoted argument: the mail subjects and bodies ExtractQuotedArg reads
// (Chat.cpp:2901). Unlike a rest-of-line argument such as .announce's text, a
// guard character inside one cannot be escaped, only refused. Returns the
// value already wrapped in quotes, ready to concatenate into a command.
export function assertQuotedText(value, label = 'text') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value.length > MAX_MESSAGE) {
    throw new Error(`${label} is longer than ${MAX_MESSAGE} characters`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must be one line; a SOAP command cannot carry a line break`);
  }
  for (const guard of GUARDS) {
    if (value.includes(guard)) {
      throw new Error(`${label} contains a quote character (${guard}), which the server cannot escape`);
    }
  }
  if (hasControlCharacter(value)) {
    throw new Error(`${label} contains a control character`);
  }
  return `"${value}"`;
}

function assertPositiveInteger(value, label, max) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error(`${label} must be a whole number of 1 or more`);
  }
  if (max !== undefined && Number(text) > max) {
    throw new Error(`${label} must be no more than ${max}`);
  }
  return text;
}

export function assertItemId(value) {
  return assertPositiveInteger(value, 'item id');
}

export function assertItemCount(value) {
  return assertPositiveInteger(value, 'item count');
}

// MAX_MONEY_AMOUNT (vmangos-core/src/game/Objects/Player.h:657). The command
// takes copper, and HandleSendMoneyHelper refuses 0 (MiscCommands.cpp:1075).
const MAX_MONEY_COPPER = 2147483646;

export function assertMoneyCopper(value) {
  return assertPositiveInteger(value, 'money (copper)', MAX_MONEY_COPPER);
}

// ExtractRaceMask accepts one of its literals or a raw number, and treats a
// zero mask as a parse failure (Chat.cpp:3885-3908) - so a mask of 0 would
// make the whole .send mass command fail rather than reach nobody.
// server/playerTypes.js carries the same literals for the form's dropdown.
const RACE_MASK_LITERALS = new Set([
  'human', 'orc', 'dwarf', 'nightelf', 'undead', 'tauren', 'gnome', 'troll',
  'alliance', 'horde', 'all'
]);

export function assertRaceMask(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (RACE_MASK_LITERALS.has(text)) return text;
  if (/^\d+$/.test(text) && Number(text) > 0) return text;
  throw new Error('race must be one of human, orc, dwarf, nightelf, undead, tauren, gnome, troll, alliance, horde, all, or a race mask above 0');
}

// gm_tickets.ticket_id is an AUTO_INCREMENT unsigned int starting at 1
// (vmangos-core/sql/characters.sql:533), and the handlers read it with atoi,
// which turns anything unparseable into 0 - an id no ticket has. Refusing that
// here means a malformed id is reported rather than silently looked up and
// answered with "ticket does not exist".
export function assertTicketId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error('ticket id must be a whole number of 1 or more');
  }
  return text;
}

// Event ids index GameEventMgr's own uint16-keyed vector, whose loop starts at
// 1 (vmangos-core/src/game/GameEventMgr.cpp:725), so 0 is never a valid event.
// Whitespace is not trimmed: an id reaches this from a hidden field the panel
// itself rendered, so a padded value means something upstream is wrong and
// should be reported rather than quietly cleaned up.
export function assertEventId(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) {
    throw new Error('event id must be a whole number');
  }
  const id = Number(text);
  if (id < 1 || id > 65535) {
    throw new Error('event id must be between 1 and 65535');
  }
  return text;
}

// .character deleted old takes a day count and refuses a negative one
// (CharacterCommands.cpp:1698-1702); 0 is legal and means "every deleted
// character", which is why the route guards the command rather than the
// validator rejecting the value.
export function assertKeepDays(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new Error('keep days must be a whole number of 0 or more');
  }
  return text;
}
