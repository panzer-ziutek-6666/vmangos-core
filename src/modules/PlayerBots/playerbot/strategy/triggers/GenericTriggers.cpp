
#include "playerbot/playerbot.h"
#include "GenericTriggers.h"
#include "playerbot/LootObjectStack.h"
#include "playerbot/PlayerbotAIConfig.h"
#include "playerbot/strategy/values/PositionValue.h"
#include "playerbot/strategy/values/AoeValues.h"
#include "playerbot/ServerFacade.h"
#include "playerbot/strategy/generic/CombatStrategy.h"
#include "playerbot/strategy/generic/PullStrategy.h"
#include "Formulas.h"
#include "playerbot/strategy/values/NearestGameObjects.h"
#include "Maps/GridNotifiers.h"
#include "Maps/GridNotifiersImpl.h"
#include "Maps/CellImpl.h"

#include <regex>

using namespace ai;

bool NoManaTrigger::IsActive()
{
    return AI_VALUE2(bool, "has mana", "self target") && AI_VALUE2(uint8, "mana", "self target") < 5;
}

bool LowManaTrigger::IsActive()
{
    return AI_VALUE2(bool, "has mana", "self target") && AI_VALUE2(uint8, "mana", "self target") < sPlayerbotAIConfig.lowMana;
}

bool MediumManaTrigger::IsActive()
{
    return AI_VALUE2(bool, "has mana", "self target") && AI_VALUE2(uint8, "mana", "self target") < sPlayerbotAIConfig.mediumMana;
}

bool HighManaTrigger::IsActive()
{
    return AI_VALUE2(bool, "has mana", "self target") && AI_VALUE2(uint8, "mana", "self target") < 65;
}

bool AlmostFullManaTrigger::IsActive()
{
    return AI_VALUE2(bool, "has mana", "self target") && AI_VALUE2(uint8, "mana", "self target") > 85;
}

bool RageAvailable::IsActive()
{
    return AI_VALUE2(uint8, "rage", "self target") >= amount;
}

bool EnergyAvailable::IsActive()
{
	return AI_VALUE2(uint8, "energy", "self target") >= amount;
}

bool ComboPointsAvailableTrigger::IsActive()
{
    return AI_VALUE2(uint8, "combo", "current target") >= amount;
}

bool LoseAggroTrigger::IsActive()
{
    if(!AI_VALUE2(bool, "has aggro", "current target"))
    {
        // Check if the aggro has been taken by another tank
        if(ai->IsTank(bot))
        {
            Unit* target = AI_VALUE(Unit*, "current target");
            if(target && !target->IsPlayer())
            {
                Unit* targetsTarget = target->GetVictim();
                if(targetsTarget && targetsTarget->IsPlayer())
                {
                    Player* targetsPlayerTarget = (Player*)targetsTarget;
                    return !ai->IsTank(targetsPlayerTarget);
                }
            }
        }

        return true;
    }

    return false;
}

bool HasAggroTrigger::IsActive()
{
    return AI_VALUE2(bool, "has aggro", "current target");
}

bool PanicTrigger::IsActive()
{
    return !ai->IsInPvp() &&
           AI_VALUE2(uint8, "health", "self target") < sPlayerbotAIConfig.criticalHealth &&
		   (!AI_VALUE2(bool, "has mana", "self target") || 
            AI_VALUE2(uint8, "mana", "self target") < sPlayerbotAIConfig.lowMana);
}

