// 共享网络用的自签证书:没有就让 sing-box 自己签一张(generate tls-keypair),
// 输出是先私钥后证书两段 PEM,拆开分别落到 etc/certs/ 下。有效期给足 10 年,
// 免得哪天到期客户端悄悄连不上。
import { TLS_SERVER_NAME } from '../engine/servers.mjs'

const CERT_MARK = '-----BEGIN CERTIFICATE-----'

export const splitKeypair = (output) => {
  const text = String(output || '')
  const at = text.indexOf(CERT_MARK)
  if (at < 0 || !text.includes('PRIVATE KEY')) return null
  const key = text.slice(0, at).trim()
  const cert = text.slice(at).trim()
  if (!key.startsWith('-----BEGIN')) return null
  return { key: `${key}\n`, cert: `${cert}\n` }
}

export const ensureTlsKeypair = async (ctx, paths) => {
  if ((await ctx.exists(paths.tlsCert)) && (await ctx.exists(paths.tlsKey))) return { generated: false }
  const { code, stdout, stderr } = await ctx.exec(paths.singbox, ['generate', 'tls-keypair', TLS_SERVER_NAME, '--months', '120'])
  const pair = code === 0 ? splitKeypair(stdout) : null
  if (!pair) throw new Error(`生成自签证书失败:${(stderr || stdout || '').trim() || `exit ${code}`}`)
  await ctx.mkdirp(paths.certsDir)
  await ctx.writeFile(paths.tlsCert, pair.cert)
  await ctx.writeFile(paths.tlsKey, pair.key)
  return { generated: true }
}
