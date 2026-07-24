export const groupNodesByRegion = (nodes, options = {}) => {
  const groupType = options.groupType || 'urltest'
  const order = []
  const byRegion = new Map()
  for (const node of nodes) {
    const region = String(node.tag).split('-')[0]
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
