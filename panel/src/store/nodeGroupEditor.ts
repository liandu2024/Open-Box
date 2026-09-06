import type { OpenboxUserGroup } from '@/api/openbox'
import { ref } from 'vue'

// 代理页节点卡片上的「修改」:弹窗只有一个实例(挂在代理页),卡片只管发出"要改哪个组"。
// seq 让连续两次点同一个组也能触发 watch。
export const nodeGroupEditRequest = ref<{ group: OpenboxUserGroup; seq: number } | null>(null)
let seq = 0

export const openNodeGroupEditor = (group: OpenboxUserGroup) => {
  seq += 1
  nodeGroupEditRequest.value = { group, seq }
}
