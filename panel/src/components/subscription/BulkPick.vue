<template>
  <!-- 全选 / 反选 / 全不选。两栏共用同一组按钮,作用于整份候选集(不受过滤框影响) -->
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      @click="$emit('selectAll')"
    >
      {{ $t('groupSelectAll') }}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      @click="$emit('invert')"
    >
      {{ $t('groupInvert') }}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      @click="$emit('clear')"
    >
      {{ $t('groupSelectNone') }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ selectAll: []; invert: []; clear: [] }>()
</script>