bool OutNumberedTrigger::IsActive()
{
    // Below level 10, Hunter has no viable kiting toolkit (ranged abilities have an 8yd
    // minimum range, no traps yet, only Concussive Shot to slow) - fleeing mid-fight can't
    // actually create distance, it just eats time while still taking hits. The correct
    // pre-10 Hunter playbook is: burst at range, then fight it out in melee once the mob
    // closes. Don't fire this trigger for low-level Hunters at all; PanicTrigger (separate,
    // narrower - critical health AND low/no mana) is untouched, so a genuine near-death
    // escape attempt still fires.
    if (bot->GetClass() == CLASS_HUNTER && bot->GetLevel() < 10)
        return false;

    // Druid has Rejuvenation/Healing Touch as a genuine pre-10 self-sufficiency fallback -
    // no need to preserve a flee/retreat option here either. Same reasoning as Hunter above,
    // different tool (self-heal instead of "no viable kiting toolkit").
    if (bot->GetClass() == CLASS_DRUID && bot->GetLevel() < 10)
        return false;

    // Mage has no kiting toolkit pre-10 either (Frost Nova is level 10, Blink is level 22) -
    // same reasoning as Hunter: fleeing can't create real distance yet, so don't bother.
    if (bot->GetClass() == CLASS_MAGE && bot->GetLevel() < 10)
        return false;

    // Priest gets real self-healing from level 1 (Renew, Heal), so the pre-10 case is the
    // same "self-sufficiency beats fleeing" reasoning as Druid. Additionally, when playing
    // solo (no group to preserve healing capacity for), that reasoning holds at any level -
    // there's no one else depending on this bot surviving longer by running instead of
    // healing through it.
    if (bot->GetClass() == CLASS_PRIEST && (bot->GetLevel() < 10 || !bot->GetGroup()))
        return false;

    // Don't trigger if the bot is a dungeon or raid
    if (!bot->IsInWorld() || bot->IsBeingTeleported() || bot->GetMap()->IsDungeon() || bot->GetMap()->IsRaid())
        return false;

    // Don't trigger if the bot is in a raid group
    if (bot->GetGroup() && bot->GetGroup()->isRaidGroup())
        return false;

    // Don't trigger if the bot is in a group with a real player
    if (bot->GetGroup() && ai->HasRealPlayerMaster())
        return false;

    // Being outmatched on paper is not by itself an emergency. The comparison
    // below weighs levels and headcount, and `dLevel * 200` overtakes the
    // friendly side as soon as a single opponent is two levels up - so a solo
    // bot at full health broke off from one mob before a blow had landed. That
    // is also the least useful moment to run: nothing has gone wrong yet, and
    // the fight may well have been winnable. Engage first and let this decide
    // whether to disengage once the fight has actually turned; at mediumHealth
    // there is still enough left to get away. PanicTrigger covers the genuine
    // near-death case separately, and it is deliberately narrower (critical
    // health *and* no mana). Tunable via AiPlayerbot.MediumHealth.
    if (AI_VALUE2(uint8, "health", "self target") >= sPlayerbotAIConfig.mediumHealth)
        return false;

    int32 botLevel = bot->GetLevel();
    float healthMod = bot->GetHealthPercent() / 100.0f;
    uint32 friendPower = 100 + 100 * healthMod, foePower = 0;
    uint32 grayCount = 0;
    // From cmangos/playerbots 490f9b95: count what is attacking the bot, not every mob that could;
    // a solo bot ran from large groups that were never going to fight it.
    for (auto &attacker : ai->GetAiObjectContext()->GetValue<std::list<ObjectGuid>>("attackers")->Get())
    {
        Creature* creature = ai->GetCreature(attacker);
        if (!creature)
            continue;

        if (!(creature->IsCreature() && ((Creature*)creature)->CanInitiateAttack()))
            continue;

        int32 dLevel = creature->GetLevel() - botLevel;

        // From cmangos/playerbots beed4ab6: a grey attacker weighs nothing on its own, an
        // attacker up to three levels above weighs the same as an even one, and each level past
        // that adds a full share - `dLevel * 200` made one mob two levels up outweigh a solo bot.
        if (int32(creature->GetLevel()) <= int32(MaNGOS::XP::GetGrayLevel(botLevel)))
        {
            grayCount++;
            continue;
        }

        healthMod = creature->GetHealthPercent() / 100.0f;

        uint32 const weight = dLevel > 3 ? 100 + (dLevel - 3) * 100 : 100;
        foePower += weight * healthMod;
    }

    if (grayCount > 10)
        foePower += 50 * grayCount;

    if (!foePower)
        return false;

    for (auto & helper : ai->GetAiObjectContext()->GetValue<std::list<ObjectGuid> >("nearest friendly players")->Get())
    {
        Unit* player = ai->GetUnit(helper);

        if (!player || player == bot)
            continue;

        int32 dLevel = player->GetLevel() - botLevel;

        healthMod = player->GetHealthPercent() / 100.0f;

        if (dLevel > -10 && sServerFacade.GetDistance2d(bot, player) < 10.0f)
            friendPower += std::max(200 + 20 * dLevel, dLevel * 200)* healthMod;
    }

    return foePower > 2 * friendPower;
}

bool BuffTrigger::IsActive()
{
    Unit* target = GetTarget();
    if (!target || !target->IsAlive())
        return false;

    // The spell-known gate that used to stand here now covers every spell trigger from
    // SpellTrigger::Check(), which the overriding IsActive() of a BUFF_TRIGGER_A cannot skip.
	return !ai->HasAura(spell, target, false, checkIsOwner);
}

bool MyBuffTrigger::IsActive()
{
    Unit* target = GetTarget();
    return target && !ai->HasMyAura(spell, target);
}

Value<Unit*>* BuffOnPartyTrigger::GetTargetValue()
{
    const std::string qualifier = spell + "-" + (ignoreTanks ? "1" : "0");
	return context->GetValue<Unit*>("friendly unit without aura", qualifier);
}

Value<Unit*>* GreaterBuffOnPartyTrigger::GetTargetValue()
{
    const std::string qualifier = spell + "-" + (ignoreTanks ? "1" : "0");
    return context->GetValue<Unit*>("party member without aura", qualifier);
}

Value<Unit*>* MyBuffOnPartyTrigger::GetTargetValue()
{
    const std::string qualifier = spell + "-" + (ignoreTanks ? "1" : "0");
    return context->GetValue<Unit*>("party member without my aura", qualifier);
}

ai::Value<Unit*>* BuffOnTankTrigger::GetTargetValue()
{
    return context->GetValue<Unit*>("party tank without aura", spell);
}

Value<Unit*>* DebuffOnAttackerTrigger::GetTargetValue()
{
	return context->GetValue<Unit*>("attacker without aura", spell);
}

bool NoAttackersTrigger::IsActive()
{
    return !AI_VALUE(Unit*, "current target") && AI_VALUE(uint8, "my attacker count") > 0;
}

bool InvalidTargetTrigger::IsActive()
{
    // "invalid target" answers true for no target at all, which is what the action behind
    // this trigger leaves behind: SelectNewTargetAction clears the current target, so from
    // the next tick on the trigger fired again on the emptiness it had just created and the
    // action ran with nothing left to do. It executed 114061 times in an 18 hour run and
    // reported 80430 of them as failures, which is what an action with no work looks like
    // from the engine.
    //
    // A bot that has no target at all is the "no target" trigger's business - that is what
    // GrindingStrategy hangs "attack anything" on, and NoTargetTrigger spells the null case
    // out deliberately. This one only has to catch a target that went bad while held.
    return AI_VALUE(Unit*, "current target") && AI_VALUE2(bool, "invalid target", "current target");
}

