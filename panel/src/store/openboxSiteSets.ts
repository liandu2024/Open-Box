import type { OpenboxUserGroup } from '@/api/openbox'
import { fetchNodeGroups, fetchProfile } from '@/api/openbox'
import { directTestUrl, speedtestUrl } from '@/store/settings'
import { ref } from 'vue'

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

// 兜底站点集的名字,和服务端 engine/routing-model.mjs 的 FALLBACK_TAG 同一个值
const FALLBACK_NAME = '其他'

// 「节点管理」里的条目:代理页的「节点」页签按它排、按它给图标;内置的直连/拒绝也在其中。
export const managedOutbounds = ref<OpenboxUserGroup[]>([])

export const loadOpenboxNodeGroups = async () => {
  try {
    managedOutbounds.value = (await fetchNodeGroups()).groups
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
    const names = (profile.routing.policies || []).map((p) => p.name).filter(Boolean)
    siteSetNames.value = new Set([...names, FALLBACK_NAME])
    siteSetOrder.value = [...names, FALLBACK_NAME]
  } catch {
    // 拉不到就保持原样(空集 → 退回猜法),不让代理页因此打不开
  }
}
