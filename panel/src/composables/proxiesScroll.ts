import { PROXY_CARD_SIZE } from '@/constant'
import { findScrollableParent } from '@/helper/utils'
import { isWindowResizing } from '@/helper/windowResizeState'
import { minProxyCardWidth, proxyCardSize } from '@/store/settings'
import { useCurrentElement, useElementSize, useInfiniteScroll } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

export const useCalculateMaxProxies = (totalProxies: number, activeIndex: number) => {
  const el = useCurrentElement()
  const { width } = useElementSize(el)
  const stableWidth = ref(0)

  const syncStableWidth = () => {
    if (width.value > 0) {
      stableWidth.value = width.value
    }
  }

  const initMaxProxies = computed(() => {
    const effectiveWidth = stableWidth.value || width.value

    return (
      Math.max(Math.floor(effectiveWidth / minProxyCardWidth.value), 2) *
      (proxyCardSize.value === PROXY_CARD_SIZE.LARGE ? 9 : 12)
    )
  })
  const maxProxies = ref(Math.max(24, activeIndex + 12))

  onMounted(() => {
    watch(
      width,
      () => {
        if (!isWindowResizing.value) {
          syncStableWidth()
        }
      },
      { immediate: true },
    )

    watch(isWindowResizing, (resizing) => {
      if (!resizing) {
        nextTick(() => {
          syncStableWidth()
        })
      }
    })

    watch(
      initMaxProxies,
      () => {
        maxProxies.value = Math.max(maxProxies.value, initMaxProxies.value)
      },
      { immediate: true },
    )

    nextTick(() => {
      const scrollEl = findScrollableParent(el.value as HTMLElement)

      useInfiniteScroll(
        scrollEl,
        () => {
          maxProxies.value = Math.min((maxProxies.value += initMaxProxies.value), totalProxies)
        },
        {
          distance: 100,
          canLoadMore: () => {
            return maxProxies.value < totalProxies
          },
        },
      )
    })
  })

  return {
    maxProxies,
  }
}
