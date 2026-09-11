#!/usr/bin/env bash
# Exercise the static early-boot BusyBox source, configuration, and payload contract.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
CHECK="${REPO_ROOT}/pkgs/mos-boot/check-busybox.sh"
CONFIG="${REPO_ROOT}/pkgs/mos-boot/busybox.config"
REQUIRED="${REPO_ROOT}/pkgs/mos-boot/busybox.required-applets"
VERSIONS="${REPO_ROOT}/pkgs/mos-boot/versions.env"
DOCKERFILE="${REPO_ROOT}/pkgs/mos-boot/Dockerfile"
BUILD="${REPO_ROOT}/pkgs/mos-boot/build-busybox.sh"

[ -x "${CHECK}" ] || { echo "FAIL: ${CHECK} is missing or not executable" >&2; exit 1; }
[ -f "${CONFIG}" ] || { echo "FAIL: ${CONFIG} is missing" >&2; exit 1; }
[ -f "${REQUIRED}" ] || { echo "FAIL: ${REQUIRED} is missing" >&2; exit 1; }

# shellcheck disable=SC1090
. "${VERSIONS}"
[ "${BUSYBOX_VERSION:-}" = 1.36.1 ] || { echo 'FAIL: latest upstream stable BusyBox is not pinned at 1.36.1' >&2; exit 1; }
[ "${BUSYBOX_URL:-}" = https://busybox.net/downloads/busybox-1.36.1.tar.bz2 ] || { echo 'FAIL: BusyBox source URL is not the official release archive' >&2; exit 1; }
[ "${BUSYBOX_SHA256:-}" = b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314 ] || { echo 'FAIL: BusyBox source digest differs from the official release checksum' >&2; exit 1; }
[ "$(grep -Fc "printf 'LICENSE=GPL-2.0-only" "${BUILD}")" -eq 1 ] || { echo 'FAIL: BusyBox provenance does not record its GPL-2.0-only license' >&2; exit 1; }
for packaged_source in \
    'COPY --from=busybox-build /busybox-source/LICENSE /usr/share/doc/mos-boot-busybox/copyright' \
    'COPY --from=busybox-build /busybox.tar.bz2 /usr/share/mos-sources/busybox-1.36.1.tar.bz2'; do
    [ "$(grep -Fxc -- "${packaged_source}" "${DOCKERFILE}")" -eq 1 ] || {
        echo "FAIL: Dockerfile does not preserve BusyBox provenance: ${packaged_source}" >&2
        exit 1
    }
done

for setting in \
    CONFIG_STATIC=y CONFIG_BUSYBOX=y CONFIG_ASH=y CONFIG_SH_IS_ASH=y \
    CONFIG_MOUNT=y CONFIG_FEATURE_MOUNT_FLAGS=y CONFIG_UMOUNT=y \
    CONFIG_LOSETUP=y CONFIG_SWITCH_ROOT=y CONFIG_SYNC=y CONFIG_HALT=y \
    CONFIG_POWEROFF=y CONFIG_REBOOT=y \
    CONFIG_KILL=y CONFIG_MKDIR=y CONFIG_RMDIR=y CONFIG_READLINK=y \
    CONFIG_SLEEP=y CONFIG_TEST=y CONFIG_PRINTF=y; do
    [ "$(grep -Fxc -- "${setting}" "${CONFIG}")" -eq 1 ] || {
        echo "FAIL: busybox.config does not select ${setting}" >&2
        exit 1
    }
done
for setting in CONFIG_INIT CONFIG_MDEV CONFIG_IFCONFIG CONFIG_IP CONFIG_LOGIN; do
    [ "$(grep -Fxc -- "# ${setting} is not set" "${CONFIG}")" -eq 1 ] || {
        echo "FAIL: busybox.config does not explicitly exclude ${setting}" >&2
        exit 1
    }
done

expected_applets='[
ash
cat
halt
kill
losetup
mkdir
mount
poweroff
printf
readlink
reboot
rmdir
sh
sleep
switch_root
sync
test
umount'
[ "$(LC_ALL=C sort -u "${REQUIRED}")" = "$(printf '%s\n' "${expected_applets}" | LC_ALL=C sort -u)" ] || {
    echo 'FAIL: required applet list differs from the approved B0/B1 contract' >&2
    exit 1
}

WORK="$(mktemp -d)"
trap 'rm -r "${WORK}"' EXIT
mkdir -p "${WORK}/bin"

cat >"${WORK}/bin/file" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
target=${!#}
case "$(basename "${target}")" in
    *dynamic*) linkage='dynamically linked' ;;
    *) linkage='statically linked' ;;
esac
case "$(basename "${target}")" in
    *aa64*) machine='ARM aarch64' ;;
    *) machine='x86-64' ;;
