
#include "playerbot/playerbot.h"
#include "DeadValues.h"
#include "playerbot/TravelMgr.h"

using namespace ai;

GuidPosition GraveyardValue::Calculate()
{
    WorldPosition refPosition = bot, botPos(bot);

    if (getQualifier() == "master")
    {
        if (ai->GetGroupMaster() && ai->IsSafe(ai->GetGroupMaster()) && ai->GetGroupMaster()->GetMapId() == bot->GetMapId())
        {
            refPosition = ai->GetGroupMaster();
        }
    }
    else if (getQualifier() == "travel")
    {
        auto travelTarget = AI_VALUE(TravelTarget*, "travel target");

        if (travelTarget && travelTarget->GetPosition() && travelTarget->GetPosition()->getMapId() == bot->GetMapId())
        {
            refPosition = *travelTarget->GetPosition();
        }
    }
    else if (getQualifier() == "another closest appropriate")
    {
        //just get ANOTHER nearest appropriate for level (neutral or same team zone)
        if (auto anotherAppropriate = GetAnotherAppropriateClosestGraveyard())
        {
            return GuidPosition(0, anotherAppropriate);
        }
    }

    WorldSafeLocsEntry const* ClosestGrave = sObjectMgr.GetClosestGraveYard(
        refPosition.getX(),
        refPosition.getY(),
        refPosition.getZ(),
        refPosition.getMapId(),
        bot->GetTeam()
    );

    if (!ClosestGrave)
    {
        // GetClosestGraveYard only ever looks at graveyards linked to the area or zone the
        // position falls in. Out at sea, and anywhere else the terrain resolves to a zone with
        // no game_graveyard_zone row, it finds nothing at all - and an empty GuidPosition is
        // the position 0,0,0, which callers then try to walk or teleport to. Bots that drowned
        // crossing open water could not reach any graveyard from there, resurrected on their
        // corpse in the middle of the ocean and drowned again on a loop. Fall back to the
        // nearest graveyard on the same map that the bot's team is allowed to use, ignoring
        // the zone link entirely.
        ClosestGrave = GetClosestGraveyardOnMap(refPosition);
    }

    if (!ClosestGrave)
    {
        sLog.outDetail(
            "ERROR: Unable to find closest graveyard in GraveyardValue, will return GuidPosition() which is 0,0,0 - bot #%d %s:%d <%s>",
            bot->GetGUIDLow(),
            bot->GetTeam() == ALLIANCE ? "A" : "H",
            bot->GetLevel(),
            bot->GetName()
        );
        return GuidPosition();
    }

    return GuidPosition(0, ClosestGrave);
}

WorldSafeLocsEntry const* GraveyardValue::GetClosestGraveyardOnMap(WorldPosition const& refPosition) const
{
    WorldSafeLocsEntry const* entryNear = nullptr;
    float distNear = std::numeric_limits<float>::max();

    for (auto const& mapValues : sObjectMgr.GetGraveYardMap())
    {
        GraveYardData const& graveyardData = mapValues.second;

        // Neutral graveyards carry TEAM_NONE here, the same value GetClosestGraveYardForArea
        // treats as "usable by anyone".
        if (graveyardData.team != TEAM_NONE && graveyardData.team != bot->GetTeam())
            continue;

        WorldSafeLocsEntry const* graveyardCoreEntry = sWorldSafeLocsStore.LookupEntry(graveyardData.safeLocId);
        if (!graveyardCoreEntry)
            continue;

        if (graveyardCoreEntry->map_id != refPosition.getMapId())
            continue;

        float dist = WorldPosition(refPosition).sqDistance(graveyardCoreEntry);

        if (dist < distNear)
        {
            distNear = dist;
            entryNear = graveyardCoreEntry;
        }
    }

    return entryNear;
}

