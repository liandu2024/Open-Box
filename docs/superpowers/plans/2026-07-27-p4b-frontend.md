# P4b: 面板前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P4a 的后端 API 变成小白用得起来的界面:清掉多后端遗产、首次引导向导、订阅与重命名 UI、分流可视化、DNS/IPv6 设置、内核管理、穿透查询、改密对接,以及 i18n 收敛(en/zh-Hans/zh-Hant)与三主题。

**Architecture:** 沿用 fork 既有前端栈与设计语言(Vue 3 + TS + Vite + Tailwind/DaisyUI + vue-i18n + pinia 风格的 `src/store/*.ts` composable store)。新增页面严格复用既有组件与主题变量;**唯一做独立视觉表达的是首次引导向导**(见下方设计方向)。API 调用统一走 `src/api/`。

**Tech Stack:** Vue 3、TypeScript、Vite、Tailwind + DaisyUI、vue-i18n;无新增依赖。

## Global Constraints

- 面板只服务本机(单后端):**彻底移除**多后端概念(SetupPage、store/setup.ts、EditBackendModal、api 里的 target header 传递)
- 语言仅三种:`en`(英语)、`zh`(简体)、`zh-tw`(繁体);**移除 `ru`**;默认跟随浏览器
- 主题仅三档:跟随系统 / 亮 / 暗
- 所有新文案必须三语齐全(缺词条视为未完成)
- 构建必须通过 `corepack pnpm run build`;类型检查 `corepack pnpm run type-check` 通过
- 质量底线(不必声张):响应式到手机、键盘焦点可见、`prefers-reduced-motion` 受尊重
- 每个 Task 结束必须 commit

## 前置事实(执行者需知)

- **后端 API 已就绪**(P4a,全部在 `/api/openbox/*`,均需登录):
  - 认证:`GET /api/auth/status`(含 `passwordSet`)、`POST /api/auth/setup {password}`、`POST /api/auth/login`、`POST /api/auth/logout`、**`POST /api/auth/change-password {currentPassword,newPassword}`**
  - 订阅:`POST /api/openbox/subscriptions/preview {url|content, renameOptions}`、`POST /api/openbox/subscriptions {url,name,renameOptions}`、`GET /api/openbox/subscriptions`、`DELETE /api/openbox/subscriptions/:id`、`POST /api/openbox/subscriptions/:id/refresh`
  - Profile:`GET|PUT /api/openbox/profile`、`GET /api/openbox/profile/defaults?region=XX`
  - 部署:`GET /api/openbox/config/preview`、`POST /api/openbox/deploy`(409=冲突/校验失败,500=启动失败;body 含 `stage`/`message`/`badTags`)、`GET /api/openbox/deploy/state`、`POST /api/openbox/rollback`
  - 服务:`GET /api/openbox/service/status`、`POST /api/openbox/service/core/:action`(start|stop|restart|enable|disable)、`GET /api/openbox/kernel/version`
  - 穿透:`POST /api/openbox/penetration {target}` → `{matched, chain, finalOutbound, chainError?}`
  - 未设密时:除 health/status/setup 外全部 403 `{error:'PASSWORD_SETUP_REQUIRED'}`
- **clash_api 代理已固化到本机**:前端**不需要**再传 `x-zashboard-target-base`/`secret`;直接请求 `/api/controller/*` 与 `/api/controller-ws` 即可
- **已删除的后端路由**(前端仍有引用,必须清理):`/api/rule-provider-cache/*`、`/api/rule-refresh/*`、`/api/rule-provider-search`、`/api/rule-provider-penetration`、`/api/proxy-group-rule-penetration`、`/api/openwrt-rule-source/*`、`/api/proxy-domain-rules*`、`/api/proxy-domain-custom-sections`
- 前端现状:视图 `src/views/{Home,Login,Setup,Overview,Proxies,Rules,Connections,Logs,Settings}Page.vue`;store `src/store/*.ts`;i18n `src/i18n/{en,zh,zh-tw,ru}.ts` + `index.ts`,`LANG` 枚举在 `src/constant/index.ts`;主题在 `src/store/settings.ts`(`config/default-theme`、`config/dark-theme`、`config/auto-theme`)+ `ThemeSelector.vue`/`CustomTheme.vue` + `src/assets/theme.css`;路由 `src/router/index.ts`
- 本地验证:`bash scripts/dev-panel.sh` 构建并起服务于 `http://127.0.0.1:2026`

## 首次引导向导设计方向(唯一做独立视觉表达之处)

**立意**:不要"进度条 + 表单"的模板答案。向导 = **把路铺出来**:页面主体是一条随步骤生长的流量路径