bool NoTargetTrigger::IsActive()
{
	if (!AI_VALUE(Unit*, "current target") || AI_VALUE2(bool, "invalid target", "current target"))
		return true;

	// From cmangos/playerbots 21b8aef2 and f6f1d3f2: a target kept out of combat, while the bot
	// stands still or has not changed position for a minute, is no target either. The bot went
	// idle on a distant target it was never going to fight. Not while waiting for an attack,
	// pulling, or looting.
	if (!sServerFacade.IsInCombat(bot) && bot->IsAlive() &&
		(bot->IsStopped() || AI_VALUE2(uint32, "time since last change", "current position") > 60) &&
		!WaitForAttackStrategy::ShouldWait(ai) &&
		!(PullStrategy::Get(ai) && PullStrategy::Get(ai)->HasPullStarted() &&
			time(0) - PullStrategy::Get(ai)->GetPullStartTime() < PullStrategy::GetMaxPullTime()) &&
		!bot->GetLootGuid() && !AI_VALUE(bool, "has available loot"))
		return true;

	return false;
}

bool MyAttackerCountTrigger::IsActive()
{
    return AI_VALUE2(bool, "combat", "self target") && AI_VALUE(uint8, "my attacker count") >= amount;
}

bool HighThreatTrigger::IsActive()
{
    uint8 relativeThreat = AI_VALUE2(uint8, "threat", "current target");

    if (relativeThreat >= 80)
    {
        //Watch delta.
        uint32 lastTime = MEM_AI_VALUE(float, "my threat::current target")->GetLastTime();

        if (lastTime < time(0))
        {
            float deltaThreat = LOG_AI_VALUE(float, "my threat::current target")->GetDelta(5.0f);
            float currentThreat = AI_VALUE2(float, "my threat", "current target");

            if (deltaThreat > 0)
            {
                float tankThreat = AI_VALUE2(float, "tank threat", "current target");

                float newThreat = currentThreat + deltaThreat * 5.0f; //No agro in 5 seconds.

                if (newThreat < tankThreat)
                    return false;
            }
        }

        return true;
    }

    return false;
}

bool MediumThreatTrigger::IsActive()
{
    if (AI_VALUE2(uint8, "threat", "current target") >= 60)
        return true;

    return false;
}

bool SomeThreatTrigger::IsActive()
{
    if (AI_VALUE2(uint8, "threat", "current target") >= 25)
        return true;

    return false;
}

bool NoThreatTrigger::IsActive()
{
    if (SomeThreatTrigger::IsActive())
        return false;

    return true;
}

bool AoeTrigger::IsActive()
{
    std::list<ObjectGuid> aoeEnemies = AoeCountValue::FindMaxDensity(bot, range);
    return aoeEnemies.size() >= amount;
}

bool DebuffTrigger::IsActive()
{
    Unit* target = GetTarget();
    if(target && target->IsAlive())
    {
        if (!ai->HasAura(spell, target, false, checkIsOwner))
        {
            return !HasMaxDebuffs();
        }
    }

    return false;
}

bool DebuffTrigger::HasMaxDebuffs()
{
#ifdef MANGOSBOT_TWO
    return false;
#else
    Unit* target = GetTarget();
    if(target)
    {
#ifdef MANGOSBOT_ONE
        constexpr uint32 debuffLimit = 40;
#else
        constexpr uint32 debuffLimit = 16;
#endif

        return ai->GetAuras(target, false, false).size() >= debuffLimit;
    }
#endif

    return false;
}

bool SpellTrigger::IsActive()
{
	return GetTarget();
}

// A spell the bot has not learned can never be cast, so a trigger firing on it only queues an
// action that reports IMPOSSIBLE and is queued again on the next tick. Over the eight hour run
// of 2026-09-09 that was 544129 impossible actions, led by "mortal strike", "sunder armor" and
// "demoralizing shout" - warrior abilities that no bot below level 10 has.
//
// The gate sits in Check() rather than IsActive() because most of these triggers override
// IsActive(): every class trigger built on BUFF_TRIGGER_A, DEBUFF_TRIGGER_A and their siblings
// does, and an override skips a gate placed in the base IsActive(). Check() is the one entry
// point Engine::ProcessTriggers goes through.
//
// Only names that resolve to a real spell are gated. Several triggers are named for a family
// rather than a spell - "seal", "blessing", "any mage armor" - and those resolve to no spell id
// at all, so asking whether the bot knows them would always say no and would silence the trigger
// for every paladin and mage. Cooldowns and resource costs are not checked here either; they
// clear by themselves.
Event SpellTrigger::Check()
{
	// An externally forced event is delivered whatever the spellbook says.
	if (!IsAlreadyTriggered() && !BotKnowsSpell())
		return Event();

	return Trigger::Check();
}

bool SpellTrigger::BotKnowsSpell()
{
	// HasSpell reads a cached value and is tested first because SpellIds returns its vector
	// by value.
	if (ai->HasSpell(spell))
		return true;

	if (spellNameIsReal < 0)
		spellNameIsReal = chat->SpellIds(spell).empty() ? 0 : 1;

	return spellNameIsReal == 0;
}

