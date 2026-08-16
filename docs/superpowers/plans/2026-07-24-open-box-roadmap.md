# Open-Box 实施路线图

> 规格:`docs/superpowers/specs/2026-07-21-open-box-design.md`
> 本项目按阶段拆分为多个实施计划,每阶段独立产出可运行、可测试的软件。
> 每个阶段的详细计划在前一阶段完成后按当时代码现状即时制定(just-in-time),避免过早写死细节。

## 阶段总览

| 阶段 | 名称 | 产出 | 依赖 |
| --- | --- | --- | --- |
| P1 | 仓库落地与面板导入 | monorepo 脚手架;AnGe-ClashBoard 代码导入 `panel/`;构建/测试/本地开发闭环跑通;品牌与端口改为 Open-Box/2026 | 无 |
| P2a | 后端引擎:订阅与节点 | 订阅解析(Clash YAML/分享链接/sing-box JSON × 七协议)→ 归一化节点模型 → 节点重命名引擎(区域归一+特征提取+模板+预览)→ 区域节点组自动生成;纯函数模块 `panel/server/engine/`,完整测试向量 TDD | P1 |
| P2b | 后端引擎:配置生成 | 节点→sing-box outbound;两层分流(策略分流+可选 DNS 分流)、IPv6、tun 入站、clash_api 9095 配置组装;钦定 sing-box 二进制 + `sing-box check` 金标准集成测试;边查官方 schema 边 TDD | P2a |
| P3 | 本地系统集成层 | system adapter:配置写入、init.d 服务控制、DNS 接管两模式的应用/还原、防火墙规则、冲突检测、启动失败恢复直连;OpenWrt 命令封装 + macOS mock 双实现 | P2 |
| P4a | 后端 API 层 | 把引擎/系统层接进 Express:订阅、profile、生成与部署、服务控制、本机 clash_api 代理固化、首次设密、sing-box 版穿透;移除 SSH/OpenClash 遗产 | P2b, P3 |
| P4b | 面板前端 | 单后端裁剪;首次引导向导;订阅管理与重命名规则 UI(含实时预览);策略分流可视化;DNS/IPv6 设置;内核管理页;登录认证;i18n 收敛(en/zh-Hans/zh-Hant)与三主题 | P2(接口),P3(联调) |
| P5 | OpenWrt 侧 | procd init 脚本(openbox / openbox-panel)、tun 与 DNS 接管落地脚本、LuCI 兜底页(luci-app-openbox,JS + rpcd ACL)、紧急停止 | P3 |
| P6 | 安装/升级/卸载与发布流水线 | install.sh(直连/镜像双通道、预检、随机密码、防火墙)、update.sh、uninstall.sh;GitHub Actions 按架构打包(Node 运行时 + 面板 + 脚本 + 元数据 + SHA256)发 Release | P5 |
| P7 | 端到端验收 | x86_64/arm64 OpenWrt 实测:装→引导→订阅→分流→断网恢复→升级→卸载全流程;故障注入(坏配置/kill 内核/订阅 4xx) | P6 |

## 关键全局约束(所有阶段共同遵守)

- 目标平台:OpenWrt 21.02+,仅 x86_64 + aarch64;Node 22+(`node:sqlite`);面板端口 2026;clash_api 127.0.0.1:9095
- sing-box 版本钦定制,配置模板与钦定版本严格匹配;不用 fake-ip
- 分流两层:策略分流(直连/拒绝/策略组)+ DNS 分流(可选,双通道隔离:直连 DNS 不经代理,代理 DNS 必经代理)
- 面板仅服务本机(单后端);本地文件下发,零 SSH
- 三语言 en/zh-Hans/zh-Hant,三主题 系统/亮/暗
- 失败保护:下发前 `sing-box check`;启动失败停止并清理,恢复裸直连
- 上游授权:面板 fork 自 AnGe-ClashBoard(上游 zashboard,MIT),保留 LICENSE 链

## 当前状态

