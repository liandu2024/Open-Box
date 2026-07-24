import assert from 'node:assert/strict'
import test from 'node:test'
import { emitGroupOutbounds } from './emit-groups.mjs'

const groups = [
  { name: '美国', type: 'urltest', nodeTags: ['美国-01', '美国-02'] },
  { name: '日本', type: 'select', nodeTags: ['日本-01'] },
]

test('总代理组 + 区域组结构', () => {
  const out = emitGroupOutbounds(groups)
  assert.deepEqual(out[0], { type: 'selector', tag: 'PROXY', outbounds: ['美国', '日本', 'direct'] })
  assert.deepEqual(out[1], { type: 'urltest', tag: '美国', outbounds: ['美国-01', '美国-02'], url: 'https://www.gstatic.com/generate_204', interval: '5m' })
  assert.deepEqual(out[2], { type: 'selector', tag: '日本', outbounds: ['日本-01'] })
})

test('proxyTag 自定义 + 不含 direct', () => {
  const out = emitGroupOutbounds(groups, { proxyTag: 'Proxy', includeDirectInProxy: false })
  assert.equal(out[0].tag, 'Proxy')
  assert.deepEqual(out[0].outbounds, ['美国', '日本'])
})

test('空组', () => {
  assert.deepEqual(emitGroupOutbounds([]), [{ type: 'selector', tag: 'PROXY', outbounds: ['direct'] }])
})
