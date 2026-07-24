# Open-Box

OpenWrt 一体化透明代理方案:一条命令装完 sing-box 内核 + 管理面板。

- 设计文档:`docs/superpowers/specs/2026-07-21-open-box-design.md`
- 实施路线图:`docs/superpowers/plans/2026-07-24-open-box-roadmap.md`

## 仓库结构

- `panel/` 管理面板(fork 自 AnGe-ClashBoard,上游 zashboard,MIT)
- `openwrt/` init 脚本与 LuCI 兜底页(P5)
- `scripts/` install / update / uninstall(P6)
- `templates/` sing-box 配置模板(P2)

状态:开发中,尚不可安装使用。