- [x] 设计规格完成并确认
- [x] P1 完成并合并(仓库落地、panel/ fork 基线、构建测试闭环、品牌化 2026、dev-panel.sh)
- [x] P2a 完成并合并(引擎:订阅解析三格式七协议、归一化节点模型、重命名引擎、区域节点组;73 测试)
- [x] P2b 完成并合并(配置生成:emit 六协议+wireguard endpoint、策略组、路由、可选 DNS 分流、tun/clash_api 组装;104 测试 + sing-box check 金标准 3/3)
- [x] P3 完成并合并(系统集成:SystemContext、服务控制、冲突检测、校验归因、DNS 接管、防火墙、部署编排;146 测试 + 金标准 4/4)
- [x] P4 拆分为 P4a(后端 API,计划已制定:`docs/superpowers/plans/2026-07-27-p4a-backend-api.md`)与 P4b(前端 UI)
- [x] P4a 完成并合并(后端 API:瘦身 5154→860 行、存储契约、订阅/profile/部署/服务/穿透 API、代理固化、首次设密;273 测试 + 金标准 4/4;两轮安全终审修复)
- [x] P4b 完成并合并(前端:去多后端、三语言三主题、强制设密+改密、首次引导向导、订阅/分流/内核/穿透 UI、品牌收尾;283 测试 + 金标准 4/4)
- [x] P5 完成并合并(OpenWrt 侧:openbox/openbox-panel 两个 procd init 脚本、LuCI 兜底页、回滚不再拆面板通道、向导门控迁后端;305 测试 + 金标准 4/4;终审修复 3 Critical)
- [x] P6 完成并合并(打包/安装/升级/卸载/发布流水线;306 测试;终审修复 1 Critical + 5 Important)
- [ ] P7 真机验收待进行
- 产品决策(2026-07-27):穿透功能**保留并重写为 sing-box 版**(基于 `sing-box rule-set match` 本地 .srs 匹配);面板密码改为**首次访问强制设密**(不再由安装脚本预生成)

## 记录在案的延期项(来自 P1 评审)

- P4(面板前端)必须包含:删除 `panel/scripts/install.sh` 与 `panel/scripts/deploy-devboard.sh`(上游 Docker 时代遗留,残留 2048 引用);PWA manifest(vite.config.ts 的 name/short_name)与 index.html meta description 去 AnGe 品牌化
- 后续加固候选(不阻塞):dev-panel.sh PID 复用校验、curl --max-time、HOST=127.0.0.1 绑定收敛

## 记录在案的延期项(来自 P2a 终审)

**P2b 首个任务必须是"parser 字段补全"**(P2a 计划已预留此回补口子),补全 emit 所需但 P2a 未采集的字段:
- REALITY:`tls.reality {public_key, short_id}`(vless 分享链接 `pbk`/`sid`、Clash `reality-opts`)——REALITY 是当前最常见节点类型之一,不补则 P2b 无法 emit 可用出站
- uTLS 指纹:`tls.utls.fingerprint`(分享链接 `fp`)
- `tls.insecure`:分享链接 `insecure/allowInsecure` 未采集;Clash 已从 `skip-cert-verify` 采集 → 两来源发散,需对齐
- HTTP/2 传输归一:Clash `network: h2` 与 vmess `net: h2` → sing-box `{type:'http'}`(当前三来源形状不一致)
- sing-box ≥1.11 的 wireguard 在 `endpoints` 而非 `outbounds`,`parseSingboxOutbounds` 当前会漏采
- Clash `ss` 的 `plugin`/`plugin-opts` 被静默丢弃 → 与分享链接 `?plugin` 丢弃决策对齐,计入 skipped

**其余 P2a 遗留 minor(不阻塞,择机处理):** subscription.mjs detect 冗余正则删除;clash.mjs 非对象 proxy 项/缺 name 的 skipped 记录质量;词典数组 `Object.freeze` 加固;groups.mjs 分组依赖默认模板首段(可让 renameNodes 附带 region 字段解耦)。

## 记录在案的延期项(来自 P2b 终审)

**P3(本地系统集成层)的应用路径必须包含:**
- **下发前逐节点归因**:整份配置里任一坏节点(如 reality 非法 pbk、未知 ss cipher、vmess 旧式 cipher)会让 `sing-box check` 拒绝整份配置且 FATAL 不指明是哪个节点。应用路径需"先 check 整体,失败则逐节点/单出站 check 定位坏节点并 drop-and-retry 或明确报告",不可整份静默失败。fail-closed(不下发坏配置)是底线。
- **rulesetTags 供给**:P3 的规则集下载器需要知道配置引用了哪些 `.srs`;`buildRoute` 已返回 `rulesetTags`,或让 `buildConfig` 一并返回,避免二次调用。

**P4(面板前端)导入层必须包含:**
- **节点 tag 去重**:完全同名的上游节点会让 sing-box `duplicate outbound/endpoint tag` FATAL;导入/重命名后需保证 tag 唯一。

