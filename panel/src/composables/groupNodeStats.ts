import { NOT_CONNECTED } from '@/constant'
import { getLatencyByName } from '@/store/proxies'
import { computed, type Ref } from 'vue'

// 卡片标题后面的「有效 / 总数」。有效 = 这个成员最近一次延迟测试有结果——和预览里的点
// "不是灰色"是同一个口径(renderProxies 的"只看可用"也是这么判的),数字和点对得上。
// 总数按组的成员表算,嵌套的组也算一个成员(点里也有它)。
export const useGroupNodeStats = (members: Ref<string[]>, groupName: string) =>
  computed(() => {
    const total = members.value.length
    const valid = members.value.filter((name) => getLatencyByName(name, groupName) !== NOT_CONNECTED).length
    return { valid, total }
  })