WorldSafeLocsEntry const* GraveyardValue::GetAnotherAppropriateClosestGraveyard() const
{
    // near
    float distNear = std::numeric_limits<float>::max();
    WorldSafeLocsEntry const* entryNear = nullptr;

    // far
    WorldSafeLocsEntry const* entryFar = nullptr;

    Corpse* corpse = bot->GetCorpse();
    if (!corpse)
        return nullptr;

    uint32 botMapId = corpse->GetMapId();
    uint32 botZoneId = corpse->GetZoneId();

    // Graveyards live in ObjectMgr here, not in a per-world manager, and the map is keyed
    // by zone rather than by graveyard id.
    for (auto const& mapValues : sObjectMgr.GetGraveYardMap())
    {
        GraveYardData const& graveyardData = mapValues.second;

        //skip non-neutral or hostile graveyards
        if (graveyardData.team != bot->GetTeam() && graveyardData.team != TEAM_BOTH_ALLOWED)
            continue;

        WorldSafeLocsEntry const* graveyardCoreEntry = sWorldSafeLocsStore.LookupEntry(graveyardData.safeLocId);
        if (!graveyardCoreEntry)
            continue;

        //skip different maps (no need for other continents)
        if (graveyardCoreEntry->map_id != botMapId)
            continue;

        uint32 graveyardZoneId = sTerrainMgr.GetZoneId(graveyardCoreEntry->map_id, graveyardCoreEntry->x, graveyardCoreEntry->y, graveyardCoreEntry->z);
        auto graveyardAreaEntry = GetAreaEntryByAreaID(graveyardZoneId);

        //skip same zone
        if (graveyardZoneId == botZoneId)
            continue;

        if (!graveyardAreaEntry)
            continue;

        // Skip higher level zones. Use the module's computed level, not AreaLevel from
        // area_template: every zone row there carries area_level 0, so this check never
        // rejected anything. After three deaths in Hillsbrad, level 13 Horde bots were sent to
        // graveyard 829 at the Alterac Valley mouth. It is neutral, its zone is level 32, and
        // it stands beside the level 61 Stormpike Battleguards, who killed each bot within five
        // seconds of it reviving.
        if ((int32)bot->GetLevel() + 5 < sTravelMgr.GetAreaLevel(graveyardZoneId))
            continue;

        float dist = WorldPosition(corpse).sqDistance(graveyardCoreEntry);

        if (dist < distNear)
        {
            distNear = dist;
            entryNear = graveyardCoreEntry;
        }
    }

    if (entryNear)
        return entryNear;

    return entryFar;
}

GuidPosition BestGraveyardValue::Calculate()
{
    Corpse* corpse = bot->GetCorpse();
    if (!corpse)
    {
        sLog.outDetail(
            "ERROR: Unable to find closest graveyard in BestGraveyardValue, will return GuidPosition() which is 0,0,0 - bot #%d %s:%d <%s>",
            bot->GetGUIDLow(),
            bot->GetTeam() == ALLIANCE ? "A" : "H",
            bot->GetLevel(),
            bot->GetName()
        );
        return GuidPosition();
    }

    uint32 deathCount = AI_VALUE(uint32, "death count");

    //attempt to revive at other same map graveyards which are not enemy territory
    if (!ai->HasActivePlayerMaster() && deathCount >= DEATH_COUNT_BEFORE_TRYING_ANOTHER_GRAVEYARD)
    {
        GuidPosition anotherGraveyard = AI_VALUE2(GuidPosition, "graveyard", "another closest appropriate");
        if (anotherGraveyard)
        {
            return anotherGraveyard;
        }
        sLog.outDetail(
            "ERROR: Unable to find another closest appropriate graveyard in BestGraveyardValue, resorting to self graveyard - bot #%d %s:%d <%s>",
            bot->GetGUIDLow(),
            bot->GetTeam() == ALLIANCE ? "A" : "H",
            bot->GetLevel(),
            bot->GetName()
        );
    }

    //Revive near master.
    if ((ai->HasStrategy("follow", BotState::BOT_STATE_NON_COMBAT) ||
        ai->HasStrategy("wander", BotState::BOT_STATE_NON_COMBAT)) &&
        ai->GetGroupMaster() && ai->GetGroupMaster() != bot)
    {
        GuidPosition masterGraveyard = AI_VALUE2(GuidPosition, "graveyard", "master");
        if (masterGraveyard)
        {
            return masterGraveyard;
        }
        sLog.outDetail(
            "ERROR: Unable to find master graveyard in BestGraveyardValue, resorting to self graveyard - bot #%d %s:%d <%s>",
            bot->GetGUIDLow(),
            bot->GetTeam() == ALLIANCE ? "A" : "H",
            bot->GetLevel(),
            bot->GetName()
        );
    }

    //Revive near travel target if it's far away from last death.
    if (AI_VALUE2(GuidPosition, "graveyard", "travel") && AI_VALUE2(GuidPosition, "graveyard", "travel").fDist(corpse) > sPlayerbotAIConfig.reactDistance)
    {
        GuidPosition travelGraveyard = AI_VALUE2(GuidPosition, "graveyard", "travel");
        if (travelGraveyard)
        {
            return travelGraveyard;
        }
        sLog.outDetail(
            "ERROR: Unable to find travel graveyard in BestGraveyardValue, resorting to self graveyard - bot #%d %s:%d <%s>",
            bot->GetGUIDLow(),
            bot->GetTeam() == ALLIANCE ? "A" : "H",
            bot->GetLevel(),
            bot->GetName()
        );
    }

    return AI_VALUE2(GuidPosition, "graveyard", "self");
}

