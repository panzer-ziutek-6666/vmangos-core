import { REALM_TYPES, REALM_ZONES, ALLOWED_FLAG_MASK, HIDDEN_FLAG_BIT } from './realmTypes.js';

// Validation for one realmd.realmlist row. These are not cosmetic checks:
// realmd reads this table itself, and a row it dislikes is not reported to
// the operator anywhere the panel can see. An unresolvable address, a subnet
// mask with a hole, or a mask flag outside the allowed set makes realmd skip
// or silently rewrite the row (vmangos-core/src/realmd/RealmList.cpp:198-244),
// leaving a realm that looks configured in the panel and is absent from the
// client's realm list. Reject here, where the operator is looking.

// Control characters are checked by code point rather than by a regex with a
// literal control range in it: the range is invisible in the source, and a
// stray edit to it would be impossible to see in a diff.
function hasControlCharacter(value) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} is longer than ${maxLength} characters, which the column cannot hold`);
  }
  if (hasControlCharacter(value)) {
    throw new Error(`${label} contains a control character`);
  }
  return value;
}

function requireInteger(value, label, min, max) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must be a number between ${min} and ${max}`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}`);
  }
  return n;
}

// realmd resolves both address columns through DNS and skips the realm when
// resolution fails (RealmList.cpp:204-217). A hostname or dotted IPv4 is all
// that can work, so anything with whitespace or exotic characters is a typo.
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function requireHost(value, label, maxLength) {
  requireText(value, label, maxLength);
  if (!HOSTNAME.test(value)) {
    throw new Error(`${label} must be a hostname or an IPv4 address; realmd resolves it and skips the realm if it cannot`);
  }
  return value;
}

// Mirrors the core's own check, RealmList.cpp:226-232: a mask is valid only
// when its inverse is one less than a power of two - that is, when the zero
// bits are contiguous and at the bottom. A mask with a hole makes realmd skip
// the realm.
export function assertSubnetMask(value) {
  requireText(value, 'subnet mask', 15);
  const parts = value.split('.');
  if (parts.length !== 4) {
    throw new Error('subnet mask must be four numbers separated by dots, for example 255.255.255.0');
  }
  let binary = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      throw new Error('subnet mask must be four numbers separated by dots, for example 255.255.255.0');
    }
    const octet = Number(part);
    if (octet > 255) {
      throw new Error('each part of the subnet mask must be between 0 and 255');
    }
    binary = ((binary << 8) | octet) >>> 0;
  }
  const inverted = (~binary) >>> 0;
  if ((((inverted & (inverted + 1)) >>> 0) !== 0)) {
    throw new Error('subnet mask must be contiguous (no holes); realmd skips a realm whose mask has one');
  }
  return value;
}

function normalizeFlags(body) {
  // Checkboxes: absent, a single string, or an array when several are ticked.
  const raw = body.flags === undefined ? [] : (Array.isArray(body.flags) ? body.flags : [body.flags]);
  let mask = 0;
  for (const entry of raw) {
    const bit = Number(entry);
    if (!Number.isInteger(bit) || bit <= 0 || (bit & ALLOWED_FLAG_MASK) !== bit) {
      throw new Error(`realm flag ${entry} is not one realmd keeps; it would be stripped from the row on the next poll`);
    }
    mask |= bit;
  }
  if (body.hidden) mask |= HIDDEN_FLAG_BIT;
  return mask;
}

function normalizeBuilds(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new Error('realmbuilds must be a space separated list of build numbers');
  }
  const parts = value.trim().split(/\s+/).filter((p) => p.length > 0);
  for (const part of parts) {
    if (!/^\d{1,10}$/.test(part)) {
      throw new Error('realmbuilds must be a space separated list of build numbers, for example "5875 6005"');
    }
  }
  const joined = parts.join(' ');
  if (joined.length > 64) {
    throw new Error('realmbuilds is longer than 64 characters, which the column cannot hold');
  }
  return joined;
}

export function normalizeRealmInput(body = {}) {
  const icon = requireInteger(body.icon, 'realm type', 0, 255);
  if (!REALM_TYPES.some((t) => t.icon === icon)) {
    throw new Error('realm type must be one of the values the client understands (0-10)');
  }

  const timezone = requireInteger(body.timezone, 'realm zone', 0, 255);
  if (!REALM_ZONES.some((z) => z.id === timezone)) {
    throw new Error('realm zone must be one of the zones the core defines');
  }

  return {
    name: requireText(body.name, 'realm name', 32),
    address: requireHost(body.address, 'address', 32),
    localAddress: requireHost(body.localAddress, 'local address', 255),
    localSubnetMask: assertSubnetMask(body.localSubnetMask),
    port: requireInteger(body.port, 'port', 1, 65535),
    icon,
    realmflags: normalizeFlags(body),
    timezone,
    allowedSecurityLevel: requireInteger(body.allowedSecurityLevel, 'security level', 0, 6),
    realmbuilds: normalizeBuilds(body.realmbuilds)
  };
}
