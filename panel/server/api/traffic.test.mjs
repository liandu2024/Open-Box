import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { buildMonthView, parseDhcpLeases, registerTrafficRoutes } from './traffic.mjs'
import { createMockContext } from '../system/context.mjs'

const startApp = async (collector, now, extra = {}) => {
  const app = express()
  registerTrafficRoutes(app, { collector, now, ...extra })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

const fakeCollector = () => {
  const data = {
    '2026-09-03': {
      total: { up: 100, down: 900, conns: 7 },
      node: [{ key: 'A', up: 60, down: 500, conns: 4 }, { key: '直连', up: 10, down: 100, conns: 2 }],
      host: [{ key: 'a.com', up: 70, down: 600, conns: 6 }],
      client: [{ key: '10.0.0.209', up: 60, down: 500, conns: 5 }, { key: '10.0.0.7', up: 10, down: 100, conns: 1 }],
    },
  }
  let flushed = 0
  const drills = []
  return {
    flushed: () => flushed,
    flush() { flushed += 1 },
    store: {
      month(month) {
        return Object.entries(data).filter(([d]) => d.startsWith(month)).map(([day, v]) => ({ day, ...v.total }))
      },
      dayTotal(day) { return data[day]?.total || null },
      hours() { return [] },
      day(day, kind, limit) { return (data[day]?.[kind] || []).slice(0, limit) },
      daySum(day, kind) {
        const rows = data[day]?.[kind] || []
        return { n: rows.length, up: rows.reduce((s, r) => s + r.up, 0), down: rows.reduce((s, r) => s + r.down, 0) }
      },
      drill(day, kind, key, by, limit) {
        drills.push({ day, kind, key, by, limit })
        if (day !== '2026-09-03' || kind !== 'host' || key !== 'a.com') return { rows: [], count: 0 }
        const rows = by === 'client'
          ? [{ key: '10.0.0.209', up: 60, down: 500, conns: 5 }, { key: '10.0.0.7', up: 10, down: 100, conns: 1 }]
          : [{ key: 'A', up: 70, down: 600, conns: 6 }]
        return { rows: rows.slice(0, limit), count: rows.length }
      },
    },
    drills,
  }
}

test('buildMonthView:整月补零;日均按已过天数(往月整月、当月到今天、未来 0)', () => {
  const rows = [{ day: '2026-09-03', up: 100, down: 900, conns: 7 }]
  const cur = buildMonthView('2026-09', rows, '2026-09-10')
  assert.equal(cur.days.length, 30)
  assert.deepEqual(cur.days[2], { day: '2026-09-03', up: 100, down: 900, conns: 7 })
  assert.deepEqual(cur.days[0], { day: '2026-09-01', up: 0, down: 0, conns: 0 })
  assert.equal(cur.avgDays, 10)
  assert.deepEqual(cur.avg, { up: 10, down: 90 })
  assert.equal(buildMonthView('2026-08', [], '2026-09-10').avgDays, 31)
  assert.equal(buildMonthView('2026-10', [], '2026-09-10').avgDays, 0)
})

test('GET /traffic/month:缺参数用当月,格式错 400,读之前先 flush', async () => {
  const collector = fakeCollector()
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10))
  try {
    const r = await fetch(`${base}/api/openbox/traffic/month`)
    const body = await r.json()
    assert.equal(body.month, '2026-09')
    assert.equal(body.today, '2026-09-03')
    assert.deepEqual(body.total, { up: 100, down: 900, conns: 7 })
    assert.equal(collector.flushed(), 1)
    assert.equal((await fetch(`${base}/api/openbox/traffic/month?month=2026-13`)).status, 400)
    assert.equal((await fetch(`${base}/api/openbox/traffic/month?month=2026/09`)).status, 400)
  } finally {
    await close()
  }
})

test('GET /traffic/day:节点/域名明细 + 未采样差额;非法日期 400', async () => {
  const collector = fakeCollector()
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10))
  try {
    const r = await fetch(`${base}/api/openbox/traffic/day?day=2026-09-03`)
    const body = await r.json()
    assert.equal(body.nodes.length, 2)
    assert.equal(body.hostsCount, 1)
    assert.deepEqual(body.other, { up: 30, down: 300 })
    const empty = await (await fetch(`${base}/api/openbox/traffic/day?day=2026-09-02`)).json()
    assert.deepEqual(empty.total, { up: 0, down: 0, conns: 0 })
    assert.deepEqual(empty.nodes, [])
    assert.equal((await fetch(`${base}/api/openbox/traffic/day?day=2026-09-32`)).status, 400)
    assert.equal((await fetch(`${base}/api/openbox/traffic/day`)).status, 400)
  } finally {
    await close()
  }
})

