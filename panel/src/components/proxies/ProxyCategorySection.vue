<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  titleMeta?: string
  showDivider?: boolean
  collapsed?: boolean
  toggleable?: boolean
  flushBottom?: boolean
}>(), {
  showDivider: false,
  collapsed: false,
  toggleable: true,
  flushBottom: false,
})

defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section
    class="flex flex-col"
    :class="props.flushBottom ? 'pb-0' : 'pb-3'"
  >
    <div
      v-if="showDivider"
      class="border-base-300/55 mb-1 border-t"
    />
    <div
      class="w-full overflow-hidden"
      :class="props.toggleable ? 'cursor-pointer select-none' : ''"
      :style="props.toggleable ? { cursor: 'pointer' } : undefined"
      :data-toggleable="props.toggleable"
      @click.stop="props.toggleable && $emit('toggle')"
    >
      <div
        class="flex min-h-10 w-full items-center justify-between gap-2 pb-0.5 text-left"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <div
            v-if="$slots.handle"
            class="shrink-0"
            @click.stop
          >
            <slot name="handle" />
          </div>
          <p
            class="text-base-content min-w-0 flex-1 text-left text-base font-medium"
            :class="props.toggleable ? 'cursor-pointer' : ''"
            :style="props.toggleable ? { cursor: 'pointer' } : undefined"
          >
            {{ title }}
            <span
              v-if="titleMeta"
              class="text-base-content/60 ml-1 text-sm font-normal"
            >
              {{ titleMeta }}
            </span>
          </p>
        </div>
        <div class="shrink-0">
          <slot name="action" />
        </div>
      </div>
      <div v-if="props.toggleable && collapsed">
        <slot name="collapsed" />
      </div>
    </div>
    <div v-if="!props.toggleable || !collapsed">
      <slot />
    </div>
  </section>
</template>
