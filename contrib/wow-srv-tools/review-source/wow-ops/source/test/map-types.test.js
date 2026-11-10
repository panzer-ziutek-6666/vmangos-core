import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBucket, BUCKET_LABELS, BUCKET_ORDER } from '../server/mapTypes.js';

test('map types bucket the way the core groups them', () => {
  assert.equal(mapBucket(0), 'world');
  assert.equal(mapBucket(1), 'instance');
  assert.equal(mapBucket(2), 'instance');
  assert.equal(mapBucket(3), 'battleground');
});

test('an unknown or missing map type is its own bucket, not silently a world', () => {
  assert.equal(mapBucket(null), 'unknown');
  assert.equal(mapBucket(undefined), 'unknown');
  assert.equal(mapBucket(99), 'unknown');
});

test('every bucket has a label and a place in the order', () => {
  for (const bucket of BUCKET_ORDER) {
    assert.equal(typeof BUCKET_LABELS[bucket], 'string');
  }
  assert.equal(BUCKET_ORDER.length, Object.keys(BUCKET_LABELS).length);
});
