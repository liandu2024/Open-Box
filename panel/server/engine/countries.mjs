// 全部国家 / 地区的目录:和 src/constant/countries.ts 是同一份数据(那边多两种语言的名字),
// countries.test.mjs 盯着两边一致。改这里之前先改那边。
//
// 用途是地区识别的兜底(rename.mjs):订阅自己的地区词典默认只有十来个常见地区,马来西亚 /
// 泰国 / 印尼这些的节点以前一律落进「其他」。用户词典没命中的,再来这里查一遍。
export const COUNTRY_CATALOG = Object.freeze([
  { code: 'HK', name: '香港', keywords: ['hk', 'hong', '香港', 'hong kong', 'hongkong', '深港'] },
  { code: 'TW', name: '台湾', keywords: ['tw', 'taiwan', '台湾', '台灣', '臺灣', '台北'] },
  { code: 'JP', name: '日本', keywords: ['jp', 'japan', '日本', '东京', '東京', '大阪'] },
  { code: 'SG', name: '新加坡', keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城'] },
  { code: 'KR', name: '韩国', keywords: ['kr', 'korea', '韩国', '韓國', '首尔', '首爾'] },
  { code: 'US', name: '美国', keywords: ['us', 'united', '美国', '美國', 'united states', 'america', '洛杉矶', '洛杉磯', '硅谷', '圣何塞', '西雅图', '纽约'] },
  { code: 'GB', name: '英国', keywords: ['gb', 'united', '英国', '英國', 'uk', 'united kingdom', 'britain', '伦敦', '倫敦'] },
  { code: 'DE', name: '德国', keywords: ['de', 'germany', '德国', '德國', '法兰克福', '法蘭克福'] },
  { code: 'FR', name: '法国', keywords: ['fr', 'france', '法国', '法國', '巴黎'] },
  { code: 'NL', name: '荷兰', keywords: ['nl', 'netherlands', '荷兰', '荷蘭', 'holland', '阿姆斯特丹'] },
  { code: 'CA', name: '加拿大', keywords: ['ca', 'canada', '加拿大', '多伦多', '多倫多'] },
  { code: 'AU', name: '澳大利亚', keywords: ['au', 'australia', '澳大利亚', '澳大利亞', '澳洲', '悉尼'] },
  { code: 'RU', name: '俄罗斯', keywords: ['ru', 'russia', '俄罗斯', '俄羅斯', '莫斯科'] },
  { code: 'TR', name: '土耳其', keywords: ['tr', 'turkey', '土耳其', 'turkiye', '伊斯坦布尔'] },
  { code: 'IN', name: '印度', keywords: ['in', 'india', '印度', '孟买', '孟買'] },
  { code: 'MY', name: '马来西亚', keywords: ['my', 'malaysia', '马来西亚', '馬來西亞', '大马', '吉隆坡'] },
  { code: 'TH', name: '泰国', keywords: ['th', 'thailand', '泰国', '泰國', '曼谷'] },
  { code: 'VN', name: '越南', keywords: ['vn', 'vietnam', '越南', '胡志明'] },
  { code: 'PH', name: '菲律宾', keywords: ['ph', 'philippines', '菲律宾', '菲律賓', '马尼拉'] },
  { code: 'ID', name: '印度尼西亚', keywords: ['id', 'indonesia', '印度尼西亚', '印度尼西亞', '印尼', '雅加达'] },
  { code: 'MO', name: '澳门', keywords: ['mo', 'macao', '澳门', '澳門', 'macau'] },
  { code: 'CN', name: '中国', keywords: ['cn', 'china', '中国', '中國', '回国', 'back to china'] },
  { code: 'IT', name: '意大利', keywords: ['it', 'italy', '意大利', '義大利', '米兰'] },
  { code: 'ES', name: '西班牙', keywords: ['es', 'spain', '西班牙', '马德里'] },
  { code: 'PT', name: '葡萄牙', keywords: ['pt', 'portugal', '葡萄牙', '里斯本'] },
  { code: 'CH', name: '瑞士', keywords: ['ch', 'switzerland', '瑞士', '苏黎世', '蘇黎世'] },
  { code: 'AT', name: '奥地利', keywords: ['at', 'austria', '奥地利', '奧地利', '维也纳'] },
  { code: 'BE', name: '比利时', keywords: ['be', 'belgium', '比利时', '比利時'] },
  { code: 'IE', name: '爱尔兰', keywords: ['ie', 'ireland', '爱尔兰', '愛爾蘭', '都柏林'] },
  { code: 'SE', name: '瑞典', keywords: ['se', 'sweden', '瑞典', '斯德哥尔摩'] },
  { code: 'NO', name: '挪威', keywords: ['no', 'norway', '挪威'] },
  { code: 'FI', name: '芬兰', keywords: ['fi', 'finland', '芬兰', '芬蘭', '赫尔辛基'] },
  { code: 'DK', name: '丹麦', keywords: ['dk', 'denmark', '丹麦', '丹麥'] },
  { code: 'PL', name: '波兰', keywords: ['pl', 'poland', '波兰', '波蘭', '华沙'] },
  { code: 'CZ', name: '捷克', keywords: ['cz', 'czechia', '捷克', 'czech', '布拉格'] },
  { code: 'RO', name: '罗马尼亚', keywords: ['ro', 'romania', '罗马尼亚', '羅馬尼亞'] },
  { code: 'UA', name: '乌克兰', keywords: ['ua', 'ukraine', '乌克兰', '烏克蘭'] },
  { code: 'KZ', name: '哈萨克斯坦', keywords: ['kz', 'kazakhstan', '哈萨克斯坦', '哈薩克', '哈萨克'] },
  { code: 'MN', name: '蒙古', keywords: ['mn', 'mongolia', '蒙古'] },
  { code: 'KH', name: '柬埔寨', keywords: ['kh', 'cambodia', '柬埔寨', '金边'] },
  { code: 'MM', name: '缅甸', keywords: ['mm', 'myanmar', '缅甸', '緬甸'] },
  { code: 'AE', name: '阿联酋', keywords: ['ae', 'united', '阿联酋', '阿聯酋', 'uae', 'united arab emirates', '迪拜'] },
  { code: 'SA', name: '沙特阿拉伯', keywords: ['sa', 'saudi', '沙特阿拉伯', '沙烏地阿拉伯', '沙特'] },
  { code: 'IL', name: '以色列', keywords: ['il', 'israel', '以色列'] },
  { code: 'EG', name: '埃及', keywords: ['eg', 'egypt', '埃及'] },
  { code: 'ZA', name: '南非', keywords: ['za', 'south', '南非', 'south africa', '约翰内斯堡'] },
  { code: 'NG', name: '尼日利亚', keywords: ['ng', 'nigeria', '尼日利亚', '奈及利亞'] },
  { code: 'BR', name: '巴西', keywords: ['br', 'brazil', '巴西', '圣保罗', '聖保羅'] },
  { code: 'AR', name: '阿根廷', keywords: ['ar', 'argentina', '阿根廷'] },
  { code: 'CL', name: '智利', keywords: ['cl', 'chile', '智利'] },
  { code: 'MX', name: '墨西哥', keywords: ['mx', 'mexico', '墨西哥'] },
  { code: 'NZ', name: '新西兰', keywords: ['nz', 'new', '新西兰', '紐西蘭', 'new zealand', '奥克兰'] },
])

// 兜底匹配时要去掉的关键词:两个字母的国家代码里有不少正好是英文单词(in / no / at / it /
// be / my / id …),"IPLC in HK""Back to Home" 这类名字会被误认;'united' 'south' 'new'
// 'saudi' 这种单个词同样太泛("New York"不是新西兰)。用户自己词典里的关键词不受此限——
// 那是他明确写下的。
const AMBIGUOUS = new Set([
  'in', 'no', 'at', 'it', 'be', 'my', 'id', 'so', 'to', 'on', 'of', 'or', 'as', 'is', 'am', 'an', 'by', 'do', 'go', 'if', 'me', 'up',
  'united', 'south', 'new', 'saudi',
])
export const FALLBACK_REGION_DICT = Object.freeze(
  COUNTRY_CATALOG.map((c) => ({ code: c.code, name: c.name, keywords: c.keywords.filter((k) => !AMBIGUOUS.has(k)) }))
    .filter((c) => c.keywords.length > 0),
)
