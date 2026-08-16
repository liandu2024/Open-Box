# P6: 安装/升级/卸载与发布流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Open-Box 真正能被用户装到路由器上——一键安装脚本(直连/加速双通道)、升级、卸载,以及按架构打包发布的 GitHub Actions。这是"用户拿得到"的最后一步。

**Architecture:** Release 产物是**每架构一个自包含 tarball**:musl 版 Node 运行时 + 面板(dist + pnpm deploy 出的自包含 server)+ sing-box 内核 + init/LuCI 文件 + 元数据。安装脚本只做"预检 → 下载 → 校验 → 铺装 → 起服务",不在路由器上编译任何东西。

**Tech Stack:** POSIX sh(OpenWrt ash,禁 bashism)、GitHub Actions、`pnpm deploy --prod` 打包 server、sha256 校验。

## Global Constraints

- 目标架构仅 **x86_64 → `x64`** 与 **aarch64 → `arm64`**;其余架构预检直接友好退出
- **Node 必须用 musl 构建**(已实测确认):`https://unofficial-builds.nodejs.org/download/release/v24.18.0/node-v24.18.0-linux-{x64,arm64}-musl.tar.xz`(各约 31MB)。**官方 nodejs.org 的 linux-x64/arm64 是 glibc 链接,在 OpenWrt 上无法启动**——绝不可使用
- sing-box 钦定 **1.13.14**:`https://github.com/SagerNet/sing-box/releases/download/v1.13.14/sing-box-1.13.14-linux-{amd64,arm64}.tar.gz`(注意 sing-box 用 `amd64`,Node 用 `x64`,映射别写错)
- 安装目录 `/opt/open-box`,数据目录 `/opt/open-box/data` 升级保留;面板端口 2026
- **不预生成密码**(产品决策已改为首次访问强制设密):安装完只打印面板地址与"首次打开需设置密码"
- 双通道:直连与镜像加速;安装时选择被**持久化**,升级沿用
- 每个 Task 结束必须 commit;shell 一律 `sh -n` + bashism 自查

## 前置事实(执行者需知)

- **打包机制已实测**:`corepack pnpm deploy --filter=./server --prod <目标>` 产出自包含 server(真实 node_modules 而非 symlink,约 5.8MB,含 express/ws/yaml)。前端产物在 `panel/dist/`。
- server 运行时依赖仅 express/ws/yaml(ssh2 已在 P4a 移除)。
- 面板进程需要的 env 与 init 脚本已在 P5 固定:`PORT=2026`、`OPENBOX_ROOT=/opt/open-box`、`ZASHBOARD_DB_PATH=/opt/open-box/data/openbox.sqlite`。
- P5 产物位置:`openwrt/initd/{openbox,openbox-panel}`、`openwrt/luci/`(三个文件,路径见下)。
- **P5 终审记录的铺装要求**:LuCI 文件铺好后需 `rm -f /tmp/luci-*cache*` 并重启 rpcd,ACL 才生效。
- **待清理的 fork 遗留**(P4b/P5 记录):`panel/scripts/{install.sh,uninstall.sh,update.sh,deploy-devboard.sh,dev-up.ps1,start-dev.cmd,fetch-mihomo.mjs}`、根 `Dockerfile`/`Caddyfile`/`.dockerignore`(Open-Box 不做 Docker 形态)。注意 `scripts/dev-panel.sh`(仓库根)是 Open-Box 自己的开发脚本,**保留**。
- 系统层的卸载语义:`removeOpenBoxRules`(两条规则全删)**仅供卸载**;`removeProxyRules` 供回滚(P5 已拆分)。

---

### Task 1: 清理 fork 遗留的分发物

**Files:**
- Delete: `panel/scripts/install.sh`、`uninstall.sh`、`update.sh`、`deploy-devboard.sh`、`dev-up.ps1`、`start-dev.cmd`、`fetch-mihomo.mjs`
- Delete: `panel/Dockerfile`、`panel/Caddyfile`、`panel/.dockerignore`
- Modify: `panel/package.json`(移除引用已删脚本的 scripts:`deploy:devboard`、`dev:up` 等)
- Modify: `panel/README.md`(删除 Docker 部署、SSH 规则源、规则缓存等已不存在的章节;穿透查询改为"按域名/IP",移除"按关键字")

**Interfaces:**
- Produces:仓库里不再有指向已删功能或 AnGe-ClashBoard 分发形态的脚本与文档。

- [ ] **Step 1: 删除并修正引用**

删除上述文件;`panel/package.json` 移除引用它们的 script 条目;README 按上面要求订正。

- [ ] **Step 2: 验证无悬空引用**

```bash
grep -rn "deploy-devboard\|dev-up\|start-dev\|fetch-mihomo\|Dockerfile\|Caddyfile" panel/package.json panel/README.md panel/src panel/server 2>/dev/null | grep -v node_modules
```
Expected:无输出。再跑 `cd panel && corepack pnpm run build && corepack pnpm run test:server`(305 全绿)。

