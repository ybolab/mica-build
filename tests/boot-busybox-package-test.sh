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
