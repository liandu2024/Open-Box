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
| P4 | 面板前端 | 单后端裁剪;首次引导向导;订阅管理与重命名规则 UI(含实时预览);策略分流可视化;DNS/IPv6 设置;内核管理页;登录认证;i18n 收敛(en/zh-Hans/zh-Hant)与三主题 | P2(接口),P3(联调) |
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
- [ ] P3–P7 计划:待各自前置阶段完成后制定

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
