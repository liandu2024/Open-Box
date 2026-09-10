# sing-box 1.14.0 TCP DNS 空闲连接兼容补丁

这是 Open-Box 的兼容补丁，不是 sing-box 官方版本；不更改 Open-Box 的 DNS 协议、规则顺序、解析器地址、策略出口、FakeIP 或旁路配置。完整发布构建保留上游全部默认功能（包括 Naive），采用 CGO 和静态 musl 链接。

## 已复现的问题

2026-09-10，在用户现有代理线路上，同一 TCP DNS 连接刚建立时正常，空闲 30 秒后再次查询不再收到应答，也没有及时收到 EOF。相同线路、解析器和查询，在独立进程对照中：

- 官方 1.13.14：空闲 32 秒后约 40 ms 返回。
- 官方 1.14.0：空闲 32 秒后连续两次超过 3 秒查询期限。
- 应用此补丁的 1.14.0：空闲后约 39、40 ms 返回。

1.13.14 的 TCP DNS 每次查询建立并关闭连接；1.14.0 增加了复用探测和共用连接。补丁只改变 `dns/transport/tcp.go` 的同步与异步 Exchange 入口，复用其原有 `exchangeSingle` 实现，恢复每次查询单独建立 TCP 连接的行为。查询仍经原策略的 `detour` 出口进行。TCP DNS 仍使用原服务器和端口，不改为 DoH、DoT 或 UDP。

这确认了本次空闲连接超时的触发机制，不表示所有节点和网络路径都会触发，也不表示所有网页的所有延迟均由此造成。首次创建连接也曾在一个隔离场景中超时一次，该结果保留在测试记录中。

## 构建与回归

要求 Go >= 1.25.5，实际验证使用 Go 1.26.8。源码固定为上游 v1.14.0，并核对下载归档 SHA-256；依赖沿用其 go.mod / go.sum。`CC` / `CXX` 必须使用适配目标架构的 Clang 与 musl sysroot；构建默认使用上游 `DEFAULT_BUILD_TAGS` 加 `with_musl`，不会退回缺少 Naive 的精简构建。

```sh
CC='/path/to/clang --target=x86_64-openwrt-linux-musl --sysroot=/path/to/x86_64-sysroot' \
CXX='/path/to/clang++ --target=x86_64-openwrt-linux-musl --sysroot=/path/to/x86_64-sysroot' \
OPENBOX_GO_BINARY=/path/to/go \
scripts/singbox-tcp-dns-hotfix/build.sh amd64 /path/to/output
```

arm64 将编译器 target 改为 `aarch64-openwrt-linux-musl`、使用相应 sysroot，并把脚本首个参数改为 `arm64`。已有上游归档时可设置 `OPENBOX_SINGBOX_SOURCE_ARCHIVE`，仍然强制检查 SHA-256。

本次构建工具链与上游 cronet-go 的 musl 方案相同：Chromium Clang `llvmorg-23-init-10931-g20b6ec66-11`，OpenWrt `23.05.5` / GCC `12.3.0` 的 x86_64、aarch64 musl sysroot；Naive 使用 go.sum 固定的 Cronet 静态库。二进制归档中的 `BUILD-INFO.json` 记录源码、工具链、构建标签和哈希，发布附件另含修改后的 sing-box 源码、补丁、测试和构建脚本。

补丁版本标识为 `1.14.0-openbox-tcp1`。回归覆盖空闲连接无回应、同步/异步查询、A/AAAA/HTTPS 类型、查询 ID 和 NXDOMAIN 保留、查询取消后关闭连接。相同回归针对未修改源码运行时，在空闲后的第三次查询失败；补丁通过。

代价：缓存未命中的 TCP DNS 查询不再共享一条 TCP 连接，每次需要新建连接。正常 DNS 应答缓存保留，HTTP/QUIC 的业务连接复用不变。

## 交付边界

`build.sh` 只生成完整静态内核，不会部署、替换正式路由器或发布 GitHub Release。构建后通过 `dt-needed.py --assert-static` 检查没有动态链接器和动态库依赖。

最初用于定位故障的 CGO=0 精简二进制未包含 Naive，只用于开发验证；正式发布包使用后续完整构建。部署先用新二进制 `check` 当前生成配置、验证隔离实例，再备份原内核并替换。保留原 config.json、config.meta.json、档案、用户选择及 DNS 上游设置；通过正常服务重启启用新内核。

上游源码：

- https://github.com/SagerNet/sing-box/blob/v1.13.14/dns/transport/tcp.go
- https://github.com/SagerNet/sing-box/blob/v1.14.0/dns/transport/tcp.go
- https://github.com/SagerNet/sing-box/blob/v1.14.0/dns/transport/multiplexer.go
