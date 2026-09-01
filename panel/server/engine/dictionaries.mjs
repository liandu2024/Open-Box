export const DEFAULT_REGION_DICT = [
  { code: 'US', name: '美国', keywords: ['us', 'united states', 'america', '美国', '美國', '洛杉矶', '洛杉磯', '硅谷', '圣何塞', '西雅图', '纽约'] },
  { code: 'HK', name: '香港', keywords: ['hk', 'hong kong', 'hongkong', '香港', '深港'] },
  { code: 'JP', name: '日本', keywords: ['jp', 'japan', '日本', '东京', '東京', '大阪'] },
  { code: 'SG', name: '新加坡', keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城'] },
  { code: 'TW', name: '台湾', keywords: ['tw', 'taiwan', '台湾', '台灣', '臺灣', '台北'] },
  { code: 'KR', name: '韩国', keywords: ['kr', 'korea', '韩国', '韓國', '首尔', '首爾'] },
  { code: 'GB', name: '英国', keywords: ['uk', 'gb', 'united kingdom', 'britain', '英国', '英國', '伦敦', '倫敦'] },
  { code: 'DE', name: '德国', keywords: ['de', 'germany', '德国', '德國', '法兰克福', '法蘭克福'] },
]

// 特征不再是「标签 + 一堆同义词」两层结构,而是一条扁平关键词表:命中哪个关键词就把
// 那个词本身(转大写)写进节点名。之前 iepl/iplc/专线 都会被折叠成同一个标签「专线」,
// 现在 iplc 命中就显示 IPLC,信息不再被抹掉。
export const DEFAULT_FEATURE_KEYWORDS = ['iepl', 'iplc', 'ipv6', '专线', '家宽', '2x']
