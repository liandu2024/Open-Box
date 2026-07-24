<template>
  <Teleport to="#app-content">
    <Transition name="modal">
      <div
        v-show="isOpen"
        ref="backdropRef"
        class="modal modal-open"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? 'dialog-title' : undefined"
        @keydown.escape="close"
      >
        <!-- 遮罩层，点击关闭 -->
        <div
          class="modal-backdrop w-screen"
          aria-hidden="true"
          @click="close"
        />
        <!-- 弹层内容，阻止点击穿透 -->
        <div
          class="modal-box bg-base-100 relative overflow-hidden p-0"
          :class="[
            blurIntensity < 5 && 'backdrop-blur-sm!',
            mobileFullscreen &&
              'max-md:h-dvh max-md:min-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:m-0',
            boxClass,
          ]"
          @click.stop
        >
          <div
            v-if="(title || slots['title-left']) && isOpen"
            id="dialog-title"
            class="border-base-content/10 relative flex items-center gap-2 border-b px-4 py-2 text-base font-bold"
            :class="headerClass"
          >
            <slot name="title-left" />
            <span v-if="title">
              {{ title }}
            </span>
            <slot name="title-right" />
            <button
              type="button"
              class="btn btn-circle btn-ghost btn-xs absolute top-1/2 right-2 -translate-y-1/2"
              aria-label="close"
              @click="close"
            >
              <XMarkIcon class="h-4 w-4" />
            </button>
          </div>
          <div
            v-if="isOpen"
            :class="[
              mobileFullscreen
                ? 'h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)] overflow-hidden'
                : 'max-h-[90dvh] overflow-y-auto max-md:max-h-[70dvh]',
              noPadding ? 'p-0' : 'p-4',
              contentClass,
            ]"
          >
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { blurIntensity } from '@/store/settings'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { useSlots } from 'vue'

const isOpen = defineModel<boolean>()
defineProps<{
  noPadding?: boolean
  boxClass?: string
  contentClass?: string
  headerClass?: string
  title?: string
  mobileFullscreen?: boolean
}>()
const slots = useSlots()

function close() {
  isOpen.value = false
}
</script>

<style scoped>
/* 进入/离开过渡 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .modal-backdrop,
.modal-leave-active .modal-backdrop {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-backdrop,
.modal-leave-to .modal-backdrop {
  opacity: 0;
}
.modal-enter-active .modal-box,
.modal-leave-active .modal-box {
  transition: transform 0.2s ease;
}
.modal-enter-from .modal-box,
.modal-leave-to .modal-box {
  transform: scale(0.95);
}
</style>
