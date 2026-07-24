export const emitGroupOutbounds = (regionGroups, options = {}) => {
  const proxyTag = options.proxyTag || 'PROXY'
  const includeDirect = options.includeDirectInProxy !== false
  const testUrl = options.testUrl || 'https://www.gstatic.com/generate_204'
  const testInterval = options.testInterval || '5m'

  const groupNames = regionGroups.map((g) => g.name)
  const proxyOutbounds = includeDirect ? [...groupNames, 'direct'] : [...groupNames]
  const selector = { type: 'selector', tag: proxyTag, outbounds: proxyOutbounds.length ? proxyOutbounds : ['direct'] }

  const groups = regionGroups.map((g) => {
    if (g.type === 'urltest') {
      return { type: 'urltest', tag: g.name, outbounds: g.nodeTags, url: testUrl, interval: testInterval }
    }
    return { type: 'selector', tag: g.name, outbounds: g.nodeTags }
  })
  return [selector, ...groups]
}
