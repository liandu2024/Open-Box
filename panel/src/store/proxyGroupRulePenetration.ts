import { fetchPolicyEntries, type OpenboxPolicyEntry } from '@/api/openbox'
import { ref } from 'vue'

// 「域名穿透」对话框的状态。对话框只有一个实例(挂在代理页),这里是它的单例状态。
export type PenetrationTab = 'all' | 'domain' | 'ip'
export type PenetrationSortKey = 'type' | 'content' | 'source'

const PAGE_SIZE = 100

export const penetrationDialogVisible = ref(false)
export const penetrationDialogGroupName = ref('')
export const penetrationDialogLoading = ref(false)
export const penetrationDialogLoadingMore = ref(false)
export const penetrationDialogError = ref('')
export const penetrationDialogEntries = ref<OpenboxPolicyEntry[]>([])
export const penetrationDialogMissing = ref<string[]>([])
export const penetrationDialogFallback = ref(false)
export const penetrationDialogSearch = ref('')
export const penetrationDialogTab = ref<PenetrationTab>('all')
export const penetrationDialogSortKey = ref<PenetrationSortKey | null>(null)
export const penetrationDialogSortDirection = ref<'asc' | 'desc'>('asc')
export const penetrationDialogCounts = ref({ all: 0, domain: 0, ip: 0 })
export const penetrationDialogTotal = ref(0)
export const penetrationDialogOffset = ref(0)
export const penetrationDialogHasMore = ref(false)

let latestRequestId = 0

const resetDialogState = () => {
  penetrationDialogEntries.value = []
  penetrationDialogMissing.value = []
  penetrationDialogFallback.value = false
  penetrationDialogError.value = ''
  penetrationDialogCounts.value = { all: 0, domain: 0, ip: 0 }
  penetrationDialogTotal.value = 0
  penetrationDialogOffset.value = 0
  penetrationDialogHasMore.value = false
}

export const loadPenetration = async (options?: { append?: boolean }) => {
  const name = penetrationDialogGroupName.value
  if (!name) {
    resetDialogState()
    return
  }
  const append = options?.append === true
  if (append) {
    if (penetrationDialogLoading.value || penetrationDialogLoadingMore.value || !penetrationDialogHasMore.value) return
    penetrationDialogLoadingMore.value = true
  } else {
    penetrationDialogLoading.value = true
    penetrationDialogError.value = ''
  }
  const requestId = ++latestRequestId
  const offset = append ? penetrationDialogOffset.value + PAGE_SIZE : 0
  try {
    const data = await fetchPolicyEntries({
      name,
      tab: penetrationDialogTab.value,
      q: penetrationDialogSearch.value.trim(),
      sort: penetrationDialogSortKey.value || '',
      dir: penetrationDialogSortDirection.value,
      offset,
      limit: PAGE_SIZE,
    })
    if (requestId !== latestRequestId) return
    penetrationDialogFallback.value = data.fallback
    penetrationDialogCounts.value = data.counts
    penetrationDialogTotal.value = data.total
    penetrationDialogMissing.value = data.missing
    penetrationDialogOffset.value = data.offset
    penetrationDialogHasMore.value = data.hasMore
    penetrationDialogEntries.value = append ? [...penetrationDialogEntries.value, ...data.entries] : data.entries
  } catch (error) {
    if (requestId !== latestRequestId) return
    if (!append) resetDialogState()
    penetrationDialogError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === latestRequestId) {
      penetrationDialogLoading.value = false
      penetrationDialogLoadingMore.value = false
    }
  }
}

export const openPenetrationDialog = async (groupName: string) => {
  penetrationDialogGroupName.value = groupName
  penetrationDialogSearch.value = ''
  penetrationDialogTab.value = 'all'
  penetrationDialogSortKey.value = null
  penetrationDialogSortDirection.value = 'asc'
  resetDialogState()
  penetrationDialogVisible.value = true
  await loadPenetration()
}
