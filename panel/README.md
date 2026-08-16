# Open-Box 面板

Open-Box 面板是 `Open-Box`(OpenWrt 一体化透明代理方案)的管理面板部分,基于 `Vue 3 + TypeScript + Vite` 开发,面向本机 `sing-box` 内核的运行态管理、观测与排错。

面板本身 fork 自 [AnGe-ClashBoard](https://github.com/liandu2024/AnGe-ClashBoard),其上游为开源项目 [zashboard](https://github.com/Zephyruso/zashboard)。授权与来源声明见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md),请勿删除或改写这两个文件。

整个 Open-Box 项目(内核安装、init 脚本、面板)见仓库根目录的 [README](../README.md) 与 [设计文档](../docs/superpowers/specs/2026-07-21-open-box-design.md)。

## 当前状态

开发中,尚不可安装使用。以下内容描述面板已经实现的功能,不代表整个 Open-Box 项目已可交付。

## 功能特点

- **单一后端**:仅对接本机 `sing-box` 内核,不支持多后端切换、不做多控制器管理
- **强制设密**:首次访问要求设置管理密码,支持随时修改密码
- **首次运行向导**:引导选择语言、地区、推荐分流默认值、导入首个订阅,并用示意图展示流量路径(设备 → Open-Box → 出口决策)
- **订阅管理**:添加、刷新、删除订阅,重命名规则支持实时预览
- **策略分流可视化**:按分类查看与调整路由规则、策略组
- **DNS / IPv6 设置**:DNS 模式(转发 / 接管)与 IPv6 开关配置
- **内核管理**:查看 sing-box 版本与运行状态、部署状态、紧急情况下一键回退为直连
- **穿透查询**:按域名 / IP 查询规则命中结果与最终节点,便于排查分流问题
- **三语言**:简体中文、繁體中文、English
- **三主题**:跟随系统、浅色、深色
- **服务端持久化**:配置、背景图、规则缓存均落盘在本地 SQLite,切换浏览器后仍可保留

## 本地开发

推荐从仓库根目录启动(会构建面板并启动本地服务,监听 `http://127.0.0.1:2026`):

```bash
bash scripts/dev-panel.sh
```

也可以在 `panel/` 目录下分别启动前后端:

```bash
corepack pnpm install
corepack pnpm run dev:full   # 同时启动 vite dev server 与本地持久化服务
```

运行服务端测试:

```bash
corepack pnpm run test:server
```

## 服务端持久化

面板内置轻量 Node 服务,用于保存设置、背景图与规则缓存,默认数据库路径为:

```bash
./data/zashboard.sqlite
```

可通过环境变量 `ZASHBOARD_DB_PATH` 覆盖(变量名沿用自 fork 之前的项目,尚未随品牌一起改名)。

## 项目结构

- `src/`:前端代码
- `server/`:本地持久化与 API 后端
- `data/`:运行时数据目录
- `public/`:静态资源
- `scripts/`:开发与构建辅助脚本

## 授权

面板基于上游 `zashboard` 二次开发,经由 `AnGe-ClashBoard` fork 而来。上游使用 `MIT License`,因此在保留原许可证声明的前提下可以继续修改、发布和分发。

请保留仓库中的 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md) 文件。

## 致谢

- 上游项目:[zashboard](https://github.com/Zephyruso/zashboard)
- 中间 fork:[AnGe-ClashBoard](https://github.com/liandu2024/AnGe-ClashBoard)
- Clash / Mihomo / sing-box 生态项目与规则集作者
