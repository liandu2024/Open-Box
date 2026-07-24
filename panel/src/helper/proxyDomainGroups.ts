import type { Rule } from '@/types'

export const DOMAIN_GROUP_PRE_CUSTOM_KEY = '__custom_pre__'
export const DOMAIN_GROUP_POST_CUSTOM_KEY = '__custom_post__'
export const DOMAIN_GROUP_CUSTOM_SOURCE = '__custom_source__'

const RULE_TYPE_ALIAS_MAP = new Map([
  ['DOMAIN', 'DOMAIN'],
  ['DOMAINSUFFIX', 'DOMAIN-SUFFIX'],
  ['DOMAINKEYWORD', 'DOMAIN-KEYWORD'],
  ['IPCIDR', 'IP-CIDR'],
  ['IPCIDR6', 'IP-CIDR6'],
  ['SRCIP', 'SRC-IP'],
  ['SRCIPCIDR', 'SRC-IP-CIDR'],
  ['SRCIPCIDR6', 'SRC-IP-CIDR6'],
  ['DSTPORT', 'DST-PORT'],
  ['SRCPORT', 'SRC-PORT'],
  ['INPORT', 'IN-PORT'],
  ['GEOIP', 'GEOIP'],
  ['RULESET', 'RULE-SET'],
  ['FINAL', 'FINAL'],
  ['MATCH', 'MATCH'],
])

export const normalizeProxyRuleTypeName = (value: string) => {
  const normalizedKey = String(value || '')
    .trim()
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()

  return RULE_TYPE_ALIAS_MAP.get(normalizedKey) || String(value || '').trim().toUpperCase()
}

export const isProxyRuleEnabled = (rule: Rule) => {
  if (rule?.extra) {
    return !rule.extra.disabled
  }

  return !rule?.disabled
}

export const isRuleSetProxyRule = (rule: Rule) => {
  return normalizeProxyRuleTypeName(rule?.type || '') === 'RULE-SET'
}

export const isDomainGroupCustomKey = (groupName: string) => {
  return groupName === DOMAIN_GROUP_PRE_CUSTOM_KEY || groupName === DOMAIN_GROUP_POST_CUSTOM_KEY
}

export const getSortedEnabledProxyRules = (rules: Rule[]) => {
  return [...rules]
    .filter((rule) => isProxyRuleEnabled(rule))
    .sort((left, right) => (left?.index || 0) - (right?.index || 0))
}

export const isCustomDomainGroupRule = (rule: Rule) => {
  const normalizedType = normalizeProxyRuleTypeName(rule?.type || '')

  return Boolean(normalizedType) && !['RULE-SET', 'MATCH', 'FINAL'].includes(normalizedType)
}

export const getCustomDomainGroupSections = (rules: Rule[]) => {
  const enabledRules = getSortedEnabledProxyRules(rules)
  const ruleSetIndexes = enabledRules
    .map((rule, index) => (isRuleSetProxyRule(rule) ? index : -1))
    .filter((index) => index >= 0)

  if (ruleSetIndexes.length === 0) {
    return {
      pre: enabledRules.filter((rule) => isCustomDomainGroupRule(rule)),
      post: [] as Rule[],
    }
  }

  const firstRuleSetIndex = ruleSetIndexes[0]
  const lastRuleSetIndex = ruleSetIndexes[ruleSetIndexes.length - 1]

  return {
    pre: enabledRules.filter(
      (rule, index) => index < firstRuleSetIndex && isCustomDomainGroupRule(rule),
    ),
    post: enabledRules.filter(
      (rule, index) => index > lastRuleSetIndex && isCustomDomainGroupRule(rule),
    ),
  }
}

export const getDomainGroupNames = (
  rules: Rule[],
  policyGroupNames: string[],
  includeEmptyCustomSections = false,
) => {
  const { pre, post } = getCustomDomainGroupSections(rules)
  const showCustomSections = includeEmptyCustomSections || pre.length > 0 || post.length > 0
  const orderedPolicyGroupNames = policyGroupNames.filter((name) => !isDomainGroupCustomKey(name))
  const otherIndex = orderedPolicyGroupNames.indexOf('其他')
  const groupsBeforeOther = otherIndex >= 0 ? orderedPolicyGroupNames.slice(0, otherIndex) : orderedPolicyGroupNames
  const groupsFromOther = otherIndex >= 0 ? orderedPolicyGroupNames.slice(otherIndex) : []

  return [
    ...(showCustomSections ? [DOMAIN_GROUP_PRE_CUSTOM_KEY] : []),
    ...groupsBeforeOther,
    ...groupsFromOther,
    ...(showCustomSections ? [DOMAIN_GROUP_POST_CUSTOM_KEY] : []),
  ]
}

export const getDomainGroupRuleSetOptions = (groupName: string, rules: Rule[]) => {
  if (!groupName || isDomainGroupCustomKey(groupName)) {
    return []
  }

  const enabledRules = getSortedEnabledProxyRules(rules).filter(
    (rule) => isProxyRuleEnabled(rule) && String(rule.proxy || '').trim() === groupName,
  )
  const options: string[] = []
  const seen = new Set<string>()
  let hasCustomSource = false

  enabledRules.forEach((rule) => {
    if (isRuleSetProxyRule(rule)) {
      const providerName = String(rule.payload || '').trim()

      if (!providerName || seen.has(providerName)) {
        return
      }

      seen.add(providerName)
      options.push(providerName)
      return
    }

    hasCustomSource = true
  })

  if (hasCustomSource) {
    options.unshift(DOMAIN_GROUP_CUSTOM_SOURCE)
  }

  return options
}
