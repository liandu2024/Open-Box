<template>
  <div class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-5 p-4">
      <div>
        <h2 class="text-base font-semibold">{{ $t('routingRulesTitle') }}</h2>
      </div>

      <!-- Category → target mapping -->
      <div class="flex flex-col gap-2">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('routingCategoriesTitle') }}</h3>
          <p class="text-base-content/60 text-xs">{{ $t('routingCategoriesDescription') }}</p>
        </div>

        <div
          v-if="categories.length === 0"
          class="text-base-content/50 text-xs"
        >
          {{ $t('routingCategoryEmpty') }}
        </div>

        <div
          v-for="(cat, idx) in categories"
          :key="`${cat.ruleset}-${idx}`"
          class="flex flex-wrap items-center gap-2"
        >
          <span class="badge badge-outline font-mono text-xs">{{ cat.ruleset }}</span>
          <ArrowRightIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
          <select
            class="select select-sm min-w-0 flex-1"
            :value="cat.target"
            @change="changeCategoryTarget(idx, ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="opt in targetOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            :aria-label="$t('delete')"
            @click="removeCategory(idx)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="newCategoryRuleset"
            type="text"
            class="input input-sm w-40 font-mono"
            :placeholder="$t('routingCategoryRulesetPlaceholder')"
          />
          <select
            v-model="newCategoryTarget"
            class="select select-sm min-w-0 flex-1"
          >
            <option
              v-for="opt in targetOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
          <button
            type="button"
            class="btn btn-sm"
            :disabled="!isValidNewCategoryRuleset || categorySaving"
            @click="addCategory"
          >
            <PlusIcon class="h-4 w-4" />
            {{ $t('routingCategoryAdd') }}
          </button>
        </div>
        <p
          v-if="newCategoryRuleset && !isValidNewCategoryRuleset"
          class="text-error text-xs"
        >
          {{ $t('routingRulesetInvalidChars') }}
        </p>
        <p class="text-base-content/50 text-xs">{{ $t('routingCategoryRulesetHint') }}</p>

        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-base-content/50 text-xs">{{ $t('routingCategoryPresetsLabel') }}</span>
          <button
            v-for="preset in CATEGORY_PRESETS"
            :key="preset.ruleset"
            type="button"
            class="badge badge-ghost hover:badge-outline cursor-pointer text-xs"
            @click="newCategoryRuleset = preset.ruleset"
          >
            {{ $t(preset.labelKey) }}
          </button>
        </div>

        <p
          v-if="categoryError"
          class="text-error text-xs"
        >
          {{ categoryError }}
        </p>
      </div>

      <div class="divider my-0" />

      <!-- Always-direct rulesets -->
      <div class="flex flex-col gap-2">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('routingDirectRulesetsTitle') }}</h3>
          <p class="text-base-content/60 text-xs">{{ $t('routingDirectRulesetsDescription') }}</p>
        </div>

        <div
          v-if="directRulesets.length === 0"
          class="text-base-content/50 text-xs"
        >
          {{ $t('routingDirectRulesetEmpty') }}
        </div>

        <div
          v-else
          class="flex flex-wrap gap-2"
        >
          <span
            v-for="(tag, idx) in directRulesets"
            :key="`${tag}-${idx}`"
            class="badge badge-outline gap-1.5 font-mono text-xs"
          >
            {{ tag }}
            <button
              type="button"
              :aria-label="$t('delete')"
              @click="removeDirectRuleset(idx)"
            >
              <XMarkIcon class="h-3 w-3" />
            </button>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="newDirectRuleset"
            type="text"
            class="input input-sm w-48 font-mono"
            :placeholder="$t('routingDirectRulesetPlaceholder')"
            @keydown.enter="addDirectRuleset"
          />
          <button
            type="button"
            class="btn btn-sm"
            :disabled="!isValidNewDirectRuleset || directSaving"
            @click="addDirectRuleset"
          >
            <PlusIcon class="h-4 w-4" />
            {{ $t('routingDirectRulesetAdd') }}
          </button>
        </div>
        <p
          v-if="newDirectRuleset && !isValidNewDirectRuleset"
          class="text-error text-xs"
        >
          {{ $t('routingRulesetInvalidChars') }}
        </p>

        <p
          v-if="directError"
          class="text-error text-xs"
        >
          {{ directError }}
        </p>
      </div>

      <div class="divider my-0" />

      <!-- Ad blocking -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold">{{ $t('routingAdBlockTitle') }}</h3>
            <p class="text-base-content/60 text-xs">{{ $t('routingAdBlockDescription') }}</p>
          </div>
          <input
            type="checkbox"
            class="toggle shrink-0"
            :checked="profile.routing.adBlock"
            @change="onAdBlockToggle"
          />
        </div>

        <div
          v-if="profile.routing.adBlock"
          class="flex flex-wrap items-center gap-2"
        >
          <label class="text-xs font-medium">{{ $t('routingAdRulesetLabel') }}</label>
          <input
            type="text"
            class="input input-sm min-w-0 flex-1 font-mono"
            :value="profile.routing.adRuleset"
            @change="onAdRulesetChange"
          />
        </div>

        <p
          v-if="adBlockError"
          class="text-error text-xs"
        >
          {{ adBlockError }}
        </p>
      </div>

      <div class="divider my-0" />

      <!-- Fallback -->
      <div class="flex flex-col gap-2">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('routingFallbackTitle') }}</h3>
          <p class="text-base-content/60 text-xs">{{ $t('routingFallbackDescription') }}</p>
        </div>
        <select
          class="select select-sm w-full sm:w-auto"
          :value="profile.routing.fallback"
          @change="onFallbackChange"
        >
          <option
            v-for="opt in targetOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
        <p
          v-if="fallbackError"
          class="text-error text-xs"
        >
          {{ fallbackError }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OpenboxPolicyGroup, OpenboxProfile, OpenboxProfileRoutingCategory } from '@/api/openbox'