```
[你的设备] ──> [路由器 Open-Box] ──> ？
[你的设备] ──> [路由器 Open-Box] ──> [中国网站 直连]
                                  └─> ？
[你的设备] ──> [路由器 Open-Box] ──> [中国网站 直连]
                                  └─> [其他流量 → 美国节点]
```

- 每完成一步,路径长出一段并轻微高亮新增段(尊重 `prefers-reduced-motion`:关闭动画时直接呈现终态)
- 步骤:① 设置密码(强制)② 语言 ③ 你在哪(区域)④ 确认推荐分流 ⑤ 导入订阅 → 完成后一键部署
- 文案面向小白、用第二人称、说人话:不说"配置 geosite-cn 规则集直连",说"中国网站直接连,不绕远路"
- 视觉严守既有 DaisyUI 主题变量(不引入新配色体系);路径图用当前主题的 `primary`/`base-content` 等语义色,保证三主题下都成立
- 签名元素只此一处;其余新页面不做额外视觉发明

---

### Task 1: 清理多后端与已删路由引用

**Files:**
- Delete: `src/views/SetupPage.vue`、`src/store/setup.ts`、`src/components/settings/EditBackendModal.vue`
- Modify: `src/router/index.ts`、`src/api/index.ts`、`src/store/auth.ts`(若引用 setup)、`src/App.vue`/布局中的入口、`src/store/rules.ts`、`src/views/RulesPage.vue`、`src/components/rules/RuleProvider.vue`、`src/store/proxyGroupRulePenetration.ts`(整清或删)、`src/types/index.d.ts`
- Modify: `panel/README.md`(删 SSH 规则源章节与 `ZASHBOARD_OPENWRT_SSH_*`、`ZASHBOARD_OPENCLASH_*` 环境变量)

**Interfaces:**
- Produces:前端不再有"后端列表/切换"概念;`src/api/` 请求 `/api/controller/*` 时不再附带 target header;所有对已删后端路由的调用被移除(相关 UI 一并移除,不留死按钮)

- [ ] **Step 1: 盘点引用**

```bash
cd panel && grep -rn "rule-provider\|rule-refresh\|openwrt-rule-source\|proxy-domain-rules\|proxy-group-rule-penetration\|targetBase\|x-zashboard-target" src/ | grep -v node_modules
```
把结果整理成待处理清单(文件 → 处理方式:删除组件 / 删除调用 / 删除 UI 区块)。

- [ ] **Step 2: 执行清理**

删除上列文件;移除路由表里的 setup 路由与跳转;`src/api/index.ts` 去掉 target header 注入;`RulesPage.vue` 移除规则源/规则集缓存相关 UI(保留纯 Clash-API 的规则列表展示);i18n 四个语言文件里对应词条一并删除。

- [ ] **Step 3: 验证**

```bash
cd panel && corepack pnpm run type-check && corepack pnpm run build
grep -rn "rule-provider\|openwrt-rule-source\|proxy-domain-rules\|x-zashboard-target" src/ | grep -v node_modules   # 应无输出
bash ../scripts/dev-panel.sh   # 起服务,浏览器可打开(此时应跳到强制设密页——Task 3 后才完整)
```

- [ ] **Step 4: Commit**

```bash
git add -A panel/src panel/README.md
git commit -m "refactor(ui): 移除多后端与已删后端路由的前端引用;README 去 SSH 章节"
```

---

### Task 2: i18n 收敛(三语言)与主题三档

**Files:**
- Delete: `src/i18n/ru.ts`
- Modify: `src/i18n/index.ts`、`src/constant/index.ts`(LANG 枚举)、语言选择组件、`src/store/settings.ts`、`ThemeSelector.vue`(或其调用处)

**Interfaces:**
- Produces:语言仅 `en`/`zh`/`zh-tw`,默认跟随浏览器(`navigator.language` 前缀匹配,`zh-TW`/`zh-HK`→zh-tw,`zh-*`→zh,其余→en);主题选择收敛为「跟随系统 / 亮色 / 暗色」三项(内部仍可映射到既有 DaisyUI 主题名,但界面只暴露三项)

- [ ] Step 1: 删 ru 与其在 LANG/messages/选择器里的注册;补默认语言探测函数并单测(若已有测试设施)或至少手动验证三种浏览器语言的落点
- [ ] Step 2: 主题选择器收敛为三项(移除自定义主题入口或隐藏到高级),确保 `auto-theme` 开启时跟随 `prefers-color-scheme`
- [ ] Step 3: `type-check` + `build` + 手动切换三语言三主题各一遍
- [ ] Step 4: Commit `feat(ui): i18n 收敛为 en/zh/zh-tw;主题收敛为 系统/亮/暗`

