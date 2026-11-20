#!/bin/sh
# 从同版本完整发布包构建镜像。先运行 build-release.sh，确保包里包含本次面板/服务端修改。
# sh scripts/build-docker.sh <x64|arm64> <release-dir> [image-tag]
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCH=${1:?Expected x64 or arm64}
DIR=$(CDPATH= cd -- "${2:?Expected release directory}" && pwd)
TAG=${3:-open-box:0.1.465}
case "$ARCH" in x64) PLATFORM=linux/amd64;; arm64) PLATFORM=linux/arm64;; *) echo 'Expected x64 or arm64' >&2; exit 1;; esac
ASSET=open-box-linux-$ARCH.tar.gz
if command -v sha256sum >/dev/null 2>&1; then
 (cd "$DIR" && sha256sum -c "$ASSET.sha256")
else
 (cd "$DIR" && shasum -a 256 -c "$ASSET.sha256")
fi
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
mkdir "$STAGE/root"
tar -xzf "$DIR/$ASSET" -C "$STAGE/root"
# Reject a wrong-architecture or damaged Go panel / kernel binary before building the image.
python3 - "$STAGE/root" "$ARCH" <<'PYGO'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
arch = sys.argv[2]
meta = json.loads((root / 'meta.json').read_text())
if meta.get('arch') != arch or meta.get('panelRuntime') != 'go-static':
    raise SystemExit('Docker package architecture or panelRuntime mismatch')
if (root / 'node').exists():
    raise SystemExit('Unexpected node runtime directory inside pure-Go package')
machine = 62 if arch == 'x64' else 183
for rel in ('bin/openbox-panel', 'bin/sing-box'):
    binary = root / rel
    if not binary.is_file() or not (binary.stat().st_mode & 0o111):
        raise SystemExit(f'Missing or non-executable binary: {rel}')
    head = binary.read_bytes()[:20]
    if len(head) < 20 or head[:6] != bytes.fromhex('7f454c460201') or int.from_bytes(head[18:20], 'little') != machine:
        raise SystemExit(f'ELF architecture mismatch: {rel}')
print('Docker package verified:', meta['version'], arch, 'go-static panel', meta.get('panelBuildId', ''))
PYGO
cp -R "$ROOT/docker" "$STAGE/docker"
cp "$ROOT/docker/Dockerfile" "$STAGE/Dockerfile"
if docker buildx version >/dev/null 2>&1; then
 docker buildx build --load --platform "$PLATFORM" -t "$TAG" "$STAGE"
else
 docker build --platform "$PLATFORM" -t "$TAG" "$STAGE"
fi
