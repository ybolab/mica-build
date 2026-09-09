#!/bin/bash
# Offline regression checks for confirmed-boot retirement and recovery.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
export MOS_TEST_TRACE="$work/trace" MOS_TEST_DATA=0 MOS_TEST_RETIRE=0
cat > "$work/bin/systemctl" <<'SH'
#!/bin/sh
echo "systemctl $*" >> "$MOS_TEST_TRACE"
case "$1" in is-active) exit "$MOS_TEST_DATA";; esac
SH
cat > "$work/bin/mos-deploy" <<'SH'
#!/bin/sh
echo "mos-deploy $*" >> "$MOS_TEST_TRACE"
exit "$MOS_TEST_RETIRE"
SH
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH"
# Keep even an existing host recovery marker outside this isolated test.
sed "s@/run/mos/shared-data-failure@$work/shared-data-failure@g" \
    "$repo/rootfs/overlay/usr/lib/mos/mos-boot-failure" > "$work/failure"
run_case() {
    : > "$MOS_TEST_TRACE"
    bash "$work/failure"
}
run_case
grep -qx 'mos-deploy fail-boot' "$MOS_TEST_TRACE"
grep -qx 'systemctl --no-block reboot' "$MOS_TEST_TRACE"
test "$(tail -n2 "$MOS_TEST_TRACE" | head -n1)" = 'mos-deploy fail-boot'
export MOS_TEST_RETIRE=1
run_case
grep -qx 'systemctl --no-block poweroff' "$MOS_TEST_TRACE"
! grep -q reboot "$MOS_TEST_TRACE"
export MOS_TEST_RETIRE=0 MOS_TEST_DATA=1
run_case
grep -qx 'systemctl --no-block poweroff' "$MOS_TEST_TRACE"
! grep -q mos-deploy "$MOS_TEST_TRACE"
export MOS_TEST_DATA=0
touch "$work/shared-data-failure"
run_case
grep -qx 'systemctl --no-block poweroff' "$MOS_TEST_TRACE"
! grep -q mos-deploy "$MOS_TEST_TRACE"
echo 'BOOT_FAILURE_TEST_PASS'
