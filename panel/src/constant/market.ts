// 面板里几处站点入口共用的地址与配色(概览页顶栏、订阅页空状态)。
// 只在这里写一次,别的地方引用,不要各自再抄一份。
export const MARKET_URL = 'https://blog.angeworld.cc/market'
export const SUPERDOOR_URL = 'https://ai.superdoor.top'
export const OPENDOOR_URL = 'https://ai.opendoor.sbs/'

// 纯 link-primary 在浅色主题下太淡,和正文挤在一起看不出是链接。往正文色方向混三成:
// 混 base-content 而不是混黑色,深色主题下同样是"更贴近正文色",不会糊成一团。
export const MARKET_LINK_STYLE = {
  color: 'color-mix(in srgb, var(--color-primary) 70%, var(--color-base-content) 30%)',
}
