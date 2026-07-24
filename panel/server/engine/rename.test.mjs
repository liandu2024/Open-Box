import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_REGION_DICT, DEFAULT_FEATURE_DICT, matchRegion, extractFeatures } from './rename.mjs'

test('matchRegion 覆盖缩写/中文/城市/emoji', () => {
  assert.equal(matchRegion('US-CA-01', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('洛杉矶 03', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('🇺🇸 premium', DEFAULT_REGION_DICT).name, '美国')
  assert.equal(matchRegion('香港 IEPL', DEFAULT_REGION_DICT).name, '香港')
  assert.equal(matchRegion('unknown-place', DEFAULT_REGION_DICT), null)
})

test('extractFeatures 多命中按序去重', () => {
  assert.deepEqual(extractFeatures('US-IEPL-x2', DEFAULT_FEATURE_DICT), ['专线', '2x'])
  assert.deepEqual(extractFeatures('普通节点', DEFAULT_FEATURE_DICT), [])
})

test('词典结构完整', () => {
  assert.ok(DEFAULT_REGION_DICT.length >= 8)
  for (const r of DEFAULT_REGION_DICT) {
    assert.ok(r.code && r.name && Array.isArray(r.keywords) && r.keywords.length > 0)
  }
})
