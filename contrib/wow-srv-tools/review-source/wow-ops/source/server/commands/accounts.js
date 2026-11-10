import { assertAccountName, assertPassword, parseBanDuration, quoteArg } from './validate.js';

// Command spellings from vmangos-core/src/game/Chat/Chat.cpp. Note that
// .account set gmlevel takes no realm argument in this fork
// (src/game/Commands/AccountCommands.cpp:71).

export function buildCreateAccount(name, pass) {
  assertAccountName(name);
  assertPassword(pass);
  return `.account create ${name} ${pass}`;
}

export function buildSetGmLevel(name, level) {
  assertAccountName(name);
  if (!Number.isInteger(level) || level < 0 || level > 6) {
    throw new Error('gm level must be an integer from 0 to 6');
  }
  return `.account set gmlevel ${name} ${level}`;
}

export function buildSetPassword(name, pass) {
  assertAccountName(name);
  assertPassword(pass);
  return `.account set password ${name} ${pass} ${pass}`;
}

export function buildBanAccount(name, duration, reason) {
  assertAccountName(name);
  const parsed = parseBanDuration(duration);
  const durationArg = parsed.permanent ? '0' : duration.trim().toLowerCase();
  return `.ban account ${name} ${durationArg} ${quoteArg(reason)}`;
}

export function buildUnbanAccount(name, reason) {
  assertAccountName(name);
  return `.unban account ${name} ${quoteArg(reason)}`;
}

export function buildDeleteAccount(name) {
  assertAccountName(name);
  return `.account delete ${name}`;
}

const REDACTED = '<redacted>';

// The audit log and the browser must never see a password, even though the
// SOAP call itself needs the real one. This produces an audit-safe copy of
// a command string with password arguments replaced by a fixed placeholder.
//
// Fail closed: this only trusts the exact argument shape the builders above
// produce. If a command starts with one of the two password-bearing
// prefixes but does not split into that exact number of tokens, we cannot
// be sure which token is a password - so everything after the account name
// is discarded (collapsed into a single placeholder) rather than risking a
// real password surviving into a log row or a rendered page. A parsing
// surprise must never leak a secret.
export function redactCommandForAudit(command) {
  if (typeof command !== 'string') return command;
  const tokens = command.split(' ');

  if (tokens[0] === '.account' && tokens[1] === 'create') {
    // Normal shape: .account create <name> <pass> (4 tokens). There is only
    // ever one password here, so the normal and fail-closed outputs coincide.
    return tokens.length >= 3
      ? `.account create ${tokens[2]} ${REDACTED}`
      : `.account create ${REDACTED}`;
  }

  if (tokens[0] === '.account' && tokens[1] === 'set' && tokens[2] === 'password') {
    if (tokens.length === 6) {
      // Normal shape: .account set password <name> <pass> <pass>. Redact
      // both password arguments, preserving the two-argument structure.
      return `.account set password ${tokens[3]} ${REDACTED} ${REDACTED}`;
    }
    // Fail closed: unexpected argument count. Collapse everything after the
    // account name into a single placeholder rather than guess which
    // tokens are passwords.
    return tokens.length >= 4
      ? `.account set password ${tokens[3]} ${REDACTED}`
      : `.account set password ${REDACTED}`;
  }

  return command;
}
