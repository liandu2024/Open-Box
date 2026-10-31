# 发布前验收

## 提交前：本地门禁

私有源码不推 GitHub，托管 CI 不会运行。提交或构建候选版本前，先在源码工作区执行：

```sh
sh scripts/preflight.sh          # git diff --check、Go 测试、面板全部测试、vue-tsc
sh scripts/preflight.sh --quick  # 跳过 vue-tsc，适合只改后端的快速检查
```

`--quick` 不能替代发版前的完整回归；真正的发布验收仍按下文逐项执行。

## 每次安装 / 升级验证后：清理测试残留

验证结束且确认服务、配置和数据正常后，立即清空旧测试镜像、临时容器和升级备份，不留到下次发版再处理。检查范围包括 Docker 宿主 `192.168.3.21`（现用网关 `192.168.3.210`）、OpenWrt `192.168.3.35`、Linux 验证机 `192.168.3.23` 及本机 Docker / 本地虚拟机 / 构建缓存。

1. 清理前记录当前版本、容器及镜像 ID、服务 PID、配置摘要、挂载目录、面板健康状态与磁盘占用。核对候选路径是否被进程、容器挂载或其他工作区使用。
2. 删除已经结束测试的临时容器，再删除没有容器引用的 Open-Box 旧镜像、测试构建缓存、构建上下文和重复安装包；当前运行镜像必须保留。不按全局未使用状态直接删除其他应用的镜像、网络或数据卷。
3. 确认原配置已恢复、升级成功且无需回滚后，删除旧程序副本、`ob-verify-backup`、开发部署备份、旧内核 `.bak` 和临时测试数据。验证失败时先完成恢复并复核，再删除本次恢复材料。
4. 本机清理重复下载和旧测试产物，保留验收结论及必要日志、当前构建依赖、源码工作区与未提交修改。不要直接删除整个 `.build-cache`，也不要通过强制移除 Git 工作区清理构建文件。
5. 清理后读回旧镜像 / 临时容器 / 备份清单，复核运行实例、配置摘要、PID 及面板 / 内核健康，记录实际回收空间。连接失败的环境明确记为未检查，补查完成前不得声称全部已清理。

## 每次发版前：检查 YouTube 教程

