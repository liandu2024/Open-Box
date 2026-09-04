<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/pic/logo-dark.png">
  <img src="docs/pic/logo.png" alt="Open-Box" height="72">
</picture>

OpenWrt 上的一体化透明代理:一条命令装完 sing-box 内核和管理面板,首次打开面板设个密码、跟引导走,不用手写任何配置文件。

订阅、节点、分流规则、DNS 接管、防火墙改动全部由面板托管,配错了也能一键恢复直连。

## 界面

**代理 · 策略**:每个站点集一张卡片,直接看到它此刻走哪条线路、下面这些节点的健康状况。

![代理页策略页签](docs/pic/proxies-policies.webp)

**域名穿透**:展开任意一条策略,一层层看到「站点集 → 节点组 → 具体节点」的完整链路,每一层都能当场改。

![域名穿透](docs/pic/proxies-penetration.webp)

**规则 · 真实路由**:输入一个域名,先按规则推一遍,再真发一次请求看它实际走了哪条线、DNS 用了哪台服务器、命中第几条规则。

![规则调试](docs/pic/rules-route-test.webp)

**订阅管理**:Clash 配置和分享链接都能吃,节点按地区自动改名分组。

![订阅管理](docs/pic/settings-subscriptions.webp)

**节点管理**:自动择优组和手动组混排,动态组按关键词自动收编新节点,不用每次刷新订阅回来重勾一遍。

![节点管理](docs/pic/settings-groups.webp)

**目标分流**:一个站点集 = 一组匹配条件 + 一个同名出口,规则集来自 MetaCubeX 的 meta-rules-dat(含被墙域名表)。

![目标分流](docs/pic/settings-policies.webp)

**后端设置**:IPv6、测速地址、自身升级和规则集更新的计划任务都在这里。

![后端设置](docs/pic/settings-backend.webp)

## 它能做什么

- **订阅**:Clash YAML 与 base64 分享链接都支持,协议覆盖 shadowsocks / vmess / vless(含 REALITY)/ trojan / hysteria2 / tuic / anytls / wireguard。导入尽量宽松——自签、过期、张冠李戴的证书都不拦,只要节点本身能用就让它通。
- **节点组**:自动择优(url-test)和手动选择(select)两种;动态组按关键词自动跟着订阅走,静态组手工挑。
- **目标分流**:站点集按域名 / 域名后缀 / 关键词 / 规则集 / IP 段匹配,出口在代理页点选,选完即成为默认。规则集来自 MetaCubeX/meta-rules-dat 的 sing 分支,geosite 1899 类、geoip 260 类,可按需下载。
- **终端分流**:按局域网来源 IP 给指定设备单独指定出口。
- **DNS 接管**:三种模式——接管 dnsmasq 转发(默认)、防火墙劫持、完全禁用。国内域名走本地解析拿就近 CDN,走代理的域名经代理侧解析,两边分开。
- **共享网络**:把内核的入站开放给局域网里的其它设备当代理用。
- **流量统计**:每日流量按终端设备 / 节点 / 访问目标三个维度下钻。
- **自动更新**:Open-Box 自身与 Geosite / GeoIP 都能按天定时检查,有新版才升。
- **LuCI 兜底页**:面板打不开时,从路由器自带界面一键停代理、恢复直连。

## 硬件要求

- **CPU 架构**:x86_64 或 arm64(aarch64)。mips / mipsel 这类老款路由器不支持。
- **可用存储**:≥ 512MB。16MB / 32MB flash 的经典入门路由器装不下,需要自带 eMMC/NAND,或者接 USB 盘 / TF 卡做 `extroot`。
- **可用内存**:≥ 512MB。
- **系统**:OpenWrt。安装脚本会检查 `/etc/openwrt_release`,不是 OpenWrt 直接拒装。

以上任一条不满足,`install.sh` 的预检会报错退出,不会碰你的系统。发布包同时提供两种架构,日常验证主要在 x86_64 上进行。

## 安装

SSH 以 root 登录路由器,二选一:

```bash
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh
```

GitHub 访问不畅时用加速版(脚本内置了几个加速站,会依次探测自动挑一个能用的):

```bash
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh -s -- --mirror
```

已经有信得过的加速站,也可以指定具体前缀跳过探测:`sh -s -- --mirror <镜像前缀>`。

安装脚本先做预检(架构、存储、内存、系统),通过才下载对应架构的发布包、校验 SHA256、铺装到 `/opt/open-box/` 并启动面板。校验不过或下载失败,系统不会有任何改动。

装完之后:

1. 浏览器打开脚本输出的地址,一般是 `http://<路由器局域网 IP>:2026`。
2. 首次访问强制**设置管理密码**——安装过程不生成随机密码。
3. 跟引导走:加订阅、挑分流、启动内核。

面板默认只允许局域网访问,由防火墙规则保证,不会自动开到公网。

## 升级

面板「设置 → 后端设置」里点「检查更新」就能升,也可以在 SSH 里跑:

```bash
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/update.sh | sh
```

强制直连 GitHub 加 `-s -- --direct`,强制走加速加 `-s -- --mirror [前缀]`。不带参数时沿用安装时选的下载通道。

升级保留 `data/`(订阅、规则、面板密码)和已生效的运行配置,只替换程序本体。升级前内核在跑的话,升级完会按新版本重新生成配置并自动把内核带起来。

## 卸载

```bash
# 停服务、清理系统改动、删程序文件;默认保留 data/
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh

# 连 data/ 一起删,彻底清干净
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh -s -- --purge
```

不加 `--purge` 且在真实终端里交互执行时,脚本会追问一次是否保留 `data/`;通过管道非交互执行问不到,按"保留"处理。

## LuCI 兜底页

装完之后路由器自带界面里会多一个入口:**服务 → Open-Box**。面板本身打不开时用它救场:

- 分别启停内核与面板服务,以及各自的开机自启
- 「紧急停止并恢复直连」:停代理、撤掉路由 / 防火墙 / DNS 改动,回到裸直连
- 跳转打开面板

被自己配的分流规则卡在外面时,先去这一页。

## 安全提示

**面板后端拥有路由器 root 级权限**(它要改防火墙、接管 DNS、启停系统服务)。所以:

- 面板端口 2026 默认只监听局域网,**不要裸端口转发到公网**。
- 确实要在外网用,请自己在前面套一层带认证的 HTTPS 反向代理,或者先用 VPN 接进局域网再访问。
- 节点侧的 TLS 证书校验默认跳过(机场自签、过期、甚至用别人域名的证书是常态,校验只会让能用的节点连不上)。节点本身的密码 / UUID 认证不受影响。

## 仓库结构

- `panel/` 管理面板(fork 自 AnGe-ClashBoard,上游 zashboard,MIT)
- `openwrt/` init 脚本与 LuCI 兜底页
- `scripts/` install / update / uninstall / build-release
- `templates/` sing-box 配置模板
- `docs/` 设计文档与真机验收指南

## 本地开发

```bash
bash scripts/dev-panel.sh                    # 构建并启动面板于 http://127.0.0.1:2026
cd panel && corepack pnpm run test:server    # 服务端测试
cd panel && corepack pnpm run type-check     # 类型检查
```