import { RULESET_TAG_PATTERN } from '@/api/openbox'
import { ArrowRightIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  profile: OpenboxProfile
  policyGroups: OpenboxPolicyGroup[]
  patchProfile: (patch: Record<string, unknown>) => Promise<OpenboxProfile>
}>()

const { t } = useI18n()

// A few well-known GeoSite category tags to fill the "add category" input as a starting point —
// purely a client-side convenience (fills the text field, nothing is added until the user
// clicks Add). They still have to exist as a rule-set file on this device like any other tag;
// see routingCategoryRulesetHint below.
const CATEGORY_PRESETS = [
  { labelKey: 'routingPresetAI', ruleset: 'geosite-openai' },
  { labelKey: 'routingPresetStreaming', ruleset: 'geosite-netflix' },
  { labelKey: 'routingPresetGoogle', ruleset: 'geosite-google' },
  { labelKey: 'routingPresetGithub', ruleset: 'geosite-github' },
  { labelKey: 'routingPresetTelegram', ruleset: 'geosite-telegram' },
] as const

const proxyTag = computed(() => props.profile.routing.proxyTag || 'PROXY')
const categories = computed(() => props.profile.routing.categories || [])
const directRulesets = computed(() => props.profile.routing.directRulesets || [])

const targetOptions = computed(() => [
  { value: proxyTag.value, label: t('routingTargetProxy') },
  { value: 'direct', label: t('direct') },
  ...props.policyGroups.map((g) => ({
    value: g.name,
    label: t('routingTargetGroup', { name: g.name, count: g.nodeCount }),
  })),
])

// -------- categories --------

const categoryError = ref('')
const categorySaving = ref(false)

const runCategoryPatch = async (next: OpenboxProfileRoutingCategory[]) => {
  categoryError.value = ''
  categorySaving.value = true
  try {
    await props.patchProfile({ routing: { categories: next } })
    return true
  } catch (error) {
    categoryError.value = t('routingSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    categorySaving.value = false
  }
}

const removeCategory = (idx: number) => {
  void runCategoryPatch(categories.value.filter((_, i) => i !== idx))
}

const changeCategoryTarget = (idx: number, target: string) => {
  void runCategoryPatch(categories.value.map((c, i) => (i === idx ? { ...c, target } : c)))
}

const newCategoryRuleset = ref('')
const newCategoryTarget = ref('')
const isValidNewCategoryRuleset = computed(() => RULESET_TAG_PATTERN.test(newCategoryRuleset.value.trim()))

watch(
  targetOptions,
  (opts) => {
    if (!newCategoryTarget.value && opts.length) newCategoryTarget.value = opts[0].value
  },
  { immediate: true },
)

const addCategory = async () => {
  const ruleset = newCategoryRuleset.value.trim()
  if (!RULESET_TAG_PATTERN.test(ruleset) || categorySaving.value) return

  const target = newCategoryTarget.value || targetOptions.value[0]?.value || proxyTag.value
  const ok = await runCategoryPatch([...categories.value, { ruleset, target }])
  if (ok) newCategoryRuleset.value = ''
}

// -------- direct rulesets --------

const directError = ref('')
const directSaving = ref(false)

const runDirectPatch = async (next: string[]) => {
  directError.value = ''
  directSaving.value = true
  try {
    await props.patchProfile({ routing: { directRulesets: next } })
    return true
  } catch (error) {
    directError.value = t('routingSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    directSaving.value = false
  }
}

const removeDirectRuleset = (idx: number) => {
  void runDirectPatch(directRulesets.value.filter((_, i) => i !== idx))
}

const newDirectRuleset = ref('')
const isValidNewDirectRuleset = computed(() => RULESET_TAG_PATTERN.test(newDirectRuleset.value.trim()))

const addDirectRuleset = async () => {
  const tag = newDirectRuleset.value.trim()
  if (!RULESET_TAG_PATTERN.test(tag) || directSaving.value) return
  if (directRulesets.value.includes(tag)) {
    newDirectRuleset.value = ''
    return
  }

  const ok = await runDirectPatch([...directRulesets.value, tag])
  if (ok) newDirectRuleset.value = ''
}

// -------- ad blocking --------

const adBlockError = ref('')

const onAdBlockToggle = async (event: Event) => {
  adBlockError.value = ''
  try {
    await props.patchProfile({ routing: { adBlock: (event.target as HTMLInputElement).checked } })
  } catch (error) {
    adBlockError.value = t('routingSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

const onAdRulesetChange = async (event: Event) => {
  const value = (event.target as HTMLInputElement).value.trim()
  if (!RULESET_TAG_PATTERN.test(value)) {
    adBlockError.value = t('routingRulesetInvalidChars')
    return
  }

  adBlockError.value = ''
  try {
    await props.patchProfile({ routing: { adRuleset: value } })
  } catch (error) {
    adBlockError.value = t('routingSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

// -------- fallback --------

const fallbackError = ref('')

const onFallbackChange = async (event: Event) => {
  fallbackError.value = ''
  try {
    await props.patchProfile({ routing: { fallback: (event.target as HTMLSelectElement).value } })
  } catch (error) {
    fallbackError.value = t('routingSaveFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
</script>