**缺失字段回补清单(P3/P4 backlog,不阻塞当前):** hysteria2 `up`/`down` 带宽、tuic `udp-relay-mode`、wireguard `reserved`、ws `max_early_data`、vmess 旧式加密(如 `aes-128-cfb`,会 FATAL)。

**表层 minor(择机):** emit 出的配置浅引用节点内部对象(headers/alpn/local_address/obfs),可在边界 spread 拷贝;`parseTrojan` 改写 `u.query`(可改传显式 flag)。

## 记录在案的延期项(来自 P3 终审)

**P4/P6 必须处理(终审 Important 7):启动持久化不一致** —— dnsmasq 接管的 uci 改动是 commit 到闪存的(重启后仍在),但内核服务从未 `enable`(`enableService` 已实现但无人调用)。若在 dnsmasq 模式下重启路由器:sing-box 不自启,dnsmasq 指向已死的 7853 → 全 LAN DNS 中断。要么部署成功时 `enableService(core)`(回滚时 `disableService`),要么明确由 P6 安装脚本负责开机自启——但不可让"持久化的 uci 状态 + 非持久化的服务状态"这种不一致进入 P7。

**P4 看门狗(终审 Minor 9):** `deploy` 的验证紧跟 restart,可能在 procd 崩溃重启循环期间读到瞬时 "running"。P4 应加短延迟复检或 clash_api 探活。

**P5 卫生项(终审 Minor 12):** `config.candidate.json`/`config.probe.json` 无清理;回滚后 `config.json` 仍是启动失败的那份(运行状态已恢复但文件未回退,可考虑 `config.json.prev`);`restoreDnsTakeover` 在 commit/重启结果未知前就删了备份。

**其余表层项:** `rollbackToDirect.actions` 记录的是"尝试过"而非"成功"(exec 返回码被忽略),命名可改为 attempted 或按步记录 ok;`parseBackup` 的无引号裸值分支无测试。

## P4b 清理清单(来自 P4a T1 大扫除)

服务端已删除 SSH/OpenClash/规则缓存路由,以下前端与文档仍引用已消失的接口,P4b 必须一并处理:
- `panel/README.md:201-222`:仍在文档 SSH 规则源与 `ZASHBOARD_OPENWRT_SSH_*`、`ZASHBOARD_OPENCLASH_*` 环境变量(后端已无实现)
- 前端引用已删路由:`src/views/RulesPage.vue`、`src/views/SetupPage.vue`(整个删除)、`src/components/settings/EditBackendModal.vue`、`src/components/rules/RuleProvider.vue`、`src/store/rules.ts`、`src/store/setup.ts`(整个删除)、`src/i18n/*`(相关词条)、`src/types/index.d.ts`
- 说明:P4a 期间应用的这些 UI 路径处于已知的过渡性损坏状态,属预期

## 记录在案的延期项(来自 P4a 两轮安全终审)

**P4b 必须处理:**
- **改密 UI 对接**:服务端已新增 `POST /api/auth/change-password`(校验旧密码、重签会话 cookie);但设置页仍绑定 `config/access-password` 经 storage 同步(该键现已被服务端保护、写入静默丢弃),必须改为调用新端点,否则用户以为改了密码实际没改
- 前端移除多后端(SetupPage/store/setup.ts)、清理已删路由的引用、README 的 SSH 章节(见上文 P4b 清理清单)
- clash_api 代理的 `x-zashboard-target-base` 覆盖能力:前端不再需要,建议随多后端一起移除或加环境变量开关

**已知残留(不阻塞,择机):**
- profile 的 `proxyTag`/`fallback`/`categories[].target` 未做内容校验(仅作为出站 tag 名使用,无路径/命令面);`rulesetDir` 仅校验绝对路径+无 `..`,未限制在允许根目录内
- `app_storage` 允许认证用户写入任意键(无白名单/长度限制),且这些键会回显给所有浏览器
- `POST /rollback` 的部署态未在异常时更新
- 生产部署注意:`server/` 以独立 pnpm workspace 包发布(`pnpm deploy --prod`),故 net-guard 未引入 `ipaddr.js`,用的是手写网段表

## 记录在案的延期项(来自 P4b 终审)

