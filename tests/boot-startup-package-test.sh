#!/bin/bash
# mos-build-side: container -- real static x64 inputs; no target execution.
set -euo pipefail
REPO=${1:?repository root}
WORK=$(mktemp -d)
trap 'rm -r "$WORK"' EXIT
# The launcher is real; Docker is an argument recorder, never a build here.
# Execute recipe branch bodies with acquisition/compiler commands isolated.
python3 - "$REPO" "$WORK" <<'TARGET_ROUTE'
import json
import os
from pathlib import Path
import re
import subprocess
import sys

repo, work = map(Path, sys.argv[1:])
route = work / 'route'; route.mkdir()
bin_dir = route / 'bin'; bin_dir.mkdir()
docker = bin_dir / 'docker'
docker.write_text('#!/usr/bin/env python3\nimport json,os,sys\nopen(os.environ["ROUTE_ARGV"],"a").write(json.dumps(sys.argv[1:])+"\\n")\n')
docker.chmod(0o755)
record = route / 'docker.jsonl'
env = dict(os.environ, PATH=str(bin_dir) + ':' + os.environ['PATH'], ROUTE_ARGV=str(record))
env.pop('MOS_BOOT_TARGET', None)
cases = [(['--target', ''], {}, False), (['--target', 'invalid'], {}, False),
         (['--target', 'x64', '--target', 'aa64'], {}, False),
         ([], {'MOS_BOOT_TARGET': ''}, False), ([], {'MOS_BOOT_TARGET': 'amd64'}, False),
         (['--target', 'aa64'], {'MOS_BOOT_TARGET': 'x64'}, False),
         ([], {}, 'x64'), (['--target', 'x64'], {}, 'x64'),
         ([], {'MOS_BOOT_TARGET': 'aa64'}, 'aa64'),
         (['--target', 'aa64'], {'MOS_BOOT_TARGET': 'aa64'}, 'aa64')]
for args, extra, target in cases:
    record.write_text('')
    result = subprocess.run(['bash', str(repo / 'pkgs/mos-boot/build-tools.sh'), *args],
                            env=dict(env, **extra), capture_output=True, text=True, timeout=15)
    calls = [json.loads(line) for line in record.read_text().splitlines()]
    if not target:
        assert result.returncode != 0 and not calls, (args, extra, result.stdout, result.stderr, calls)
    else:
        assert result.returncode == 0 and len(calls) == 1, result.stderr
        argv = calls[0]
        assert argv[0] == 'build' and argv[-1] == str(repo / 'pkgs/mos-boot')
        assert argv.count('MOS_BOOT_TARGET=' + target) == 1 and argv.count('--platform') == 1
        assert argv[argv.index('--platform') + 1] == 'linux/amd64'
        assert argv[argv.index('-t') + 1] == 'ai-agent/mos-boot-tools-' + {'x64': 'amd64', 'aa64': 'arm64'}[target]
        assert any(v.startswith('MOS_IMAGE_DEBIAN_TRIXIE=') and '@sha256:' in v for v in argv)
        assert any(v.startswith('MOS_DEBIAN_SNAPSHOT=http://snapshot.debian.org/archive/debian/') for v in argv)
    print('PASS: target launcher', args, extra, target or 'refused')

recipe = (repo / 'pkgs/mos-boot/Dockerfile').read_text().replace('\\\n', '')
instructions = [line.strip() for line in recipe.splitlines() if line and not line.startswith('#')]
runs = [line[4:] for line in instructions if line.startswith('RUN ')]
assert instructions.count('ARG MOS_BOOT_TARGET=x64') == 1
guard = re.match(r'(case "\$MOS_BOOT_TARGET" in .*?esac;)', runs[0])
assert guard, 'target must be checked before first acquisition'
for target in ('', 'both', 'x64 aa64'):
    result = subprocess.run(['sh', '-c', guard[1]], env=dict(env, MOS_BOOT_TARGET=target), capture_output=True, timeout=10)
    assert result.returncode != 0, target
assert [line for line in instructions if line.startswith('FROM ')] == [
    'FROM ${MOS_IMAGE_DEBIAN_TRIXIE} AS tools', 'FROM tools AS loader-build',
    'FROM tools AS artifact-tools']
assert 'COPY --from=loader-build /loader-out/ /usr/lib/systemd/boot/efi/' in instructions
assert not any(line.startswith('COPY --from=loader-build /build') for line in instructions)
for required in (
    'COPY initramfs.sh kernel.sh compression.sh elf-closure.py /tools/',
    'COPY --from=loader-build /source/LICENSE.LGPL2.1 /usr/share/doc/mos-systemd-boot/LICENSE.LGPL2.1',
    'LABEL mos.boot.target=${MOS_BOOT_TARGET}',
):
    assert required in instructions, required

