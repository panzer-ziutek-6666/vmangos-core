import { escapeHtml } from '../layout.js';
import { questTypeName, questSide, questLevelLabel, categoryLabel } from '../../dbLookups/questCategories.js';

const OBJECTIVES_LIMIT = 300;

// The quest hover card: built from the quest_template row plus, for a zone
// category, the zone's name - never from loadQuest, which reads relation,
// item and faction tables a hover has no use for (the defect cycle 3 shipped
// once, and the cost test pins).
export function renderQuestTooltip(row, zoneName) {
  const lines = [`<div>${escapeHtml(row.Title)}</div>`];
  const requires = Number(row.MinLevel) ? ` <span class="detail">(requires ${escapeHtml(row.MinLevel)})</span>` : '';
  lines.push(`<div>Level ${escapeHtml(questLevelLabel(row.QuestLevel))}${requires}</div>`);
  lines.push(`<div>Races: ${escapeHtml(questSide(row.RequiredRaces))} · ${escapeHtml(questTypeName(row.Type))}</div>`);
  const category = categoryLabel(row.ZoneOrSort, zoneName);
  if (category) lines.push(`<div class="detail">${escapeHtml(category)}</div>`);
  const objectives = String(row.Objectives ?? '').trim();
  if (objectives) {
    const cut = objectives.length > OBJECTIVES_LIMIT ? `${objectives.slice(0, OBJECTIVES_LIMIT)}…` : objectives;
    lines.push(`<div class="detail">${escapeHtml(cut)}</div>`);
  }
  return `<div class="tooltip">
  ${lines.join('\n  ')}
</div>`;
}
