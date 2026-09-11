import assert from 'node:assert/strict'
import test from 'node:test'
import { UnsupportedPluginError, clashSsPlugin, normalizeRealityShortId, normalizeUtlsFingerprint, normalizeVlessFlow, sip003Plugin } from './node-fields.mjs'

test('sing-box 1.14 不接受 Clash 的 unsafe 指纹,仅归一为 chrome', () => {
  assert.equal(normalizeUtlsFingerprint('unsafe'), 'chrome')
  assert.equal(normalizeUtlsFingerprint(' UNSAFE '), 'chrome')
  assert.equal(normalizeUtlsFingerprint('firefox'), 'firefox')
  assert.equal(normalizeUtlsFingerprint('some-future-fingerprint'), 'some-future-fingerprint')
  assert.equal(normalizeUtlsFingerprint(undefined), undefined)
})

test('normalizeVlessFlow:只认 xtls-rprx-vision,-udp443 变体归一,废弃 / 空的丢掉(GitHub #23)', () => {
  assert.equal(normalizeVlessFlow('xtls-rprx-vision'), 'xtls-rprx-vision')
  assert.equal(normalizeVlessFlow('xtls-rprx-vision-udp443'), 'xtls-rprx-vision')
  assert.equal(normalizeVlessFlow(' xtls-rprx-vision '), 'xtls-rprx-vision')
  assert.equal(normalizeVlessFlow('xtls-rprx-direct'), undefined)
  assert.equal(normalizeVlessFlow('none'), undefined)
  assert.equal(normalizeVlessFlow(''), undefined)
  assert.equal(normalizeVlessFlow(undefined), undefined)
  assert.equal(normalizeVlessFlow(null), undefined)
})

test('normalizeRealityShortId:十六进制最长 16 位;空 / null / "null" / 非法一律不写(GitHub #19)', () => {
  assert.equal(normalizeRealityShortId('01ab'), '01ab')
  assert.equal(normalizeRealityShortId(' 0123456789abcdef '), '0123456789abcdef')
  assert.equal(normalizeRealityShortId(1234), '1234')
  assert.equal(normalizeRealityShortId(null), undefined)
  assert.equal(normalizeRealityShortId(undefined), undefined)
  assert.equal(normalizeRealityShortId('null'), undefined)
  assert.equal(normalizeRealityShortId(''), undefined)
  assert.equal(normalizeRealityShortId('nope'), undefined)
  assert.equal(normalizeRealityShortId('0123456789abcdef0'), undefined)
})

test('clashSsPlugin:obfs / v2ray-plugin 按 SIP003 写法,别的插件抛 UnsupportedPluginError(GitHub #21)', () => {
  assert.deepEqual(clashSsPlugin('obfs', { mode: 'http', host: 'www.bing.com' }), { plugin: 'obfs-local', plugin_opts: 'obfs=http;obfs-host=www.bing.com' })
  assert.deepEqual(clashSsPlugin('obfs', { mode: 'tls' }), { plugin: 'obfs-local', plugin_opts: 'obfs=tls' })
  assert.deepEqual(clashSsPlugin('simple-obfs', undefined), { plugin: 'obfs-local', plugin_opts: 'obfs=http' })
  assert.deepEqual(clashSsPlugin('v2ray-plugin', { mode: 'websocket', host: 'cdn.example.com', path: '/ws', tls: true, mux: false }), { plugin: 'v2ray-plugin', plugin_opts: 'mode=websocket;host=cdn.example.com;path=/ws;tls;mux=0' })
  assert.deepEqual(clashSsPlugin('v2ray-plugin', {}), { plugin: 'v2ray-plugin', plugin_opts: 'mode=websocket' })
  assert.throws(() => clashSsPlugin('shadow-tls', { host: 'x' }), (err) => err instanceof UnsupportedPluginError && err.code === 'unsupported-plugin' && err.detail === 'shadow-tls')
  assert.throws(() => clashSsPlugin('restls', {}), UnsupportedPluginError)
})

test('sip003Plugin:ss:// 的 plugin= 参数,第一段是插件名,其余原样是 plugin_opts', () => {
  assert.deepEqual(sip003Plugin('obfs-local;obfs=http;obfs-host=www.bing.com'), { plugin: 'obfs-local', plugin_opts: 'obfs=http;obfs-host=www.bing.com' })
  assert.deepEqual(sip003Plugin('simple-obfs;obfs=tls'), { plugin: 'obfs-local', plugin_opts: 'obfs=tls' })
  assert.deepEqual(sip003Plugin('v2ray-plugin;tls;host=cdn.example.com'), { plugin: 'v2ray-plugin', plugin_opts: 'tls;host=cdn.example.com' })
  assert.deepEqual(sip003Plugin('v2ray-plugin'), { plugin: 'v2ray-plugin', plugin_opts: '' })
  assert.equal(sip003Plugin(''), undefined)
  assert.equal(sip003Plugin(null), undefined)
  assert.throws(() => sip003Plugin('shadow-tls;host=x'), UnsupportedPluginError)
})
