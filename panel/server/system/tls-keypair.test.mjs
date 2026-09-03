import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { ensureTlsKeypair, splitKeypair } from './tls-keypair.mjs'

const paths = createPaths('/opt/open-box')
const PEM = '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n\n-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n'

test('splitKeypair:sing-box 先输出私钥再输出证书,拆成两段', () => {
  const r = splitKeypair(PEM)
  assert.equal(r.key, '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n')
  assert.equal(r.cert, '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n')
  assert.equal(splitKeypair('garbage'), null)
})

test('ensureTlsKeypair:没证书就调 sing-box 生成并落盘;已有就不动', async () => {
  const ctx = createMockContext({ execResults: { [`${paths.singbox} generate tls-keypair open-box.local --months 120`]: { code: 0, stdout: PEM } } })
  assert.deepEqual(await ensureTlsKeypair(ctx, paths), { generated: true })
  assert.ok(ctx.files[paths.tlsCert].includes('CERT'))
  assert.ok(ctx.files[paths.tlsKey].includes('KEY'))
  assert.deepEqual(await ensureTlsKeypair(ctx, paths), { generated: false })
  const bad = createMockContext({ execResults: { [`${paths.singbox} generate tls-keypair open-box.local --months 120`]: { code: 1, stderr: 'boom' } } })
  await assert.rejects(() => ensureTlsKeypair(bad, paths), /boom/)
})
