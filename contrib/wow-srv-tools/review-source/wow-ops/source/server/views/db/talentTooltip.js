import { escapeHtml } from '../layout.js';
import { substituteSpellText } from '../../dbLookups/spellText.js';
import { spellContext } from '../../dbLookups/spellLabels.js';
import { referencedContexts } from './spellTooltip.js';

function text(row, labels, referenced) {
  if (!row) return '';
  const ctx = spellContext(row, labels, referencedContexts(referenced, labels));
  return escapeHtml(substituteSpellText(row.description, ctx).trim()).replaceAll('\n', '<br>');
}

// The requirements are the core's (Player::LearnTalent,
// vmangos-core/src/game/Objects/Player.cpp:20998-21050): row * 5 points in
// the tree, and the prerequisite talent at its rank.
export function renderTalentTooltip({ talent, rank, current, next, labels, referenced, requiredSpell, treeName, prereqName }) {
  const shown = current ?? next;
  const lines = [`<div>${escapeHtml(shown?.name ?? `talent #${talent.id}`)}</div>`, `<div class="detail">Rank ${rank}/${talent.ranks.length}</div>`];
  if (talent.row > 0) lines.push(`<div class="detail">Requires ${talent.row * 5} points in ${escapeHtml(treeName ?? '')}</div>`);
  if (talent.prereq) {
    const points = talent.prereq.rank + 1;
    lines.push(`<div class="detail">Requires ${points} point${points === 1 ? '' : 's'} in ${escapeHtml(prereqName ?? `talent #${talent.prereq.talentId}`)}</div>`);
  }
  // Talent 761 (Entangling Roots) is a requirement the calculator does not
  // gate on (the one build it allows that the server can refuse,
  // Player.cpp:21018) - noted with a plain link, not entityLink, so the card
  // never nests a second .tooltip-host inside this one (I-3).
  if (requiredSpell) lines.push(`<div class="detail">Requires <a href="/db/spell/${escapeHtml(requiredSpell.id)}">${escapeHtml(requiredSpell.name)}</a></div>`);
  if (current) lines.push(`<div>${text(current, labels, referenced)}</div>`);
  if (next && rank > 0) lines.push(`<div class="detail">Next rank:</div><div>${text(next, labels, referenced)}</div>`);
  if (next && rank === 0) lines.push(`<div>${text(next, labels, referenced)}</div>`);
  return `<div class="tooltip">\n  ${lines.join('\n  ')}\n</div>`;
}
