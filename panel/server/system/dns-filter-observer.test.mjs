import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createDnsEventParser, createDnsFilterStore } from './dns-filter-observer.mjs'

test('native DNS events count requests once, identify filter vs policy, and retain real duration', () => {
  const db = new DatabaseSync(':memory:')
  const now = () => 1700000000000
  const data = createDnsFilterStore(db, { now })
  const parser = createDnsEventParser({ data, now, rules: [{ rule_set: ['ads'], action: 'predefined', rcode: 'NXDOMAIN' }], names: { ads: 'anti-AD' } })
  const send = (payload) => parser.accept({ payload })
  send('[1 0ms] inbound/direct[dns-in]: inbound packet connection from 192.168.3.100:56000')
  send('[1 0ms] dns: exchange ads.test. IN A')
  send('[1 0ms] dns: match[0] rule_set=ads => predefined(NXDOMAIN)')
  send('[2 10ms] dns: exchange good.test. IN AAAA')
  send('[2 34ms] dns: exchanged good.test NOERROR 60')
  send('[2 34ms] dns: exchanged AAAA good.test. 60 IN AAAA ::1')
  send('[3 0ms] dns: exchange good.test. IN A')
  send('[3 2ms] dns: cached good.test NOERROR 58')
  send('[4 0ms] dns: exchange fail.test. IN A')
  send('[4 10ms] dns: exchange failed for fail.test. IN A: timeout')
  const summary = data.summary()
  assert.equal(summary.queries, 4)
  assert.equal(summary.blocked, 1)
  assert.equal(summary.timed, 3)
  assert.equal(summary.elapsed, 36)
  const blocked = data.records({ result: 'blocked' })
  assert.equal(blocked.total, 1)
  assert.equal(blocked.rows[0].source, '192.168.3.100')
  assert.equal(blocked.rows[0].list, 'anti-AD')
  assert.deepEqual(summary.topDomains.map((r) => [r.domain, r.count]), [['ads.test', 1]])
  db.close()
})

test('ambiguous parallel completions and disconnected queries do not invent timings or blocks', () => {
  const rows = [], started = []
  const parser = createDnsEventParser({ data: { start: (q) => started.push(q), finish: (q) => rows.push(q) } })
  for (const payload of ['[1 0ms] dns: exchange same.test. IN A', '[1 0ms] dns: exchange same.test. IN AAAA', '[1 25ms] dns: exchanged same.test NOERROR 60']) parser.accept({ payload })
  parser.drain()
  assert.equal(started.length, 2)
  assert.equal(rows[0].elapsed, null)
  assert.equal(rows[1].result, 'unknown')
  assert.equal(rows[1].elapsed, null)
})

test('core duration hundredths and retained hourly statistics survive reopening the collector', () => {
  const db = new DatabaseSync(':memory:')
  let at = 1700000000000
  let data = createDnsFilterStore(db, { now: () => at })
  const parser = createDnsEventParser({ data, now: () => at })
  parser.accept({ payload: '[9 0ms] dns: exchange slow.test. IN A' })
  parser.accept({ payload: '[9 1.5s] dns: exchanged slow.test NOERROR 60' })
  data.flush()
  data = createDnsFilterStore(db, { now: () => at })
  assert.equal(data.summary().queries, 1)
  assert.equal(data.summary().averageMs, 1050)
  assert.equal(data.records({ search: 'slow.test', page: '1.1' }).total, 1)
  at += 25 * 3600000
  assert.equal(data.summary().queries, 0)
  assert.equal(data.records().total, 0)
  db.close()
})
