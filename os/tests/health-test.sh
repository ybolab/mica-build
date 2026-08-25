#!/usr/bin/env bash
# Offline tests for os/health. Every external command the scripts call (rauc,
# systemctl, busctl, curl, df, fw_setenv, fw_printenv) is faked in a $TMPDIR
# directory prepended to PATH, so no host state is ever read or written: the
# real rauc/systemctl are never invoked and no U-Boot environment is touched.
#
#   bash os/tests/health-test.sh
# The fake bodies below are shell source passed as literal strings; their `$`
# expressions are expanded when the fake runs, not when it is written.
# shellcheck disable=SC2016
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# The scripts under test stay in os/health/; this test moved out of it.
HEALTH=$HERE/../health
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

# Per-case sandbox: $BIN holds the fakes, $CALLS records what was invoked.
new_case() {
    CASE=$WORK/case-$1
    BIN=$CASE/bin
    CALLS=$CASE/calls.log
    CONF=$CASE/health.conf
    rm -rf "$CASE"
    mkdir -p "$BIN"
    : >"$CALLS"
    # Fast settle so the tests never sleep.
    printf 'settle-sec=0\nprobe-timeout-sec=5\nvar-threshold-pct=85\n' >"$CONF"
}

# fake <name> <body...> — write an executable that logs its argv, then runs body.
fake() {
    local name=$1
    shift
    {
        printf '#!/bin/sh\n'
        printf 'echo "%s $*" >> "$CALLS_FILE"\n' "$name"
        printf '%s\n' "$@"
    } >"$BIN/$name"
    chmod 0755 "$BIN/$name"
}

# Verbatim shape of `rauc status --output-format=shell` as emitted by rauc 1.8-2
# (the version the bookworm allowlist installs) driving the rendered
# os/update/rauc/system.conf, captured in a container with rauc.slot=A on the kernel
# command line. Trimmed to the rows a parser can care about; every variable NAME
# and the quoting are exactly as observed. $1 is the booted bootname, empty for
# the "rauc answered but names no booted slot" case.
write_rauc_status() {
    cat >"$CASE/rauc-status.txt" <<FIXTURE
RAUC_SYSTEM_COMPATIBLE='mos-cx3576'
RAUC_SYSTEM_VARIANT=''
RAUC_SYSTEM_BOOTED_BOOTNAME='$1'
RAUC_BOOT_PRIMARY=''
RAUC_SYSTEM_SLOTS='rootfs.1 boot.0 rootfs.0 boot.1'
RAUC_SLOTS='1 2 3 4'
RAUC_SLOT_STATE_1='inactive'
RAUC_SLOT_CLASS_1='rootfs'
RAUC_SLOT_DEVICE_1='/dev/disk/by-partuuid/5ac35760-0002-4000-8000-000000000006'
RAUC_SLOT_BOOTNAME_1='B'
RAUC_SLOT_STATE_2='active'
RAUC_SLOT_CLASS_2='boot'
RAUC_SLOT_BOOTNAME_2=''
RAUC_SLOT_PARENT_2='rootfs.0'
RAUC_SLOT_STATE_3='booted'
RAUC_SLOT_CLASS_3='rootfs'
RAUC_SLOT_DEVICE_3='/dev/disk/by-partuuid/5ac35760-0002-4000-8000-000000000005'
RAUC_SLOT_BOOTNAME_3='A'
RAUC_SLOT_STATE_4='inactive'
RAUC_SLOT_CLASS_4='boot'
RAUC_SLOT_BOOTNAME_4=''
RAUC_SLOT_PARENT_4='rootfs.1'
FIXTURE
}

# Defaults: a healthy A/B system with mosd and apid both answering.
healthy_fakes() {
    write_rauc_status A
    fake rauc '
case "$1 $2" in
  "status --output-format=shell")
      [ -n "${FAKE_RAUC_STDERR:-}" ] && echo "$FAKE_RAUC_STDERR" >&2
      [ "${FAKE_RAUC_STATUS_RC:-0}" = 0 ] && cat "$CASE_DIR/rauc-status.txt"
      exit ${FAKE_RAUC_STATUS_RC:-0} ;;
  "status mark-good") exit ${FAKE_MARKGOOD_RC:-0} ;;
esac
exit 0'
    fake systemctl '
case "$1" in
  is-system-running) echo "${FAKE_SYS_STATE:-running}" ;;
  list-jobs) printf "%s" "${FAKE_JOBS:-}" ;;
  list-units) printf "%s" "${FAKE_FAILED_UNITS:-}" ;;
  list-unit-files) case "${FAKE_UNITS:-mosd.service apid.service}" in *"$3"*) echo "$3 enabled" ;; esac ;;
