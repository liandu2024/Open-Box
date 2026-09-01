<template>
  <!-- 全选 / 反选 / 清空选择 + 右端的订阅下拉框。三个按钮作用于「当前下拉框与过滤框
       框出来的那一批」(范围由父组件算好传进事件里),所以下拉框和它们放在同一行:
       选中一条订阅再按「全选」,加进来的正好是那条订阅的节点。 -->
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
    <select
      class="select select-xs ml-auto max-w-32"
      :value="subscription"
      @change="$emit('update:subscription', ($event.target as HTMLSelectElement).value)"
    >
      <!-- 值带前缀是为了不和订阅名撞车:订阅名是用户随便起的,直接拿名字当值的话,
           有人把订阅命名成「全部节点」就分不出这一项到底指哪个了。 -->
      <option value="">
        {{ $t('groupFilterAllSubscriptions') }}
      </option>
      <option value="kind:group">
        {{ $t('groupFilterAllGroups') }}
      </option>
      <option value="kind:node">
        {{ $t('groupFilterAllNodes') }}
      </option>
      <option
        v-for="name in subscriptions"
        :key="name"
        :value="`sub:${name}`"
      >
        {{ name }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  // 节点实际来自的订阅名(去重后)。为空时下拉框只有「全部」一项。
  subscriptions: string[]
  subscription: string
}>()

defineEmits<{
  selectAll: []
  invert: []
  clear: []
  'update:subscription': [string]
}>()
</script>
