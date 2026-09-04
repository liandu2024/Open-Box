// 流量表里"名称"后面那个灰字:DHCP 主机名,或者"本机 · WAN pppoe-wan0"这种路由器自身地址的
// 标注。主表和下钻表共用,别各写一遍。
import type { OpenboxTrafficRow } from '@/api/openbox'

export const trafficRowNote = (row: OpenboxTrafficRow, t: (key: string, params?: Record<string, unknown>) => string): string => {
  if (row.self) {
    if (row.self.kind === 'lan') return t('trafficSelfLan', { iface: row.self.iface })
    if (row.self.kind === 'wan') return t('trafficSelfWan', { iface: row.self.iface })
    return t('trafficSelfOther', { iface: row.self.iface })
  }
  return row.name || ''
}
