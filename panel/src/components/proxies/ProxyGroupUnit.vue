<template>
  <div class="card overflow-hidden border border-base-300/60">
    <template
      v-for="(name, index) in names"
      :key="name"
    >
      <div
        v-if="index > 0"
        class="border-base-300/55 mx-5 border-t max-md:mx-3"
      />
      <div class="px-4 py-3 max-md:px-3 max-md:py-2.5">
        <ProxyEmbeddedGroup :name="name" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ProxyEmbeddedGroup from './ProxyEmbeddedGroup.vue'

defineProps<{
  names: string[]
}>()
</script>
