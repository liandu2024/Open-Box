<template>
  <div :class="`collapse ${isExpanded ? 'collapse-open' : 'collapse-close'}`">
    <div
      class="collapse-title overflow-hidden pr-4"
      :class="[!disableCollapse && 'cursor-pointer']"
      @click="!disableCollapse && (showCollapse = !showCollapse)"
    >
      <slot name="title" />
      <slot
        v-if="!isExpanded"
        name="preview"
      />
    </div>
    <div
      class="collapse-content !p-0"
      @transitionend="handlerTransitionEnd"
    >
      <div
        v-if="shouldRenderContent"
        class="px-4 pt-0 pb-4 max-md:px-3 max-md:pt-0 max-md:pb-3"
        :class="[
          contentScrollable && 'max-h-108 overflow-y-auto',
          contentScrollable && SCROLLABLE_PARENT_CLASS,
          !isExpanded && 'opacity-0',
        ]"
      >
        <slot name="content" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SCROLLABLE_PARENT_CLASS } from '@/helper/utils'
import { isWindowResizing } from '@/helper/windowResizeState'
import { collapseGroupMap } from '@/store/settings'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    contentScrollable?: boolean
    disableCollapse?: boolean
  }>(),
  {
    contentScrollable: true,
    disableCollapse: false,
  },
)

const showCollapse = computed({
  get() {
    return collapseGroupMap.value[props.name]
  },
  set(value) {
    collapseGroupMap.value[props.name] = value
  },
})

const isExpanded = computed(() => props.disableCollapse || showCollapse.value)
const showContent = ref(isExpanded.value)

watch(showCollapse, (value) => {
  if (value) {
    showContent.value = true
  }
})

watch(
  () => props.disableCollapse,
  (value) => {
    if (value) {
      showContent.value = true
    }
  },
  { immediate: true },
)

const shouldRenderContent = computed(() => (props.disableCollapse || showContent.value) && !isWindowResizing.value)

const handlerTransitionEnd = () => {
  if (!isExpanded.value) {
    showContent.value = false
  }
}
</script>
