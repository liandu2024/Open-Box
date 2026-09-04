// 关键词匹配。这是 server/engine/rename.mjs 里 keywordMatches / normalizeForMatch 的
// 前端镜像,只用于**预览**(动态组里实时显示"按现在的节点会选中谁")。
//
// 真正决定成员的永远是服务端那份:生成配置时按当前节点重新算一遍。这里若与那边有出入,
// 表现是预览和实际不符——所以两边改动要一起改。之所以不共用一份代码:服务端是 .mjs,
// 走的是 Node 运行时,前端打包进不来。
//
// 规则有两条,都不是随便定的:
//   1. 纯 ASCII 短码(us/hk/jp)要按 token 边界匹配,否则 Russia 里的 "us"、
//      Sweden 里的 "de" 都会误命中。
//   2. 国旗 emoji 本质是两个区域指示符字母(🇭🇰 = H,K),先还原成 ASCII,
//      "🇭🇰香港 01" 才会被关键词 "hk" 命中。

const SHORT_ASCII_CODE = /^[a-z]{2,3}$/i
const REGIONAL_INDICATOR_PAIR = /[\u{1F1E6}-\u{1F1FF}]{2}/gu

export const normalizeForMatch = (text: string): string =>
  String(text || '')
    .replace(
      REGIONAL_INDICATOR_PAIR,
      (flag) =>
        ' ' +
        [...flag].map((c) => String.fromCharCode((c.codePointAt(0) as number) - 0x1f1e6 + 97)).join('') +
        ' ',
    )
    .toLowerCase()

export const keywordMatches = (normalizedName: string, keyword: string): boolean => {
  const needle = normalizeForMatch(keyword).trim()
  if (!needle) return false
  if (SHORT_ASCII_CODE.test(needle)) {
    // 与 server/engine/rename.mjs 一致:cn 不匹配 CN2 线路名(CN2 GIA / CN2-01),否则预览和内核不一致
    const tail = needle === 'cn' ? '(?!2(?![0-9]))' : ''
    return new RegExp(`(^|[^a-z])${needle}${tail}([^a-z]|$)`, 'i').test(normalizedName)
  }
  return normalizedName.includes(needle)
}
