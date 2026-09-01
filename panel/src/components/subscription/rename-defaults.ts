// A client-side mirror of server/engine/dictionaries.mjs's DEFAULT_REGION_DICT /
// DEFAULT_FEATURE_DICT, used purely to pre-populate the rename-rules editor with something
// legible on first open instead of a blank slate.
//
// Why a mirror and not a fetch: there is no `GET` endpoint that serves these defaults (the
// backend only ever *consumes* renameOptions — see server/api/subscriptions.mjs's
// `resolveNodes`), and this task's file list is frontend-only. If the backend's dictionaries
// change, this copy can drift; that's an accepted, documented gap (see task-5-report.md) rather
// than an attempt to add a new backend route out of scope.
//
// This only matters for the *initial* values shown in the editor — once the user has the page
// open, every edit is sent verbatim as `renameOptions` on each preview/save call, so the actual
// rename behavior is always driven by what's on screen, never by this file, after first load.
import type { OpenboxRenameRegionEntry } from '@/api/openbox'

export const DEFAULT_RENAME_TEMPLATE = '{region}-{feature}-{seq}'
export const DEFAULT_UNKNOWN_LABEL = '其他'
export const DEFAULT_SEQ_PAD = 2

export const DEFAULT_REGION_DICT: OpenboxRenameRegionEntry[] = [
  { code: 'US', name: '美国', keywords: ['us', 'united states', 'america', '美国', '美國', '洛杉矶', '洛杉磯', '硅谷', '圣何塞', '西雅图', '纽约'] },
  { code: 'HK', name: '香港', keywords: ['hk', 'hong kong', 'hongkong', '香港', '深港'] },
  { code: 'JP', name: '日本', keywords: ['jp', 'japan', '日本', '东京', '東京', '大阪'] },
  { code: 'SG', name: '新加坡', keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城'] },
  { code: 'TW', name: '台湾', keywords: ['tw', 'taiwan', '台湾', '台灣', '臺灣', '台北'] },
  { code: 'KR', name: '韩国', keywords: ['kr', 'korea', '韩国', '韓國', '首尔', '首爾'] },
  { code: 'GB', name: '英国', keywords: ['uk', 'gb', 'united kingdom', 'britain', '英国', '英國', '伦敦', '倫敦'] },
  { code: 'DE', name: '德国', keywords: ['de', 'germany', '德国', '德國', '法兰克福', '法蘭克福'] },
]

// 特征改成扁平关键词表:命中哪个词就把那个词本身(转大写)写进节点名,
// 不再折叠成一个统一标签(见 server/engine/dictionaries.mjs 的同名常量)。
export const DEFAULT_FEATURE_KEYWORDS: string[] = ['iepl', 'iplc', 'ipv6', '专线', '家宽', '2x']

// 过滤关键词:机场订阅里混着的公告/广告条目。默认只放最没歧义的三个词——这是个
// "会让节点消失"的功能,默认值宁可保守(见 server/engine/dictionaries.mjs 同名常量)。
export const DEFAULT_EXCLUDE_KEYWORDS: string[] = ['官网', '工单', '客服']