test('GET /traffic/day:访问终端按来源 IP,能从 DHCP 租约翻出主机名', async () => {
  const collector = fakeCollector()
  const ctx = createMockContext({ files: { '/tmp/dhcp.leases': '1757000000 00:15:5d:03:0a:28 10.0.0.209 WIN11-VM 01:00:15:5d:03:0a:28\n1757000000 aa:bb:cc:dd:ee:ff 10.0.0.7 * *\n' } })
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10), { ctx, paths: { dhcpLeases: '/tmp/dhcp.leases' } })
  try {
    const body = await (await fetch(`${base}/api/openbox/traffic/day?day=2026-09-03`)).json()
    assert.equal(body.clientsCount, 2)
    assert.deepEqual(body.clients[0], { key: '10.0.0.209', up: 60, down: 500, conns: 5, name: 'WIN11-VM' })
    assert.equal(body.clients[1].name, '')
  } finally {
    await close()
  }
})

test('GET /traffic/drill:一条记录按另一维拆;按终端拆时带主机名;参数校验 400', async () => {
  const collector = fakeCollector()
  const ctx = createMockContext({ files: { '/tmp/dhcp.leases': '1757000000 00:15:5d:03:0a:28 10.0.0.209 WIN11-VM 01:00:15:5d:03:0a:28\n' } })
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10), { ctx, paths: { dhcpLeases: '/tmp/dhcp.leases' } })
  try {
    const q = (s) => fetch(`${base}/api/openbox/traffic/drill?${s}`)
    const byClient = await (await q('day=2026-09-03&kind=host&key=a.com&by=client')).json()
    assert.equal(byClient.count, 2)
    assert.deepEqual(byClient.rows[0], { key: '10.0.0.209', up: 60, down: 500, conns: 5, name: 'WIN11-VM' })
    assert.equal(byClient.rows[1].name, '')
    assert.equal(collector.flushed(), 1)
    const byNode = await (await q('day=2026-09-03&kind=host&key=a.com&by=node&limit=1')).json()
    assert.deepEqual(byNode.rows, [{ key: 'A', up: 70, down: 600, conns: 6 }])
    assert.deepEqual(collector.drills.at(-1), { day: '2026-09-03', kind: 'host', key: 'a.com', by: 'node', limit: 1 })
    // 空 key(来源不明的终端)也能查
    assert.equal((await q('day=2026-09-03&kind=client&key=&by=host')).status, 200)
    assert.equal((await q('day=2026-09-32&kind=host&key=a.com&by=client')).status, 400)
    assert.equal((await q('day=2026-09-03&kind=host&key=a.com&by=host')).status, 400)
    assert.equal((await q('day=2026-09-03&kind=total&key=&by=host')).status, 400)
    assert.equal((await q('day=2026-09-03&kind=host&key=a.com')).status, 400)
  } finally {
    await close()
  }
})

test('parseDhcpLeases:主机名为 * 的不算', () => {
  const m = parseDhcpLeases('1 m1 10.0.0.2 pc 01\n1 m2 10.0.0.3 * *\nbad line\n')
  assert.deepEqual([...m.entries()], [['10.0.0.2', 'pc']])
})

test('GET /clients:租约里的设备 + 今天流量里的来源 IP', async () => {
  const collector = fakeCollector()
  const ctx = createMockContext({ files: { '/tmp/dhcp.leases': '1 m1 10.0.0.209 WIN11 01\n' } })
  const { base, close } = await startApp(collector, () => new Date(2026, 8, 3, 10), { ctx, paths: { dhcpLeases: '/tmp/dhcp.leases' } })
  try {
    const body = await (await fetch(`${base}/api/openbox/clients`)).json()
    assert.deepEqual(body.clients, [{ ip: '10.0.0.209', name: 'WIN11' }, { ip: '10.0.0.7', name: '' }])
  } finally {
    await close()
  }
})

test('readLocalAddresses:问 netifd 哪个逻辑接口占着这个设备,eth0 是 wan 就标 wan;问不到按设备名猜', async () => {
  const { readLocalAddresses } = await import('../system/local-subnets.mjs')
  const ctx = createMockContext({ execResults: {
    'ip -4 -o addr': { code: 0, stdout: '2: eth0    inet 192.168.3.35/24 brd 192.168.3.255 scope global eth0\n3: br-lan    inet 10.0.0.1/24 brd 10.0.0.255 scope global br-lan\n' },
    // wan6 和 wan 共用 eth0(顺序故意把 wan6 放前面):要留 wan
    'ubus call network.interface dump': { code: 0, stdout: JSON.stringify({ interface: [{ interface: 'wan6', l3_device: 'eth0', device: 'eth0' }, { interface: 'wan', l3_device: 'eth0', device: 'eth0' }, { interface: 'lan', l3_device: 'br-lan', device: 'br-lan' }] }) },
  } })
  const out = await readLocalAddresses(ctx)
  assert.deepEqual(out, [
    { iface: 'eth0', address: '192.168.3.35', kind: 'wan', logical: 'wan' },
    { iface: 'br-lan', address: '10.0.0.1', kind: 'lan', logical: 'lan' },
  ])
  const noUbus = createMockContext({ execResults: { 'ip -4 -o addr': { code: 0, stdout: '5: pppoe-wan0    inet 10.65.3.225 peer 10.65.0.1/32 scope global pppoe-wan0\n' } } })
  assert.deepEqual(await readLocalAddresses(noUbus), [{ iface: 'pppoe-wan0', address: '10.65.3.225', kind: 'wan' }])
})