**P5/P6 处理:**
- 向导门控标志(`config/wizard-dismissed` 等)存在浏览器 localStorage 并经 storage 同步推给后端:工厂重置后,之前用过的浏览器会**抑制新机的引导流程**。应改为以后端状态为准(独立 openbox 字段)
- 设置页"后端"分区仍有 fork 遗留的 mihomo 控件(端口、更新核心、指向 metacubex/mihomo 的链接),内核未检测到时会显示为死按钮
- `UI_RELEASES_API` 仍轮询上游仓库做自更新检查;install/uninstall/update 脚本与 Dockerfile 仍是 `ange-clashboard` 命名(P6 领域);`ZASHBOARD_DB_PATH`/`zashboard.sqlite` 后端命名
- `panel/README.md` 残留:提到已删除的"规则缓存落盘 SQLite";穿透查询写了"按关键字"(实际不支持,target 校验会拒)

**其他:** 服务端错误详情未本地化(中文句子 + 英文 server detail 混排);内核页在无 init.d 环境显示面板"已停止"(真机上正确,可考虑显示"未知")

## 记录在案的延期项(来自 P5 终审)

**P6 安装脚本必须处理:**
- 两个 init 脚本铺到 `/etc/init.d/` 并 `chmod +x`;LuCI 三个文件铺到 `htdocs/luci-static/resources/view/openbox/`、`/usr/share/luci/menu.d/`、`/usr/share/rpcd/acl.d/`,装完需 `rm -f /tmp/luci-*cache*` 并重启 rpcd 使 ACL 生效
- 卸载时才调用 `removeOpenBoxRules`(含面板放行规则);`removeProxyRules` 仅供回滚使用
- P4b 记录的命名残留:install/uninstall/update 脚本与 Dockerfile 仍是 `ange-clashboard`;`ZASHBOARD_DB_PATH`/`zashboard.sqlite` 后端命名;`UI_RELEASES_API` 仍指向上游仓库做自更新检查

**P7 真机验收清单(终审建议,这两条本可提前抓到本轮的两个 Critical):**
- dnsmasq 模式下:部署完成后确认 `uci get dhcp.@dnsmasq[0].server` 仍为 `127.0.0.1#7853`(验证 restart 没有撤销接管)
- dnsmasq 模式下:部署 → 拔掉 WAN DNS → LuCI 紧急停止 → 确认 LAN 仍能解析(验证停止清理真的恢复了上网)
- LuCI 页面在 21.02/23.05/24.10 上的运行态显示与按钮生效情况(`service list` + `setInitAction`)

**已知残留(不阻塞):** LuCI master 已移除 `luci.setInitAction`(改用 `rc` 对象),若 P7 用 snapshot 固件需迁移;`restart()` 未套 `trap '' TERM`(仅在从 openbox 进程树内部调用时才有影响);deploy 预检只查存在性不查可执行位。

## 记录在案(来自 P6 终审)

**首次发版前必须确认:** 仓库标识 `liandu2024/Open-Box` 目前是占位(本地无 git remote),它被硬编码在 `scripts/install.sh`、`scripts/update.sh`、`.github/workflows/release.yml`、`README.md` 四处。与真实 GitHub 仓库不一致会让文档里每条命令 404。

**musl 相关的三处坑(已全部修复,记录以防回退):**
1. nodejs.org 官方 Linux 二进制是 glibc 链接,OpenWrt 无法启动 → 必须用 unofficial-builds 的 `-musl` 变体
2. sing-box 默认的 `linux-amd64` 资产同样是 glibc 动态链接(内含 libcronet.so)→ 必须用 `-musl` 资产
3. x64 版 musl Node 仍动态依赖 `libstdc++.so.6`,而 OpenWrt 的 DEFAULT_PACKAGES 不含 `libstdcpp` → 已捆绑该库到 `node/lib/` 并在 panel init 脚本设 `LD_LIBRARY_PATH`
构建期已有 DT_NEEDED 守卫 + sing-box 静态性断言,上游任何一处变动都会让构建当场失败,而不是装到用户路由器上才发现。

**P7 真机验收补充项(终审建议):**
- 第一个冒烟点:`/opt/open-box/node/bin/node -v` 能否在 stock x86_64 OpenWrt 上跑起来(验证 musl + libstdc++ 捆绑)
- busybox 的 `df -P` 支持(预检依赖它;不支持会导致所有安装被拒)
- 512MB 机器上跑一次完整升级(验证内存阈值与暂存目录改到 /opt 文件系统)
- 一台 ≤22.03 的 LuCI-Lua 固件(验证 `/tmp/luci-modulecache` 是目录时的清理不再中止脚本)

**已知残留(不阻塞):** 同版本 update 仍会下载 78MB 并解包(放弃 GitHub API 的代价);`LD_LIBRARY_PATH` 会传递给面板派生的子进程;发布流水线尚未跑面板测试(建议在打包前加一步)。
