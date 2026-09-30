
#include "playerbot/playerbot.h"
#include "AttackersValue.h"
#include "PossibleTargetsValue.h"
#include "EnemyPlayerValue.h"
#include "TargetValue.h"
#include "playerbot/strategy/generic/PullStrategy.h"

#ifdef _WIN32
#include <excpt.h>
#include "CrashDump.h"
#include "Errors.h"
#endif

using namespace ai;
using namespace MaNGOS;

#ifdef _WIN32
namespace
{
    // 0xC0000005, spelled out so this file does not have to pull in windows.h.
    unsigned long const kAccessViolation = 0xC0000005;

    // A stale unit is stale for every bot that can see it, on every tick, so an
    // uncapped handler would fill the disk before anyone read the first line.
    unsigned int const kMaxReports = 3;
    unsigned int g_reportCount = 0;

    int ReportStaleAttackerFault(unsigned long code, void* exceptionPointers, Player* player)
    {
        if (code != kAccessViolation)
            return EXCEPTION_CONTINUE_SEARCH; // not ours - let it reach the process filter

        ++g_reportCount;

        if (g_reportCount > kMaxReports)
        {
            sLog.outError("AttackersValue: attacker list holds a stale unit again (occurrence %u), bot %s",
                g_reportCount, player ? player->GetName() : "<null>");
            return EXCEPTION_EXECUTE_HANDLER;
        }

        if (player)
        {
            sLog.outError("AttackersValue: access violation reading an attacker of %s "
                          "(guid %u, map %u, zone %u, at %.2f %.2f %.2f)",
                player->GetName(), player->GetGUIDLow(),
                player->GetMapId(), player->GetZoneId(),
                player->GetPositionX(), player->GetPositionY(), player->GetPositionZ());
        }
        else
            sLog.outError("AttackersValue: access violation reading an attacker of a null player");

        // Runs before the stack unwinds, so this is the faulting trace and not
        // the handler's own.
        MaNGOS::Errors::PrintStacktrace(0, 64);

        if (char const* dumpPath = MaNGOS::CrashDump::Write(exceptionPointers))
            sLog.outError("AttackersValue: crash dump written to %s", dumpPath);

        return EXCEPTION_EXECUTE_HANDLER;
    }

    // Needs a frame of its own: MSVC rejects __try in a function that has objects
    // to unwind, and the read itself is the only thing here that can fault.
    bool ReadGuidGuarded(Unit* unit, Player* owner, ObjectGuid& guid)
    {
        __try
        {
            guid = unit->GetObjectGuid();
            return true;
        }
        __except (ReportStaleAttackerFault(GetExceptionCode(), GetExceptionInformation(), owner))
        {
            return false;
        }
    }
}
#endif

// Turns a raw unit pointer taken from core bookkeeping into one the object
// accessor still knows about, or into nothing.
//
// Every other unit this value collects arrives as a guid and is resolved through
// the accessor, so it cannot outlive the object it names. The attacker sets and
// the duel opponent are raw pointers instead, and a unit freed while it was still
// listed leaves one behind. The crash then lands wherever that pointer is next
// dereferenced - a bot died reading a freed threat list inside ThreatManager,
// with nothing in the trace to say who left the pointer there. Reading the guid
// back and asking the map for it turns a stale entry into a skipped target: a
// freed object is no longer in the store, so the lookup fails whether its memory
// now reads as garbage or still holds the old guid.
Unit* AttackersValue::ResolveLiveUnit(Unit* unit)
{
    if (!unit)
        return nullptr;

    ObjectGuid guid;

#ifdef _WIN32
    if (!ReadGuidGuarded(unit, bot, guid))
        return nullptr;
#else
    guid = unit->GetObjectGuid();
#endif

    // A guid that does not even name a unit cannot have come off a live one, so
    // this entry is reading freed memory that has already been handed out again.
    // Worth a line, because unlike the fault above it costs nothing to survive
    // and would otherwise be skipped in silence - and it says which bot's list
    // the entry was in, which is the part the crash never said.
    if (!guid.IsUnit())
    {
        static unsigned int reported = 0;
        if (reported < 10)
        {
            ++reported;
            sLog.outError("AttackersValue: attacker list of %s holds an entry that is not a unit any more (raw guid " UI64FMTD ")",
                bot ? bot->GetName() : "<null>", guid.GetRawValue());
        }

        return nullptr;
    }

    return ai->GetUnit(guid);
}

