# P1: 仓库落地与面板导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Open-Box monorepo 骨架,把 AnGe-ClashBoard 面板代码导入 `panel/`,在本机(macOS)跑通安装→构建→测试→启动闭环,并完成 Open-Box 品牌化(名称/端口 2026)。

**Architecture:** monorepo 布局按规格第 10 节;面板以文件拷贝方式 fork(保留上游 LICENSE 与致谢,不保留上游 git 历史);系统级功能(OpenWrt 脚本、LuCI)只建目录占位,后续阶段填充。

**Tech Stack:** pnpm(corepack)+ Vue 3 + Vite + TypeScript;Node 24(本地开发,满足 node:sqlite;目标运行时 Node 22+);node --test 跑服务端测试。

## Global Constraints

- 面板端口默认 **2026**(规格 6/7 节;原 AnGe-ClashBoard 为 2048)
- 面板名称/品牌:**Open-Box**(package name `open-box-panel`)
- 保留上游 MIT LICENSE 链:zashboard → AnGe-ClashBoard → Open-Box(规格"授权"要求)
- 本地开发环境 Node 使用 `~/.local/share/node-v24.18.0-darwin-arm64/bin`(已装,含 node:sqlite)
- 不引入新框架/新依赖;沿用 panel 现有工具链(pnpm、vite、eslint、prettier)
- 每个 Task 结束必须 commit

## 前置事实(执行者需知)