bool SpellCanBeCastedTrigger::IsActive()
{
	Unit* target = GetTarget();
	// Ignore range/LOS here so this only gates on real cast-blockers (cooldown, mana,
	// proc/aura-state requirements). The action's own "reach spell" prerequisite is what
	// handles closing distance - if range were checked here too, the trigger would never
	// fire while out of range, so the reach step it depends on would never get a chance to run.
	return target && ai->CanCastSpell(spell, target, true, nullptr, true);
}

bool SpellNoCooldownTrigger::IsActive()
{
    uint32 spellId = AI_VALUE2(uint32, "spell id", name);
    if (!spellId)
        return false;

    return bot->IsSpellReady(sSpellMgr.GetSpellEntry(spellId));
}

bool RandomTrigger::IsActive()
{
    if (time(0) - lastCheck < sPlayerbotAIConfig.repeatDelay / 1000)
        return false;

    lastCheck = time(0);
    int k = (int)(probability / sPlayerbotAIConfig.randomChangeMultiplier);
    if (k < 1) k = 1;
    return (rand() % k) == 0;
}

bool AndTrigger::IsActive()
{
    std::vector<std::string> tnames = getMultiQualifiers(getQualifier(), ",");

    for (auto tname : tnames)
    {
        Trigger* trigger1 = ai->GetAiObjectContext()->GetTrigger(tname);
        if (!trigger1 || !trigger1->IsActive())
            return false;
    }

    return true;
}

std::string AndTrigger::getName()
{
    std::string name;
    std::vector<std::string> tnames = getMultiQualifiers(getQualifier(), ",");

    for (auto tname : tnames)
    {
        if (!name.empty())
            name += " and ";
        name += tname;
    }

    return name;
}

bool OrTrigger::IsActive()
{
    std::vector<std::string> tnames = getMultiQualifiers(getQualifier(), ",");

    for (auto tname : tnames)
    {
        Trigger* trigger1 = ai->GetAiObjectContext()->GetTrigger(tname);
        if (trigger1 && trigger1->IsActive())
            return true;
    }

    return false;
}

std::string OrTrigger::getName()
{
    std::string name;
    std::vector<std::string> tnames = getMultiQualifiers(getQualifier(), ",");

    for (auto tname : tnames)
    {
        if (!name.empty())
            name += " or ";
        name += tname;
    }

    return name;
}

bool TwoTriggers::IsActive()
{
    if (name1.empty() || name2.empty())
        return false;

    Trigger* trigger1 = ai->GetAiObjectContext()->GetTrigger(name1);
    Trigger* trigger2 = ai->GetAiObjectContext()->GetTrigger(name2);

    if (!trigger1 || !trigger2)
        return false;

    return trigger1->IsActive() && trigger2->IsActive();
}

std::string TwoTriggers::getName()
{
    std::string name;
    name = name1 + " and " + name2;
    return name;
}

bool BoostTrigger::IsActive()
{
    if (ai->IsStateActive(BotState::BOT_STATE_COMBAT) && BuffTrigger::IsActive())
    {
        if (!ai->HasRealPlayerMaster())
        {
            return AI_VALUE(uint8, "balance") <= balance;
        }
        else
        {
            return true;
        }
    }

    return false;
}

bool ItemCountTrigger::IsActive()
{
	return AI_VALUE2(uint32, "item count", item) < uint32(count);
}

bool InterruptSpellTrigger::IsActive()
{
	return SpellTrigger::IsActive() && ai->IsInterruptableSpellCasting(GetTarget(), getName());
}

bool DeflectSpellTrigger::IsActive()
{
    Unit* target = GetTarget();
    if (!target)
        return false;

    if (!target->IsNonMeleeSpellCasted(true))
        return false;

    // Was written "!target->GetTargetGuid() == bot->GetObjectGuid()", which negates the guid
    // first and then compares a bool against it, so the test never fired and the bot would
    // deflect a cast aimed at somebody else.
    if (target->GetTargetGuid() != bot->GetObjectGuid())
        return false;

    uint32 spellid = context->GetValue<uint32>("spell id", spell)->Get();
    if (!spellid)
        return false;

    SpellEntry const *deflectSpell = sServerFacade.LookupSpellInfo(spellid);
    if (!deflectSpell)
        return false;

    // warrior deflects all
    if (spell == "spell reflection")
        return true;

    // human priest feedback
    if (spell == "feedback")
        return true;

    SpellSchoolMask deflectSchool = SpellSchoolMask(deflectSpell->EffectMiscValue[0]);
    SpellSchoolMask attackSchool = SPELL_SCHOOL_MASK_NONE;

    Spell* spell = target->GetCurrentSpell(CURRENT_GENERIC_SPELL);
    if (spell)
    {
        SpellEntry const* tarSpellInfo = spell->m_spellInfo;
        if (tarSpellInfo)
        {
            attackSchool = GetSpellSchoolMask(tarSpellInfo);
            if (deflectSchool == attackSchool)
                return true;
        }
    }
    return false;
}

