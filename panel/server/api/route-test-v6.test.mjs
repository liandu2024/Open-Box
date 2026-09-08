import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { hostPort, targetUrl, probeViaKernel } from './route-test.mjs'

test('hostPort / targetUrl:IPv6 字面量加方括号,默认端口不写(审核 B7)', () => {
  assert.equal(hostPort('2001:db8::1', 80), '[2001:db8::1]:80')
  assert.equal(hostPort('1.2.3.4', 443), '1.2.3.4:443')
  assert.equal(hostPort('example.com', 8443), 'example.com:8443')
  assert.equal(targetUrl('2001:db8::1', 443, true), 'https://[2001:db8::1]/')
  assert.equal(targetUrl('2001:db8::1', 8080, false), 'http://[2001:db8::1]:8080/')
  assert.equal(targetUrl('example.com', 443, true), 'https://example.com/')
  assert.equal(targetUrl('1.2.3.4', 80, false), 'http://1.2.3.4/')
})

// 本地起一个假的 mixed 入站收 CONNECT,看探测器写出来的目标格式
const capture = (host, opts) => new Promise((resolve) => {
  const server = net.createServer((socket) => {
    let head = ''
    socket.on('data', (c) => {
      head += c.toString('latin1')
      if (head.includes('\r\n\r\n')) {
        const [connectLine, ...rest] = head.split('\r\n')
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        socket.end()
        server.close()
        resolve({ connectLine, hostLine: rest.find((l) => l.startsWith('Host:')) })
      }
    })
  })
  server.listen(0, '127.0.0.1', () => { probeViaKernel(host, { ...opts, proxyPort: server.address().port, timeoutMs: 2000 }) })
})

test('CONNECT / Host:IPv6 目标带方括号;IPv4 和域名照旧', async () => {
  assert.deepEqual(await capture('2001:db8::1', { port: 80, secure: false }), { connectLine: 'CONNECT [2001:db8::1]:80 HTTP/1.1', hostLine: 'Host: [2001:db8::1]:80' })
  assert.deepEqual(await capture('example.com', { port: 443, secure: true, connectTo: '2001:db8::5' }), { connectLine: 'CONNECT [2001:db8::5]:443 HTTP/1.1', hostLine: 'Host: [2001:db8::5]:443' })
  assert.deepEqual(await capture('1.2.3.4', { port: 8080, secure: false }), { connectLine: 'CONNECT 1.2.3.4:8080 HTTP/1.1', hostLine: 'Host: 1.2.3.4:8080' })
})