- [ ] **Step 3: Commit**

```bash
git add -A panel
git commit -m "chore(p6): 清理 fork 遗留的 Docker/SSH 时代分发脚本与文档"
```

---

### Task 2: 发布打包脚本

**Files:**
- Create: `scripts/build-release.sh`

**Interfaces:**
- Produces:`bash scripts/build-release.sh <arch> <outdir>`(arch ∈ `x64`|`arm64`)产出 `open-box-<version>-linux-<arch>.tar.gz` 与 `.sha256`。
- Tarball 内部布局(解开后即 `/opt/open-box` 的内容):
  ```
  node/            musl Node 运行时(bin/node 等)
  panel/           dist/ + server/(pnpm deploy 产物)
  bin/sing-box     钦定内核
  openwrt/         initd/ 与 luci/(供安装脚本铺到系统路径)
  meta.json        {version, singboxVersion, nodeVersion, arch, builtAt}
  ```
- 脚本步骤:构建前端 → `pnpm deploy` 出 server → 下载并解出 musl Node(缓存到 `.build-cache/`)→ 下载并解出 sing-box(注意 `x64→amd64` 映射)→ 拷 openwrt/ → 写 meta.json → 打包 → 算 sha256。
- 下载前先校验 URL 可达;失败即退出非 0(不产出半成品)。

- [ ] **Step 1: 写脚本**(POSIX sh;架构映射表显式写清:`x64→amd64`、`arm64→arm64`)
- [ ] **Step 2: 本机试跑 x64 产物**

```bash
bash scripts/build-release.sh x64 /tmp/ob-release
ls -la /tmp/ob-release/
tar -tzf /tmp/ob-release/open-box-*-linux-x64.tar.gz | head -20
```
Expected:tarball 存在、sha256 匹配、内部布局含 `node/bin/node`、`panel/server/index.mjs`、`panel/dist/index.html`、`bin/sing-box`、`openwrt/initd/openbox`、`meta.json`。
**验证 musl 而非 glibc**(本任务最关键的一条):
```bash
tar -xzf /tmp/ob-release/open-box-*-linux-x64.tar.gz -C /tmp/ob-x --strip-components=0 2>/dev/null || (mkdir -p /tmp/ob-x && tar -xzf /tmp/ob-release/open-box-*-linux-x64.tar.gz -C /tmp/ob-x)
file /tmp/ob-x/node/bin/node
```
Expected:输出应表明是 **statically linked / musl** 而非 `interpreter /lib64/ld-linux-x86-64.so.2`(glibc)。把实际输出贴进报告。

- [ ] **Step 3: Commit**

---

### Task 3: 一键安装脚本

**Files:**
- Create: `scripts/install.sh`

**Interfaces:**
- `sh install.sh [--mirror <前缀>]`。流程:
  1. **预检**:架构(仅 x86_64/aarch64,`uname -m` 映射)、可用存储 ≥512MB、内存 ≥512MB、OpenWrt 版本(读 `/etc/openwrt_release`)。任一不达标 → 友好中文提示 + 退出非 0,**不留半成品**
  2. **冲突提示**:检测 openclash/nikki/passwall/ssr-plus/homeproxy 是否安装/运行 → 仅警告(不阻断,与 P3 的"启动时拒绝"分工)
  3. 解析 release:取最新版本号,拼下载 URL(镜像前缀可选),下载 tarball + `.sha256`,**校验通过后**才继续
  4. 铺装:解到 `/opt/open-box`(升级路径见 Task 4,首装时若目录已存在则提示改用 update)
  5. init 脚本 → `/etc/init.d/`,`chmod +x`;LuCI 三文件 → 各自系统路径;`rm -f /tmp/luci-*cache*`;重启 rpcd(`/etc/init.d/rpcd restart`)
  6. 记录安装通道到 `/opt/open-box/data/channel`(直连/镜像前缀),供 update 沿用
  7. 启动面板并 `enable` 自启;**不启内核**(用户尚未配置)
  8. 打印:面板地址 `http://<LAN IP>:2026`、"首次打开需设置密码"、LuCI 入口位置
- 幂等与安全:任何步骤失败都要有明确中文错误;下载到临时目录,校验通过再动 `/opt`。

- [ ] **Step 1: 写脚本** — [ ] **Step 2: `sh -n` + bashism 自查 + 预检分支演练**(在 macOS 上可跑通"架构不支持"分支)— [ ] **Step 3: Commit**

---

### Task 4: 升级与卸载脚本

**Files:**
- Create: `scripts/update.sh`、`scripts/uninstall.sh`