bool HasAuraTrigger::IsActive()
{
   if (!name.empty())
	{
      return ai->HasAura(name, GetTarget(), false, false, -1, false, 0, auraTypeId);
   }

   std::string str = getQualifier();
   std::regex pattern(R"(spellid::(\d+)::([^:]*)::(\d+))");
   std::smatch match;

   if (std::regex_search(str, match, pattern) && match.size() == 4)
   {
      uint32 spell_id = atoi(match[1].str().c_str());

      if (Aura* aura = ai->GetAura(spell_id, GetTarget()))
      {
         uint32 count = atoi(match[3].str().c_str());
         uint32 stack_size = aura->GetStackAmount();
         std::string comp_symb = match[2].str();

         if (comp_symb == "equal")
         {
            return stack_size == count;
         }
         else if (comp_symb == "greater or equal")
         {
            return stack_size >= count;
         }
         else if (comp_symb == "lesser or equal")
         {
            return stack_size <= count;
         }
         else if (comp_symb == "greater")
         {
            return stack_size > count;
         }
         else if (comp_symb == "lesser")
         {
            return stack_size < count;
         }
         else
         {
            return false;
         }
      }
   };

   pattern = R"(spellid::(\d+))";

   if (std::regex_search(str, match, pattern) && match.size() == 2)
   {

      uint32 spell_id = atoi(match[1].str().c_str());
      return ai->HasAura(spell_id, GetTarget());
   }

   return false;
}

std::string HasAuraTrigger::getName()
{
   if (!name.empty())
   {
      return name;
   }

   std::ostringstream ss;
   ss << "has aura with " << getQualifier();
   return ss.str();
}


bool HasNoAuraTrigger::IsActive()
{
    return !ai->HasAura(getName(), GetTarget());
}

bool TankAssistTrigger::IsActive()
{
    if (!AI_VALUE(bool, "has attackers"))
        return false;

    Unit* currentTarget = AI_VALUE(Unit*, "current target");
    if (!currentTarget)
        return true;

    // do not switch if enemy target
    Unit* enemy = AI_VALUE(Unit*, "enemy player target");
    if (enemy)
    {
        return currentTarget != enemy;
    }

    Unit* tankTarget = AI_VALUE(Unit*, "tank target");
    if (!tankTarget || currentTarget == tankTarget)
        return false;
#ifdef CMANGOS
    return tankTarget->GetVictim() != AI_VALUE(Unit*, "self target");
#endif
#ifdef MANGOS
    return tankTarget->getVictim() != AI_VALUE(Unit*, "self target");
#endif
}

bool IsBehindTargetTrigger::IsActive()
{
    Unit* target = AI_VALUE(Unit*, "current target");
    return target && AI_VALUE2(bool, "behind", "current target");
}

bool IsNotBehindTargetTrigger::IsActive()
{
    Unit* target = AI_VALUE(Unit*, "current target");
    return target && !AI_VALUE2(bool, "behind", "current target");
}

bool IsNotFacingTargetTrigger::IsActive()
{
    return !AI_VALUE2(bool, "facing", "current target");
}

bool HasCcTargetTrigger::IsActive()
{
    uint32 spellid = AI_VALUE2(uint32, "spell id", getName());
    if (spellid && sServerFacade.IsSpellReady(bot, spellid))
    {
        return AI_VALUE2(Unit*, "cc target", getName()) && !AI_VALUE2(Unit*, "current cc target", getName());
    }

    return false;
}

bool NoMovementTrigger::IsActive()
{
	return !AI_VALUE2(bool, "moving", "self target");
}

bool NoPossibleTargetsTrigger::IsActive()
{
    std::list<ObjectGuid> targets = AI_VALUE(std::list<ObjectGuid>, "possible targets");
    return !targets.size();
}

bool PossibleAddsTrigger::IsActive()
{
    return AI_VALUE(bool, "possible adds") && !AI_VALUE(ObjectGuid, "attack target");
}

bool NotDpsTargetActiveTrigger::IsActive()
{
    Unit* target = AI_VALUE(Unit*, "current target");

    // Holding no target at all used to answer false here, which left the combat engine
    // with nothing that could pick one: "select new target" only ever clears the target,
    // and "dps assist" behind this trigger is the one action that sets it. A bot whose
    // target died or was cleared therefore stood still and took hits until the stuck
    // trigger reset it five minutes later - 12 of the 40 bots sampled during the
    // 2026-09-14 freeze were in exactly that state, the core reporting a live fight and a
    // live attacker while the bot held neither target nor victim, and "dps assist" ran
    // 258 times in 22 hours against 119819 runs of "select new target". TankAssistTrigger
    // has always answered true for the empty case; the dps side never did, and almost
    // every bot is dps.
    if (!target)
        return AI_VALUE(Unit*, "dps target") != nullptr;

    if (target->IsPlayer())
    {
        return false;
    }

    if (sServerFacade.IsAlive(target))
    {
        // do not switch if enemy target
        Unit* enemy = AI_VALUE(Unit*, "enemy player target");
        if (enemy)
        {
            return target != enemy;
        }

        Unit* dps = AI_VALUE(Unit*, "dps target");
        if (dps)
        {
            return target != dps;
        }
    }

    return false;
}

bool NotDpsAoeTargetActiveTrigger::IsActive()
{
    Unit* target = AI_VALUE(Unit*, "current target");
    if (target)
    {
        if (target->IsPlayer())
        {
            return false;
        }

        if (sServerFacade.IsAlive(target))
        {
            // do not switch if enemy target
            Unit* enemy = AI_VALUE(Unit*, "enemy player target");
            if (enemy)
            {
                return target != enemy;
            }

            Unit* dps = AI_VALUE(Unit*, "dps aoe target");
            if (dps)
            {
                return target != dps;
            }
        }
    }

    return false;
}

bool IsSwimmingTrigger::IsActive()
{
    return AI_VALUE2(bool, "swimming", "self target");
}

