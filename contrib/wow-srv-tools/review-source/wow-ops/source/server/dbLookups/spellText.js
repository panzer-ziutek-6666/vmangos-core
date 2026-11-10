// $-token substitution for spell_template.description and .auraDescription.
// The core never parses these (the client does), so the token set is the
// one the realm's own descriptions use (measured 2026-09-23: $s 8289, $d
// 3469, $o 459, $t 419, $/ 350, ...). The arithmetic follows the core, not
// any third-party parser: an effect's value is EffectBasePoints plus
// EffectBaseDice when EffectDieSides is 0 or 1, otherwise plus a roll
// between the two (vmangos-core/src/game/Objects/SpellCaster.cpp:1162-1189).
// Anything not handled here is returned exactly as written. Output is plain
// text; the caller escapes it once.

const TOKEN = /\$(?:\$|([lLgG])([^:;]*):([^;]*);|(?:([/*])(\d+);)?(\d*)([a-zA-Z])(\d?))/g;

function trimNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function formatDuration(ms) {
  const n = Number(ms);
  // spell_duration's Duration[0] is -1 for a permanent effect
  // (vmangos-core/src/game/Spells/SpellEntry.cpp:708-713, GetDuration); every
  // caller that cares tests `!= -1` rather than a length
  // (vmangos-core/src/game/Spells/SpellAuras.cpp:6929), so -1 means "until
  // cancelled", not "no duration" - unlike 0/absent, which stays a dash.
  if (n === -1) return 'until cancelled';
  if (!(n > 0)) return '';
  if (n < 60000) return `${trimNumber(n / 1000)} sec`;
  if (n < 3600000) return `${trimNumber(n / 60000)} min`;
  const hours = trimNumber(n / 3600000);
  return `${hours} ${hours === '1' ? 'hour' : 'hours'}`;
}

export function referencedSpellIds(text) {
  const ids = [];
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    if (m[6] && m[7]) {
      const id = Number(m[6]);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// [min, max] magnitudes of effect n (1-3).
// vmangos-core/src/game/Objects/SpellCaster.cpp:1173-1189: if EffectDieSides
// is 0 or 1, value is EffectBasePoints + EffectBaseDice; else roll between the two.
export function effectRange(spell, n) {
  const base = Number(spell[`effectBasePoints${n}`]);
  const dice = Number(spell[`effectBaseDice${n}`]);
  const sides = Number(spell[`effectDieSides${n}`]);

  // If sides is exactly 0 or 1, add only dice (no roll)
  if (sides === 0 || sides === 1) {
    const a = base + dice;
    const mag = Math.abs(a);
    return [mag, mag];
  }

  // Roll between min(dice, sides) and max(dice, sides)
  const lo = base + Math.min(dice, sides);
  const hi = base + Math.max(dice, sides);

  // Magnitudes: if range crosses zero, minimum is 0
  if (lo < 0 && hi > 0) {
    return [0, Math.max(Math.abs(lo), Math.abs(hi))];
  }

  // Both same sign: sort absolute values
  return [Math.abs(lo), Math.abs(hi)].sort((x, y) => x - y);
}

function rangeText([lo, hi]) {
  return lo === hi ? trimNumber(lo) : `${trimNumber(lo)} to ${trimNumber(hi)}`;
}

function apply(op, arg, [lo, hi]) {
  if (!op) return [lo, hi];
  const k = Number(arg);
  return op === '/' ? [lo / k, hi / k] : [lo * k, hi * k];
}

// One token's value, or null when this token cannot be resolved.
function resolve(letter, n, source, op, arg) {
  const idx = n ? Number(n) : 1;
  const s = source.spell;
  switch (letter) {
    case 's': case 'S': return rangeText(apply(op, arg, effectRange(s, idx)));
    case 'm': return trimNumber(apply(op, arg, effectRange(s, idx))[0]);
    case 'M': return trimNumber(apply(op, arg, effectRange(s, idx))[1]);
    case 'o': {
      const amp = Number(s[`effectAmplitude${idx}`]);
      if (!(amp > 0) || !(source.durationMs > 0)) return null;
      const ticks = source.durationMs / amp;
      const [lo, hi] = effectRange(s, idx);
      return rangeText(apply(op, arg, [lo * ticks, hi * ticks]));
    }
    case 't': {
      const amp = Number(s[`effectAmplitude${idx}`]);
      return amp > 0 ? trimNumber(apply(op, arg, [amp / 1000, amp / 1000])[0]) : null;
    }
    case 'd': case 'D': {
      if (source.durationMs === -1) return formatDuration(-1);
      return source.durationMs > 0 ? formatDuration(apply(op, arg, [source.durationMs, source.durationMs])[0]) : null;
    }
    case 'a': { const r = source.radiusYards?.[idx - 1]; return r === null || r === undefined ? null : trimNumber(r); }
    case 'r': return source.rangeYards === null || source.rangeYards === undefined ? null : trimNumber(source.rangeYards);
    case 'h': return trimNumber(Number(s.procChance));
    case 'n': return trimNumber(Number(s.procCharges));
    case 'u': return trimNumber(Number(s.stackAmount));
    case 'x': return trimNumber(Number(s[`effectChainTarget${idx}`]));
    case 'q': return trimNumber(Math.abs(Number(s[`effectMiscValue${idx}`])));
    default: return null;
  }
}

export function substituteSpellText(text, ctx) {
  let lastNumber = null;
  return String(text ?? '').replace(TOKEN, (whole, lg, one, two, op, arg, ref, letter, n) => {
    if (whole === '$$') return '$';
    if (lg) {
      if (lg.toLowerCase() === 'g') return `${one}/${two}`;
      return lastNumber === 1 ? one : two;
    }
    const source = ref ? ctx.referenced?.get(Number(ref)) : ctx;
    if (!source) return whole;
    const value = resolve(letter, n, source, op, arg);
    if (value === null) return whole;
    const first = Number(String(value).split(' ')[0]);
    if (Number.isFinite(first)) lastNumber = /\bto\b/.test(value) ? null : first;
    return value;
  });
}
