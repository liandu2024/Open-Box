export const createPaths = (root = '/opt/open-box') => ({
  root,
  bin: `${root}/bin`,
  singbox: `${root}/bin/sing-box`,
  etc: `${root}/etc`,
  configPath: `${root}/etc/config.json`,
  // 共享网络的自签证书(system/tls-keypair.mjs)
  certsDir: `${root}/etc/certs`,
  tlsCert: `${root}/etc/certs/server.crt`,
  tlsKey: `${root}/etc/certs/server.key`,
  dataDir: `${root}/data`,
  rulesetDir: `${root}/data/rulesets`,
  // 内核的 cache_file:记住各 selector 的选择,重启不丢
  cacheDb: `${root}/data/cache.db`,
  metaPath: `${root}/meta.json`,
  updateScript: `${root}/update.sh`,
  channelPath: `${root}/data/channel`,
  // 和 scripts/update.sh 里 STATUS_PATH / UPDATE_LOG 的默认值一致(TMPDIR 未设置时)
  updateStatusPath: '/tmp/openbox-update.status',
  // OpenWrt dnsmasq 的 DHCP 租约表,每日流量「访问终端」用它把 IP 翻成主机名
  dhcpLeases: '/tmp/dhcp.leases',
  updateLogPath: '/tmp/openbox-update.log',
  geoUpdateStatePath: `${root}/data/geo-update.json`,
  scheduleStatePath: `${root}/data/schedule-state.json`,
  initd: { core: '/etc/init.d/openbox', panel: '/etc/init.d/openbox-panel' },
})