bool HasNearestAddsTrigger::IsActive()
{
    std::list<ObjectGuid> targets = AI_VALUE(std::list<ObjectGuid>, "nearest adds");
    return targets.size();
}

bool HasItemForSpellTrigger::IsActive()
{
    std::string spell = getName();
    uint32 spellId = AI_VALUE2(uint32, "spell id", spell);
    return spellId && AI_VALUE2(Item*, "item for spell", spellId);
}


bool TargetChangedTrigger::IsActive()
{
    Unit* oldTarget = context->GetValue<Unit*>("old target")->Get();
    Unit* target = context->GetValue<Unit*>("current target")->Get();
    return target && oldTarget != target;
}

Value<Unit*>* InterruptEnemyHealerTrigger::GetTargetValue()
{
    return context->GetValue<Unit*>("enemy healer target", spell);
}

Value<Unit*>* SnareTargetTrigger::GetTargetValue()
{
    return context->GetValue<Unit*>("snare target", spell);
}

bool StayTimeTrigger::IsActive()
{
    time_t stayTime = AI_VALUE(time_t, "stay time");
    time_t now = time(0);
    return delay && stayTime && now > stayTime + 2 * delay / 1000;
}

bool IsMountedTrigger::IsActive()
{
    return AI_VALUE2(bool, "mounted", "self target");
}

bool CorpseNearTrigger::IsActive()
{
    return bot->GetCorpse() && bot->GetCorpse()->IsWithinDistInMap(bot, CORPSE_RECLAIM_RADIUS, true);
}

bool IsFallingTrigger::IsActive()
{
#ifndef MANGOSBOT_TWO
    return bot->HasMovementFlag(MOVEFLAG_JUMPING);
#else
    return bot->HasMovementFlag(MOVEFLAG_FALLING);
#endif
}

bool IsFallingFarTrigger::IsActive()
{
    return bot->HasMovementFlag(MOVEFLAG_FALLINGFAR);
}

bool HasAreaDebuffTrigger::IsActive()
{
    return AI_VALUE2(bool, "has area debuff", "self target");
}

GameObject* InEnvironmentalHazardTrigger::FindDamagingTrap(Player* bot, float x, float y, float z, float& reach)
{
    std::list<GameObject*> objects;
    AnyGameObjectInObjectRangeCheck check(bot, 15.0f);
    MaNGOS::GameObjectListSearcher<AnyGameObjectInObjectRangeCheck> searcher(objects, check);
    Cell::VisitAllObjects(bot, searcher, 15.0f);

    for (GameObject* go : objects)
    {
        // A trap someone placed is a player's or a creature's to spring; world traps such as
        // campfires burn everyone who stands in them.
        if (go->GetGoType() != GAMEOBJECT_TYPE_TRAP || go->GetOwnerGuid())
            continue;

        // A trap with a faction only hurts that faction's enemies; a wild one (no faction) hurts
        // everyone. Alterac Valley's 175 landmines are Frostwolf and Stormpike traps, and
        // counting them for their own side held bots in place for hours: one Horde bot stood
        // beside a Frostwolf mine for seven hours of a 33 hour run, the hazard reaction
        // refusing every way out.
        if (!go->IsHostileTo(bot))
            continue;

        GameObjectInfo const* info = go->GetGOInfo();
        SpellEntry const* spell = sServerFacade.LookupSpellInfo(info->trap.spellId);
        if (!spell)
            continue;

        bool damaging = false;
        for (int i = 0; i < MAX_EFFECT_INDEX; ++i)
            damaging |= spell->Effect[i] == SPELL_EFFECT_ENVIRONMENTAL_DAMAGE || spell->Effect[i] == SPELL_EFFECT_SCHOOL_DAMAGE;

        if (!damaging)
            continue;

        // What matters is the radius that springs the trap, the one GameObject::Update searches,
        // not the radius of the spell it casts: the landmine's blast reaches 15 yards, but it
        // only goes off for a player within 4. A trap without a radius springs at 3 yards when
        // its cooldown field is 3 (battleground traps) and is never sprung by walking into it
        // otherwise.
        float trapReach = float(info->trap.radius);
        if (!trapReach)
        {
            if (info->trap.cooldown != 3)
                continue;

            trapReach = 3.0f;
        }

        // The core springs the trap on a player whose edge is within the radius of the trap's
        // edge (GameObject::Update, AnyPlayerInObjectRangeCheck), and GetDistance already takes
        // off the trap's own size, so add the bot's and half a yard for one update of walking.
        // A flat yard and a half overshot that by about a yard. The reaction stopped bots 880
        // thousand times in a 36 hour run, most of them at campfires, and in 307 of 318 sampled
        // campfire stops the bot's edge was 2 yards or more from the fire's, where nothing burns.
        trapReach += bot->GetObjectBoundingRadius() + 0.5f;
        if (go->GetDistance(x, y, z) < trapReach)
        {
            reach = trapReach;
            return go;
        }
    }

    return nullptr;
}

bool InEnvironmentalHazardTrigger::IsHazardousLiquid(Player* bot, float x, float y, float z)
{
    // Magma only. This core never damages a player standing in slime - the environmental
    // mirror timer burns IsInMagma() and nothing else - so slime is no hazard, and counting
    // it made the Undercity canals one: the reaction stopped every bot walking through them,
    // 4.1 million times in a 25 hour run.
    GridMapLiquidData liquid;
    GridMapLiquidStatus status = bot->GetMap()->GetTerrain()->getLiquidStatus(x, y, z + 0.01f, MAP_LIQUID_TYPE_MAGMA, &liquid);
    return status & (LIQUID_MAP_UNDER_WATER | LIQUID_MAP_IN_WATER | LIQUID_MAP_WATER_WALK);
}

