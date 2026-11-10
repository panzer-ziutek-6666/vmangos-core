import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeArg, assertAccountName, assertPassword, parseBanDuration, quoteArg,
  assertCharacterName, assertMuteMinutes, assertQuotedText, assertItemId,
  assertItemCount, assertMoneyCopper, assertRaceMask, assertKeepDays, assertEventId, assertTicketId
} from '../server/commands/validate.js';

test('accepts an ordinary argument', () => {
  assert.equal(assertSafeArg('Jaina', 'account'), 'Jaina');
});

test('rejects every quote character the core treats as a guard', () => {
  for (const bad of [`a'b`, 'a"b', 'a[b', 'a]b']) {
    assert.throws(() => assertSafeArg(bad, 'account'), /account contains a quote character/);
  }
});

test('rejects whitespace, which would split the argument', () => {
  assert.throws(() => assertSafeArg('a b', 'account'), /account contains whitespace/);
  assert.throws(() => assertSafeArg('a\tb', 'account'), /account contains whitespace/);
  assert.throws(() => assertSafeArg('a\nb', 'account'), /account contains whitespace/);
});

test('rejects control characters', () => {
  assert.throws(() => assertSafeArg('a\u0000b', 'account'), /account contains a control character/);
});

test('rejects empty and non-string values', () => {
  assert.throws(() => assertSafeArg('', 'account'), /account is required/);
  assert.throws(() => assertSafeArg(undefined, 'account'), /account is required/);
  assert.throws(() => assertSafeArg(42, 'account'), /account is required/);
});

test('enforces the core 16 character account limit', () => {
  assert.equal(assertAccountName('a'.repeat(16)), 'a'.repeat(16));
  assert.throws(() => assertAccountName('a'.repeat(17)), /account name is longer than 16 characters/);
});

test('enforces the same limit on passwords', () => {
  assert.throws(() => assertPassword('a'.repeat(17)), /password is longer than 16 characters/);
  assert.throws(() => assertPassword('has space'), /password contains whitespace/);
});

test('parses the durations the core understands', () => {
  assert.deepEqual(parseBanDuration('30d'), { seconds: 2592000, permanent: false });
  assert.deepEqual(parseBanDuration('12h'), { seconds: 43200, permanent: false });
  assert.deepEqual(parseBanDuration('45m'), { seconds: 2700, permanent: false });
  assert.deepEqual(parseBanDuration('30s'), { seconds: 30, permanent: false });
  assert.deepEqual(parseBanDuration('1d12h'), { seconds: 129600, permanent: false });
});

test('treats an explicit zero and the word permanent as permanent', () => {
  assert.deepEqual(parseBanDuration('0'), { seconds: 0, permanent: true });
  assert.deepEqual(parseBanDuration('permanent'), { seconds: 0, permanent: true });
});

test('rejects durations the core would silently read as permanent', () => {
  for (const bad of ['30', '30x', 'd30', 'thirty days', '', '  ']) {
    assert.throws(() => parseBanDuration(bad), /duration/);
  }
});

test('rejects durations that wrap to zero in the core uint32', () => {
  assert.throws(() => parseBanDuration('4294967296s'), /duration exceeds the maximum/);
});

test('rejects durations with extremely large single units', () => {
  assert.throws(() => parseBanDuration('99999999999999d'), /duration exceeds the maximum/);
});

test('accepts a large but legal duration', () => {
  assert.deepEqual(parseBanDuration('365d'), { seconds: 31536000, permanent: false });
});

test('rejects sum of multiple units that together exceed the cap', () => {
  assert.throws(() => parseBanDuration('3650d3650d'), /duration exceeds the maximum/);
});

test('quotes an argument that may contain spaces', () => {
  assert.equal(quoteArg('spam in trade chat'), '"spam in trade chat"');
});

test('refuses to quote a value containing a guard character', () => {
  assert.throws(() => quoteArg('he said "no"'), /reason contains a quote character/);
});

// ---- character arguments -------------------------------------------------


test('a character name is 1 to 12 characters', () => {
  assert.equal(assertCharacterName('Thrall'), 'Thrall');
  // MAX_PLAYER_NAME is 12 (vmangos-core/src/game/ObjectMgr.h:402).
  assert.equal(assertCharacterName('Abcdefghijkl'), 'Abcdefghijkl');
  assert.throws(() => assertCharacterName('Abcdefghijklm'), /12/);
  assert.throws(() => assertCharacterName(''), /required/);
});

