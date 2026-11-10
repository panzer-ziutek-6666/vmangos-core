// Command spellings and argument order come from vmangos-core's own tables
// and handlers; each builder cites the source of anything surprising.
//
// Every command here is allowConsole = true (Chat.cpp:242-258, 172-180,
// 937-946, 1024-1030, 1252-1304), which is the only thing SOAP checks: it
// runs commands as SEC_CONSOLE (MaNGOSsoap.cpp:120), so a command's GM
// security level never applies. Commands whose allowConsole is false -
// .additem, .levelup, .modify money, .tele, .pinfo, .whispers, .unstuck -
// cannot be reached this way at all and have no builder here.
import {
  assertCharacterName, assertMuteMinutes, assertItemId, assertItemCount,
  assertMoneyCopper, assertQuotedText, assertRaceMask, assertKeepDays,
  assertMessageText, assertSafeArg, parseBanDuration, quoteArg
} from './validate.js';

// PLAYER_STRONG_MAX_LEVEL is higher, but this realm serves 1.12 content: 60
// is the cap a character can legitimately hold, and a number above it is a
// typo the core would silently clamp (CharacterCommands.cpp:1908) rather than
// report.
const MAX_LEVEL = 60;

// .character rename does NOT rename. It sets CHARACTER_FLAG_RENAME on the
// character and lets the player choose a new name at next login
// (CharacterCommands.cpp:1936-1949). There is no argument for a new name, and
// there is no command in this core that renames a character outright.
export function buildFlagRename(name) {
  assertCharacterName(name);
  return `.character rename ${name}`;
}

export function buildSetLevel(name, level) {
  assertCharacterName(name);
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new Error(`level must be an integer from 1 to ${MAX_LEVEL}`);
  }
  return `.character level ${name} ${level}`;
}

export function buildRevive(name) {
  assertCharacterName(name);
  return `.revive ${name}`;
}

export function buildRepairItems(name) {
  assertCharacterName(name);
  return `.repairitems ${name}`;
}

export function buildKick(name) {
  assertCharacterName(name);
  return `.kick ${name}`;
}

// Minutes, not a duration string: HandleMuteCommand reads a uint32 and
// multiplies it by MINUTE (AccountCommands.cpp:1115, 1134). buildBanCharacter
// below takes the entirely different d/h/m/s format, so the two must never
// share a form field.
export function buildMute(name, minutes, reason) {
  assertCharacterName(name);
  const mins = assertMuteMinutes(minutes);
  return `.mute ${name} ${mins} ${quoteArg(reason)}`;
}

export function buildUnmute(name) {
  assertCharacterName(name);
  return `.unmute ${name}`;
}

// Despite its name, this bans the ACCOUNT that owns the character:
// World::BanAccount resolves the character's guid and bans its account row
// (World.cpp:2631-2637). It is also asynchronous - it returns BAN_INPROGRESS
// and the handler prints nothing - so an empty SOAP response is the success
// case, not a failure. The view says both things.
export function buildBanCharacter(name, duration, reason) {
  assertCharacterName(name);
  const parsed = parseBanDuration(duration);
  const durationArg = parsed.permanent ? '0' : duration.trim().toLowerCase();
  return `.ban character ${name} ${durationArg} ${quoteArg(reason)}`;
}

export function buildUnbanCharacter(name, reason) {
  assertCharacterName(name);
  return `.unban character ${name} ${quoteArg(reason)}`;
}

// Item id first, then the name - the reverse of every other command here
// (CharacterCommands.cpp:1978-1987).
export function buildHasItem(name, itemId) {
  assertCharacterName(name);
  const id = assertItemId(itemId);
  return `.character hasitem ${id} ${name}`;
}

export function buildReputation(name) {
  assertCharacterName(name);
  return `.character reputation ${name}`;
}

// Irreversible: Player::DeleteFromDB with deleteFinally = true, whatever
// CharDelete.Method says (CharacterCommands.cpp:1733). The route guards it
// with a typed confirmation.
export function buildErase(name) {
  assertCharacterName(name);
  return `.character erase ${name}`;
}

// A rest-of-line argument, like .announce: SendAreaTriggerMessage takes
// everything after the name (MiscCommands.cpp:1184-1199), so quotes need no
// escaping here and must not be rejected.
export function buildSendMessage(name, text) {
  assertCharacterName(name);
  assertMessageText(text, 'message');
  return `.send message ${name} ${text}`;
}

export function buildSendMail(name, subject, body) {
  assertCharacterName(name);
  return `.send mail ${name} ${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
}

// One item stack per mail: MAX_MAIL_ITEMS is 1 (Mail.h:51). A count above the
// item's own max stack size is split by the core into several stacks and then
// rejected against that same limit (MiscCommands.cpp:976-995); the panel has
// no item prototypes, so it cannot pre-check that and the form says so.
export function buildSendItems(name, subject, body, itemId, count) {
  assertCharacterName(name);
  const quoted = `${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
  return `.send items ${name} ${quoted} ${assertItemId(itemId)}:${assertItemCount(count)}`;
}

export function buildSendMoney(name, subject, body, copper) {
  assertCharacterName(name);
  const quoted = `${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
  return `.send money ${name} ${quoted} ${assertMoneyCopper(copper)}`;
}

export function buildSendMassMail(raceMask, subject, body) {
  const mask = assertRaceMask(raceMask);
  return `.send mass mail ${mask} ${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
}

export function buildSendMassItems(raceMask, subject, body, itemId, count) {
  const mask = assertRaceMask(raceMask);
  const quoted = `${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
  return `.send mass items ${mask} ${quoted} ${assertItemId(itemId)}:${assertItemCount(count)}`;
}

export function buildSendMassMoney(raceMask, subject, body, copper) {
  const mask = assertRaceMask(raceMask);
  const quoted = `${assertQuotedText(subject, 'subject')} ${assertQuotedText(body, 'body')}`;
  return `.send mass money ${mask} ${quoted} ${assertMoneyCopper(copper)}`;
}

// .character deleted list takes a subcommand, never a bare search
// (Chat.cpp:209-213). The search itself is a prefix the core runs as
// deleted_name LIKE CONCAT(search, '%') (CharacterCommands.cpp:1378).
export function buildDeletedListName(search) {
  assertSafeArg(search, 'search');
  return `.character deleted list name ${search}`;
}

export function buildDeletedListAccount(search) {
  assertSafeArg(search, 'search');
  return `.character deleted list account ${search}`;
}

// Both of these act on EVERY row that prefix search matches, up to fifty
// (CharacterCommands.cpp:1607, 1664) - not on one character. The route shows
// the matching rows and requires a typed confirmation before sending either.
export function buildDeletedRestore(search) {
  assertSafeArg(search, 'search');
  return `.character deleted restore ${search}`;
}

export function buildDeletedDelete(search) {
  assertSafeArg(search, 'search');
  return `.character deleted delete ${search}`;
}

export function buildDeletedOld(keepDays) {
  return `.character deleted old ${assertKeepDays(keepDays)}`;
}