bool InEnvironmentalHazardTrigger::IsActive()
{
    if (!bot->IsAlive() || bot->GetTransport() || bot->IsTaxiFlying() || bot->IsBeingTeleported())
    {
        highSeaSince = 0;
        return false;
    }

    // Deep water starts the fatigue timer, and a minute later the bot dies. Bots ended up there
    // stepping off ships under way or walking the sea floor towards an unreachable point, and
    // then sank: 25 fatigue deaths in an 18 hour run, at z -131 to -500 in the straits between
    // Teldrassil and Darkshore, off Theramore and off Durotar. A short swim across a deep
    // channel is fine, so only a bot still out there after 20 seconds counts.
    if (bot->IsInHighSea() && !ai->HasRealPlayerMaster())
    {
        time_t const now = time(nullptr);
        if (!highSeaSince)
            highSeaSince = now;

        if (now - highSeaSince >= 20)
            return true;
    }
    else
        highSeaSince = 0;

    float reach;
    return IsHazardousLiquid(bot, bot->GetPositionX(), bot->GetPositionY(), bot->GetPositionZ()) ||
        FindDamagingTrap(bot, bot->GetPositionX(), bot->GetPositionY(), bot->GetPositionZ(), reach);
}

bool ReturnToStayPositionTrigger::IsActive()
{
    PositionEntry stayPosition = AI_VALUE(PositionMap&, "position")["stay"];
    if (stayPosition.isSet())
    {
        const float distance = bot->GetDistance(stayPosition.x, stayPosition.y, stayPosition.z);
        return distance > ai->GetRange("follow");
    }

    return false;
}

bool ReturnToPullPositionTrigger::IsActive()
{
    PositionEntry pullPosition = AI_VALUE(PositionMap&, "position")["pull"];
    if (pullPosition.isSet())
    {
        const float distance = bot->GetDistance(pullPosition.x, pullPosition.y, pullPosition.z);
        return distance > ai->GetRange("follow");
    }

    return false;
}

bool NoBuffAndComboPointsAvailableTrigger::IsActive()
{
    if (BuffTrigger::IsActive())
    {
        return AI_VALUE2(uint8, "combo", GetComboPointsTargetName()) >= comboPoints;
    }

    return false;
}

bool InPvpTrigger::IsActive()
{
    return ai->IsInPvp();
}

bool InPveTrigger::IsActive()
{
    return ai->IsInPve();
}

bool InRaidFightTrigger::IsActive()
{
    return ai->IsInRaid();
}

bool GreaterBuffOnPartyTrigger::IsActive()
{
    Unit* target = GetTarget();
    return target && bot->IsInGroup(target) && BuffOnPartyTrigger::IsActive() && !ai->HasAura(lowerSpell, target, false, checkIsOwner);
}

bool TargetOfAttacker::IsActive()
{
    return !AI_VALUE(std::list<ObjectGuid>, "attackers targeting me").empty();
}

bool TargetOfAttackerInRange::IsActive()
{
    const Unit* closestAttacker = AI_VALUE(Unit*, "closest attacker targeting me");
    return closestAttacker && bot->GetDistance(closestAttacker, DIST_CALC_COMBAT_REACH) <= (distance - sPlayerbotAIConfig.contactDistance);
}

bool TargetOfCastedAuraTypeTrigger::IsActive()
{
    const std::list<ObjectGuid>& attackers = AI_VALUE(std::list<ObjectGuid>, "attackers");
    for (const ObjectGuid& attackerGuid : attackers)
    {
        // Check against the given creature id
        Unit* attacker = ai->GetUnit(attackerGuid);
        if (attacker)
        {
            const Spell* auraTypeSpell = nullptr;
            const Spell* genericSpell = attacker->GetCurrentSpell(CurrentSpellTypes::CURRENT_GENERIC_SPELL);
            if (genericSpell)
            {
                const SpellEntry* spellInfo = genericSpell->m_spellInfo;
                if (spellInfo)
                {
                    for (int32 i = SpellEffectIndex::EFFECT_INDEX_0; i <= SpellEffectIndex::EFFECT_INDEX_2; i++)
                    {
                        if ((spellInfo->Effect[i] == SPELL_EFFECT_APPLY_AURA) && (spellInfo->EffectApplyAuraName[i] == auraType))
                        {
                            auraTypeSpell = genericSpell;
                            break;
                        }
                    }
                }
            }

            if (!auraTypeSpell)
            {
                const Spell* channeledSpell = attacker->GetCurrentSpell(CurrentSpellTypes::CURRENT_CHANNELED_SPELL);
                if (channeledSpell)
                {
                    const SpellEntry* spellInfo = channeledSpell->m_spellInfo;
                    if (spellInfo)
                    {
                        for (int32 i = SpellEffectIndex::EFFECT_INDEX_0; i <= SpellEffectIndex::EFFECT_INDEX_2; i++)
                        {
                            if ((spellInfo->Effect[i] == SPELL_EFFECT_APPLY_AURA) && (spellInfo->EffectApplyAuraName[i] == auraType))
                            {
                                auraTypeSpell = channeledSpell;
                                break;
                            }
                        }
                    }
                }
            }

            if (auraTypeSpell)
            {
                Unit* spellTarget = auraTypeSpell->m_targets.getUnitTarget();
                if (spellTarget == bot)
                {
                    return true;
                }
            }
        }
    }

    return false;
}

