<template>
  <div class="relative">
    <XMarkIcon
      v-if="beforeClose && clearable"
      :class="clearIconClass"
      @click="clearInput"
    />
    <input
      v-model="inputValue"
      ref="inputRef"
      type="text"
      :class="['input input-sm join-item w-full', inputPaddingClass]"
      :placeholder="placeholder || ''"
      :maxlength="maxlength"
      :name="name || ''"
      :autocomplete="autocomplete || ''"
      @click="handlerSearchInputClick"
      @input="(emits('input', inputValue || ''), hideTip())"
      @change="emits('change', inputValue || '')"
    />
    <div
      v-if="hasSuffix"
      class="absolute top-1/2 right-1 z-10 -translate-y-1/2"
    >
      <slot name="suffix" />
    </div>
    <XMarkIcon
      v-if="!beforeClose && clearable"
      :class="clearIconClass"
      @click="clearInput"
    />
  </div>
</template>

<script lang="ts" setup>
import { useTooltip } from '@/helper/tooltip'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, createApp, defineComponent, h, ref, useSlots } from 'vue'

const emits = defineEmits<{
  (e: 'input', value: string): void
  (e: 'change', value: string): void
  (e: 'update:menus', value: string[]): void
}>()

const props = defineProps<{
  placeholder?: string
  beforeClose?: boolean
  name?: string
  autocomplete?: string
  maxlength?: number | string
  clearable?: boolean
  menus?: string[]
  menusDeleteable?: boolean
}>()

const inputValue = defineModel<string>()
const slots = useSlots()
const hasSuffix = computed(() => Boolean(slots.suffix))
const inputPaddingClass = computed(() => {
  if (props.clearable && hasSuffix.value) {
    return 'pr-14'
  }

  if (props.clearable || hasSuffix.value) {
    return 'pr-8'
  }

  return ''
})
const clearIconClass = computed(() => {
  return [
    'absolute top-2 z-10 h-4 w-3 cursor-pointer hover:scale-125',
    hasSuffix.value ? 'right-8' : 'right-2',
  ]
})

const clearInput = () => {
  inputValue.value = ''
}

const { showTip, hideTip } = useTooltip()
const inputRef = ref<HTMLInputElement>()
const handlerSearchInputClick = (e: Event) => {
  if (!props.menus?.length) {
    return
  }
  const PopContent = defineComponent({
    props: {
      menus: {
        type: Array,
        default: () => [],
      },
      menusDeleteable: {
        type: Boolean,
        default: false,
      },
    },
    setup(props: { menus: string[]; menusDeleteable: boolean }) {
      return () =>
        h(
          'div',
          { class: 'max-h-64 overflow-y-auto overflow-x-hidden scrollbar-hidden min-w-24 py-1' },
          props.menus.map((item) =>
            h(
              'div',
              {
                class:
                  'cursor-pointer rounded-sm p-1 px-3 flex gap-2 items-center overflow-hidden hover:bg-base-300',
              },
              [
                h(
                  'span',
                  {
                    class: 'flex-1 truncate',
                    onClick: () => {
                      inputValue.value = item
                      hideTip()
                      inputRef.value?.focus()
                    },
                  },
                  item,
                ),
                props.menusDeleteable &&
                  h(XMarkIcon, {
                    class: 'h-3 w-3 transition-transform hover:scale-125',
                    onClick: (e) => {
                      const target = e.target as HTMLElement

                      emits(
                        'update:menus',
                        props.menus.filter((menu) => menu !== item),
                      )
                      target.closest('div')?.remove()
                    },
                  }),
              ],
            ),
          ),
        )
    },
  })
  const mountEl = document.createElement('div')
  const app = createApp(PopContent, {
    menus: props.menus,
    menusDeleteable: props.menusDeleteable,
  })

  app.mount(mountEl)

  showTip(e, mountEl, {
    theme: 'base',
    placement: 'bottom-start',
    trigger: 'click',
    interactive: true,
    appendTo: document.body,
    arrow: false,
  })
}
</script>
