// map_template.map_type, from vmangos-core src/game/Database/DBCEnums.h:143-149:
// MAP_COMMON = 0, MAP_INSTANCE = 1, MAP_RAID = 2, MAP_BATTLEGROUND = 3.
//
// Instances and raids share a bucket because the distinction does not matter
// to an operator asking where the bots are. A map type the world DB reports
// that is none of these gets its own bucket rather than being folded into
// "world": a wrong bucket is worse than an honest "unknown", and this is
// exactly where a world DB from a different expansion would show up.
const BUCKET_BY_TYPE = new Map([[0, 'world'], [1, 'instance'], [2, 'instance'], [3, 'battleground']]);

export const BUCKET_LABELS = {
  world: 'World',
  battleground: 'Battlegrounds',
  instance: 'Instances and raids',
  unknown: 'Unknown maps'
};

export const BUCKET_ORDER = ['world', 'battleground', 'instance', 'unknown'];

export function mapBucket(mapType) {
  if (mapType == null) return 'unknown';
  return BUCKET_BY_TYPE.get(Number(mapType)) ?? 'unknown';
}