std::list<ObjectGuid> AttackersValue::Calculate()
{
    std::list<ObjectGuid> result;
    if (!ai->AllowActivity(ALL_ACTIVITY))
        return result;

    if (!bot->IsInWorld())
        return result;

    if (bot->IsBeingTeleported())
        return result;

    if (bot->IsFlying() && WorldPosition(bot).currentHeight() > 10.0f)
        return result;

    // lost control, e.g. BG ended
    if (bot->HasFlag(UNIT_FIELD_FLAGS, UNIT_FLAG_CLIENT_CONTROL_LOST))
        return result;

    if (ai->HasStrategy("focus rti targets", BotState::BOT_STATE_COMBAT))
    {
        Unit* rtiTarget = AI_VALUE(Unit*, "rti target");

        if (rtiTarget && rtiTarget->IsInWorld() && rtiTarget->GetMapId() == bot->GetMapId())
        {
            return { rtiTarget->GetObjectGuid() };
        }

        return result;
    }

    if (sPlayerbotAIConfig.shareTargets)
    {
        // Try to get the value from nearby friendly bots.
        std::list<ObjectGuid> nearGuids = ai->GetAiObjectContext()->GetValue<std::list<ObjectGuid> >("nearest friendly players")->Get();
        for (auto& i : nearGuids)
        {
            Player* player = sObjectMgr.GetPlayer(i);

            if (!player)
                continue;

            if (player == bot)
                continue;

            if (!ai->IsSafe(player))
                continue;

            if (sServerFacade.GetDistance2d(bot, player) > 10.0f)
                continue;

            PlayerbotAI* botAi = GetBotAI(player);

            if (!botAi)
                continue;

            std::string valueName = "attackers" + !qualifier.empty() ? "::" + qualifier : "";

            // Ignore bots without the value.
            if (!PHAS_AI_VALUE(valueName))
                continue;

            UntypedValue* pValue = botAi->GetAiObjectContext()->GetUntypedValue(valueName);

            AttackersValue* pAttackersValue = dynamic_cast<AttackersValue*>(pValue);

            if (!pAttackersValue)
                continue;

            // Ignore expired values.
            if (pAttackersValue->Expired())
                continue;

            if (pAttackersValue->calculatePos.sqDistance2d(bot) > 100.0f)
                continue;

            // Make the value expire at the same time as the copied value.
            lastCheckTime = pAttackersValue->lastCheckTime;

            calculatePos = pAttackersValue->calculatePos;

            result = PAI_VALUE(std::list<ObjectGuid>, valueName);

            std::vector<std::string> specificTargetNames = { "current target","old target","attack target","pull target" };
            Unit* target;

            //Remove bot specific targets of the other bot.
            for (auto& targetName : specificTargetNames)
            {
                target = (targetName == "attack target") ? ai->GetUnit(PAI_VALUE(ObjectGuid, targetName)) : PAI_VALUE(Unit*, targetName);
                if (target)
                    result.remove(target->GetObjectGuid());
            }

            //Add bot specific targets of this bot.
            for (auto& targetName : specificTargetNames)
            {
                target = (targetName == "attack target") ? ai->GetUnit(AI_VALUE(ObjectGuid, targetName)) : AI_VALUE(Unit*, targetName);
                if (target)
                    result.push_back(target->GetObjectGuid());
            }

            //Validate these targets.
            std::list<ObjectGuid> filter;

            for (auto& guid : result)
            {
                target = ai->GetUnit(guid);

                if (!IsValid(target, bot, bot))
                    filter.push_back(guid);
            }

            for(auto& guid : filter)
                result.remove(guid);

            return result;
        }
    }
    
    calculatePos = bot;

    std::set<Unit*> targets;

    // Check if we only need one attacker
    bool getOne = false;
    if (!qualifier.empty())
    {
        getOne = stoi(qualifier);
    }

    std::set<ObjectGuid> invalidTargets;

    // Add the targets of the bot
    AddTargetsOf(bot, targets, invalidTargets, getOne);

    // Don't check for group member targets if we only need one
    if (targets.empty() || !getOne)
    {
        // Add the targets of the members of the group
        Group* group = bot->GetGroup();
        if (group && !bot->InBattleGround())
        {
            AddTargetsOf(group, targets, invalidTargets, getOne);
        }

        Player* master = GetMaster();
        if (master && !bot->InBattleGround() && (!group || master->GetGroup() != group))
            AddTargetsOf(master, targets, invalidTargets, getOne);
    }

    // Convert the targets to guids
    for (Unit* target : targets)
    {
        result.push_back(target->GetObjectGuid());
    }

    return result;
}

