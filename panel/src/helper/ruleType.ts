// 规则条目类型的通俗叫法,全项目共用:代理页「域名穿透」、站点集详情弹窗都从这里取,
// 别再各自造一遍。键对应 i18n 的 ruleType*(三语齐全)。
export const RULE_TYPE_LABEL_KEY: Record<string, string> = {
  domain: 'ruleTypeDomain',
  domain_suffix: 'ruleTypeDomainSuffix',
  domain_keyword: 'ruleTypeDomainKeyword',
  domain_regex: 'ruleTypeDomainRegex',
  ip_cidr: 'ruleTypeIpCidr',
}

export const ruleTypeLabelKey = (type: string): string => RULE_TYPE_LABEL_KEY[type] || 'ruleTypeOther'
