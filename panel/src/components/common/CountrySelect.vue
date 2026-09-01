<template>
  <!-- 带搜索的国家选择器。用 daisyUI 的 dropdown(靠 :focus-within 展开),不是原生
       <select>:原生 select 既放不下国旗,也没法在几十个国家里打字筛选。 -->
  <div class="dropdown">
    <div
      tabindex="0"
      role="button"
      class="input input-sm flex w-full items-center gap-1.5"
    >
      <CountryFlag
        :code="modelValue"
        :size="16"
        :title="label"
      />
      <span
        class="min-w-0 flex-1 truncate text-left"
        :class="{ 'text-base-content/40': !label }"
      >
        {{ label || placeholder }}
      </span>
      <ChevronDownIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
    </div>
    <div
      tabindex="0"
      class="dropdown-content bg-base-100 border-base-content/10 z-10 mt-1 w-56 rounded-lg border p-2 shadow-lg"
    >
      <!-- 搜索框用全局那个 TextInput(带清除按钮),和别处的搜索长一样 -->
      <TextInput
        v-model="keyword"
        :placeholder="$t('subscriptionRenameCountrySearch')"
        clearable
      />
      <ul class="mt-1 max-h-56 overflow-y-auto">
        <li
          v-for="c in filtered"
          :key="c.code"
        >
          <button
            type="button"
            class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            :class="{ 'bg-base-200': c.code === modelValue }"
            @click="choose(c.code)"
          >
            <CountryFlag
              :code="c.code"
              :size="16"
            />
            <span class="truncate">{{ c.label }}</span>
            <span class="text-base-content/40 ml-auto text-xs">{{ c.code }}</span>
          </button>
        </li>
        <li
          v-if="!filtered.length"
          class="text-base-content/50 px-2 py-3 text-center text-xs"
        >
          {{ $t('subscriptionRenameCountryNoMatch') }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import CountryFlag from '@/components/common/CountryFlag.vue'
import TextInput from '@/components/common/TextInput.vue'
import { COUNTRIES, countryName, findCountry } from '@/constant/countries'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  // ISO 3166-1 alpha-2;空 = 还没选
  modelValue: string
  // 还没选国家时显示的文字(老档案里手写的地区名就放在这儿,不会被悄悄清掉)
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { locale } = useI18n()
const keyword = ref('')

const label = computed(() => {
  const c = findCountry(props.modelValue)
  return c ? countryName(c, locale.value) : ''
})

const options = computed(() =>
  COUNTRIES.map((c) => ({ code: c.code, label: countryName(c, locale.value) })).sort((a, b) =>
    a.label.localeCompare(b.label, locale.value),
  ),
)

// 代码和名字都能搜:输 "jp" 和输 "日本" 都该找到日本
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return options.value
  return options.value.filter(
    (c) => c.label.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw),
  )
})

const choose = (code: string) => {
  emit('update:modelValue', code)
  keyword.value = ''
  // dropdown 是靠 focus-within 展开的,挑完要主动失焦才收起来
  ;(document.activeElement as HTMLElement | null)?.blur()
}
</script>