void AttackersValue::AddTargetsOf(Group* group, std::set<Unit*>& targets, std::set<ObjectGuid>& invalidTargets, bool getOne)
{
    Group::MemberSlotList const& groupSlot = group->GetMemberSlots();
    for (Group::member_citerator itr = groupSlot.begin(); itr != groupSlot.end(); itr++)
    {
        // Only add group member targets that are alive and near the player
        Player* member = sObjectMgr.GetPlayer(itr->guid);
        if (member && (member != bot) &&
           sServerFacade.IsAlive(member) &&
           member->IsInWorld() &&
           !member->IsBeingTeleported() &&
           (member->GetMapId() == bot->GetMapId()) && 
           (sServerFacade.GetDistance2d(bot, member) <= GetRange()))
        {
            AddTargetsOf(member, targets, invalidTargets, getOne);

            // Finish early if we only need one target
            if (getOne && !targets.empty())
            {
                break;
            }
        }
    }
}

void AttackersValue::AddTargetsOf(Player* player, std::set<Unit*>& targets, std::set<ObjectGuid>& invalidTargets, bool getOne)
{
    // If the player is available
    if (ai->IsSafe(player))
    {
        std::set<Unit*> units;

        // If the player is a bot
        PlayerbotAI* playerBot = GetBotAI(player);
        if (playerBot)
        {
            // Get all the units around the player
            // NOTE: We don't validate the value here because it will be validated later on
            const std::string ignoreValidate = std::to_string(true);
            const std::string range = std::to_string((int32)GetRange());
            const std::vector<std::string> qualifiers = { range, ignoreValidate };
            const std::list<ObjectGuid> possibleTargets = PAI_VALUE2(std::list<ObjectGuid>, "possible targets", Qualified::MultiQualify(qualifiers, ":"));
            for (const ObjectGuid& guid : possibleTargets)
            {
                if (Unit* unit = ai->GetUnit(guid))
                {
                    units.insert(unit);
                }
            }

            // Add the current target
            Unit* currentTarget = PAI_VALUE(Unit*, "current target");
            if (currentTarget)
            {
                units.insert(currentTarget);
            }

            // Add the previous target
            Unit* oldTarget = PAI_VALUE(Unit*, "old target");
            if (oldTarget)
            {
                units.insert(oldTarget);
            }

            // Add the pull and attack targets (Only consider the owner bot)
            if (bot == player)
            {
                Unit* attackTarget = playerBot->GetUnit(PAI_VALUE(ObjectGuid, "attack target"));
                if (attackTarget)
                {
                    units.insert(attackTarget);
                }

                Unit* pullTarget = PAI_VALUE(Unit*, "pull target");
                if (pullTarget)
                {
                    units.insert(pullTarget);
                }
            }
        }

        // Get the current attackers of the player
        for (Unit* attacker : player->GetAttackers())
        {
            if (Unit* live = ResolveLiveUnit(attacker))
                units.insert(live);
        }

        // Add the duel opponent (Only consider the owner bot)
        if (bot == player && bot->m_duel && bot->m_duel->opponent)
        {
            // Penqle's DuelInfo::opponent is an ObjectGuid; resolve to Unit*.
            if (Unit* opp = ResolveLiveUnit(bot->m_duel->opponent))
                units.insert(opp);
        }

        // Add the pet attackers (if nearby)
        Pet* pet = player->GetPet();
        if (pet && sServerFacade.GetDistance2d(bot, pet) <= GetRange())
        {
            for (Unit* attacker : pet->GetAttackers())
            {
                if (Unit* live = ResolveLiveUnit(attacker))
                    units.insert(live);
            }
        }

        // Filter the units that are valid
        for (Unit* unit : units)
        {
            if (!ai->IsSafe(unit))
                continue;

            // Prevent checking a target that has already been validated
            if((targets.find(unit) == targets.end()))
            {
                // Prevent checking a target that has already been invalidated
                if(InCombat(unit, player) || (invalidTargets.find(unit->GetObjectGuid()) == invalidTargets.end()))
                {
                    if (IsValid(unit, player, bot))
                    {
                        // Add the target to the list of combat targets
                        targets.insert(unit);

                        // Add the target's pet/guardian too
                        unit->CallForAllControlledUnits(AddGuardiansHelper(targets), CONTROLLED_PET | CONTROLLED_GUARDIANS | CONTROLLED_CHARM | CONTROLLED_MINIPET | CONTROLLED_TOTEMS);

                        if (getOne)
                        {
                            break;
                        }
                    }
                    else
                    {
                        invalidTargets.insert(unit->GetObjectGuid());
                    }
                }
            }
        }
    }
}

