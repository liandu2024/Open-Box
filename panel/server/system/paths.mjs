export const createPaths = (root = '/opt/open-box') => ({
  root,
  bin: `${root}/bin`,
  singbox: `${root}/bin/sing-box`,
  etc: `${root}/etc`,
  configPath: `${root}/etc/config.json`,
  dataDir: `${root}/data`,
  rulesetDir: `${root}/data/rulesets`,
  initd: { core: '/etc/init.d/openbox', panel: '/etc/init.d/openbox-panel' },
})