# These are shell branch fixtures, not target executable or image acceptance.
prefix = '''log() { printf '%s\\n' "$*" >> "$ROUTE_COMMANDS"; }
dpkg() { log dpkg "$@"; }
curl() { log curl "$@"; }; sha256sum() { cat >/dev/null; log sha256sum "$@"; }; tar() { log tar "$@"; }
meson() { log meson "$@"; }; ninja() { log ninja "$@"; }; patch() { cat >/dev/null; log patch "$@"; }
bash() { log bash "$@"; }; cp() { log cp "$@"; }; mkdir() { log mkdir "$@"; }
rm() { log rm "$@"; }; find() { log find "$@"; }
'''
for name in ('apt-get', 'dpkg-deb'):
    stub = bin_dir / name
    stub.write_text('#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$ROUTE_COMMANDS"\n')
    stub.chmod(0o755)
for target in ('x64', 'aa64'):
    root = route / target; root.mkdir()
    for directory in ('etc/apt/sources.list.d', 'etc/apt/preferences.d', 'source'):
        (root / directory).mkdir(parents=True, exist_ok=True)
    (root / 'versions.env').write_bytes((repo / 'pkgs/mos-boot/versions.env').read_bytes())
    (root / 'policy.patch').write_text('fixture patch boundary\n')
    commands = root / 'commands.txt'
    for code in runs:
        # Redirect only fixed absolute recipe data paths into this test tree.
        code = re.sub(r'(?<![A-Za-z0-9_/])/(?:etc/|var/|source(?=[/\s;]|$)|policy\.patch|versions\.env|busybox-out|arm-debs)',
                      lambda match: str(root) + match[0], code)
        result = subprocess.run(['sh', '-eu', '-c', prefix + code], cwd=root,
                                env=dict(env, MOS_BOOT_TARGET=target, MOS_DEBIAN_SNAPSHOT='fixture', ROUTE_COMMANDS=str(commands)),
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, (target, code, result.stderr)
    lines = commands.read_text().splitlines()
    loader = [v for v in lines if v.startswith('ninja ')]
    loader_outputs = [v for v in lines if v.startswith('cp -p ') and '/loader-out/' in v]
    assert len(loader) == len(loader_outputs) == 1, lines
    assert not any('busybox' in v for v in lines), lines
    assert 'systemd-boot' + target + '.efi' in loader[0] and '-j2' in loader[0]
    assert loader_outputs[0].endswith('/loader-out/systemd-boot' + target + '.efi')
    if target == 'x64':
        assert not any(any(word in line for word in ('--add-architecture', ':arm64', 'aarch64', 'qemu-', '/build-arm64', '/busybox-out/aa64')) for line in lines), lines
    else:
        assert any('dpkg --add-architecture arm64' in line for line in lines)
        assert any('systemd-boot-efi:arm64' in line for line in lines)
        assert not any(any(word in line for word in ('cryptsetup-bin:arm64', 'util-linux:arm64', 'mount:arm64', 'libgcc-s1:arm64')) for line in lines)
    print('PASS: recipe branch and selected EFI output', target, '(commands isolated)')
print('BOOT_TOOLS_TARGET_ROUTE_TEST_PASS cases=15 productionBuilds=0 targetExecutions=0')
TARGET_ROUTE

bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/first" x64
test "$(cat "$WORK/first/startup.files")" = init
test "$(cat "$WORK/first/exitrd.files")" = shutdown
cmp /input/mos-init "$WORK/first/init"
cmp /input/mos-shutdown "$WORK/first/exitrd/shutdown"
test "$(readlink "$WORK/first/sbin/mos-shutdown")" = /exitrd/shutdown
test "$(find "$WORK/first" -type f | wc -l)" = 5
for path in bin/busybox sbin/blkid sbin/veritysetup sbin/dmsetup lib usr/lib; do test ! -e "$WORK/first/$path"; done
cp /output/initramfs.cpio "$WORK/first.cpio"
mv /output/initramfs.cpio.zst "$WORK/first.zst"
bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/repeat" x64
cmp "$WORK/first.cpio" /output/initramfs.cpio
cmp "$WORK/first.zst" /output/initramfs.cpio.zst
printf 'STARTUP_SINGLE_STATIC_MANIFEST_PASS\n'