---

### Task 3: 强制设密与改密对接

**Files:**
- Modify: `src/store/auth.ts`、`src/views/LoginPage.vue`、`src/router/index.ts`(守卫)
- Create: `src/views/SetupPasswordPage.vue`(或作为向导第一步组件,见 Task 4 —— 二选一,推荐做成组件供向导复用)
- Modify: `src/components/settings/GeneralSettings.vue`(改密改调新端点)

**Interfaces:**
- Produces:
  - 任意 API 返回 403 `PASSWORD_SETUP_REQUIRED` 时,路由守卫强制跳到设密流程
  - 设密成功后自动进入向导(Task 4)
  - 设置页的"访问密码"区块改为调用 `POST /api/auth/change-password`(需填当前密码 + 新密码),成功后提示并保持登录;**移除**原先经 `config/access-password` 存储同步的写法(后端已保护该键,写入会被静默丢弃 —— 这是 P4a 记录的必办项)

- [ ] Step 1: auth store 增加 `passwordSet` 与 `setupPassword()`/`changePassword()`;拦截 403 错误码
- [ ] Step 2: 守卫与页面接线;设置页改密表单(当前密码、新密码、确认新密码;<8 位给出明确提示)
- [ ] Step 3: 手动验证:全新数据库启动 → 被强制设密 → 设密后可用 → 设置页改密 → 旧密码登录失败、新密码成功
- [ ] Step 4: Commit `feat(ui): 强制设密流程与改密对接新端点`

---

### Task 4: 首次引导向导

**Files:**
- Create: `src/views/WizardPage.vue` + `src/components/wizard/*.vue`(路径图组件 `RoutePath.vue`、各步骤组件)
- Modify: `src/router/index.ts`、`src/store/`(新增 `wizard.ts` 或复用 profile store)

**Interfaces:**
- Produces:五步向导(密码 → 语言 → 区域 → 确认推荐分流 → 导入订阅),完成后落 profile 与订阅并可一键部署;**签名元素为随步骤生长的流量路径图**(设计方向见上)
- 区域步骤调 `GET /api/openbox/profile/defaults?region=XX` 取推荐值,展示为人话摘要(如「中国网站直连,其他走代理」),用户可直接接受
- 订阅步骤复用 Task 5 的订阅导入组件(先做 Task 5 或以最小表单起步,Task 5 完成后替换)
- 完成页:显示最终路径图 + 「开始使用」按钮 →(可选)立即部署

- [ ] Step 1: 路径图组件先行(纯展示,props 驱动:是否已设区域/是否已有节点),三主题下检查对比度;`prefers-reduced-motion` 下不做生长动画
- [ ] Step 2: 五步骨架 + 状态机(可前进/后退,刷新不丢已完成步骤 —— 已落库的部分从后端读回)
- [ ] Step 3: 三语言文案齐全,面向小白
- [ ] Step 4: 手动走查:全新库 → 完整走完 → profile 与订阅确实落库(用 `GET /api/openbox/profile`、`/subscriptions` 核对)
- [ ] Step 5: Commit `feat(ui): 首次引导向导(流量路径图签名元素)`

---

### Task 5: 订阅管理与重命名规则 UI

**Files:**
- Create: `src/views/SubscriptionsPage.vue`、`src/components/subscription/*.vue`
- Modify: 路由与导航

**Interfaces:**
- Produces:
  - 订阅列表(名称、节点数、上次更新、操作:刷新/删除)
  - 添加订阅:URL 或直接粘贴内容 → **预览**(调 preview 接口)展示解析出的节点、跳过项、分组结果 → 确认保存
  - **重命名规则编辑器 + 实时预览**:区域词典/特征词典/命名模板可改,右侧实时显示「原名 → 新名」对照表(调 preview 接口传 `renameOptions`)
  - 跳过项(skipped)明确展示,让用户知道哪些节点没被导入及原因

- [ ] Step 1: 列表与增删刷新
- [ ] Step 2: 预览 + 重命名规则编辑与对照表
- [ ] Step 3: 三语言 + 空状态文案(空状态是行动邀请:"还没有订阅,先添加一个")
- [ ] Step 4: 手动验证(用真实订阅内容粘贴测试)
- [ ] Step 5: Commit `feat(ui): 订阅管理与重命名规则实时预览`

---

### Task 6: 分流可视化与 DNS/IPv6 设置

**Files:**
- Create: `src/views/RoutingPage.vue`、`src/components/routing/*.vue`
- Modify: 路由与导航;设置页(DNS/IPv6 分区或独立页)