**Interfaces:**
- `update.sh`:沿用 `data/channel` 记录的通道;下载新版并校验 → **停面板与内核** → 替换 `node/`、`panel/`、`bin/`、`openwrt/`(**保留 `data/` 与 `etc/`**)→ 重新铺 init/LuCI → 起面板 → 打印新版本号。校验失败或下载失败 → 保持原样退出,不动现有安装。
- `uninstall.sh`:停并 `disable` 两个服务 → 调用系统清理(**卸载才移除两条防火墙规则**,含面板放行;还原 dnsmasq;详见下)→ 删除 init 脚本与 LuCI 三文件 + 清 LuCI 缓存 + 重启 rpcd → 询问是否保留 `data/`(默认保留,`--purge` 全删)→ 删除 `/opt/open-box`。
- **卸载时的系统还原怎么做**:优先走面板(若面板还活着,调 `POST /api/openbox/rollback` 不合适——那是回滚不是卸载)。**推荐直接在 shell 里做**,与 P5 的 init 脚本清理同源:
  - `/etc/init.d/openbox stop`(P5 已实现:摘 Open-Box 上游 + 删 noresolv + 移除 v6 拦截,且仅在确实接管过时动 dnsmasq)
  - 再额外移除面板放行规则:`uci -q delete firewall.openbox_panel; uci -q commit firewall; /etc/init.d/firewall reload`
  - 这样卸载的系统还原 = P5 停止清理 + 面板规则,职责清晰不重复实现

- [ ] **Step 1: 写两个脚本** — [ ] **Step 2: 语法与 bashism 检查** — [ ] **Step 3: Commit**

---

### Task 5: GitHub Actions 发布流水线

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- 触发:推 `v*` tag。
- Job 矩阵 `[x64, arm64]`:checkout → 装 Node 24 + pnpm → `pnpm install` → `bash scripts/build-release.sh <arch> dist-release` → 上传产物。
- 汇总 job:创建 GitHub Release,附上两个 tarball 与两个 `.sha256`,release body 写明钦定的 sing-box 与 Node 版本、硬件要求、两条安装命令(直连/加速)。
- **注意**:打包本身是纯下载+拷贝,不需要交叉编译,故两种架构都可在 ubuntu-latest 上构建。

- [ ] **Step 1: 写 workflow** — [ ] **Step 2: YAML 解析校验**(`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"`)— [ ] **Step 3: Commit**

---

### Task 6: README 与安装文档

**Files:**
- Modify: `README.md`(仓库根)

**Interfaces:**
- 面向小白的安装说明:硬件要求(x86_64/arm64、≥512MB 存储与内存)、**两条一键安装命令**(直连 + 加速)、装完做什么(打开 `http://路由器IP:2026`、设密码、跟引导走)、升级/卸载命令、LuCI 兜底页在哪、公网访问安全警告(面板具备路由器 root 权限,严禁裸端口转发)。
- 明确写出:**当前版本尚未在真实硬件上验证**(P7 之前),避免误导用户。

- [ ] **Step 1: 写 README** — [ ] **Step 2: 链接与命令自查** — [ ] **Step 3: Commit**

---

## Self-Review

**1. Spec coverage(规格 §7 安装/升级/卸载 + 路线图 P6):**
- 一键安装、双通道、预检、冲突警告、铺装、打印地址 → Task 3。✅
- 无损升级(保留 data/etc)、卸载(含系统还原与 data 保留选项)→ Task 4。✅
- 按架构打包、SHA256、GitHub Release → Task 2/5。✅
- fork 遗留分发物清理(P4b/P5 记录)→ Task 1。✅
- LuCI 铺装后清缓存重启 rpcd(P5 终审要求)→ Task 3/4。✅
- 卸载才移除面板放行规则(P5 拆分的语义)→ Task 4。✅
- 面向小白的文档 → Task 6。✅

**2. Placeholder scan:** 无 TBD;下载 URL、架构映射、目录布局、验证命令均为已实测确认的具体值。

**3. Type consistency:**
- 安装布局与 P5 init 脚本的硬编码路径一致(`/opt/open-box/{node/bin/node,panel/server/index.mjs,bin/sing-box,data}`)。✅
- 架构名映射两处不同(Node 用 `x64`/`arm64`,sing-box 用 `amd64`/`arm64`),Task 2 显式列表处理。✅
- 卸载的防火墙语义与 P5 的 `removeProxyRules`/`removeOpenBoxRules` 拆分对齐。✅

**边界声明(诚实):** 本阶段所有脚本**仍未在真实 OpenWrt 上执行过**。可在 macOS 验证的是:shell 语法、bashism、打包产物结构、**Node 二进制确为 musl 而非 glibc**、YAML 可解析、预检的不支持分支。真实的下载→铺装→起服务全流程属 P7。特别提示:musl 版 Node 能否在目标固件上真正运行,是 P7 的**第一个**冒烟点(`/opt/open-box/node/bin/node -v`)。