路由器端或客户端每次发版前，都检查[安格视界频道的最新视频](https://www.youtube.com/@Ange-Digital-Life/videos?hl=zh-CN)，不能只依赖面板的动态教程列表。

1. 查看频道最新上传的视频，筛选标题含 `Open-Box` 或 `openbox` 的条目（不区分大小写），核对视频链接、原标题和发布顺序。
2. 更新源码工作区及公开发布工作区 `README.md` 的「使用说明视频」，按发布先后排列、按视频 ID 去重，保留旧教程。没有新视频时不重复添加。
3. 同步源码工作区的 `panel/server/defaults/tutorial-videos.json`，使新安装及离线首次打开也有相同的教程列表；在提交和打包前完成。
4. 发布后读回 GitHub 公开分支的 README，确认新增链接已公开。若本次无法访问频道，记录「未完成检查」及原因，不将网络失败当成没有新视频。

## 每次发版前：Geo 数据及多语种说明

先比较 `MetaCubeX/meta-rules-dat` 的 `sing` 分支与随包清单；有更新时下载、校验并冻结同一提交。不要用显式缓存目录绕过检查，网络失败不能视为“没有更新”。Geo 准备及分类更新应在提交源码和构建前完成：

```sh
python3 scripts/bundle-geodata.py .build-cache/geodata
node panel/scripts/gen-geo-catalog.mjs --geo-dir .build-cache/geodata
python3 scripts/bundle-geodata.py .build-cache/geodata --check-current
node panel/scripts/gen-geo-catalog.mjs --geo-dir .build-cache/geodata --check
python3 scripts/check-geodata.py .build-cache/geodata panel/.tools/sing-box 1.14.1
node --test panel/scripts/geo-catalog.test.mjs
```

Node 使用 24。生成器按该快照的文件清单生成分类，不再向另一个仓库取名单；保留已校对的简体、繁体、英文说明。新分类缺少说明时停止，先补齐 `GEO_NOTES_JSON`（格式见生成器），不能仅用分类名冒充说明。`@ads`、`@cn`、`@!cn`、`@telemetry` 等子集的组合说明也要能搜索。

记录上游提交、时间、数量与变更情况。双架构路由器和本次更新的客户端均指定同一 `OPENBOX_GEO_BUNDLE_DIR`；Docker 使用对应路由器完整包。仅发布客户端也执行上面检查。路由器打包脚本会再次检查上游及分类版本。已发布版本的二进制不原地替换；Geo 更新进入下一次构建和新版本。

## 发布说明与客户端下载

仓库的 GitHub Latest 必须指向带路由器安装包、独立 `update.sh` 及校验文件的正式版，
保证已经安装的旧版入口仍能获取升级脚本。只发布客户端时使用 `gh release create ... --latest=false`，
不要覆盖路由器 Latest。路由器发布后读回 `/releases/latest` 的 tag，并实际下载
`/releases/latest/download/update.sh` 及其校验文件；客户端始终提供带版本号的下载链接。

安装脚本、升级脚本及面板检查也应核对升级脚本资产，Latest 指向客户端时从 Release feed
查找路由器正式版。测试覆盖四段客户端版本、与路由器相同格式的客户端版本、缺失或伪校验文件。

正文以本次用户可感知的改动为主，保留必要兼容提示，省略完整测试流水和内部构建细节。响应 issue 的条目标注 `#编号`，并准确限定修复范围。GitHub 正文、`release-notes.md` 和 `.sha256` 同步更新。

每次提供各平台最近正式版的实际安装包链接，尤其是本次没有客户端或仅更新部分平台时。客户端版本取安装包文件名，不能把旧客户端标成本次路由器版本；没有公开 iOS 安装包就不要编造链接。

发布后同步处理相关 GitHub issue：先核对完整讨论、图片、附件与实际发布内容，用简体中文回复修复范围、版本链接及必要的复测方法。已修复、验证并发布且覆盖原始问题的 bug，以 `completed` 关闭；仅修复子问题、改善诊断或原始故障仍待确认时，说明进展并保持打开。避免重复回复，发送和关闭后读回评论、状态确认。不要把本地代码或未发布的修复称为已发布。

巡检还应覆盖尚未回应的故障反馈，以及用户补充证据后尚未跟进的讨论，不能只看本次发布的修复列表。信息不足时，在对应 issue 说明已确认的线索、最少需要补充的内容及取得方法，保持打开；不要只在本地标记“待补充”，不要重复索要已经提交的截图或日志。用户明确确认恢复时，回复具体解决办法或版本后结案。发送前复读最新讨论，逐条记录评论链接和读回状态。

## 客户端内核侧源码附件

本次包含客户端安装包时，按已定的客户端内核同步规范 §8，提供与实际构建提交一致的内核侧源码；不能仅上传路由器 sing-box 源码包。以下命令只导出白名单内的已提交文件，不读取本机签名、配置、界面或桌面服务源码：

```sh
python3 scripts/package-client-kernel-source.py --commit <客户端实际构建提交> --version 0.1.354 --kernel-source <产物目录>/sing-box-1.14.1-openbox-tcp30-source.tar.gz --output <产物目录>
```

将 `open-box-client-<版本>-kernel-side-source.tar.gz` 及其 `.sha256` 一起上传。解包核对 `SOURCE-MANIFEST.json` 的提交和文件摘要、包含 Android 隧道模块 / iOS 网络扩展及其 Go/Kotlin 依赖、不含 UI、独立桌面服务、私钥、签名和用户数据，再在公开下载验收中逐字节核对。

## 每次发版后：只保留最近 10 个 Release

公开下载安装验收完成后，先生成计划，再执行维护：

```sh
python3 scripts/release-verify/release-maintenance.py
python3 scripts/release-verify/release-maintenance.py --apply
```

需要精简当前正式版说明时，用 `--notes-file <正文文件>` 配合 `--apply`；维护脚本会补齐客户端下载区，并同步正文、说明附件及 SHA256。

- 按发布时间保留最近 10 个已发布 Release，草稿不计入也不删除。
- 按安装包中的版本号定位各平台最新正式版客户端。如果仅在待删版本中，先将安装包及校验文件原样复制到保留的最新正式版；核对下载前后 SHA256 和大小，版本与文件名不变。
- 更新最新正式版的客户端下载链接，再读回确认客户端均已在保留范围内，最后删除旧 Release。复制、校验、链接更新失败或过程中版本清单变化时停止，不继续删除。
- 清理后读回数量和客户端下载位置；Git 标签保留。当前已有不足 10 个版本时不补造版本。

维护脚本的无网络测试：`python3 scripts/release-verify/release-maintenance.test.py`。

## 内存与吞吐基准

基准脚本仅用于测试，不进入面板运行流程。`bench-net/main.go` 是标准库实现的本地 HTTP/DNS 数据源和计数客户端，需用 Go 编译为目标 Linux 架构；它不访问外网。

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o <测试目录>/verify/bench-net scripts/release-verify/bench-net/main.go
# arm64 使用 GOARCH=arm64
```

将 `benchmark-api.mjs`、`benchmark-metrics.sh` 和目标架构的 `bench-net` 放入 Docker 宿主的测试目录 `verify/`，在该宿主运行：

```sh
python3 scripts/release-verify/docker-benchmark.py --arch x64 --root <测试目录> --baseline open-box:0.1.324 --candidate open-box:0.1.325
```

脚本使用独立的容器、网络和数据目录，固定 1000 个合成节点、四条 HTTP 流，本地 SOCKS5 代理不带加密。默认按 1 Gbit/s 的目标速率运行；`--mbps 0 --label uncapped --cases baseline,default` 可测不设速率上限的结果。后者仍受虚拟接口、数据源和测试 CPU 配额限制，不代表物理网卡或真实加密代理的最大吞吐，不同宿主的结果不能直接比较。

面板/内核 RSS 和进程历史峰值分别记录；容器同时记录 cgroup 内存、去除 inactive_file 后的工作集近似值、CPU 时间和节流计数。各进程的历史峰值不一定同时发生，不要将两列相加作为容器峰值。每个 JSON 保留逐秒样本和原始吞吐计数；导入和生成配置阶段包含在采样中。

`native-benchmark.py` 可通过 SSH 在 OpenWrt/Linux 开发机的临时网络命名空间运行同一组配置和数据源。先将 Docker 基准生成的 `auto-config.json`、`tun-config.json`、数据目录 `flip/`、`socks.json` 和 x64 `bench-net` 复制到该机器的独立测试目录，并将两份配置分别命名为 `auto.json`、`tun.json`。脚本以较低优先级运行，默认目标 250 Mbit/s，可通过 `--mbps` 调整。它不停止现有服务、不修改宿主路由或防火墙、不安装软件包，结束后检查原服务 PID 并清理自己的命名空间。

```sh
python3 scripts/release-verify/native-benchmark.py --host <OpenWrt开发机别名> --platform openwrt --source <测试目录> --output <结果.json>
python3 scripts/release-verify/native-benchmark.py --host <Linux开发机别名> --sudo --platform linux --source <测试目录> --output <结果.json>
```

`docker-log-rotation.test.mjs` 必须在覆盖 entrypoint 的临时容器运行，不能对现有网关执行。它验证持续打开的写入句柄、定时轮转、两份归档、近期 FATAL 和输出边界。

```sh
docker run --rm --network none -v <测试目录>/verify:/verify:ro --entrypoint /opt/open-box/node/bin/node open-box:0.1.325 --test /verify/docker-log-rotation.test.mjs
```

发版在本机打包(`scripts/build-release.sh`),源码不推 GitHub,所以没有 CI。以前是先发布、再用公开命令在两台 x86_64
机器上装一遍——验收之前用户已经能下载到,arm64 的包从来没跑过(审查第十七项)。现在按下面的顺序:**验收全过才发布**。

## 1. 打包

在干净的 `git worktree` 里打(打包脚本会拒绝有未提交改动的工作区、拒绝不是 `vX.Y.Z` 的版本号,见 build-release.sh 开头):

```sh
OPENBOX_VERSION=v0.1.266 ... sh scripts/build-release.sh x64 <产物目录>
OPENBOX_VERSION=v0.1.266 ... sh scripts/build-release.sh arm64 <产物目录>
```

## 2. 发布前验收(Release 还没建)

发布目录必须包含 `install.sh`、`update.sh`、`uninstall.sh` 及各自的 `.sha256`，不能只检查安装包。
`update.sh` 与完整安装包内的同名文件必须字节一致；旧版面板会先请求
`releases/latest/download/update.sh`，缺少这个独立资产会在下载升级包之前失败，关闭 FakeIP 无效。

1. 本机起假镜像,把产物目录当 GitHub Release 的镜像前缀提供出去:

   ```sh
   python3 scripts/release-verify/fake-mirror.py --dir <产物目录> --tag v0.1.266 --port 8765
   ```

2. 两台 x86_64 机器上全新安装(OpenWrt 开发路由器会先备份、验完还原 data / etc):

   ```sh
   sh scripts/release-verify/run-host.sh openbox-dev install MIRROR=http://192.168.3.9:8765 TAG=v0.1.266
   sh scripts/release-verify/run-host.sh ubuntu23 install MIRROR=http://192.168.3.9:8765 TAG=v0.1.266
   ```

   验:版本号、meta.json 里的源码提交、面板 `/api/health`、命令行、LuCI 视图 / glibc Node、没有残留 `.old`、内核起得来、本机上网。

3. 升级路径(从当前公开版本升到新版本,从 Release 资产入口取新的 update.sh):

   ```sh
   sh scripts/release-verify/run-host.sh ubuntu23 upgrade MIRROR=http://192.168.3.9:8765 TAG=v0.1.266
   ```

   当前公开版本默认经 ghfast.top 装;镜像慢的时候加 `OLD_MIRROR=direct` 直连 GitHub(2026-09-30 ghfast.top 给
   ubuntu23 只有 6 KB/s,直连约 1 MB/s)。direct 只在机器自己就能直连 GitHub 时能用(ubuntu23 可以);开发路由器卸掉
   内核之后直连 GitHub 不通(拿到真实地址、连接超时),用默认的 ghfast.top。取脚本之前会先停本机内核(内核开着时直连
   GitHub 会被它重置),要用的脚本都先取到才动机器,取不到就把内核拉回来、原样退出;数据备份在 `/root/ob-verify-backup`,
   半路断了下次会沿用、不覆盖。

   OpenWrt 也跑一遍:`sh scripts/release-verify/run-host.sh openbox-dev upgrade MIRROR=http://192.168.3.9:8765 TAG=v0.1.266`。

4. arm64:`sh scripts/release-verify/arm64-vm.sh <产物目录>/open-box-v0.1.266-linux-arm64.tar.gz`(虚拟机准备见 `vz/README.md`)。

5. 改过升级脚本的回退逻辑时,再验一次「新版本面板起不来 → 整体回退」:另打一个故意起不来的包(比如在临时 worktree 里给
   `panel/server/index.mjs` 开头加一行 `throw new Error('verify rollback')`,`OPENBOX_VERSION=v0.1.267 OPENBOX_ALLOW_DIRTY=1` 打 x64),
   另起一个假镜像(`--port 8766 --tag v0.1.267`),在已经装着新版本的机器上:

   ```sh
   sh scripts/release-verify/run-host.sh openbox-dev rollback MIRROR=http://192.168.3.9:8766 TAG=v0.1.266 BAD_TAG=v0.1.267
   ```

## 3. 发布,再用公开命令验一遍

`gh release create` 上传产物,附件里再带一份 `release-notes.md`(和发布说明同一份:面板「发现新版本」弹窗取更新日志时
先直连 GitHub API,不通才从镜像取这个附件,见 panel/server/system/updater.mjs 的 fetchReleaseNotes);同步公开分支(README 一键安装拉的是它);
公开说明不加入内部 HTML 注释标记（旧版面板会原样显示）；客户端下载区块以 `### 客户端下载` 标题维护。验收时检查升级弹窗实际内容，而不只看 GitHub 的 Markdown 渲染。
等镜像缓存跟上之后:

```sh
curl -fsSL https://github.com/liandu2024/Open-Box/releases/latest/download/update.sh -o /tmp/openbox-release-update.sh
curl -fsSL https://github.com/liandu2024/Open-Box/releases/latest/download/update.sh.sha256 -o /tmp/openbox-release-update.sh.sha256
sh -n /tmp/openbox-release-update.sh
sh scripts/release-verify/run-host.sh openbox-dev install MIRROR=https://ghfast.top TAG=v0.1.266
sh scripts/release-verify/run-host.sh ubuntu23 install MIRROR=https://ghfast.top TAG=v0.1.266
```

核对上述公开下载脚本与发布目录中的 `update.sh` SHA256 相同，并检查远端 Release 资产清单包含三份独立脚本及校验文件。
还要从上一正式版的**已安装升级入口**启动一次升级，覆盖它先获取最新脚本再接力执行的过程；仅手动运行新脚本不能替代这项验证。

### 下载期间保持内核运行

在开发环境开启 FakeIP 和「直连不进内核」，从已安装入口选择「GitHub 直连」完成一次真实公开下载升级。
脚本、版本号、组件清单、校验文件和正文下载都应使用正在运行的内核回环入口 `127.0.0.1:7891`，
将域名交给内核按现有分流规则处理；下载子进程的代理环境不能传给重启后的服务。

下载、校验和新 Node 冒烟期间，原内核 PID 应保持不变。只有进入 `committing` 后才能停止内核、等待 TUN 退出，
然后停面板、替换文件并恢复原先运行的内核。另验下载失败和取消：内核 PID、原安装与 profile 均保持不变。
原本停止的内核不能因检查或下载被启动；旧脚本已暂停内核后接力到新版时，应先恢复它再联网。
本地假镜像验收不能替代这项公开 GitHub 下载检查。正式路由器只由用户手动升级，不作为自动测试目标。

镜像失败只更换来源，内核代理和正在使用的 DNS 保持不变。入口尚未监听时先等待，
等待超时应安全中止并保留原服务，不能清空代理设置改走系统网络。必须复测首个镜像失败、
下一个来源成功的路径，并检查 FakeIP 和「直连不进内核」配置与内核 PID 均未改变。
