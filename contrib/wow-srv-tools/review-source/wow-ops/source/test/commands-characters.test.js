import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlagRename, buildSetLevel, buildRevive, buildRepairItems, buildKick,
  buildMute, buildUnmute, buildBanCharacter, buildUnbanCharacter,
  buildHasItem, buildReputation, buildErase,
  buildSendMessage, buildSendMail, buildSendItems, buildSendMoney,
  buildSendMassMail, buildSendMassItems, buildSendMassMoney,
  buildDeletedListName, buildDeletedListAccount, buildDeletedRestore,
  buildDeletedDelete, buildDeletedOld
} from '../server/commands/characters.js';

test('rename flags the character rather than renaming it', () => {
  // .character rename sets CHARACTER_FLAG_RENAME; the player picks the new
  // name at next login (CharacterCommands.cpp:1936-1949), so the command
  // carries no new name and the builder must not invent an argument for one.
  assert.equal(buildFlagRename('Thrall'), '.character rename Thrall');
});

test('level takes the name first and the level second', () => {
  assert.equal(buildSetLevel('Thrall', 60), '.character level Thrall 60');
});

test('level is bounded by what this realm can hold', () => {
  assert.throws(() => buildSetLevel('Thrall', 0), /level/);
  assert.throws(() => buildSetLevel('Thrall', 61), /60/);
  assert.throws(() => buildSetLevel('Thrall', 1.5), /level/);
  assert.throws(() => buildSetLevel('Thrall', '60'), /level/);
});

test('the simple one-argument commands are built', () => {
  assert.equal(buildRevive('Thrall'), '.revive Thrall');
  assert.equal(buildRepairItems('Thrall'), '.repairitems Thrall');
  assert.equal(buildKick('Thrall'), '.kick Thrall');
  assert.equal(buildUnmute('Thrall'), '.unmute Thrall');
  assert.equal(buildReputation('Thrall'), '.character reputation Thrall');
  assert.equal(buildErase('Thrall'), '.character erase Thrall');
});

test('mute is name, minutes, quoted reason', () => {
  assert.equal(buildMute('Thrall', '30', 'spam'), '.mute Thrall 30 "spam"');
});

test('ban character uses the d/h/m/s duration string, not minutes', () => {
  // HandleBanHelper reads the duration with TimeStringToSecs
  // (AccountCommands.cpp:599-603), a different format from .mute's minutes.
  assert.equal(buildBanCharacter('Thrall', '30d', 'cheating'), '.ban character Thrall 30d "cheating"');
  assert.equal(buildBanCharacter('Thrall', 'permanent', 'cheating'), '.ban character Thrall 0 "cheating"');
});

test('an unparseable ban duration is refused rather than sent', () => {
  // TimeStringToSecs returns 0 for anything it cannot parse, and the core
  // reads 0 as permanent - so a typo would silently become a permanent ban.
  assert.throws(() => buildBanCharacter('Thrall', 'forever', 'cheating'), /duration/);
});

test('unban character takes a mandatory reason', () => {
  // HandleUnBanHelper requires a second argument and returns false without an
  // error message if it is missing, so the command would silently do nothing.
  assert.equal(buildUnbanCharacter('Thrall', 'appeal upheld'), '.unban character Thrall "appeal upheld"');
  assert.throws(() => buildUnbanCharacter('Thrall', ''), /required/);
});

test('hasitem puts the item id before the name', () => {
  // HandleCharacterHasItemCommand reads the item id first
  // (CharacterCommands.cpp:1978-1987) - the reverse of every other command
  // in this file.
  assert.equal(buildHasItem('Thrall', '12345'), '.character hasitem 12345 Thrall');
});

test('every builder rejects a name the command line cannot carry', () => {
  for (const build of [buildFlagRename, buildRevive, buildRepairItems, buildKick, buildUnmute, buildReputation, buildErase]) {
    assert.throws(() => build('Two Words'), /whitespace/);
    assert.throws(() => build(''), /required/);
  }
});

test('send message takes the rest of the line unquoted', () => {
  // HandleSendMessageCommand uses everything after the name as the message
  // (MiscCommands.cpp:1184-1199), so a quotation mark in it is ordinary.
  assert.equal(buildSendMessage('Thrall', 'server restarting in 5'), '.send message Thrall server restarting in 5');
  assert.equal(buildSendMessage('Thrall', 'say "hi"'), '.send message Thrall say "hi"');
});

test('send message refuses a line break and an over-long message', () => {
  assert.throws(() => buildSendMessage('Thrall', 'two\nlines'), /one line/);
  assert.throws(() => buildSendMessage('Thrall', 'x'.repeat(256)), /longer than/);
});

test('send mail quotes the subject and the body', () => {
  assert.equal(
    buildSendMail('Thrall', 'Welcome', 'Enjoy the realm'),
    '.send mail Thrall "Welcome" "Enjoy the realm"'
  );
});

test('send items carries exactly one item stack', () => {
  // MAX_MAIL_ITEMS is 1 (vmangos-core/src/game/Mail/Mail.h:51) despite the
  // handler comment describing item1..item12.
  assert.equal(
    buildSendItems('Thrall', 'Gift', 'Here', '12345', '5'),
    '.send items Thrall "Gift" "Here" 12345:5'
  );
});

test('send money is copper and refuses zero', () => {
  assert.equal(
    buildSendMoney('Thrall', 'Refund', 'Sorry', '10000'),
    '.send money Thrall "Refund" "Sorry" 10000'
  );
  assert.throws(() => buildSendMoney('Thrall', 'Refund', 'Sorry', '0'), /1 or more/);
});

test('the mass variants take a race mask instead of a name', () => {
  assert.equal(buildSendMassMail('horde', 'Notice', 'Hello'), '.send mass mail horde "Notice" "Hello"');
  assert.equal(buildSendMassItems('all', 'Gift', 'Here', '12345', '1'), '.send mass items all "Gift" "Here" 12345:1');
  assert.equal(buildSendMassMoney('alliance', 'Refund', 'Sorry', '500'), '.send mass money alliance "Refund" "Sorry" 500');
});

test('a mass send refuses a race mask the core would not parse', () => {
  assert.throws(() => buildSendMassMail('everyone', 'Notice', 'Hello'), /race/);
});

test('deleted list has no bare form, only name and account', () => {
  // Chat.cpp:209-213: characterDeletedListCommandTable holds "name" and
  // "account" and nothing else, so `.character deleted list <x>` is not a
  // command at all.
  assert.equal(buildDeletedListName('Thr'), '.character deleted list name Thr');
  assert.equal(buildDeletedListAccount('TOMEK'), '.character deleted list account TOMEK');
});

test('deleted restore and delete take the search string the preview used', () => {
  assert.equal(buildDeletedRestore('Thr'), '.character deleted restore Thr');
  assert.equal(buildDeletedDelete('Thr'), '.character deleted delete Thr');
});

test('a deleted search must be a safe single argument', () => {
  assert.throws(() => buildDeletedDelete('Two Words'), /whitespace/);
  assert.throws(() => buildDeletedDelete(''), /required/);
});

test('deleted old takes a day count', () => {
  assert.equal(buildDeletedOld('30'), '.character deleted old 30');
  assert.equal(buildDeletedOld('0'), '.character deleted old 0');
  assert.throws(() => buildDeletedOld('-1'), /whole number/);
});
