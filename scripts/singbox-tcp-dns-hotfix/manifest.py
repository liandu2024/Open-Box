#!/usr/bin/env python3
"""Record and verify that a bundled kernel was built from this checkout's inputs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    return {p.name: sha(p) for p in sorted(HERE.iterdir())
            if p.is_file() and p.suffix in ('.sh', '.py', '.patch', '.go')}


def inspect(binary, arch):
    header = binary.read_bytes()[:20]
    assert header[:6] == b'\x7fELF\x02\x01', 'Expected a 64-bit little-endian ELF'
    assert int.from_bytes(header[18:20], 'little') == {'amd64': 62, 'arm64': 183}[arch], 'Wrong kernel architecture'
    subprocess.run([sys.executable, str(HERE.parent / 'dt-needed.py'), '--assert-static', str(binary)], check=True)


mode, bundle_arg, arch, version = sys.argv[1:5]
bundle = Path(bundle_arg)
binary = bundle / 'sing-box'
inspect(binary, arch)
if mode == 'create':
    source, go = sys.argv[5:7]
    build = subprocess.check_output([go, 'version', '-m', str(binary)], text=True)
    for required in ('with_naive_outbound', 'with_musl', 'CGO_ENABLED=1', 'GOOS=linux', f'GOARCH={arch}'):
        assert required in build, f'Missing build feature: {required}'
    manifest = {
        'version': version,
        'arch': arch,
        'binary_sha256': sha(binary),
        'upstream_source_sha256': os.environ['SINGBOX_SOURCE_SHA256'],
        'build_inputs': inputs(),
        'openbox_commit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'go_version': subprocess.check_output([go, 'version'], text=True).strip(),
        'clang_archive_sha256': os.environ.get('OPENBOX_CLANG_SHA256'),
        'sysroot_archive_sha256': os.environ.get('OPENBOX_SYSROOT_SHA256'),
        'build_tags': (Path(source) / 'release/DEFAULT_BUILD_TAGS').read_text().strip().split(',') + ['with_musl'],
        'cgo_enabled': True,
        'static_musl': True,
        'go_build_information': build,
    }
    (bundle / 'BUILD-INFO.json').write_text(json.dumps(manifest, indent=2) + '\n')
elif mode == 'verify':
    manifest = json.loads((bundle / 'BUILD-INFO.json').read_text())
    assert manifest['version'] == version and manifest['arch'] == arch, 'Kernel version/architecture mismatch'
    assert manifest['binary_sha256'] == sha(binary), 'Kernel binary checksum mismatch'
    assert manifest['build_inputs'] == inputs(), 'Kernel build inputs differ from this checkout; rebuild the kernel'
    assert manifest['upstream_source_sha256'] == os.environ['SINGBOX_SOURCE_SHA256'], 'Upstream source mismatch'
    assert manifest['cgo_enabled'] and manifest['static_musl'], 'Incomplete kernel build'
    assert 'with_naive_outbound' in manifest['build_tags'], 'Naive support is required'
    assert (bundle / 'LICENSE').is_file(), 'Missing kernel license'
    print(f'Verified locally built kernel: {version} {arch} {manifest["binary_sha256"]}')
else:
    raise SystemExit(f'Unknown mode: {mode}')
