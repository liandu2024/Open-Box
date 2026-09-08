import type { OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, fetchProfile, saveProfile } from '@/api/openbox'
import { directTestUrl, speedtestUrl } from '@/store/settings'
import { computed, ref } from 'vue'

// 代理页「策略 / 节点」两个页签怎么分:zashboard 原来是猜的——一个组的成员如果全是
// 已知的叶子节点就算节点组,否则算策略组。这套猜法在 sing-box 上会翻车:clash_api 的
// /proxies 不列 direct / block,于是一个成员只有 direct 占位的空节点组(爱尔兰-自动)
// 会被当成策略组,跑到「策略」页签里去。
//
// Open-Box 自己知道哪些 selector 是站点集(routing.policies + 兜底「其他」),不用猜。
// 这里把名字拉过来,composables/proxies.ts 优先按它分;拉不到再退回原来的猜法。
export const siteSetNames = ref<Set<string>>(new Set())
// 站点集的顺序(用户拖出来的那个顺序,兜底「其他」永远最后)。代理页的「策略」页签按它排,
// 而不是按内核 GLOBAL 列表的顺序——内核把 route.final 指向的那个排在最前面,兜底就跑到
// 顶上去了,和「分流与策略」页里钉在最下面的样子对不上。
export const siteSetOrder = ref<string[]>([])
// 代理页「策略」页签的显示顺序,在「策略设置」里拖出来的。它和上面的命中顺序分开:匹配是
// 先到先得、顺序有意义;显示只是看着顺手,两者不必一样。存在档案的 routing.displayOrder 里,
// 手机和电脑看到的顺序一致。新建的站点集不在这张表里,按命中顺序补在后面;已删掉的忽略。
export const siteSetDisplayOrder = ref<string[]>([])
export const effectiveSiteSetOrder = computed(() => {
  const known = siteSetOrder.value
  const picked = siteSetDisplayOrder.value.filter((name) => known.includes(name))
  return [...picked, ...known.filter((name) => !picked.includes(name))]
})
export const saveSiteSetDisplayOrder = async (order: string[]) => {
  // 先改本地再落档案:拖完立刻按新顺序排,不等网络
  siteSetDisplayOrder.value = [...order]
  await saveProfile({ routing: { displayOrder: order } })
}
// 站点集各自挑的图标(名字 → 图标代码):代理页策略卡片标题左边那个大图标就从这来。
// 兜底「其他」固定彩色地球,和「分流与策略」里钉在最下面那条一致。
export const siteSetIcons = ref<Map<string, string>>(new Map())
// 各站点集的图标缩放(名字 → 像素偏移),在「修改站点集」里拨的;画图标时加到尺寸上
export const siteSetIconScales = ref<Map<string, number>>(new Map())

// 兜底站点集的名字,和服务端 engine/routing-model.mjs 的 FALLBACK_TAG 同一个值
const FALLBACK_NAME = '其他'
// 前置自定义分流的默认名字和图标,同样和服务端那份对齐(CUSTOM_POLICY_NAME / CUSTOM_POLICY_ICON)
const CUSTOM_NAME = '前置自定义分流'
const CUSTOM_ICON = 'misc:pin'

// 前置自定义分流:命中顺序里排在所有站点集之前(见 server/engine/routing.mjs)。
// 它不是 selector,代理页上没有它的卡片,所以只在「策略设置」的命中顺序里露面。
// active = 启用着且至少有一条规则;不满足时它不进内核配置,列表里标成未生效。
export const customPolicySummary = ref<{ name: string; icon: string; iconScale: number; active: boolean } | null>(null)

// 「节点管理」里的条目:代理页的「节点」页签按它排、按它给图标;内置的直连/拒绝也在其中。
export const managedOutbounds = ref<OpenboxUserGroup[]>([])
// 每个节点来自哪条订阅(节点名 → 订阅名)。代理页开了「节点根据提供商分组」后按它分段:
// sing-box 的 clash_api 没有 provider 概念,zashboard 原来靠内核给的 provider-name 分,
// 在这里永远是空的——所以由 Open-Box 自己按订阅归属补上。
export const nodeProviders = ref<Map<string, string>>(new Map())

export const loadOpenboxNodeGroups = async () => {
  try {
    const payload = await fetchNodeGroups()
    managedOutbounds.value = payload.groups
    nodeProviders.value = new Map(
      (payload.availableNodes || []).filter((n) => n.subscription).map((n) => [n.name, n.subscription]),
    )
  } catch {
    // 拉不到就保持原样:代理页照内核给的顺序显示,只是没有图标
  }
}

export const loadOpenboxSiteSets = async () => {
  try {
    const profile = await fetchProfile()
    // 测速地址以档案为准(「分流与策略 → 其他」里改),面板的延迟测试跟着它
    if (profile.testUrl) speedtestUrl.value = profile.testUrl
    if (profile.directTestUrl) directTestUrl.value = profile.directTestUrl
    // 停用的站点集不在内核里,代理页也就不用认它
    const policies = (profile.routing.policies || []).filter((p) => p.name && p.enabled !== false)
    const names = policies.map((p) => p.name)
    const fallbackName = profile.routing.fallbackName?.trim() || FALLBACK_NAME
    siteSetNames.value = new Set([...names, fallbackName])
    siteSetOrder.value = [...names, fallbackName]
    siteSetDisplayOrder.value = Array.isArray(profile.routing.displayOrder)
      ? profile.routing.displayOrder.filter((name) => typeof name === 'string')
      : []
    const icons = new Map<string, string>(policies.filter((p) => p.icon).map((p) => [p.name, p.icon as string]))
    icons.set(fallbackName, profile.routing.fallbackIcon?.trim() || 'globe:earth-meridians')
    siteSetIcons.value = icons
    const scales = new Map<string, number>(policies.map((p) => [p.name, Number(p.iconScale) || 0]))
    scales.set(fallbackName, Number(profile.routing.fallbackIconScale) || 0)
    siteSetIconScales.value = scales
    const custom = profile.routing.custom || {}
    customPolicySummary.value = {
      name: custom.name?.trim() || CUSTOM_NAME,
      icon: custom.icon?.trim() || CUSTOM_ICON,
      iconScale: Number(custom.iconScale) || 0,
      active: custom.enabled !== false && (custom.rules || []).length > 0,
    }
  } catch {
    // 拉不到就保持原样(空集 → 退回猜法),不让代理页因此打不开
  }
}
