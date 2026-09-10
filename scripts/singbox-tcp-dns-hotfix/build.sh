#!/bin/sh
# Complete, static musl TCP DNS compatibility build. Does not deploy or publish.
set -eu

hotfix_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
hotfix_arch=${1:-amd64}
case "$hotfix_arch" in amd64|arm64) ;; *) echo 'Expected amd64 or arm64' >&2; exit 2 ;; esac
hotfix_output=${2:-"$hotfix_dir/../../.build-cache/tcp-dns-hotfix"}
mkdir -p "$hotfix_output"
hotfix_output=$(CDPATH= cd -- "$hotfix_output" && pwd)
hotfix_work=$(mktemp -d "${TMPDIR:-/tmp}/openbox-tcp-dns-build.XXXXXX")
hotfix_go=${OPENBOX_GO_BINARY:-go}
hotfix_cc=${CC:?Set CC to the Chromium clang compiler with the target musl sysroot}
hotfix_cxx=${CXX:?Set CXX to the matching clang++ compiler with the target musl sysroot}
hotfix_sha=87baf6852e37941cbe40bdd94bec81c957c88a56751cecd6bbf0e6108bc69398
hotfix_version=1.14.0-openbox-tcp1

printf 'Build workspace: %s\n' "$hotfix_work"
"$hotfix_go" version
if [ -n "${OPENBOX_SINGBOX_SOURCE_ARCHIVE:-}" ]; then
  cp "$OPENBOX_SINGBOX_SOURCE_ARCHIVE" "$hotfix_work/source.tar.gz"
else
  curl -fSL --connect-timeout 10 --max-time 120 \
    https://codeload.github.com/SagerNet/sing-box/tar.gz/refs/tags/v1.14.0 \
    -o "$hotfix_work/source.tar.gz"
fi
if command -v sha256sum >/dev/null 2>&1; then
  hotfix_actual=$(sha256sum "$hotfix_work/source.tar.gz" | awk '{print $1}')
else
  hotfix_actual=$(shasum -a 256 "$hotfix_work/source.tar.gz" | awk '{print $1}')
fi
[ "$hotfix_actual" = "$hotfix_sha" ] || { echo 'Source archive checksum mismatch' >&2; exit 1; }
tar -xzf "$hotfix_work/source.tar.gz" -C "$hotfix_work"
cd "$hotfix_work/sing-box-1.14.0"
patch -p1 < "$hotfix_dir/tcp-dns-short-connections.patch"
cp "$hotfix_dir/tcp_short_connection_test.go" dns/transport/openbox_tcp_test.go

# Preserve the upstream complete feature set, including Naive's static Cronet
# library. Never fall back to CGO=0 or DEFAULT_BUILD_TAGS_OTHERS for a release.
hotfix_tags="$(cat release/DEFAULT_BUILD_TAGS),with_musl"
CGO_ENABLED=0 GOMAXPROCS=2 "$hotfix_go" test -p 2 -count=1 -timeout 30s \
  ./dns/transport -run '^TestOpenBoxTCPDNS' -v
hotfix_binary="$hotfix_output/sing-box-$hotfix_version-linux-$hotfix_arch"
CGO_ENABLED=1 GOOS=linux GOARCH="$hotfix_arch" GOMAXPROCS=2 \
  CC="$hotfix_cc" CXX="$hotfix_cxx" CGO_LDFLAGS="${CGO_LDFLAGS:--fuse-ld=lld}" \
  "$hotfix_go" build -p 2 -trimpath -tags "$hotfix_tags" \
  -ldflags "-X github.com/sagernet/sing-box/constant.Version=$hotfix_version -X runtime.godebugDefault=multipathtcp=0,tlssha1=1 -checklinkname=0 -s -w -buildid=" \
  -o "$hotfix_binary.tmp" ./cmd/sing-box
python3 "$hotfix_dir/../dt-needed.py" --assert-static "$hotfix_binary.tmp"
mv "$hotfix_binary.tmp" "$hotfix_binary"
printf 'Complete static musl binary: %s\n' "$hotfix_binary"
printf 'Includes with_naive_outbound. No deployment or release was performed.\n'
