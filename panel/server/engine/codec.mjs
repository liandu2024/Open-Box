const BASE64_CHARS = /^[A-Za-z0-9+/_-]*={0,2}$/

export const isProbablyBase64 = (text) => {
  if (typeof text !== 'string') return false
  const compact = text.replace(/\s+/g, '')
  return compact.length > 0 && BASE64_CHARS.test(compact)
}

export const decodeBase64 = (text) => {
  if (typeof text !== 'string') throw new Error('decodeBase64 expects a string')
  let s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad === 2) s += '=='
  else if (pad === 3) s += '='
  else if (pad === 1) throw new Error('invalid base64 length')
  return Buffer.from(s, 'base64').toString('utf8')
}

export const parseUri = (uri) => {
  if (typeof uri !== 'string') throw new Error('parseUri expects a string')
  const schemeMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (!schemeMatch) throw new Error(`not a uri: ${uri}`)
  const scheme = schemeMatch[1].toLowerCase()
  let rest = uri.slice(schemeMatch[0].length)

  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = decodeURIComponent(rest.slice(hashIdx + 1))
    rest = rest.slice(0, hashIdx)
  }

  let query = new URLSearchParams()
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    query = new URLSearchParams(rest.slice(qIdx + 1))
    rest = rest.slice(0, qIdx)
  }

  // 去掉 path 部分(host:port 之后的 / ...)
  let authority = rest
  const slashIdx = rest.indexOf('/')
  if (slashIdx >= 0) authority = rest.slice(0, slashIdx)

  let userinfo = ''
  const atIdx = authority.lastIndexOf('@')
  if (atIdx >= 0) {
    userinfo = authority.slice(0, atIdx)
    authority = authority.slice(atIdx + 1)
  }

  let host = ''
  let port = null
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    host = authority.slice(1, close)
    const after = authority.slice(close + 1)
    if (after.startsWith(':')) port = Number.parseInt(after.slice(1), 10)
  } else {
    const colon = authority.lastIndexOf(':')
    if (colon >= 0) {
      host = authority.slice(0, colon)
      port = Number.parseInt(authority.slice(colon + 1), 10)
    } else {
      host = authority
    }
  }
  if (port !== null && !Number.isInteger(port)) port = null

  return { scheme, userinfo, host, port, query, fragment }
}
