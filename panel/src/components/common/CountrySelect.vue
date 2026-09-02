<template>
  <!-- 带搜索的国家选择器。用 daisyUI 的 dropdown(靠 :focus-within 展开),不是原生
       <select>:原生 select 既放不下国旗,也没法在几十个国家里打字筛选。 -->
  <div class="dropdown w-full">
    <div
      tabindex="0"
      role="button"
      class="input input-sm hover:border-base-content/30 flex w-full cursor-pointer items-center gap-1.5"
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
      class="dropdown-content bg-base-100 border-base-content/10 z-10 mt-1 w-64 rounded-lg border p-2 shadow-lg"
    >
      <!-- 搜索框用全局那个 TextInput(带清除按钮),和别处的搜索长一样 -->
      <TextInput
        v-model="keyword"
        :placeholder="$t('subscriptionRenameCountrySearch')"
        clearable
      />
      <!-- 分类:图标一多就得分,不然找个公司要在几十面国旗里翻。
           只有真给了公司图标的地方才显示这一行(比如地区关键词那边就只能选国家)。 -->
      <div
        v-if="brands"
        role="tablist"
        class="tabs-box tabs tabs-xs mt-1 w-full"
      >
        <a
          v-for="tab in CATEGORY_TABS"
          :key="tab.key"
          role="tab"
          :class="['tab flex-1', category === tab.key && 'tab-active']"
          @click.stop="category = tab.key"
        >
          {{ $t(tab.labelKey) }}
        </a>
      </div>

      <ul class="mt-1 max-h-56 overflow-y-auto">
        <li
          v-for="b in brandOptions"
          :key="b.value"
        >
          <button
            type="button"
            class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            :class="{ 'bg-base-200': b.value === modelValue }"
            @click="choose(b.value)"
          >
            <CountryFlag
              :code="b.value"
              :size="16"
            />
            <span class="truncate">{{ b.label }}</span>
          </button>
        </li>
        <!-- 可清空时给一条「无」:图标是可选的,选错了得有路退回去 -->
        <!-- 地球图标排在国旗前面:跨地区的组(所有-自动、回国)配国旗都不对,
             这几个才是它们该用的。 -->
        <li
          v-for="g in globeOptions"
          :key="g.value"
        >
          <button
            type="button"
            class="hover:bg-base-200 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            :class="{ 'bg-base-200': g.value === modelValue }"
            @click="choose(g.value)"
          >
            <CountryFlag
              :code="g.value"
              :size="16"
            />
            <span class="truncate">{{ g.label }}</span>
          </button>
        </li>
        <li v-if="clearable">
          <button
            type="button"
            class="hover:bg-base-200 text-base-content/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            :class="{ 'bg-base-200': !modelValue }"
            @click="choose('')"
          >
            {{ placeholder || $t('subscriptionRenameCountrySearch') }}
          </button>
        </li>
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
          v-if="!filtered.length && !brandOptions.length && !globeOptions.length"
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
import { BRANDS, BRAND_PREFIX, brandName, findBrand } from '@/constant/brands'
import { COUNTRIES, GLOBE_ICONS, countryName, findCountry, globeIconKey } from '@/constant/countries'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  // ISO 3166-1 alpha-2;空/未定义 = 还没选(老记录里这个字段可能压根没有)
  modelValue?: string
  // 还没选国家时显示的文字(老档案里手写的地区名就放在这儿,不会被悄悄清掉)
  placeholder?: string
  // 列表顶上多给一条「无」,用来清空选择
  clearable?: boolean
  // 列出地球图标(节点组用;地区关键词那边必须选真国家)
  globes?: boolean
  // 列出公司/服务图标(策略、节点组用)。给了它才会出现「全部/地区/公司」分类
  brands?: boolean
  // 只给这些国家可选(按给定顺序,不再按名字排)。调用方用它把范围收窄到
  // "当前节点里真有的国家"——给一个选了也没用的选项没有意义。
  only?: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { t, locale } = useI18n()
const keyword = ref('')

type Category = 'all' | 'regions' | 'brands'
const CATEGORY_TABS: { key: Category; labelKey: string }[] = [
  { key: 'all', labelKey: 'iconCategoryAll' },
  { key: 'regions', labelKey: 'iconCategoryRegions' },
  { key: 'brands', labelKey: 'iconCategoryBrands' },
]
const category = ref<Category>('all')

const label = computed(() => {
  if (props.modelValue && props.modelValue.startsWith('globe:')) return t(globeIconKey(props.modelValue))
  const brand = findBrand(props.modelValue)
  if (brand) return brandName(brand, locale.value)
  const c = findCountry(props.modelValue || '')
  return c ? countryName(c, locale.value) : ''
})

const matches = (kw: string, ...fields: string[]) =>
  !kw || fields.some((f) => f.toLowerCase().includes(kw))

const options = computed(() => {
  if (props.only) {
    // 保持调用方给的顺序:那个顺序本身带着信息(比如按节点数从多到少)
    return props.only
      .map((code) => findCountry(code))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ code: c.code, label: countryName(c, locale.value) }))
  }
  return COUNTRIES.map((c) => ({ code: c.code, label: countryName(c, locale.value) })).sort((a, b) =>
    a.label.localeCompare(b.label, locale.value),
  )
})

// 代码和名字都能搜:输 "jp" 和输 "日本" 都该找到日本
// 地球图标只在明确要的地方给(节点组图标);地区关键词那边必须是真国家,不能选地球。
const globeOptions = computed(() => {
  if (!props.globes || category.value === 'brands') return []
  const kw = keyword.value.trim().toLowerCase()
  return GLOBE_ICONS.map((value) => ({ value, label: t(globeIconKey(value)) })).filter((g) =>
    matches(kw, g.label),
  )
})

// 公司图标:中英文名和关键词一起参与检索——输「奈飞」「netflix」「nf」都该找到它。
const brandOptions = computed(() => {
  if (!props.brands || category.value === 'regions') return []
  const kw = keyword.value.trim().toLowerCase()
  return BRANDS.filter((b) => matches(kw, b.zh, b.en, b.id, ...b.keywords)).map((b) => ({
    value: `${BRAND_PREFIX}${b.id}`,
    label: brandName(b, locale.value),
  }))
})

const filtered = computed(() => {
  if (category.value === 'brands') return []
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return options.value
  return options.value.filter((c) => matches(kw, c.label, c.code, ...(findCountry(c.code)?.keywords || [])))
})

const choose = (code: string) => {
  emit('update:modelValue', code)
  keyword.value = ''
  category.value = 'all'
  // dropdown 是靠 focus-within 展开的,挑完要主动失焦才收起来
  ;(document.activeElement as HTMLElement | null)?.blur()
}
</script>
