export const groupNodesByRegion = (nodes, options = {}) => {
  const groupType = options.groupType || 'urltest'
  const order = []
  const byRegion = new Map()
  for (const node of nodes) {
    // 名字可能带订阅名前缀(「破晓 | 香港-01」)。地区要从前缀后面取:按整段名字切的话,
    // 同一个地区会因为来自两个订阅被拆成「破晓 | 香港」「备用 | 香港」两个组。
    const region = String(node.tag).split(' | ').pop().split('-')[0]
    if (!byRegion.has(region)) {
      byRegion.set(region, [])
      order.push(region)
    }
    byRegion.get(region).push(node.tag)
  }
  const groups = order.map((region) => ({
    name: region,
    type: groupType,
    nodeTags: byRegion.get(region),
  }))
  return { groups }
}

export const buildProxyGroupModel = (nodes, options = {}) => {
  const { groups } = groupNodesByRegion(nodes, options)
  return { regionGroups: groups, allGroupTags: groups.map((g) => g.name) }
}
