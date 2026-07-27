import { serviceStatus } from './service.mjs'

export const CONFLICT_SERVICES = Object.freeze([
  { id: 'openclash', label: 'OpenClash', initd: '/etc/init.d/openclash' },
  { id: 'nikki', label: 'Nikki', initd: '/etc/init.d/nikki' },
  { id: 'passwall', label: 'PassWall', initd: '/etc/init.d/passwall' },
  { id: 'passwall2', label: 'PassWall2', initd: '/etc/init.d/passwall2' },
  { id: 'shadowsocksr', label: 'ShadowSocksR Plus+', initd: '/etc/init.d/shadowsocksr' },
  { id: 'homeproxy', label: 'HomeProxy', initd: '/etc/init.d/homeproxy' },
])

export const detectConflicts = async (ctx) => {
  const conflicts = []
  for (const svc of CONFLICT_SERVICES) {
    if (!(await ctx.exists(svc.initd))) continue
    const { running } = await serviceStatus(ctx, svc.initd)
    if (running) conflicts.push({ id: svc.id, label: svc.label, running: true })
  }
  return { conflicts, hasRunning: conflicts.length > 0 }
}