esac
exit 0'
    fake busctl 'exit ${FAKE_BUSCTL_RC:-0}'
    fake curl 'exit ${FAKE_CURL_RC:-0}'
    fake df 'printf "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 100 10 90 %s%% /var\n" "${FAKE_VAR_PCT:-12}"'
    # wget must not shadow curl in these cases; the script prefers curl.
}

run_health() {
    env -i PATH="$BIN:/usr/bin:/bin" CALLS_FILE="$CALLS" MOS_HEALTH_CONF="$CONF" \
        CASE_DIR="$CASE" \
        "$@" sh "$HEALTH/mos-health"
}

run_machine_id() {
    env -i PATH="$BIN:/usr/bin:/bin" CALLS_FILE="$CALLS" \
        "$@" sh "$HEALTH/mos-machine-id"
}

check() {
    local name=$1 want=$2 got=$3
    if [ "$want" = "$got" ]; then
        PASS=$((PASS + 1))
        echo "PASS $name"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $name: expected [$want], got [$got]"
    fi
}

marked_good() { grep -qx 'rauc status mark-good' "$CALLS" && echo yes || echo no; }

# --- health gate: no-op paths ----------------------------------------------
new_case rauc-absent
out=$(run_health 2>&1) && rc=0 || rc=$?
check "rauc absent -> exit 0" "0" "$rc"
check "rauc absent -> logged" "yes" "$(grep -q 'rauc not installed' <<<"$out" && echo yes || echo no)"
check "rauc absent -> not confused with a parse failure" "no" \
    "$(grep -q 'cannot parse' <<<"$out" && echo yes || echo no)"

# The three silences must never be confused with one another. A gate that
# cannot read rauc is broken, not idle, and must say so loudly.
new_case rauc-answers-no-slot
healthy_fakes
write_rauc_status ''
out=$(run_health 2>&1) && rc=0 || rc=$?
check "rauc answers, no bootname -> exit 0" "0" "$rc"
check "rauc answers, no bootname -> no mark-good" "no" "$(marked_good)"
check "rauc answers, no bootname -> distinct log" "yes" \
    "$(grep -q 'answered but names no booted slot' <<<"$out" && echo yes || echo no)"
check "rauc answers, no bootname -> not confused with absence" "no" \
    "$(grep -q 'rauc not installed' <<<"$out" && echo yes || echo no)"

new_case rauc-errors
healthy_fakes
out=$(run_health FAKE_RAUC_STATUS_RC=1 \
    FAKE_RAUC_STDERR='Error retrieving slot status via D-Bus: error calling D-Bus method "GetSlotStatus": Failed to determine slot states: Did not find booted slot' 2>&1) && rc=0 || rc=$?
check "rauc status fails -> exit 1" "1" "$rc"
check "rauc status fails -> no mark-good" "no" "$(marked_good)"
check "rauc status fails -> quotes rauc's reason" "yes" \
    "$(grep -q 'Did not find booted slot' <<<"$out" && echo yes || echo no)"
check "rauc status fails -> not confused with absence" "no" \
    "$(grep -q 'rauc not installed' <<<"$out" && echo yes || echo no)"

new_case rauc-unparseable
healthy_fakes
printf 'some unexpected output\n' >"$CASE/rauc-status.txt"
out=$(run_health 2>&1) && rc=0 || rc=$?
check "unparseable rauc output -> exit 1" "1" "$rc"
check "unparseable rauc output -> no mark-good" "no" "$(marked_good)"
check "unparseable rauc output -> says so" "yes" \
    "$(grep -q 'cannot parse' <<<"$out" && echo yes || echo no)"

# --- health gate: success ---------------------------------------------------
new_case healthy
healthy_fakes
out=$(run_health 2>&1) && rc=0 || rc=$?
check "healthy -> exit 0" "0" "$rc"
check "healthy -> mark-good" "yes" "$(marked_good)"
check "healthy -> confirmed log" "yes" \
    "$(grep -q 'PENDING_CONFIRM -> CONFIRMED' <<<"$out" && echo yes || echo no)"
check "healthy -> bootname parsed from real 1.8 output" "yes" \
    "$(grep -q 'booted slot bootname: A' <<<"$out" && echo yes || echo no)"

