#!/bin/sh
# 从同版本完整发布包构建镜像。先运行 build-release.sh，确保包里包含本次面板/服务端修改。
# sh scripts/build-docker.sh <x64|arm64> <release-dir> [image-tag]
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCH=${1:?Expected x64 or arm64}
DIR=$(CDPATH= cd -- "${2:?Expected release directory}" && pwd)
TAG=${3:-open-box:0.1.346}
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
# Reject a wrong-architecture or damaged native application before building the image.
python3 - "$STAGE/root" "$ARCH" <<'PYCORE'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]); arch=sys.argv[2]
meta=json.loads((root/'meta.json').read_text())
server=root/'panel/server'
m=json.loads((server/'hardening-manifest.json').read_text())
core=json.loads((server/'native/core-build.json').read_text())
binary=server/'native/openbox-core'; data=binary.read_bytes()
if meta.get('arch')!=arch or m.get('schema')!=2 or m.get('format')!='go-native+minified-esm' or core!=m.get('core') or core.get('os')!='linux' or core.get('arch')!=('amd64' if arch=='x64' else 'arm64') or core.get('protocol')!=1:
 raise SystemExit('Docker package/native-core architecture mismatch')
if data[:6]!=bytes.fromhex('7f454c460201') or int.from_bytes(data[18:20],'little')!=(62 if arch=='x64' else 183) or not binary.stat().st_mode & 0o111:
 raise SystemExit('Invalid native-core ELF or executable permission')
for name,want in m['files'].items():
 if hashlib.sha256((server/name).read_bytes()).hexdigest()!=want: raise SystemExit('Native app hash mismatch: '+name)
print('Docker package verified:',meta['version'],arch,'native core',core['buildID'])
PYCORE
cp -R "$ROOT/docker" "$STAGE/docker"
cp "$ROOT/docker/Dockerfile" "$STAGE/Dockerfile"
if docker buildx version >/dev/null 2>&1; then
 docker buildx build --load --platform "$PLATFORM" -t "$TAG" "$STAGE"
else
 docker build --platform "$PLATFORM" -t "$TAG" "$STAGE"
fi