test('a character name with whitespace or a quote is rejected, not quoted', () => {
  assert.throws(() => assertCharacterName('Two Words'), /whitespace/);
  assert.throws(() => assertCharacterName('Th"rall'), /quote/);
});

test('mute minutes are a whole number of at least one', () => {
  assert.equal(assertMuteMinutes('30'), '30');
  // .mute reads its duration with ExtractUInt32 and multiplies by MINUTE
  // (vmangos-core/src/game/Commands/AccountCommands.cpp:1115, 1134): zero
  // minutes is an unmute dressed as a mute, so it is refused here.
  assert.throws(() => assertMuteMinutes('0'), /at least 1/);
  assert.throws(() => assertMuteMinutes('30m'), /whole number/);
  assert.throws(() => assertMuteMinutes('-5'), /whole number/);
});

test('mute minutes are capped below the uint32 wrap point', () => {
  assert.throws(() => assertMuteMinutes('999999999'), /maximum/);
});

test('quoted text is wrapped, and a quote character is refused', () => {
  assert.equal(assertQuotedText('Welcome back', 'subject'), '"Welcome back"');
  // ExtractQuotedArg (Chat.cpp:2901) scans to the first matching guard and
  // has no escape, so a value containing one cannot be made safe.
  assert.throws(() => assertQuotedText('say "hi"', 'subject'), /quote character/);
  assert.throws(() => assertQuotedText('a [link]', 'subject'), /quote character/);
  assert.throws(() => assertQuotedText('', 'subject'), /required/);
});

test('quoted text may not carry a newline or a control character', () => {
  assert.throws(() => assertQuotedText('two\nlines', 'body'), /one line/);
  assert.throws(() => assertQuotedText(`${String.fromCharCode(7)}bell`, 'body'), /control character/);
});

test('an item id and count are positive whole numbers', () => {
  assert.equal(assertItemId('12345'), '12345');
  assert.equal(assertItemCount('20'), '20');
  assert.throws(() => assertItemId('0'), /item id/);
  assert.throws(() => assertItemId('12a'), /item id/);
  assert.throws(() => assertItemCount('0'), /count/);
});

test('money is copper, at least 1 and no more than the core allows', () => {
  assert.equal(assertMoneyCopper('10000'), '10000');
  // HandleSendMoneyHelper rejects 0 (MiscCommands.cpp:1075) and
  // MAX_MONEY_AMOUNT is 0x7FFFFFFF-1 (Player.h:657).
  assert.throws(() => assertMoneyCopper('0'), /1 or more/);
  assert.throws(() => assertMoneyCopper('2147483647'), /2147483646/);
});

test('a race mask is one of the core literals or a positive number', () => {
  assert.equal(assertRaceMask('horde'), 'horde');
  assert.equal(assertRaceMask('ALL'), 'all');
  assert.equal(assertRaceMask('255'), '255');
  assert.throws(() => assertRaceMask('everyone'), /race/);
  // ExtractRaceMask treats a zero mask as a parse failure (Chat.cpp:3906).
  assert.throws(() => assertRaceMask('0'), /race/);
});

test('keep days is a non-negative whole number', () => {
  assert.equal(assertKeepDays('30'), '30');
  assert.equal(assertKeepDays('0'), '0');
  assert.throws(() => assertKeepDays('-1'), /whole number/);
  assert.throws(() => assertKeepDays('thirty'), /whole number/);
});

test('an event id is a whole number from 1 to 65535', () => {
  assert.equal(assertEventId('13'), '13');
  assert.equal(assertEventId(13), '13');
  assert.throws(() => assertEventId('0'), /event id/);
  assert.throws(() => assertEventId('65536'), /event id/);
  assert.throws(() => assertEventId('1.5'), /event id/);
  assert.throws(() => assertEventId(' 13 '), /event id/);
});

test('a ticket id is a positive whole number', () => {
  assert.equal(assertTicketId('3'), '3');
  assert.throws(() => assertTicketId('0'), /ticket id/);
  assert.throws(() => assertTicketId('-1'), /ticket id/);
  assert.throws(() => assertTicketId('3x'), /ticket id/);
});
