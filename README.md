# Open-Box

Open-Box 是面向 OpenWrt 路由器的一体化透明代理安装包，内置 sing-box 内核、Node 运行时以及 GeoSite / GeoIP 数据。

## 下载

请从 [GitHub Releases](https://github.com/liandu2024/Open-Box/releases/latest) 下载对应架构的完整安装包：

- `x64`：x86_64 路由器
- `arm64`：aarch64 路由器

完整安装包包含程序、内核和 GeoSite / GeoIP 数据，首次安装无需额外下载规则数据库。每个资产旁边都有 SHA256 校验文件。

## 安装

SSH 以 root 登录 OpenWrt 路由器后执行：

```sh
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh
```

GitHub 访问不畅时，可使用安装脚本支持的镜像参数：

```sh
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/install.sh | sh -s -- --mirror
```

要求：OpenWrt、x86_64 或 aarch64、至少 512MB 存储空间和 512MB 内存。

## 升级

```sh
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/update.sh | sh
```

升级会校验本地 Open-Box、sing-box 和 GeoSite / GeoIP 组件版本；版本一致且文件完整时直接复用，只有变化或损坏的组件才从本仓库 Release 下载。

## 卸载

默认保留订阅和配置数据：

```sh
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh
```

连数据一起删除：

```sh
curl -fsSL https://raw.githubusercontent.com/liandu2024/Open-Box/main/scripts/uninstall.sh | sh -s -- --purge
```

## 许可证

本仓库公开安装、升级和卸载所需脚本及发布资产。面板和内核的许可证与版权信息随安装包提供。
