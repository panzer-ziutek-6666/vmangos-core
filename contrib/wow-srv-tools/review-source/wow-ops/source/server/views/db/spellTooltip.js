import { escapeHtml } from '../layout.js';
import { renderIcon } from './icon.js';
import { substituteSpellText } from '../../dbLookups/spellText.js';
import { spellContext } from '../../dbLookups/spellLabels.js';
import { powerTypeName } from '../../dbLookups/spellTypes.js';
import { castLabel, cooldownLabel } from './spellList.js';

// Contexts for the spells a description references, built from their rows
// and the same label batch as the spell itself. The whole context - not a
// hand-picked subset of its fields - so a referenced spell's $NNNNr (range)
// resolves exactly as $NNNNd (duration) and $NNNNs (effect amount) already
// did; a referenced spell never references a spell of its own (new Map()).
export function referencedContexts(refRows, labels) {
  const map = new Map();
  for (const [id, row] of refRows) {
    map.set(id, spellContext(row, labels, new Map()));
  }
  return map;
}

// Cost as the client writes it: "30 Mana", or "8% of base mana" when the
// spell costs a percentage (manaCostPercentage).
//
// Rage is the one power stored tenths-scaled: its pool is created at 1000
// against 100 for energy/focus (vmangos-core/src/game/Objects/Unit.cpp:8321-8322,
// GetCreatePowers), and rage regen adds `addRage * 10`
// (vmangos-core/src/game/Objects/Player.cpp:2423) - so a full rage bar is
// 1000, not the 100 the client displays. manaCost is taken straight off that
// pool with no unscaling (vmangos-core/src/game/Spells/Spell.cpp:6988 builds
// the cost from spellInfo->manaCost verbatim; :5085 subtracts it as-is), so
// spell_template.manaCost for a rage spell is itself tenths-scaled and must
// be divided by 10 to show what the client shows (Heroic Strike, entry 78:
// manaCost 150 reads "15 Rage").
export function costLabel(row) {
  if (Number(row.manaCostPercentage) > 0) return `${row.manaCostPercentage}% of base mana`;
  const cost = Number(row.manaCost);
  if (cost > 0) {
    const shown = Number(row.powerType) === 1 ? cost / 10 : cost;
    return `${shown} ${powerTypeName(row.powerType)}`;
  }
  return '';
}

// The spell hover card: the row, its labels, and (when its description
// references another spell) that spell's context - never loadSpell, which
// reads trainers, items and skills a hover never shows.
export function renderSpellTooltip({ row, labels, referenced }) {
  const e = Number(row.entry);
  const ctx = spellContext(row, labels, referenced);
  const lines = [`<div>${renderIcon(labels.iconName.get(e), row.name)}${escapeHtml(row.name)}${row.nameSubtext ? ` <span class="detail">${escapeHtml(row.nameSubtext)}</span>` : ''}</div>`];
  const cost = costLabel(row);
  const range = labels.range.get(e);
  const facts = [
    cost,
    labels.castMs.has(e) ? (Number(labels.castMs.get(e)) > 0 ? `${castLabel(labels.castMs.get(e))} cast` : 'Instant') : '',
    range && range.max > 0 ? `${range.max} yd range` : '',
    cooldownLabel(row) !== '—' ? `${cooldownLabel(row)} cooldown` : ''
  ].filter(Boolean);
  if (facts.length) lines.push(`<div>${escapeHtml(facts.join(' · '))}</div>`);
  // escapeHtml first, then turn the CRLFs 43 build-5875 descriptions carry
  // (Kidney Shot's combo-point table among them) into <br> - exactly what
  // views/db/spell.js's own description does, so the card does not collapse
  // a multi-line description into one run-on line. The text is still escaped
  // exactly once: replaceAll runs on the already-escaped string.
  const text = substituteSpellText(row.description, ctx).trim();
  if (text) lines.push(`<div class="detail">${escapeHtml(text).replaceAll('\n', '<br>')}</div>`);
  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
