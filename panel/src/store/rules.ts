import { isValidPenetrationTarget } from '@/api/openbox'
import { fetchRuleProvidersAPI, fetchRulesAPI } from '@/api'
import type { Rule, RuleProvider } from '@/types'
import { computed, ref } from 'vue'

export const rulesFilter = ref('')

// 搜索框里只有一个词、且像域名或 IP(带 . 或 :)时,当作一次穿透查询:去问服务端这个
// 目标会命中哪条规则、走哪个站点集/出口(RulesPage 顶上的结果卡片)。
// 「格式化查询」:把整条 URL(https://board.ok1248.cn:4433/#/settings)整理成 host[:port]
// (board.ok1248.cn:4433)。不带协议的也处理:去掉路径/参数/账号密码,统一小写。
export const normalizeRuleTarget = (input: string): string => {
  const raw = input.trim()
  if (!raw) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : raw.startsWith('//') ? `http:${raw}` : `http://${raw}`
  try {
    const url = new URL(withScheme)
    const host = url.hostname.toLowerCase()
    if (!host) return raw
    return url.port ? `${host}:${url.port}` : host
  } catch {
    return raw
  }
}

// host[:port] 形式的查询目标:host 用来查规则/DNS,port 只给「真实路由」发请求用
const parseHostPort = (value: string): { host: string; port: number | null } | null => {
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(value)
  if (!m) return null
  const port = m[2] ? Number(m[2]) : null
  if (port !== null && (port < 1 || port > 65535)) return null
  return { host: m[1], port }
}

export const lookupTarget = computed(() => {
  const value = rulesFilter.value.trim()
  if (!value || /\s/.test(value)) return ''
  const parsed = parseHostPort(value)
  if (!parsed) return ''
  if (!isValidPenetrationTarget(parsed.host)) return ''
  if (!parsed.host.includes('.')) return ''
  return value
})
export const lookupHost = computed(() => parseHostPort(lookupTarget.value)?.host || '')
export const lookupPort = computed(() => parseHostPort(lookupTarget.value)?.port ?? null)

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
