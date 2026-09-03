import { isValidPenetrationTarget } from '@/api/openbox'
import { fetchRuleProvidersAPI, fetchRulesAPI } from '@/api'
import type { Rule, RuleProvider } from '@/types'
import { computed, ref } from 'vue'

export const rulesFilter = ref('')

// 搜索框里只有一个词、且像域名或 IP(带 . 或 :)时,当作一次穿透查询:去问服务端这个
// 目标会命中哪条规则、走哪个站点集/出口(RulesPage 顶上的结果卡片)。
export const lookupTarget = computed(() => {
  const value = rulesFilter.value.trim()
  if (!value || /\s/.test(value)) return ''
  if (!isValidPenetrationTarget(value)) return ''
  if (!value.includes('.') && !value.includes(':')) return ''
  return value
})

export const rules = ref<Rule[]>([])
export const ruleProviderList = ref<RuleProvider[]>([])

export const renderRules = computed(() => {
  const rulesFilterValue = rulesFilter.value.split(' ').map((f) => f.toLowerCase().trim())

  if (rulesFilter.value === '') {
    return rules.value
  }

  return rules.value.filter((rule) => {
    return rulesFilterValue.every((f) =>
      [rule.type.toLowerCase(), rule.payload.toLowerCase(), rule.proxy.toLowerCase()].some((i) =>
        i.includes(f),
      ),
    )
  })
})

export const fetchRules = async () => {
  const { data: ruleData } = await fetchRulesAPI()
  const { data: providerData } = await fetchRuleProvidersAPI()

  rules.value = ruleData.rules.map((rule) => {
    const proxy = rule.proxy
    const proxyName = proxy.startsWith('route(') ? proxy.substring(6, proxy.length - 1) : proxy

    return {
      ...rule,
      proxy: proxyName,
    }
  })
  ruleProviderList.value = Object.values(providerData.providers)
}
