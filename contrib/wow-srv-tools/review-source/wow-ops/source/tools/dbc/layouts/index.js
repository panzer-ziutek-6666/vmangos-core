import SpellIcon from './SpellIcon.js';
import SpellCastTimes from './SpellCastTimes.js';
import SpellDuration from './SpellDuration.js';
import SpellRange from './SpellRange.js';
import SpellRadius from './SpellRadius.js';
import SpellMechanic from './SpellMechanic.js';
import SpellDispelType from './SpellDispelType.js';
import SpellItemEnchantment from './SpellItemEnchantment.js';
import SkillLine from './SkillLine.js';
import SkillLineAbility from './SkillLineAbility.js';
import ItemDisplayInfo from './ItemDisplayInfo.js';
import ItemSet from './ItemSet.js';
import ItemRandomProperties from './ItemRandomProperties.js';
import Lock from './Lock.js';
import Faction from './Faction.js';
import FactionTemplate from './FactionTemplate.js';
import AreaTable from './AreaTable.js';
import WorldMapArea from './WorldMapArea.js';
import WorldMapOverlay from './WorldMapOverlay.js';
import Map from './Map.js';
import Resistances from './Resistances.js';
import Talent from './Talent.js';
import TalentTab from './TalentTab.js';
import ChrClasses from './ChrClasses.js';
import ChrRaces from './ChrRaces.js';
import Spell from './Spell.js';

// Import order. Nothing here has a foreign key, so the order is only about
// what a partial run leaves behind: the small support tables first, so a
// failure in one of the big ones still leaves a usable set. Spell is last
// because it is the largest read in the cycle - a partial run should reach
// it only once everything else is already in place.
export const LAYOUTS = [
  SpellIcon, SpellCastTimes, SpellDuration, SpellRange, SpellRadius,
  SpellMechanic, SpellDispelType, SpellItemEnchantment, SkillLine, SkillLineAbility,
  ItemDisplayInfo, ItemSet, ItemRandomProperties, Lock, Faction,
  FactionTemplate, AreaTable, WorldMapArea, WorldMapOverlay, Map, Resistances,
  Talent, TalentTab, ChrClasses, ChrRaces, Spell
];

export const layoutFor = (table) => LAYOUTS.find((layout) => layout.table === table);