**Interfaces:**
- Produces:
  - 分流规则可视化:类别(AI/流媒体/本地区域/广告…)→ 策略目标(某策略组/直连/拒绝)的映射,可改;兜底方向可切换
  - 策略组一览(区域组自动生成的结果,只读展示 + 组类型 select/urltest 可切)
  - DNS 设置:分流开关、直连 DNS、代理 DNS、接管模式(劫持/dnsmasq 上游)
  - IPv6 开关(关闭时提示"将拦截 IPv6 出站以防泄漏")
  - 保存即 `PUT /api/openbox/profile`;顶部常驻「有未部署的更改」提示 + 「立即部署」按钮

- [ ] Step 1: profile 读写 store + 表单
- [ ] Step 2: 类别→策略组映射编辑 UI
- [ ] Step 3: 未部署变更提示与部署入口(部署结果按 stage 给人话反馈:冲突列出插件名、校验失败列出 `badTags`)
- [ ] Step 4: 三语言 + 手动验证
- [ ] Step 5: Commit `feat(ui): 分流可视化与 DNS/IPv6 设置`

---

### Task 7: 内核管理与穿透查询

**Files:**
- Create: `src/views/KernelPage.vue`、`src/components/penetration/*.vue`(或并入既有 Rules 页)
- Modify: 路由与导航

**Interfaces:**
- Produces:
  - 内核管理:服务状态(核心/面板)、版本、启停/重启/自启开关、冲突插件警示(有冲突时明确列出并说明"请先停止 XXX")
  - 「紧急停止并恢复直连」按钮(调 `POST /api/openbox/rollback`),需二次确认,文案说明后果
  - 穿透查询:输入域名/IP → 展示命中的规则(第几条、规则集)、策略目标、策略链下钻、最终出口;`chainError` 时降级展示并说明原因
  - 部署状态展示(读 `GET /api/openbox/deploy/state`)

- [ ] Step 1: 服务状态与控制
- [ ] Step 2: 穿透查询 UI(结果以路径形式呈现,与向导路径图语言呼应)
- [ ] Step 3: 三语言 + 手动验证
- [ ] Step 4: Commit `feat(ui): 内核管理、紧急恢复直连与穿透查询`

---

### Task 8: 品牌收尾与全局走查

**Files:**
- Modify: `vite.config.ts`(PWA manifest name/short_name)、`index.html`(meta description)、favicon/图标资源、`panel/README.md`

**Interfaces:**
- Produces:去除 AnGe-ClashBoard 残留品牌(PWA 安装后应用名为 Open-Box);README 与实际功能一致

- [ ] Step 1: PWA manifest 与 meta 去品牌化(P1 评审记录的延期项)
- [ ] Step 2: 全局走查清单:三语言 × 三主题 × 手机宽度,逐页检查(向导/订阅/分流/内核/设置/概览/代理/连接/日志);键盘 Tab 可达且焦点可见
- [ ] Step 3: `type-check` + `build` + `bash scripts/dev-panel.sh` 最终验证
- [ ] Step 4: Commit `chore(ui): 品牌收尾与全局走查修正`

---

## Self-Review

**1. Spec coverage(规格 6 节 + 各阶段延期项):**
- 单后端裁剪 → Task 1。✅
- 首次引导向导(语言/区域/推荐默认/订阅)→ Task 4(密码步骤见 Task 3)。✅
- 订阅管理与重命名 UI 含实时预览 → Task 5。✅
- 策略分流可视化、DNS/IPv6 设置 → Task 6。✅
- 内核管理页、紧急恢复直连、穿透查询 → Task 7。✅
- 登录认证与**强制设密**;**改密对接新端点(P4a 必办项)** → Task 3。✅
- i18n 收敛三语言、三主题 → Task 2。✅
- **PWA/meta 去品牌化(P1 延期项)**、README 修正(P4a 记录)→ Task 1 + Task 8。✅
- 已删后端路由的前端引用清理(P4a 记录)→ Task 1。✅

**2. Placeholder scan:** 无 TBD;每个 Task 给出文件清单、接口契约与验证方式。前端以手动走查为主(无既有前端测试设施),故每个 Task 都明确了可执行的验证步骤与后端核对手段。

**3. Type consistency:** 所有 API 路径、请求/响应字段均取自 P4a 实现(见前置事实),与后端契约一致;profile 结构与 P2b/P3/P4a 同一份。

**诚实边界:** 本阶段无自动化前端测试(fork 未带前端测试设施,本计划不新建测试框架——那会喧宾夺主)。质量依赖:类型检查、构建、以及每个 Task 明确列出的手动走查与后端数据核对。真机 UI 表现留待 P7。