esac
printf '%s: ELF 64-bit LSB executable, %s, %s, stripped\n' "${target}" "${machine}" "${linkage}"
EOF
chmod 0755 "${WORK}/bin/file"

cat >"${WORK}/bin/readelf" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
target=${!#}
case "$1" in
    -h)
        case "$(basename "${target}")" in
            *aa64*) printf '  Machine:                           AArch64\n' ;;
            *) printf '  Machine:                           Advanced Micro Devices X86-64\n' ;;
        esac
        ;;
    -l)
        case "$(basename "${target}")" in
            *dynamic*) printf '      [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]\n' ;;
        esac
        ;;
    -d)
        case "$(basename "${target}")" in
            *dynamic*) printf ' 0x0000000000000001 (NEEDED) Shared library: [libc.so.6]\n' ;;
            *) printf 'There is no dynamic section in this file.\n' ;;
        esac
        ;;
    *) exit 64 ;;
esac
EOF
chmod 0755 "${WORK}/bin/readelf"

make_payload() {
    local path=$1 applets=$2
    cat >"${path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[ "\${1:-}" = --list ] || exit 64
printf '%s\\n' '${applets}'
EOF
    chmod 0755 "${path}"
}

expect_failure() {
    local label=$1 expected=$2
    shift 2
    local output rc
    set +e
    output="$("$@" 2>&1)"
    rc=$?
    set -e
    if [ "${rc}" -eq 0 ]; then
        echo "FAIL: ${label} was accepted" >&2
        exit 1
    fi
    if [ "$(grep -Fc -- "${expected}" <<<"${output}")" -eq 0 ]; then
        echo "FAIL: ${label} did not report '${expected}': ${output}" >&2
        exit 1
    fi
    printf 'PASS: %s rejected\n' "${label}"
}

all_applets="$(cat "${REQUIRED}")"
without_mount="$(grep -Fvx mount "${REQUIRED}")"
make_payload "${WORK}/busybox-x64" "${all_applets}"
make_payload "${WORK}/busybox-aa64" "${all_applets}"
make_payload "${WORK}/busybox-dynamic-x64" "${all_applets}"
make_payload "${WORK}/busybox-incomplete-x64" "${without_mount}"

PATH="${WORK}/bin:${PATH}" expect_failure missing-payload 'missing BusyBox payload' \
    "${CHECK}" "${WORK}/missing" x64 "${REQUIRED}"
PATH="${WORK}/bin:${PATH}" expect_failure wrong-architecture 'expected AArch64' \
    "${CHECK}" "${WORK}/busybox-x64" aa64 "${REQUIRED}"
PATH="${WORK}/bin:${PATH}" expect_failure dynamic-payload 'not statically linked' \
    "${CHECK}" "${WORK}/busybox-dynamic-x64" x64 "${REQUIRED}"
PATH="${WORK}/bin:${PATH}" expect_failure incomplete-applets 'missing required applet: mount' \
    "${CHECK}" "${WORK}/busybox-incomplete-x64" x64 "${REQUIRED}"
PATH="${WORK}/bin:${PATH}" expect_failure wrong-identity 'payload SHA-256 does not match' \
    "${CHECK}" "${WORK}/busybox-x64" x64 "${REQUIRED}" "$(printf '0%.0s' {1..64})"