// True while the bot's standing decision to attack something is recent enough to still
// mean anything. The guid comparison in the caller has already confirmed this is the
// decision being asked about, so this resolves the value at most once per bot per check.
bool AttackersValue::IsAttackDecisionFresh(Player* player)
{
    PlayerbotAI* botAi = GetBotAI(player);
    if (!botAi)
        return false;

    AttackTargetValue* attackTarget = dynamic_cast<AttackTargetValue*>(
        botAi->GetAiObjectContext()->GetUntypedValue("attack target"));

    // Nothing to age the decision against, so fall back on the old unconditional answer
    // rather than silently dropping a target the bot is genuinely about to engage.
    if (!attackTarget)
        return true;

    return (time(0) - attackTarget->DecidedOn()) <= PullStrategy::GetMaxPullTime();
}

bool AttackersValue::InCombat(Unit* target, Player* player, bool checkPullTargets)
{
    // Answer for a target already out of the world before anything reads its
    // threat list. Nothing off the world holds threat, so the answer does not
    // change, and a unit that has left the world is the one about to be freed.
    if (!target || !player || !target->IsInWorld())
        return false;

    // Check if the the target is attacking the player
    bool inCombat = (target->GetThreatManager().getThreat(player) > 0.0f) ||
                    (target->GetVictim() && (target->GetVictim() == player));

    // Check if the target is attacking the player's pet
    if(!inCombat)
    {
        Pet* pet = player->GetPet();
        if (pet)
        {
            inCombat = (target->GetThreatManager().getThreat(pet) > 0.0f) ||
                       (target->GetVictim() && (target->GetVictim() == pet));
        }
    }

    // A player keeps no threat list, and GetVictim is only set by melee auto-attack, so the
    // two tests above never see an enemy player who fights with spells or a bow. A mage or
    // hunter shooting a bot was therefore not an attacker: the bot stayed in the non-combat
    // engine and stood there, doing idle emotes, while it died. Two players are fighting
    // when both are in combat and either one has the other selected.
    if (!inCombat && target->GetTypeId() == TYPEID_PLAYER && target->IsInCombat() && player->IsInCombat())
    {
        inCombat = target->GetTargetGuid() == player->GetObjectGuid() ||
                   player->GetTargetGuid() == target->GetObjectGuid();
    }

    // A target the bot has merely decided to attack is not fighting it yet, and saying
    // otherwise without a time limit is what let one stale decision hold a bot in combat
    // state for hours. AttackAnythingAction sets "attack target" the moment it starts a
    // grind and nothing clears it while the mob stays in range, so a mob the bot never
    // reached kept this true, which kept "has attackers" true, which kept the bot in the
    // combat engine with nothing to fight - 28 of the 40 bots sampled during the
    // 2026-09-14 freeze were in exactly that state, the core reporting no combat, no
    // attackers and full health. Honour the decision only while it is still fresh, the
    // same window a pull gets, and let it lapse after that.
    if(!inCombat && checkPullTargets && GetBotAI(player))
    {
        if (PAI_VALUE(ObjectGuid, "attack target") == target->GetObjectGuid())
            inCombat = IsAttackDecisionFresh(player);
        else
            inCombat = (PAI_VALUE(Unit*, "pull target") == target);
    }

    return inCombat;
}

