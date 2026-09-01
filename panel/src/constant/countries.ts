// 国家/地区目录。地区关键词表的每一行都绑定到这里的一条,而不是一个随手写的名字:
// 绑定之后才谈得上"这条规则对应哪个国家"——界面能给它配一面对应的国旗,匹配出来的
// 节点也就跟着有了国别归属(节点对象上的 regionCode,见 server/engine/rename.mjs)。
//
// 只收机场订阅里真会出现的国家/地区,不是完整的 ISO 3166 列表:下拉框长到几百条就
// 没法用了,而且每多一条就要多带一个国旗文件。要加就在这里加一行,再把上游对应的
// 正方形国旗放进 src/assets/flags/(见那边的 README)。
//
// code 用 ISO 3166-1 alpha-2 大写形式;国旗文件名是它的小写。
export interface Country {
  code: string
  zh: string
  tw: string
  en: string
  // 默认关键词。用户加一行时预填这些,之后随他改——真正参与匹配的永远是订阅里存的
  // 那份关键词表,这里只是省掉从零开始敲的功夫。
  keywords: string[]
}

export const COUNTRIES: Country[] = [
  { code: 'HK', zh: '香港', tw: '香港', en: 'Hong Kong', keywords: ['hk', 'hong', '香港', 'hong kong', 'hongkong', '深港'] },
  { code: 'TW', zh: '台湾', tw: '台灣', en: 'Taiwan', keywords: ['tw', 'taiwan', '台湾', '台灣', '臺灣', '台北'] },
  { code: 'JP', zh: '日本', tw: '日本', en: 'Japan', keywords: ['jp', 'japan', '日本', '东京', '東京', '大阪'] },
  { code: 'SG', zh: '新加坡', tw: '新加坡', en: 'Singapore', keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城'] },
  { code: 'KR', zh: '韩国', tw: '韓國', en: 'Korea', keywords: ['kr', 'korea', '韩国', '韓國', '首尔', '首爾'] },
  { code: 'US', zh: '美国', tw: '美國', en: 'United States', keywords: ['us', 'united', '美国', '美國', 'united states', 'america', '洛杉矶', '洛杉磯', '硅谷', '圣何塞', '西雅图', '纽约'] },
  { code: 'GB', zh: '英国', tw: '英國', en: 'United Kingdom', keywords: ['gb', 'united', '英国', '英國', 'uk', 'united kingdom', 'britain', '伦敦', '倫敦'] },
  { code: 'DE', zh: '德国', tw: '德國', en: 'Germany', keywords: ['de', 'germany', '德国', '德國', '法兰克福', '法蘭克福'] },
  { code: 'FR', zh: '法国', tw: '法國', en: 'France', keywords: ['fr', 'france', '法国', '法國', '巴黎'] },
  { code: 'NL', zh: '荷兰', tw: '荷蘭', en: 'Netherlands', keywords: ['nl', 'netherlands', '荷兰', '荷蘭', 'holland', '阿姆斯特丹'] },
  { code: 'CA', zh: '加拿大', tw: '加拿大', en: 'Canada', keywords: ['ca', 'canada', '加拿大', '多伦多', '多倫多'] },
  { code: 'AU', zh: '澳大利亚', tw: '澳大利亞', en: 'Australia', keywords: ['au', 'australia', '澳大利亚', '澳大利亞', '澳洲', '悉尼'] },
  { code: 'RU', zh: '俄罗斯', tw: '俄羅斯', en: 'Russia', keywords: ['ru', 'russia', '俄罗斯', '俄羅斯', '莫斯科'] },
  { code: 'TR', zh: '土耳其', tw: '土耳其', en: 'Turkey', keywords: ['tr', 'turkey', '土耳其', 'turkiye', '伊斯坦布尔'] },
  { code: 'IN', zh: '印度', tw: '印度', en: 'India', keywords: ['in', 'india', '印度', '孟买', '孟買'] },
  { code: 'MY', zh: '马来西亚', tw: '馬來西亞', en: 'Malaysia', keywords: ['my', 'malaysia', '马来西亚', '馬來西亞', '大马', '吉隆坡'] },
  { code: 'TH', zh: '泰国', tw: '泰國', en: 'Thailand', keywords: ['th', 'thailand', '泰国', '泰國', '曼谷'] },
  { code: 'VN', zh: '越南', tw: '越南', en: 'Vietnam', keywords: ['vn', 'vietnam', '越南', '胡志明'] },
  { code: 'PH', zh: '菲律宾', tw: '菲律賓', en: 'Philippines', keywords: ['ph', 'philippines', '菲律宾', '菲律賓', '马尼拉'] },
  { code: 'ID', zh: '印度尼西亚', tw: '印度尼西亞', en: 'Indonesia', keywords: ['id', 'indonesia', '印度尼西亚', '印度尼西亞', '印尼', '雅加达'] },
  { code: 'MO', zh: '澳门', tw: '澳門', en: 'Macao', keywords: ['mo', 'macao', '澳门', '澳門', 'macau'] },
  { code: 'CN', zh: '中国', tw: '中國', en: 'China', keywords: ['cn', 'china', '中国', '中國', '回国', 'back to china'] },
  { code: 'IT', zh: '意大利', tw: '義大利', en: 'Italy', keywords: ['it', 'italy', '意大利', '義大利', '米兰'] },
  { code: 'ES', zh: '西班牙', tw: '西班牙', en: 'Spain', keywords: ['es', 'spain', '西班牙', '马德里'] },
  { code: 'PT', zh: '葡萄牙', tw: '葡萄牙', en: 'Portugal', keywords: ['pt', 'portugal', '葡萄牙', '里斯本'] },
  { code: 'CH', zh: '瑞士', tw: '瑞士', en: 'Switzerland', keywords: ['ch', 'switzerland', '瑞士', '苏黎世', '蘇黎世'] },
  { code: 'AT', zh: '奥地利', tw: '奧地利', en: 'Austria', keywords: ['at', 'austria', '奥地利', '奧地利', '维也纳'] },
  { code: 'BE', zh: '比利时', tw: '比利時', en: 'Belgium', keywords: ['be', 'belgium', '比利时', '比利時'] },
  { code: 'IE', zh: '爱尔兰', tw: '愛爾蘭', en: 'Ireland', keywords: ['ie', 'ireland', '爱尔兰', '愛爾蘭', '都柏林'] },
  { code: 'SE', zh: '瑞典', tw: '瑞典', en: 'Sweden', keywords: ['se', 'sweden', '瑞典', '斯德哥尔摩'] },
  { code: 'NO', zh: '挪威', tw: '挪威', en: 'Norway', keywords: ['no', 'norway', '挪威'] },
  { code: 'FI', zh: '芬兰', tw: '芬蘭', en: 'Finland', keywords: ['fi', 'finland', '芬兰', '芬蘭', '赫尔辛基'] },
  { code: 'DK', zh: '丹麦', tw: '丹麥', en: 'Denmark', keywords: ['dk', 'denmark', '丹麦', '丹麥'] },
  { code: 'PL', zh: '波兰', tw: '波蘭', en: 'Poland', keywords: ['pl', 'poland', '波兰', '波蘭', '华沙'] },
  { code: 'CZ', zh: '捷克', tw: '捷克', en: 'Czechia', keywords: ['cz', 'czechia', '捷克', 'czech', '布拉格'] },
  { code: 'RO', zh: '罗马尼亚', tw: '羅馬尼亞', en: 'Romania', keywords: ['ro', 'romania', '罗马尼亚', '羅馬尼亞'] },
  { code: 'UA', zh: '乌克兰', tw: '烏克蘭', en: 'Ukraine', keywords: ['ua', 'ukraine', '乌克兰', '烏克蘭'] },
  { code: 'KZ', zh: '哈萨克斯坦', tw: '哈薩克', en: 'Kazakhstan', keywords: ['kz', 'kazakhstan', '哈萨克斯坦', '哈薩克', '哈萨克'] },
  { code: 'MN', zh: '蒙古', tw: '蒙古', en: 'Mongolia', keywords: ['mn', 'mongolia', '蒙古'] },
  { code: 'KH', zh: '柬埔寨', tw: '柬埔寨', en: 'Cambodia', keywords: ['kh', 'cambodia', '柬埔寨', '金边'] },
  { code: 'MM', zh: '缅甸', tw: '緬甸', en: 'Myanmar', keywords: ['mm', 'myanmar', '缅甸', '緬甸'] },
  { code: 'AE', zh: '阿联酋', tw: '阿聯酋', en: 'United Arab Emirates', keywords: ['ae', 'united', '阿联酋', '阿聯酋', 'uae', 'united arab emirates', '迪拜'] },
  { code: 'SA', zh: '沙特阿拉伯', tw: '沙烏地阿拉伯', en: 'Saudi Arabia', keywords: ['sa', 'saudi', '沙特阿拉伯', '沙烏地阿拉伯', '沙特'] },
  { code: 'IL', zh: '以色列', tw: '以色列', en: 'Israel', keywords: ['il', 'israel', '以色列'] },
  { code: 'EG', zh: '埃及', tw: '埃及', en: 'Egypt', keywords: ['eg', 'egypt', '埃及'] },
  { code: 'ZA', zh: '南非', tw: '南非', en: 'South Africa', keywords: ['za', 'south', '南非', 'south africa', '约翰内斯堡'] },
  { code: 'NG', zh: '尼日利亚', tw: '奈及利亞', en: 'Nigeria', keywords: ['ng', 'nigeria', '尼日利亚', '奈及利亞'] },
  { code: 'BR', zh: '巴西', tw: '巴西', en: 'Brazil', keywords: ['br', 'brazil', '巴西', '圣保罗', '聖保羅'] },
  { code: 'AR', zh: '阿根廷', tw: '阿根廷', en: 'Argentina', keywords: ['ar', 'argentina', '阿根廷'] },
  { code: 'CL', zh: '智利', tw: '智利', en: 'Chile', keywords: ['cl', 'chile', '智利'] },
  { code: 'MX', zh: '墨西哥', tw: '墨西哥', en: 'Mexico', keywords: ['mx', 'mexico', '墨西哥'] },
  { code: 'NZ', zh: '新西兰', tw: '紐西蘭', en: 'New Zealand', keywords: ['nz', 'new', '新西兰', '紐西蘭', 'new zealand', '奥克兰'] },
]

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

export const findCountry = (code: string): Country | undefined =>
  BY_CODE.get(String(code || '').toUpperCase())

// 按当前语言取显示名。locale 取值见 src/i18n('zh-CN' / 'zh-TW' / 'en')。
export const countryName = (c: Country, locale: string): string => {
  if (!locale.startsWith('zh')) return c.en
  return locale.includes('TW') || locale.includes('Hant') ? c.tw : c.zh
}
