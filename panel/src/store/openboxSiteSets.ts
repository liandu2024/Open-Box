import { fetchProfile } from '@/api/openbox'
import { ref } from 'vue'

// 代理页「策略 / 节点」两个页签怎么分:zashboard 原来是猜的——一个组的成员如果全是
// 已知的叶子节点就算节点组,否则算策略组。这套猜法在 sing-box 上会翻车:clash_api 的
// /proxies 不列 direct / block,于是一个成员只有 direct 占位的空节点组(爱尔兰-自动)
// 会被当成策略组,跑到「策略」页签里去。
//
// Open-Box 自己知道哪些 selector 是站点集(routing.policies + 兜底「其他」),不用猜。
// 这里把名字拉过来,composables/proxies.ts 优先按它分;拉不到再退回原来的猜法。
export const siteSetNames = ref<Set<string>>(new Set())

// 兜底站点集的名字,和服务端 engine/routing-model.mjs 的 FALLBACK_TAG 同一个值
const FALLBACK_NAME = '其他'

export const loadOpenboxSiteSets = async () => {
  try {
    const profile = await fetchProfile()
    const names = (profile.routing.policies || []).map((p) => p.name).filter(Boolean)
    siteSetNames.value = new Set([...names, FALLBACK_NAME])
  } catch {
    // 拉不到就保持原样(空集 → 退回猜法),不让代理页因此打不开
  }
}