bool BuffOnTargetTrigger::IsActive()
{
    const Unit* target = GetTarget();
    return target && target->HasAura(buffID);
}

bool DispelOnTargetTrigger::IsActive()
{
    Unit* target = GetTarget();
    if (target)
    {
        const uint32 dispelMask = GetDispellMask(dispelType);
        const std::vector<Aura*> auras = ai->GetAuras(target);
        for (const Aura* aura : auras)
        {
            const SpellEntry* spellInfo = aura->GetSpellProto();
            if (spellInfo && ((1 << spellInfo->Dispel) & dispelMask))
            {
                return true;
            }
        }
    }

    return false;
}

bool RtscJumpTrigger::IsActive()
{
    return AI_VALUE2(WorldPosition, "RTSC saved location", "jump point") && AI_VALUE2(WorldPosition, "RTSC saved location", "jump");
}

bool SpellTargetTrigger::IsActive()
{
    if (IsSpellReady())
    {
        // Check for assigned targets
        const std::list<ObjectGuid>& possibleTargets = AI_VALUE(std::list<ObjectGuid>, targetsValue);
        if (!possibleTargets.empty())
        {
            for (const ObjectGuid& possibleTargetGuid : possibleTargets)
            {
                if (IsTargetValid(ai->GetUnit(possibleTargetGuid)))
                {
                    return true;
                }
            }
        }
        else
        {
            // Check for the default target
            if (IsTargetValid(GetTarget()))
            {
                return true;
            }
        }
    }

    return false;
}

bool SpellTargetTrigger::IsTargetValid(Unit* target)
{
    return target &&
           ai->IsSafe(target) &&
           (bot == target || sServerFacade.GetDistance2d(bot, target) < sPlayerbotAIConfig.sightDistance) &&
           (bot->IsInGroup(target)) &&
           (!aliveCheck || !target->IsDead()) &&
           (!auraCheck || !ai->HasAura(spell, target));
}

bool SpellTargetTrigger::IsSpellReady()
{
    uint32 spellId = AI_VALUE2(uint32, "spell id", spell);
    return spellId && bot->IsSpellReady(sSpellMgr.GetSpellEntry(spellId));
}

bool ItemTargetTrigger::IsTargetValid(Unit* target)
{
    if (SpellTargetTrigger::IsTargetValid(target))
    {
        if (itemAuraCheck)
        {
            const uint32 itemId = GetItemId();
            const ItemPrototype* proto = sObjectMgr.GetItemPrototype(itemId);
            if (proto)
            {
                for (uint8 i = 0; i < MAX_ITEM_PROTO_SPELLS; ++i)
                {
#ifdef MANGOSBOT_ZERO
                    if (proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_USE || proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_NO_DELAY_USE)
#else
                    if (proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_USE)
#endif
                    {
                        if (proto->Spells[i].SpellId > 0 && ai->HasAura(proto->Spells[i].SpellId, target))
                        {
                            return false;
                        }
                    }
                }

                return true;
            }
        }
        else
        {
            return true;
        }
    }

    return false;
}

bool ItemTargetTrigger::IsSpellReady()
{
    const uint32 itemId = GetItemId();
    if (!ai->HasCheat(BotCheatMask::item) && !bot->HasItemCount(itemId, 1))
        return false;

    const ItemPrototype* proto = sObjectMgr.GetItemPrototype(itemId);
    if (proto)
    {
        for (uint8 i = 0; i < MAX_ITEM_PROTO_SPELLS; ++i)
        {
#ifdef MANGOSBOT_ZERO
            if (proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_USE || proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_NO_DELAY_USE)
#else
            if (proto->Spells[i].SpellTrigger == ITEM_SPELLTRIGGER_ON_USE)
#endif
            {
                if (proto->Spells[i].SpellId > 0)
                {
                    if (!sServerFacade.IsSpellReady(bot, proto->Spells[i].SpellId) ||
                        !sServerFacade.IsSpellReady(bot, proto->Spells[i].SpellId, itemId))
                    {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    return false;
}

bool AtWarTrigger::IsActive()
{
    ReputationMgr& mgr = bot->GetReputationMgr();

#ifndef MANGOSBOT_ONE
    for (uint32 id = 0; id < sFactionStore.GetNumRows(); ++id)
#else
    for (uint32 id = 0; id < sFactionStore.GetMaxEntry(); ++id)
#endif
    {
#ifndef MANGOSBOT_ONE
        const FactionEntry* factionEntry = sFactionStore.LookupEntry(id);
#else
        const FactionEntry* factionEntry = sFactionStore.LookupEntry<FactionEntry>(id);
#endif

        if (!factionEntry)
            continue;

        FactionState const* repState = mgr.GetState(factionEntry);

        if (!repState)
            continue;

        if (!(repState->Flags & FACTION_FLAG_VISIBLE))
            continue;

        if (repState->Flags & FACTION_FLAG_HIDDEN)
            continue;

        if (repState->Flags & FACTION_FLAG_INVISIBLE_FORCED)
            continue;

        if (repState->Flags & FACTION_FLAG_PEACE_FORCED)
            continue;

        if (!(repState->Flags & FACTION_FLAG_AT_WAR))
            continue;

        if (mgr.GetRank(factionEntry) < REP_HOSTILE)
            continue;

        return true;
    }

    return false;
}