first="$(PATH="${WORK}/bin:${PATH}" "${CHECK}" "${WORK}/busybox-x64" x64 "${REQUIRED}")"
second="$(PATH="${WORK}/bin:${PATH}" "${CHECK}" "${WORK}/busybox-x64" x64 "${REQUIRED}")"
[ "${first}" = "${second}" ] || { echo 'FAIL: identical payload checks produced different identities' >&2; exit 1; }
[ "$(grep -Fc 'BOOT_BUSYBOX_PASS arch=x64' <<<"${first}")" -eq 1 ] || { echo "FAIL: positive x64 result is malformed: ${first}" >&2; exit 1; }
PATH="${WORK}/bin:${PATH}" "${CHECK}" "${WORK}/busybox-aa64" aa64 "${REQUIRED}" >/dev/null
printf '%s\n' 'PASS: positive x64/aa64 fixtures and deterministic identity'

# The launcher is real; Docker is an argument recorder, never a build here.
# Execute recipe branch bodies with acquisition/compiler commands isolated.
python3 - "$REPO_ROOT" "$WORK" <<'TARGET_ROUTE'
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
    'FROM tools AS busybox-build', 'FROM tools AS artifact-tools']
assert 'COPY --from=loader-build /loader-out/ /usr/lib/systemd/boot/efi/' in instructions
assert not any(line.startswith('COPY --from=loader-build /build') for line in instructions)
for required in (
    'COPY initramfs.sh kernel.sh elf-closure.py /tools/',
    'COPY --from=loader-build /source/LICENSE.LGPL2.1 /usr/share/doc/mos-systemd-boot/LICENSE.LGPL2.1',
    'COPY --from=busybox-build /busybox-out/ /usr/lib/mos/boot-busybox/',
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
    for directory in ('etc/apt/sources.list.d', 'etc/apt/preferences.d', 'source', 'busybox-out/x64', 'busybox-out/aa64'):
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
    busybox = [v for v in lines if v.startswith('bash /tools/build-busybox.sh ')]
    assert len(loader) == len(loader_outputs) == len(busybox) == 1, lines
    assert 'systemd-boot' + target + '.efi' in loader[0] and '-j2' in loader[0]
    assert loader_outputs[0].endswith('/loader-out/systemd-boot' + target + '.efi')
    assert '/busybox-out/' + target + ' ' + target in busybox[0]
    provenance = root / 'busybox-out' / target / 'busybox.provenance'
    assert 'SOURCE_VERSION=1.36.1\n' in provenance.read_text()
    assert 'SOURCE_SHA256=b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314\n' in provenance.read_text()
    assert not (root / 'busybox-out' / ('aa64' if target == 'x64' else 'x64') / 'busybox.provenance').exists()
    if target == 'x64':
        assert not any(any(word in line for word in ('--add-architecture', ':arm64', 'aarch64', 'qemu-', '/build-arm64', '/busybox-out/aa64')) for line in lines), lines
    else:
        assert any('dpkg --add-architecture arm64' in line for line in lines)
        assert 'aarch64-linux-gnu- qemu-aarch64' in busybox[0]
    print('PASS: recipe branch and selected provenance', target, '(commands isolated)')
print('BOOT_TOOLS_TARGET_ROUTE_TEST_PASS cases=15 productionBuilds=0 targetExecutions=0')
TARGET_ROUTE

if [ -n "${MOS_BOOT_BUSYBOX_X64:-}" ]; then
    "${CHECK}" "${MOS_BOOT_BUSYBOX_X64}" x64 "${REQUIRED}" "${MOS_BOOT_BUSYBOX_X64_SHA256:-}"
else
    echo 'SKIP: MOS_BOOT_BUSYBOX_X64 is unset; no built x64 payload was supplied'
fi
if [ -n "${MOS_BOOT_BUSYBOX_AA64:-}" ]; then
    runner=()
    [ -z "${MOS_BOOT_BUSYBOX_AA64_RUNNER:-}" ] || runner=("${MOS_BOOT_BUSYBOX_AA64_RUNNER}")
    "${CHECK}" "${MOS_BOOT_BUSYBOX_AA64}" aa64 "${REQUIRED}" "${MOS_BOOT_BUSYBOX_AA64_SHA256:-}" "${runner[@]}"
else
    echo 'SKIP: MOS_BOOT_BUSYBOX_AA64 is unset; no built aa64 payload was supplied'
fi

echo 'BOOT_BUSYBOX_PACKAGE_TEST_PASS'