bool AttackersValue::IsValid(Unit* target, Player* player, Player* owner, bool checkInCombat, bool validatePossibleTarget)
{
    Player* playerToCheckAgainst = owner != nullptr ? owner : player;

    // Validate possible target
    if (validatePossibleTarget && !PossibleTargetsValue::IsValid(target, playerToCheckAgainst))
    {
        return false;
    }

    // This will be used on both enemy player and npc checks
    const bool inPvPProhibitedZone = sPlayerbotAIConfig.IsInPvpProhibitedZone(sServerFacade.GetAreaId(target));

    // If the target is a player
    Player* enemyPlayer = dynamic_cast<Player*>(target);
    if (enemyPlayer)
    {
        // Don't consider enemy players if pvp strategy is not set
        if (GetBotAI(playerToCheckAgainst) && !GetBotAI(playerToCheckAgainst)->HasStrategy("pvp", BotState::BOT_STATE_COMBAT))
        {
            return false;
        }

        // If the enemy player is in a PVP Prohibited zone
        if (inPvPProhibitedZone)
        {
            return false;
        }

        const bool isDuelOpponent = player->m_duel && player->m_duel->opponent == target;

        // Don't check distance on duel opponents
        if (!isDuelOpponent)
        {
            // If the enemy player is not within sight distance
            if (!enemyPlayer->IsWithinDist(playerToCheckAgainst, EnemyPlayerValue::GetMaxAttackDistance(playerToCheckAgainst), false))
            {
                return false;
            }
        }

        // Unlike the NPC branch below, this had no actual-combat check at all: a stale
        // "current target"/"old target" reference to a player who stopped fighting long ago
        // (or was never fighting to begin with) stayed "valid" forever just by being nearby
        // and PvP-flagged, keeping "has attackers" true and the bot latched into combat
        // state with nothing to do (see AttackersValue::AddTargetsOf and InCombat()).
        if (checkInCombat && !isDuelOpponent && !InCombat(target, player, (player == owner)))
        {
            bool isRtiTarget = false;
            if (GetBotAI(player) && !GetBotAI(player)->HasActivePlayerMaster())
            {
                Unit* rtiTarget = PAI_VALUE(Unit*, "rti target");
                if (target == rtiTarget)
                    isRtiTarget = true;
            }

            if (!isRtiTarget)
                return false;
        }
    }
    // If the target is a NPC
    else
    {
        // Some callers (GrindTargetValue::FindTargetForGrinding, PullRequestAction)
        // pass validatePossibleTarget=false to reuse this function purely for its
        // combat/evade checks, which skips the friendliness gate above entirely.
        // Re-check here so a friendly NPC referenced by a stale "current target"/
        // "attack target"/"pull target" (the same staleness this function already
        // guards against for players, above) is never treated as a valid attacker.
        if (sServerFacade.IsFriendlyTo(playerToCheckAgainst, target))
        {
            return false;
        }

        // If the target is not fighting the player (and if the owner bot is not pulling the target)
        if (checkInCombat && !InCombat(target, player, (player == owner)))
        {
            bool isRtiTarget = false;
            if (GetBotAI(player) && !GetBotAI(player)->HasActivePlayerMaster())
            {
                Unit* rtiTarget = PAI_VALUE(Unit*, "rti target");
                if (target == rtiTarget)
                    isRtiTarget = true;
            }

            if(!isRtiTarget)
                return false;
        }

        // If the target is a player's pet and in a PvP prohibited zone
        if (target->GetObjectGuid().IsPet() && inPvPProhibitedZone)
        {
            return false;
        }

        // If the target is evading
        const Creature* creature = dynamic_cast<Creature*>(target);
        if (creature)
        {
            if (creature->IsInEvadeMode())
            {
                return false;
            }
        }        
    }

    if (IgnoreTarget(target, playerToCheckAgainst))
        return false;

    return true;
}