- 源码来源:`/Users/ange/Code/AnGe-Board/AnGe-ClashBoard`(工作副本,v2.04,含 node_modules/dist/data 等运行产物,导入时必须排除)
- 端口定义点:`server/index.mjs:21`(`process.env.PORT || 2048`)与 `vite.config.ts:10-13`(dev 代理端口)
- 服务端测试:`corepack pnpm run test:server`(node --test server/test/*.test.mjs)
- pnpm workspace:根 `pnpm-workspace.yaml` 含 `server` 子包;`package.json` 的 `pnpm.onlyBuiltDependencies` 已允许 esbuild/ssh2/cpu-features 原生构建

---

### Task 1: monorepo 脚手架

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `openwrt/.gitkeep`、`scripts/.gitkeep`、`templates/.gitkeep`

**Interfaces:**
- Produces: 仓库顶层目录结构(`panel/` 由 Task 2 创建);后续所有阶段的路径基准

- [ ] **Step 1: 写 .gitignore**

```gitignore
node_modules/
dist/
*.log
.DS_Store
.devboard-server.pid
data/
panel/data/
```

- [ ] **Step 2: 写占位 README.md**

```markdown
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
```

- [ ] **Step 3: 建目录占位并提交**

```bash
mkdir -p openwrt scripts templates
touch openwrt/.gitkeep scripts/.gitkeep templates/.gitkeep
git add -A
git commit -m "chore: monorepo 脚手架与目录结构"
```

---

### Task 2: 面板代码导入(fork 基线)

**Files:**
- Create: `panel/`(整树导入,排除运行产物)
- Create: `panel/NOTICE.md`

**Interfaces:**
- Consumes: `/Users/ange/Code/AnGe-Board/AnGe-ClashBoard` 工作副本
- Produces: `panel/` 完整可构建源码树;后续所有面板改动的基线 commit(方便与上游 diff)

- [ ] **Step 1: rsync 导入源码(排除运行产物与上游 git)**

```bash
rsync -a \
  --exclude node_modules --exclude dist --exclude data \
  --exclude .git --exclude .devboard-server.pid --exclude .devboard-server.log \
  --exclude .runtime \
  /Users/ange/Code/AnGe-Board/AnGe-ClashBoard/ /Users/ange/Code/Open-Box/panel/
```

- [ ] **Step 2: 校验导入完整性**

```bash
ls panel/src panel/server panel/package.json panel/LICENSE
test -d panel/node_modules && echo "FAIL: node_modules 混入" || echo OK
test -d panel/.git && echo "FAIL: .git 混入" || echo OK
```

Expected: 列出目录;两个 OK。

- [ ] **Step 3: 写 fork 来源声明 panel/NOTICE.md**

```markdown
# NOTICE

本目录代码 fork 自 AnGe-ClashBoard v2.04(https://github.com/liandu2024/AnGe-ClashBoard),
其上游为 zashboard(https://github.com/Zephyruso/zashboard),MIT License。
原始 LICENSE 见本目录 LICENSE 文件。Open-Box 对其做单后端裁剪与本机管理改造。
```

- [ ] **Step 4: 基线提交(导入原样,不做任何修改)**

```bash
git add panel
git commit -m "feat: 导入 AnGe-ClashBoard v2.04 作为 panel/ fork 基线"
```

---

### Task 3: 本机构建/测试闭环跑通

**Files:**
- Modify: 无源码修改(如构建失败,修什么记什么,单独 commit)

**Interfaces:**
- Consumes: Task 2 的 `panel/`
- Produces: 可复现的构建/测试命令序列,写入 Task 5 的 dev 脚本

- [ ] **Step 1: 安装依赖**

```bash
export PATH="$HOME/.local/share/node-v24.18.0-darwin-arm64/bin:$PATH"
cd /Users/ange/Code/Open-Box/panel
corepack pnpm install
```

Expected: 安装成功,esbuild 原生构建被 onlyBuiltDependencies 放行。

- [ ] **Step 2: 跑服务端测试**

```bash
corepack pnpm run test:server
```

Expected: PASS(以导入时上游的测试全绿为基线;若有环境性失败,查明并记录,不静默跳过)。

- [ ] **Step 3: 构建前端**

```bash
corepack pnpm run build
```

Expected: `panel/dist/` 生成,exit 0。

- [ ] **Step 4: 启动服务端冒烟**

```bash
PORT=2026 node server/index.mjs &
sleep 1
curl -sf http://127.0.0.1:2026/api/health && echo HEALTH-OK
kill %1
```

Expected: `HEALTH-OK`(此时用 PORT 环境变量,默认值改造在 Task 4)。

- [ ] **Step 5: 提交(若本 Task 产生了修复改动)**

```bash
git add -A && git diff --cached --quiet || git commit -m "fix: 面板本机构建/测试环境修复"
```

---

### Task 4: Open-Box 品牌化与默认端口 2026

**Files:**
- Modify: `panel/package.json`(name/description)
- Modify: `panel/server/index.mjs:21`(默认端口)
- Modify: `panel/vite.config.ts:10-13`(dev 代理端口默认值)
- Modify: `panel/index.html`(标题)
- Test: `panel/server/test/server.test.mjs`(若其中硬编码 2048,同步更新)

**Interfaces:**
- Produces: 默认端口 2026;`open-box-panel` 包名。后续阶段(安装脚本、LuCI 跳转、防火墙规则)一律引用 2026

- [ ] **Step 1: 改默认端口**

`panel/server/index.mjs:21`:

```js
const port = Number(process.env.PORT || 2026)
```

`panel/vite.config.ts`(把两处 `2048` 默认值改为 `2026`):

```ts
const devProxyPort = Number(
  process.env.ZASHBOARD_DEV_PROXY_PORT || process.env.PORT || '2026',
)
// ...
const resolvedDevProxyPort = Number.isFinite(devProxyPort) ? devProxyPort : 2026
```

- [ ] **Step 2: 改包名与标题**

`panel/package.json`:`"name": "open-box-panel"`,`"description": "Open-Box panel - integrated sing-box management for OpenWrt"`。
`panel/index.html`:`<title>` 改为 `Open-Box`。

- [ ] **Step 3: 全库残留扫描**

```bash
grep -rn "2048" panel/server panel/vite.config.ts panel/scripts panel/index.html | grep -v node_modules
```

Expected: 无面板端口语义的残留(规则端口类数字如出现属误伤,逐条人工判断)。

- [ ] **Step 4: 回归:测试 + 构建 + 默认端口冒烟**

```bash
cd panel && corepack pnpm run test:server && corepack pnpm run build
node server/index.mjs &
sleep 1
curl -sf http://127.0.0.1:2026/api/health && echo HEALTH-OK
kill %1
```

Expected: 测试绿、构建成功、`HEALTH-OK`(不带 PORT 环境变量)。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Open-Box 品牌化,面板默认端口改为 2026"
```

---

### Task 5: Open-Box 本地开发脚本

**Files:**
- Create: `scripts/dev-panel.sh`(替代上游 deploy-devboard.sh 的 Open-Box 版)
- Modify: `README.md`(补"本地开发"一节)

**Interfaces:**
- Consumes: Task 3/4 验证过的命令序列
- Produces: `bash scripts/dev-panel.sh` 一条命令完成 构建→(重)启服务→健康检查;后续所有阶段的本地验证入口

- [ ] **Step 1: 写 scripts/dev-panel.sh**

```bash
#!/usr/bin/env bash
# Open-Box 面板本地开发:构建 + (重)启动 + 健康检查
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
panel_dir="$repo_root/panel"
pid_file="$repo_root/.dev-panel.pid"
port="${PORT:-2026}"
export PATH="$HOME/.local/share/node-v24.18.0-darwin-arm64/bin:$PATH"

cd "$panel_dir"
corepack pnpm run build

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  kill "$(cat "$pid_file")"
  sleep 1
fi

PORT="$port" nohup node server/index.mjs >"$repo_root/.dev-panel.log" 2>&1 &
echo $! >"$pid_file"

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; then
    echo "Open-Box panel OK: http://127.0.0.1:$port"
    exit 0
  fi
  sleep 0.5
done
echo "FAIL: panel 未通过健康检查,日志见 .dev-panel.log" >&2
exit 1
```

- [ ] **Step 2: 赋权并跑通**

```bash
chmod +x scripts/dev-panel.sh
bash scripts/dev-panel.sh
```

Expected: `Open-Box panel OK: http://127.0.0.1:2026`

- [ ] **Step 3: .gitignore 补运行产物,README 补开发说明**

`.gitignore` 追加:

```gitignore
.dev-panel.pid
.dev-panel.log
```

README「仓库结构」后追加:

```markdown
## 本地开发

```bash
bash scripts/dev-panel.sh   # 构建并启动面板于 http://127.0.0.1:2026
cd panel && corepack pnpm run test:server   # 服务端测试
```
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 本地开发脚本 dev-panel.sh(构建+启动+健康检查)"
```

---

## Self-Review

1. **Spec coverage(P1 范围)**:仓库结构(规格 10 节)→ Task 1/2;fork 与授权(规格 1/授权)→ Task 2 NOTICE;端口 2026(规格 6/7)→ Task 4;本地可验证闭环(AGENTS 工作流延续)→ Task 3/5。单后端裁剪、i18n 收敛等属 P4,不在本计划。
2. **Placeholder scan**:无 TBD/TODO;所有命令与代码均为可执行实文。
3. **Type consistency**:本计划无跨任务类型接口;路径与端口在 Task 间一致(panel/、2026)。
