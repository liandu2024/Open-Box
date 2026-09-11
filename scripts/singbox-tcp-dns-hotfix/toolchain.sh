#!/bin/sh
# Sourced by build.sh. Downloads compilers/sysroots, never a sing-box binary.
toolchain_cache=${OPENBOX_TOOLCHAIN_CACHE:-"$hotfix_dir/../../.build-cache/kernel-toolchains"}
mkdir -p "$toolchain_cache"
toolchain_cache=$(CDPATH= cd -- "$toolchain_cache" && pwd)
toolchain_clang_revision=llvmorg-23-init-10931-g20b6ec66-11
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    toolchain_host=Mac_arm64
    toolchain_clang_sha=94aac4f9e8a68559b579c76b863a5e0df6e80ba2900d2b7b5a6f1475a08a390c
    ;;
  Linux/x86_64)
    toolchain_host=Linux_x64
    toolchain_clang_sha=de584381536aa5ba2403033c4f8b70f3c39c2e5d7fa87c953b7fd8bfbba0ee2a
    ;;
  *) echo 'Set CC and CXX for this build host; automatic toolchain supports macOS arm64 and Linux x86_64.' >&2; exit 1 ;;
esac
case "$hotfix_arch" in
  amd64)
    toolchain_target=x86_64-openwrt-linux-musl
    toolchain_platform=x86/64
    toolchain_archive=openwrt-toolchain-23.05.5-x86-64_gcc-12.3.0_musl.Linux-x86_64
    toolchain_inner=toolchain-x86_64_gcc-12.3.0_musl
    toolchain_sysroot_sha=f1122c80bbfb791e9347aa87c3e9643f260357ab8e30e8082b79990f968c2c73
    ;;
  arm64)
    toolchain_target=aarch64-openwrt-linux-musl
    toolchain_platform=armsr/armv8
    toolchain_archive=openwrt-toolchain-23.05.5-armsr-armv8_gcc-12.3.0_musl.Linux-x86_64
    toolchain_inner=toolchain-aarch64_generic_gcc-12.3.0_musl
    toolchain_sysroot_sha=917bc1d5f86edb58b4044826f5de68983e7f6f7c81dbbe2c73066e4c90db14e9
    ;;
esac
toolchain_fetch() {
  if [ ! -s "$2" ]; then
    curl -fSL --retry 3 --connect-timeout 10 --max-time 300 "$1" -o "$2.part"
    mv "$2.part" "$2"
  fi
  python3 - "$2" "$3" <<'PY'
import hashlib, sys
from pathlib import Path
p = Path(sys.argv[1])
if hashlib.sha256(p.read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit(f'Toolchain checksum mismatch: {p}')
PY
}
toolchain_clang_tar="$toolchain_cache/clang-$toolchain_host-$toolchain_clang_revision.tar.xz"
toolchain_fetch "https://commondatastorage.googleapis.com/chromium-browser-clang/$toolchain_host/clang-$toolchain_clang_revision.tar.xz" "$toolchain_clang_tar" "$toolchain_clang_sha"
toolchain_clang_dir="$hotfix_work/clang"
mkdir -p "$toolchain_clang_dir"
tar -xJf "$toolchain_clang_tar" -C "$toolchain_clang_dir"
toolchain_sysroot_tar="$toolchain_cache/$toolchain_archive.tar.xz"
toolchain_fetch "https://downloads.openwrt.org/releases/23.05.5/targets/$toolchain_platform/$toolchain_archive.tar.xz" "$toolchain_sysroot_tar" "$toolchain_sysroot_sha"
tar -xJf "$toolchain_sysroot_tar" -C "$hotfix_work"
toolchain_sysroot="$hotfix_work/$toolchain_archive/$toolchain_inner"
hotfix_cc="$toolchain_clang_dir/bin/clang --target=$toolchain_target --sysroot=$toolchain_sysroot"
hotfix_cxx="$toolchain_clang_dir/bin/clang++ --target=$toolchain_target --sysroot=$toolchain_sysroot"
export OPENBOX_CLANG_SHA256="$toolchain_clang_sha" OPENBOX_SYSROOT_SHA256="$toolchain_sysroot_sha"
