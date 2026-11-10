import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateAccount, buildSetGmLevel, buildSetPassword,
  buildBanAccount, buildUnbanAccount, buildDeleteAccount,
  redactCommandForAudit
} from '../server/commands/accounts.js';

test('builds account creation', () => {
  assert.equal(buildCreateAccount('Jaina', 'hunter2'), '.account create Jaina hunter2');
});

test('builds a gm level change with no realm argument', () => {
  assert.equal(buildSetGmLevel('Jaina', 3), '.account set gmlevel Jaina 3');
});

test('accepts the top of the range the core accepts', () => {
  assert.equal(buildSetGmLevel('Jaina', 6), '.account set gmlevel Jaina 6');
});

test('rejects a gm level outside the range the core accepts', () => {
  assert.throws(() => buildSetGmLevel('Jaina', 7), /gm level must be an integer from 0 to 6/);
  assert.throws(() => buildSetGmLevel('Jaina', -1), /gm level must be an integer from 0 to 6/);
  assert.throws(() => buildSetGmLevel('Jaina', 2.5), /gm level must be an integer from 0 to 6/);
  assert.throws(() => buildSetGmLevel('Jaina', '3'), /gm level must be an integer from 0 to 6/);
});

test('repeats the password twice, as the command expects', () => {
  assert.equal(buildSetPassword('Jaina', 'hunter2'), '.account set password Jaina hunter2 hunter2');
});

test('builds a timed ban with a quoted reason', () => {
  assert.equal(
    buildBanAccount('Jaina', '30d', 'spam in trade chat'),
    '.ban account Jaina 30d "spam in trade chat"'
  );
});

test('builds a permanent ban', () => {
  assert.equal(buildBanAccount('Jaina', 'permanent', 'cheating'), '.ban account Jaina 0 "cheating"');
});

test('refuses a duration the core would read as permanent by accident', () => {
  assert.throws(() => buildBanAccount('Jaina', '30', 'oops'), /duration must be digits/);
});

test('builds unban with a quoted reason', () => {
  assert.equal(buildUnbanAccount('Jaina', 'appealed ban'), '.unban account Jaina "appealed ban"');
  assert.equal(buildDeleteAccount('Jaina'), '.account delete Jaina');
});

test('refuses an empty reason on unban', () => {
  assert.throws(() => buildUnbanAccount('Jaina', ''), /reason is required/);
});

test('refuses a reason containing a quote character on unban', () => {
  assert.throws(() => buildUnbanAccount('Jaina', 'said "no"'), /reason contains a quote character/);
});

test('every builder rejects an injected quote in the account name', () => {
  const bad = 'Tom"ek';
  assert.throws(() => buildCreateAccount(bad, 'pass'), /account contains a quote character/);
  assert.throws(() => buildSetGmLevel(bad, 1), /account contains a quote character/);
  assert.throws(() => buildSetPassword(bad, 'pass'), /account contains a quote character/);
  assert.throws(() => buildBanAccount(bad, '1d', 'r'), /account contains a quote character/);
  assert.throws(() => buildUnbanAccount(bad, 'reason'), /account contains a quote character/);
  assert.throws(() => buildDeleteAccount(bad), /account contains a quote character/);
});

test('rejects a password containing a space, which would be silently truncated', () => {
  assert.throws(() => buildCreateAccount('Jaina', 'two words'), /password contains whitespace/);
});

test('redactCommandForAudit leaves an unrelated command untouched', () => {
  assert.equal(redactCommandForAudit('.server info'), '.server info');
  assert.equal(
    redactCommandForAudit('.ban account Jaina 1d "y"'),
    '.ban account Jaina 1d "y"'
  );
});

test('redactCommandForAudit redacts the password in .account create', () => {
  assert.equal(
    redactCommandForAudit(buildCreateAccount('Jaina', 'hunter2')),
    '.account create Jaina <redacted>'
  );
});

test('redactCommandForAudit redacts both password arguments in .account set password', () => {
  assert.equal(
    redactCommandForAudit(buildSetPassword('Jaina', 'hunter2')),
    '.account set password Jaina <redacted> <redacted>'
  );
});

test('redactCommandForAudit fails closed on a malformed .account create with extra arguments', () => {
  const redacted = redactCommandForAudit('.account create Jaina hunter2 extra-token');
  assert.equal(redacted, '.account create Jaina <redacted>');
  assert.doesNotMatch(redacted, /hunter2/);
  assert.doesNotMatch(redacted, /extra-token/);
});

test('redactCommandForAudit fails closed on a malformed .account set password with extra arguments', () => {
  const redacted = redactCommandForAudit('.account set password Jaina hunter2 hunter2 extra-token');
  assert.equal(redacted, '.account set password Jaina <redacted>');
  assert.doesNotMatch(redacted, /hunter2/);
  assert.doesNotMatch(redacted, /extra-token/);
});

test('redactCommandForAudit fails closed when the account name itself is missing', () => {
  assert.equal(redactCommandForAudit('.account create'), '.account create <redacted>');
  assert.equal(redactCommandForAudit('.account set password'), '.account set password <redacted>');
});
