# Open-Box

OpenWrt 一体化透明代理方案:一条命令装完 sing-box 内核 + 管理面板,面板首次打开设密码、跟引导走,不需要手写配置文件。

- 设计文档:`docs/superpowers/specs/2026-07-21-open-box-design.md`
- 实施路线图:`docs/superpowers/plans/2026-07-24-open-box-roadmap.md`

> **当前状态:尚未在真实 OpenWrt 硬件上验证过完整安装流程。**
> 以下所有脚本已经过 shell 语法检查、打包产物结构检查、契约测试等本地/CI 验证,但
> 真实路由器上的"下载 → 铺装 → 起服务"全流程还没有跑过一次。在这一轮真机验收
> (路线图 P7)完成之前,请把本项目当作 **测试版** 使用,不建议在生产网络中依赖它。

## 硬件要求

- **CPU 架构**:x86_64 或 arm64(aarch64)。除此之外的架构(如常见的 mips/mipsel
  老款路由器)暂不支持。
- **可用存储**:≥ 512MB。**16MB / 32MB flash 的经典入门路由器不支持**——即使刷了
  OpenWrt,可用空间也远达不到这个门槛。通常需要路由器自带 eMMC/NAND ≥512MB,或者
  接了 USB 盘/TF 卡并 `extroot` 到足够大的存储上。
- **可用内存**:≥ 512MB。
- **系统**:OpenWrt(安装脚本会检测 `/etc/openwrt_release`,非 OpenWrt 系统会直接
  拒绝安装)。

不满足以上任一条件,`install.sh` 的预检会直接报错退出,不会碰你的系统。

## 安装

**通过 SSH 以 root 身份登录路由器**,然后二选一执行:

```bash
# 直连版(能正常访问 GitHub 时用这个)
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh

# 镜像加速版(GitHub 访问不畅时用这个;把 <镜像前缀> 换成你信任的加速站点域名)
curl -fsSL https://<镜像前缀>/https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh -s -- --mirror <镜像前缀>
```

安装脚本会先做预检(架构、存储、内存、系统),校验通过才会下载对应架构的发布包、
校验 SHA256、铺装到 `/opt/open-box/`,并启动面板服务。**校验不通过、下载失败,或
架构/存储/内存不满足要求,系统不会有任何改动。**

### 安装完成后

1. 浏览器打开脚本输出的面板地址,一般是 `http://<路由器局域网 IP>:2026`。
2. 首次访问会要求**设置管理密码**——安装过程不会生成随机密码,这一步是必须的。
3. 设完密码后跟着**引导向导**走,添加订阅、配置分流规则即可。

面板只监听局域网(LAN),不会自动开放到公网。

## 升级

同样通过 SSH 以 root 身份登录路由器执行:

```bash
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/update.sh | sh
```

`update.sh` 不接受任何参数——它会自动沿用安装时选择的下载通道(直连或镜像),
如果安装时用的是镜像通道,升级会自动继续用同一个镜像前缀,无需再手动指定。

升级会保留你的数据(`data/`,包括订阅、规则、面板密码)与已生效的运行配置,只替换
程序本体;只重启面板,不会自动重启代理内核——如果之前配置并跑着代理,升级后请到
面板里手动重新启动一次。

## 卸载

同样通过 SSH 以 root 身份登录路由器执行:

```bash
# 停止服务、清理系统改动、删除程序文件;默认保留 data/(订阅、规则、密码等数据)
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh

# 同上,但连 data/ 一起删掉,彻底清干净
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh -s -- --purge
```

不加 `--purge` 时,如果是在真实终端里交互执行,脚本还会追问一次是否保留
`data/`;通过管道这种非交互方式执行时问不到,会静默按"保留"处理,之后想彻底删除
再重新执行一次上面的 `--purge` 命令即可。

## LuCI 兜底页

安装后,路由器自带的管理界面(LuCI)里会多出一个入口:**服务 → Open-Box**。这是给
面板本身打不开时用的救场页面,能做的事情包括:

- 分别启停 sing-box 内核服务与面板服务,以及切换它们的开机自启
- 「紧急停止并恢复直连」——一键停掉代理、清掉路由/防火墙/DNS 改动,恢复到裸直连
- 「打开 Open-Box 面板」跳转链接

如果面板进程意外崩溃或者你被自己配的分流规则卡在了外面,先去 LuCI 这个页面看看。

## ⚠️ 安全提示

**面板后端具备路由器 root 级别的权限**(它需要改防火墙规则、下发 DNS 接管、启停
系统服务)。因此:

- 面板端口(2026)默认只监听局域网,**不要把它裸端口转发到公网**。
- 如果确实需要在外网访问面板,请自己在前面套一层带认证的 HTTPS 反向代理,或者用
  VPN/WireGuard 之类的方式先接入局域网,再访问面板——不要让路由器直接把 2026 端口
  暴露给公网。

## 仓库结构

- `panel/` 管理面板(fork 自 AnGe-ClashBoard,上游 zashboard,MIT)
- `openwrt/` init 脚本与 LuCI 兜底页(P5)
- `scripts/` install / update / uninstall / build-release(P6)
- `templates/` sing-box 配置模板(P2)

## 本地开发

```bash
bash scripts/dev-panel.sh   # 构建并启动面板于 http://127.0.0.1:2026
cd panel && corepack pnpm run test:server   # 服务端测试
```
