import type { OpenboxUserGroup } from '@/api/openbox'
import { keywordMatches, normalizeForMatch } from '@/helper/keywordMatch'
import { showNotification } from '@/helper/notification'

// 节点管理列表(NodeGroupsPanel)和添加/修改分组弹窗(NodeGroupEditorDialog)共用的几段:
// 两边都会调 saveNodeGroups,服务端返回的"哪些组落地不了"得用同一套话说出来。

// 提示一律走右上角那套 toast(zashboard 自带的 showNotification),不在页面里挂内联文字。
// content 传 i18n 键,params 交给 t();传原始错误串也行(t 找不到键就原样返回)。
export const notifyGroupError = (err: unknown) =>
  showNotification({
    content: err instanceof Error ? err.message : String(err),
    type: 'alert-error',
  })

export type NodeGroupSaveResult = {
  groups: OpenboxUserGroup[]
  dropped?: Array<{ name: string; reason: string }>
  dangling?: Array<{ name: string; members: string[] }>
}

// 服务端把「按当前节点跑一遍」的结果一并返回:落地不了的组必须说出来。成员是按
// 名字引用的,节点一改名引用就会悬空,组会被静默丢掉——不提示的话,用户只会发现
// 配置里少了个组,却不知道为什么。同一个原因的合成一条,免得建十个空组刷十行。
export const reportGroupSaveResult = (res: NodeGroupSaveResult) => {
  const list = res.dropped || []
  const empty = list.filter((d) => d.reason !== 'cycle').map((d) => d.name)
  const cycle = list.filter((d) => d.reason === 'cycle').map((d) => d.name)
  if (empty.length) {
    showNotification({ content: 'groupDroppedEmpty', params: { names: empty.join('、') } })
  }
  if (cycle.length) {
    showNotification({ content: 'groupDroppedCycle', params: { names: cycle.join('、') } })
  }
  // 悬空引用:组没空的话 dropped 不会提到它,单独说
  for (const d of res.dangling || []) {
    showNotification({
      content: 'groupDanglingMembers',
      params: { group: d.name, members: d.members.join('、') },
      type: 'alert-warning',
    })
  }
}

// 动态组按关键词现算:节点名命中任一关键词就算进组;没有关键词 = 全部节点
export const matchedNodeNames = (group: Pick<OpenboxUserGroup, 'keywords'>, names: string[]) => {
  const keywords = group.keywords || []
  if (!keywords.length) return names
  return names.filter((name) => {
    const lower = normalizeForMatch(name)
    return keywords.some((kw) => keywordMatches(lower, kw))
  })
}