bool ShouldSpiritHealerValue::Calculate()
{
    uint32 deathCount = AI_VALUE(uint32, "death count");
    uint8 durability = AI_VALUE(uint8, "durability");

    if (ai->HasActivePlayerMaster()) //Only use spirit healers with direct command with active master.
        return false;

    //Nothing to lose
    if (ai->HasAura(SPELL_ID_PASSIVE_RESURRECTION_SICKNESS, bot) || durability < 10)
        return true;

    //Died too many times
    if (deathCount > DEATH_COUNT_BEFORE_REVIVING_AT_SPIRIT_HEALER)
        return true;

    Corpse* corpse = bot->GetCorpse();
    if (!corpse || !WorldPosition(corpse))
    {
        //if no corpse (?) then definitely should revive at spirit healer
        return true;
    }

    uint32 deadTime = time(nullptr) - corpse->GetGhostTime();

    //Dead for a long time
    if (deadTime > 10 * MINUTE && deathCount > 1)
        return true;

    //Dead for a long time
    if (deadTime > 20 * MINUTE)
        return true;

    //If there are enemies near grave and corpse we go to corpse first.
    if (AI_VALUE2(bool, "manual bool", "enemies near graveyard"))
        return false;

    //Enemies near corpse so try grave first.
    if (AI_VALUE2(bool, "manual bool", "enemies near corpse"))
        return true;

    GuidPosition graveyard = AI_VALUE(GuidPosition, "best graveyard");

    float corpseDistance = WorldPosition(bot).fDist(corpse);
    float graveYardDistance = WorldPosition(bot).fDist(graveyard);
    bool corpseInSight = corpseDistance < sPlayerbotAIConfig.sightDistance;
    bool graveInSight = graveYardDistance < sPlayerbotAIConfig.sightDistance;
    bool enemiesNear = !AI_VALUE(std::list<ObjectGuid>, "possible targets").empty();

    if (enemiesNear)
    {
        if (graveInSight)
        {
            SET_AI_VALUE2(bool, "manual bool", "enemies near graveyard", true);
            return false;
        }
        if (corpseInSight)
        {
            SET_AI_VALUE2(bool, "manual bool", "enemies near corpse", true);
            return true;
        }
    }

    //If grave is near and no ress sickness go there.
    if (graveInSight && !corpseInSight && ai->HasCheat(BotCheatMask::repair))
        return true;

    //Stick to corpse.
    return false;
}