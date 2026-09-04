import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTransport } from './emit-outbound.mjs'
import { emitEndpoint } from './emit-endpoint.mjs'

test('buildTransport:grpc 只输出 service_name,v2rayN 放在 path 里的 serviceName 也认(去掉开头的 /)', () => {
  assert.deepEqual(buildTransport({ type: 'grpc', path: '/mysvc' }), { type: 'grpc', service_name: 'mysvc' })
  assert.deepEqual(buildTransport({ type: 'grpc', service_name: 'svc', path: '/ignored', headers: { Host: 'h' } }), { type: 'grpc', service_name: 'svc' })
})

test('buildTransport:http 是 host 列表 + path,分享链接里的 headers.Host 归到 host,其它 header 保留', () => {
  assert.deepEqual(buildTransport({ type: 'http', path: '/h2', headers: { Host: 'a.com,b.com', 'X-Foo': '1' } }), {
    type: 'http', host: ['a.com', 'b.com'], path: '/h2', headers: { 'X-Foo': '1' },
  })
  assert.deepEqual(buildTransport({ type: 'http', host: ['c.com'] }), { type: 'http', host: ['c.com'] })
})

test('buildTransport:ws 保留 path/headers,path 里 v2rayN 的 ?ed=2048 拆成 early data 字段', () => {
  assert.deepEqual(buildTransport({ type: 'ws', path: '/ws', headers: { Host: 'cdn.com' } }), { type: 'ws', path: '/ws', headers: { Host: 'cdn.com' } })
  assert.deepEqual(buildTransport({ type: 'ws', path: '/ws?ed=2048' }), {
    type: 'ws', path: '/ws', max_early_data: 2048, early_data_header_name: 'Sec-WebSocket-Protocol',
  })
})

test('buildTransport:httpupgrade 是单个 host;quic 没有字段;tcp / 不认识的类型(xhttp 老记录)不输出 transport', () => {
  assert.deepEqual(buildTransport({ type: 'httpupgrade', path: '/up', headers: { Host: 'u.com' } }), { type: 'httpupgrade', host: 'u.com', path: '/up' })
  assert.deepEqual(buildTransport({ type: 'quic', path: '/x' }), { type: 'quic' })
  assert.equal(buildTransport({ type: 'tcp' }), undefined)
  assert.equal(buildTransport({ type: 'xhttp', path: '/x' }), undefined)
})

test('emitEndpoint:wireguard 裸 IP 补 /32、/128,已带前缀的不动', () => {
  const ep = emitEndpoint({
    type: 'wireguard', tag: 'WG', server: 'wg.example.com', server_port: 51820,
    fields: { private_key: 'priv', peer_public_key: 'pub', local_address: ['10.0.0.2', 'fd00::2', '172.16.0.0/24'] },
  })
  assert.deepEqual(ep.address, ['10.0.0.2/32', 'fd00::2/128', '172.16.0.0/24'])
})