new_case idempotent
healthy_fakes
run_health >/dev/null 2>&1
out=$(run_health 2>&1) && rc=0 || rc=$?
check "second run -> exit 0" "0" "$rc"
check "second run -> mark-good again" "2" "$(grep -cx 'rauc status mark-good' "$CALLS")"

# --- health gate: systemd states -------------------------------------------
new_case degraded-unlisted
healthy_fakes
out=$(run_health FAKE_SYS_STATE=degraded FAKE_FAILED_UNITS='broken.service loaded failed failed X
' 2>&1) && rc=0 || rc=$?
check "unlisted failed unit -> exit 1" "1" "$rc"
check "unlisted failed unit -> no mark-good" "no" "$(marked_good)"
check "unlisted failed unit -> named" "yes" \
    "$(grep -q 'broken.service' <<<"$out" && echo yes || echo no)"

new_case degraded-allowlisted
healthy_fakes
printf 'tolerate-failed=broken.service\n' >>"$CONF"
out=$(run_health FAKE_SYS_STATE=degraded FAKE_FAILED_UNITS='broken.service loaded failed failed X
' 2>&1) && rc=0 || rc=$?
check "allowlisted failed unit -> exit 0" "0" "$rc"
check "allowlisted failed unit -> mark-good" "yes" "$(marked_good)"

new_case maintenance
healthy_fakes
out=$(run_health FAKE_SYS_STATE=maintenance 2>&1) && rc=0 || rc=$?
check "maintenance -> exit 1" "1" "$rc"
check "maintenance -> no mark-good" "no" "$(marked_good)"

# --- health gate: `starting`, which is the state this gate ALWAYS sees ------
#
# mos-health.service is WantedBy=multi-user.target, so it is a job in the
# initial transaction and `is-system-running` cannot report anything but
# `starting` while it runs. Until these cases existed the suite only ever
# handed the probe `running` (the stub's default), so the one state the gate
# actually meets on a device was the one state never tested -- and the gate
# failed every real boot while the suite stayed green.
#
# `list-jobs` columns are JOB UNIT TYPE STATE. A job in state `waiting` is
# blocked on ordering (mos-status-led.service waits on this gate by design);
# only a job still `running` means something else is genuinely in flight.

new_case starting-self-only
healthy_fakes
# This gate is the only job running, and mos-status-led is waiting on it.
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mos-health.service start running
2 mos-status-led.service start waiting
' 2>&1) && rc=0 || rc=$?
check "starting with only this gate running -> exit 0" "0" "$rc"
check "starting with only this gate running -> mark-good" "yes" "$(marked_good)"

new_case starting-other-job-running
healthy_fakes
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mos-health.service start running
2 something-slow.service start running
' 2>&1) && rc=0 || rc=$?
check "starting with another job running -> exit 1" "1" "$rc"
check "starting with another job running -> no mark-good" "no" "$(marked_good)"
check "starting with another job running -> names the job" "yes" \
    "$(grep -q 'something-slow.service' <<<"$out" && echo yes || echo no)"

new_case starting-self-only-unlisted-failure
healthy_fakes
# Settled by the self-only rule, but a unit has failed: the gate must still
# refuse. Otherwise the `starting` path would be a way past the allowlist.
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mos-health.service start running
' FAKE_FAILED_UNITS='broken.service loaded failed failed X
' 2>&1) && rc=0 || rc=$?
check "starting + unlisted failed unit -> exit 1" "1" "$rc"
check "starting + unlisted failed unit -> no mark-good" "no" "$(marked_good)"
check "starting + unlisted failed unit -> named" "yes" \
    "$(grep -q 'broken.service' <<<"$out" && echo yes || echo no)"

# --- health gate: mosd and apid --------------------------------------------
new_case mosd-down
healthy_fakes
out=$(run_health FAKE_BUSCTL_RC=1 2>&1) && rc=0 || rc=$?
check "mosd unreachable -> exit 1" "1" "$rc"
check "mosd unreachable -> no mark-good" "no" "$(marked_good)"

new_case mosd-absent
healthy_fakes
out=$(run_health FAKE_UNITS=apid.service 2>&1) && rc=0 || rc=$?
check "mosd.service absent -> exit 0" "0" "$rc"
check "mosd.service absent -> skip logged" "yes" \
    "$(grep -q 'probe mosd: SKIP' <<<"$out" && echo yes || echo no)"

new_case apid-down
healthy_fakes
out=$(run_health FAKE_CURL_RC=22 2>&1) && rc=0 || rc=$?
check "apid healthz fails -> exit 1" "1" "$rc"
check "apid healthz fails -> no mark-good" "no" "$(marked_good)"

new_case apid-absent
healthy_fakes
out=$(run_health FAKE_UNITS=mosd.service 2>&1) && rc=0 || rc=$?
check "apid.service absent -> exit 0" "0" "$rc"
check "apid.service absent -> skip logged" "yes" \
    "$(grep -q 'probe apid: SKIP' <<<"$out" && echo yes || echo no)"

# --- health gate: /var pressure is reported, never fatal --------------------
new_case var-pressure
healthy_fakes
out=$(run_health FAKE_VAR_PCT=91 2>&1) && rc=0 || rc=$?
check "/var over threshold -> exit 0" "0" "$rc"
check "/var over threshold -> mark-good" "yes" "$(marked_good)"
check "/var over threshold -> reported degraded" "yes" \
    "$(grep -q 'ReportHealth sss var degraded' "$CALLS" && echo yes || echo no)"
check "/var over threshold -> flagged not fatal" "yes" \
    "$(grep -q 'NOT fatal' <<<"$out" && echo yes || echo no)"

new_case var-ok
healthy_fakes
out=$(run_health FAKE_VAR_PCT=12 2>&1) && rc=0 || rc=$?
check "/var under threshold -> reported ok" "yes" \
    "$(grep -q 'ReportHealth sss var ok' "$CALLS" && echo yes || echo no)"

# --- machine id -------------------------------------------------------------
new_case mid-no-tool
out=$(run_machine_id 2>&1) && rc=0 || rc=$?
check "fw_setenv absent -> exit 0" "0" "$rc"
check "fw_setenv absent -> logged" "yes" \
    "$(grep -q 'not installed' <<<"$out" && echo yes || echo no)"

new_case mid-unreadable-env
fake fw_printenv 'exit 1'
fake fw_setenv 'exit 0'
out=$(run_machine_id 2>&1) && rc=0 || rc=$?
check "env unreadable -> exit 0" "0" "$rc"
check "env unreadable -> no write" "no" \
    "$(grep -q '^fw_setenv machine_id' "$CALLS" && echo yes || echo no)"

new_case mid-generate
fake fw_printenv '
[ $# -eq 0 ] && exit 0
[ -f "$CASE_DIR/env" ] && cat "$CASE_DIR/env"
exit 0'
fake fw_setenv 'printf "%s=%s\n" "$1" "$2" > "$CASE_DIR/env"; exit 0'
out=$(run_machine_id CASE_DIR="$CASE" 2>&1) && rc=0 || rc=$?
check "generate -> exit 0" "0" "$rc"
generated=$(sed -n 's/^machine_id=//p' "$CASE/env")
check "generated id is 32 dashless lowercase hex" "yes" \
    "$(grep -Eq '^[0-9a-f]{32}$' <<<"$generated" && echo yes || echo no)"
check "generate -> next-boot note" "yes" \
    "$(grep -q 'NEXT boot' <<<"$out" && echo yes || echo no)"
echo "     sample machine_id: $generated"

new_case mid-already-set
mkdir -p "$CASE"
printf 'machine_id=0123456789abcdef0123456789abcdef\n' >"$CASE/env"
fake fw_printenv '
[ $# -eq 0 ] && exit 0
cat "$CASE_DIR/env"
exit 0'
fake fw_setenv 'printf "%s=%s\n" "$1" "$2" > "$CASE_DIR/env"; exit 0'
out=$(run_machine_id CASE_DIR="$CASE" 2>&1) && rc=0 || rc=$?
check "already set -> exit 0" "0" "$rc"
check "already set -> no rewrite" "no" \
    "$(grep -q '^fw_setenv machine_id' "$CALLS" && echo yes || echo no)"

# --- staged overlay copies must not drift from the sources ------------------
OVERLAY=$HERE/../rootfs/overlay-v2
for pair in \
    "mos-health:$OVERLAY/usr/lib/mos/mos-health" \
    "mos-machine-id:$OVERLAY/usr/lib/mos/mos-machine-id" \
    "mos-health.service:$OVERLAY/usr/lib/systemd/system/mos-health.service" \
    "mos-machine-id.service:$OVERLAY/usr/lib/systemd/system/mos-machine-id.service" \
    "health.conf:$OVERLAY/etc/mos/health.conf"; do
    src=${pair%%:*}
    dst=${pair#*:}
    check "overlay copy in sync: $src" "yes" \
        "$(cmp -s "$HEALTH/$src" "$dst" && echo yes || echo no)"
done

echo
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
