import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import zlib from 'node:zlib'

const releaseApiUrl = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
const targetArch = process.env.TARGETARCH || process.arch
const targetVariant = normalizeVariant(process.env.TARGETVARIANT || detectNodeArmVariant())
const targetLabel = `${targetArch}${targetVariant ? `/${targetVariant}` : ''}`
const targetPath = path.resolve(process.env.MIHOMO_BIN_PATH || '.tools/mihomo-bin/mihomo')

function normalizeVariant(value) {
  return String(value || '')
    .replace(/^\//, '')
    .trim()
}

function detectNodeArmVariant() {
  if (process.arch !== 'arm') {
    return ''
  }

  const armVersion = process.config?.variables?.arm_version
  return armVersion ? `v${armVersion}` : ''
}

function findAsset(assets, patterns) {
  for (const pattern of patterns) {
    const asset = assets.find((item) => pattern.test(item.name))
    if (asset) {
      return asset
    }
  }

  return null
}

function pickAsset(assets) {
  if (targetArch === 'amd64' || targetArch === 'x64') {
    return findAsset(assets, [
      /^mihomo-linux-amd64-compatible-v[0-9.]+\.gz$/i,
      /^mihomo-linux-amd64-v1-v[0-9.]+\.gz$/i,
      /^mihomo-linux-amd64-v[0-9.]+\.gz$/i,
    ])
  }

  if (targetArch === 'arm64') {
    return findAsset(assets, [/^mihomo-linux-arm64-v[0-9.]+\.gz$/i])
  }

  if (targetArch === 'arm') {
    const variantPatterns = {
      v7: [/^mihomo-linux-armv7-v[0-9.]+\.gz$/i],
      v6: [/^mihomo-linux-armv6-v[0-9.]+\.gz$/i],
      v5: [/^mihomo-linux-armv5-v[0-9.]+\.gz$/i],
    }

    if (targetVariant && variantPatterns[targetVariant]) {
      return findAsset(assets, variantPatterns[targetVariant])
    }

    return findAsset(assets, [
      /^mihomo-linux-armv7-v[0-9.]+\.gz$/i,
      /^mihomo-linux-armv6-v[0-9.]+\.gz$/i,
      /^mihomo-linux-armv5-v[0-9.]+\.gz$/i,
    ])
  }

  throw new Error(`Unsupported architecture: ${targetLabel}`)
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'AnGe-ClashBoard',
            Accept: 'application/vnd.github+json',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch release metadata: ${res.statusCode}`))
            res.resume()
            return
          }

          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(body))
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      .on('error', reject)
  })
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'AnGe-ClashBoard',
            Accept: 'application/octet-stream',
          },
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (redirects >= 5) {
              reject(new Error('Too many redirects while downloading mihomo asset'))
              res.resume()
              return
            }

            res.resume()
            resolve(download(res.headers.location, redirects + 1))
            return
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Failed to download mihomo asset: ${res.statusCode}`))
            res.resume()
            return
          }

          resolve(res)
        },
      )
      .on('error', reject)
  })
}

async function main() {
  const release = await requestJson(releaseApiUrl)
  const asset = pickAsset(release.assets || [])

  if (!asset) {
    throw new Error(`No matching mihomo asset found for ${targetLabel}`)
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const response = await download(asset.browser_download_url)

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath, { mode: 0o755 })

    response.pipe(zlib.createGunzip()).pipe(output)
    response.on('error', reject)
    output.on('finish', resolve)
    output.on('error', reject)
  })

  console.log(`Downloaded ${asset.name} for ${targetLabel}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