bool AttackersValue::IgnoreTarget(Unit* target, Player* playerToCheckAgainst)
{
    if (!GetBotAI(playerToCheckAgainst))
        return false; 

    PlayerbotAI* ai = GetBotAI(playerToCheckAgainst);
    AiObjectContext* context = ai->GetAiObjectContext();

    //Ignore Hard hostiles while not already fighting.
    if (target->GetLevel() > (playerToCheckAgainst->GetLevel() + 5) && ai->GetState() == BotState::BOT_STATE_NON_COMBAT)
    {
        //When traveling a long distance.
        if (AI_VALUE(bool, "travel target traveling") && AI_VALUE2(float, "distance", "travel target") > sPlayerbotAIConfig.reactDistance)
            return true;

        //When moving to master far away.
        if ((ai->HasStrategy("follow", BotState::BOT_STATE_NON_COMBAT) ||
            ai->HasStrategy("wander", BotState::BOT_STATE_NON_COMBAT)) &&
            AI_VALUE2(bool, "trigger active", "out of react range"))
            return true;

        if (ai->GetMaster() && !ai->HasActivePlayerMaster())
        {
            Player* player = ai->GetMaster();

            //When master is traveling a long distance.
            if (PAI_VALUE(bool, "travel target traveling") && PAI_VALUE2(float, "distance", "travel target") > sPlayerbotAIConfig.reactDistance)
                return true;
        }
    }

    Player* enemyPlayer = dynamic_cast<Player*>(target);

    if (!enemyPlayer)
    {
        bool isDummy = false;


        // cmangos's AI knows whether a creature is a training dummy kept alive on purpose.
        // Nothing here tracks that, so no target is treated as a dummy.
        if (false)
        {

            isDummy = true;
        }

        uint32 entry = target->GetEntry();

#define TRAINING_DUMMY_NPC_ENTRY1 190013
#define TRAINING_DUMMY_NPC_ENTRY2 190014
#define TRAINING_DUMMY_NPC_ENTRY3 190015
#define THERAMORE_COMBAT_DUMMY 4952
#define NAXXRAMAS_COMBAT_DUMMY 16211
#ifdef MANGOSBOT_TWO
#define INITATES_TRAINING_DUMMY 32541
#endif
// This server's custom capital-city training dummies (custom_npc_training_dummy,
// sql/base/tw_world_creature_template.sql) - previously unrecognized here, which let
// bots latch onto them permanently since their 1,000,000 HP never dies.
#define HEROIC_TRAINING_DUMMY 50514
#define APPRENTICE_TRAINING_DUMMY 50515
#define EXPERT_TRAINING_DUMMY 50516

        switch (entry)
        {
        case TRAINING_DUMMY_NPC_ENTRY1:
        case TRAINING_DUMMY_NPC_ENTRY2:
        case TRAINING_DUMMY_NPC_ENTRY3:
        case THERAMORE_COMBAT_DUMMY:
        case NAXXRAMAS_COMBAT_DUMMY:
#ifdef MANGOSBOT_TWO
        case INITATES_TRAINING_DUMMY:
#endif
        case HEROIC_TRAINING_DUMMY:
        case APPRENTICE_TRAINING_DUMMY:
        case EXPERT_TRAINING_DUMMY:
            isDummy = true;
        }

        if (isDummy && ai->GetFixedBotNumber(BotTypeNumber::DUMMY_ATTACK_NUMBER, 10, 0.2f)) //90% of bots, cycle every 5 min.
            return true;
    }

    return false;
}

std::string AttackersValue::Format()
{
    std::ostringstream out;

    for (auto& target : value)
    {
        if(target != value.front())
        out << ",";

        WorldObject* wo = ai->GetWorldObject(target);

        if (wo)
            out << wo->GetName();
        else
            out << target;      
    }

    return out.str();
}

std::list<ObjectGuid> AttackersTargetingMeValue::Calculate()
{
    std::list<ObjectGuid> result;

    const std::list<ObjectGuid>& attackers = AI_VALUE(std::list<ObjectGuid>, "attackers");
    for (const ObjectGuid& attackerGuid : attackers)
    {
        Unit* attacker = ai->GetUnit(attackerGuid);
        if (attacker && (attacker->GetTarget() == bot || attacker->GetVictim() == bot))
        {
            result.push_back(attackerGuid);
        }
    }

    return result;
}
