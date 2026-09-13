#!/usr/bin/env bash
# Offline tests for the health gate. Every external
# command the scripts call (rauc, systemctl, busctl, curl, df, fw_setenv,
# fw_printenv) is faked in a $TMPDIR directory prepended to PATH, so no host
# state is ever read or written: the real rauc/systemctl are never invoked and
# no U-Boot environment is touched.
#
#   bash tests/health-test.sh
# The fake bodies below are shell source passed as literal strings; their `$`
# expressions are expanded when the fake runs, not when it is written.
# shellcheck disable=SC2016
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# The scripts under test are the ones that SHIP: the overlay is copied into the
# image verbatim by the mos rootfs build, so testing that copy tests the file the
# device runs. The overlay is the only copy there is.
HEALTH=$HERE/../rootfs/overlay/usr/lib/mica
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
    CASE_PATH=
    # Fast settle so the tests never sleep. The required set mirrors the
    # SHIPPED /etc/mica/health.conf, so the default case exercises the decision
    # the image actually makes; the cases that are about the set override it.
    printf 'require=boot-settled\nrequire=micad\nrequire=apid\n' >"$CONF"
    printf 'settle-sec=0\nprobe-timeout-sec=5\nvar-threshold-pct=85\n' >>"$CONF"
}

# Replace this case's required set. With no argument the conf is left with NO
# `require=` line at all, which is the empty-set case.
set_required() {
    sed -i '/^require=/d' "$CONF"
    local m
    for m in "$@"; do printf 'require=%s\n' "$m" >>"$CONF"; done
}

# Make curl and wget ABSENT for this case, the way an image built without
# either would be. Dropping the fakes is not enough — the host's own curl is on
# the default PATH and `command -v` would find it, and the probe would then
# reach out of the sandbox — so the PATH is narrowed to the fakes plus the
# handful of real tools mica-health and the fakes need, and nothing else. `sh` is
# on the list because `env` resolves it through this PATH, and `cat` because the
# rauc fake reads its fixture with it.
no_http_client() {
    local t p
    rm -f "$BIN/curl" "$BIN/wget"
    mkdir -p "$CASE/sysbin"
    for t in sh cat sed head awk tr grep timeout mktemp rm sleep; do
        p=$(command -v "$t") && ln -sf "$p" "$CASE/sysbin/$t"
    done
    CASE_PATH="$BIN:$CASE/sysbin"
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

# The backend emits one validated deployment ID, without shell metadata.
write_deployment_status() {
    printf '%s\n' "$1" >"$CASE/deployment-status.txt"
}

healthy_fakes() {
    write_deployment_status "$(printf a%.0s {1..64})"
    fake mica-deploy '
case "$1" in
  "booted")
      [ -n "${FAKE_DEPLOY_STDERR:-}" ] && echo "$FAKE_DEPLOY_STDERR" >&2
      [ "${FAKE_DEPLOY_STATUS_RC:-0}" = 0 ] && cat "$CASE_DIR/deployment-status.txt"
      exit ${FAKE_DEPLOY_STATUS_RC:-0} ;;
  "confirm") exit ${FAKE_MARKGOOD_RC:-0} ;;
esac
exit 0'
    fake systemctl '
case "$1" in
  is-system-running) echo "${FAKE_SYS_STATE:-running}" ;;
  list-jobs) printf "%s" "${FAKE_JOBS:-}" ;;
  list-units) printf "%s" "${FAKE_FAILED_UNITS:-}" ;;
  list-unit-files) case "${FAKE_UNITS:-micad.service apid.service}" in *"$3"*) echo "$3 enabled" ;; esac ;;
esac
exit 0'
    fake busctl 'exit ${FAKE_BUSCTL_RC:-0}'
    fake curl 'exit ${FAKE_CURL_RC:-0}'
    fake df 'printf "Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 100 10 90 %s%% /var\n" "${FAKE_VAR_PCT:-12}"'
    # wget must not shadow curl in these cases; the script prefers curl.
}

run_health() {
    env -i PATH="${CASE_PATH:-$BIN:/usr/bin:/bin}" CALLS_FILE="$CALLS" MOS_HEALTH_CONF="$CONF" \
        CASE_DIR="$CASE" \
        "$@" sh "$HEALTH/mica-health"
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

marked_good() { grep -qx 'mica-deploy confirm' "$CALLS" && echo yes || echo no; }

# Missing, failed or malformed deployment status must never confirm a boot.
new_case backend-absent
out=$(run_health 2>&1) && rc=0 || rc=$?
check "backend absent -> exit 1" "1" "$rc"

new_case backend-no-deployment
healthy_fakes
write_deployment_status ''
out=$(run_health 2>&1) && rc=0 || rc=$?
check "no deployment -> exit 1" "1" "$rc"
check "no deployment -> no confirmation" "no" "$(marked_good)"

new_case backend-errors
healthy_fakes
out=$(run_health FAKE_DEPLOY_STATUS_RC=1 FAKE_DEPLOY_STDERR='shared DATA unavailable' 2>&1) && rc=0 || rc=$?
check "backend failure -> exit 1" "1" "$rc"
check "backend failure -> no confirmation" "no" "$(marked_good)"
check "backend failure -> preserves reason" "yes" "$(grep -q 'shared DATA unavailable' <<<"$out" && echo yes || echo no)"

new_case backend-unparseable
healthy_fakes
write_deployment_status 'unexpected output'
out=$(run_health 2>&1) && rc=0 || rc=$?
check "malformed status -> exit 1" "1" "$rc"
check "malformed status -> no confirmation" "no" "$(marked_good)"

# --- health gate: success
new_case healthy
healthy_fakes
out=$(run_health 2>&1) && rc=0 || rc=$?
check "healthy -> exit 0" "0" "$rc"
check "healthy -> mark-good" "yes" "$(marked_good)"
check "healthy -> confirmed log" "yes" \
    "$(grep -q 'PENDING_CONFIRM -> CONFIRMED' <<<"$out" && echo yes || echo no)"
check "healthy -> deployment identity reported" "yes" \
    "$(grep -q 'booted deployment: aaaaa' <<<"$out" && echo yes || echo no)"
check "healthy -> the required set is in the journal" "yes" \
    "$(grep -q 'required set: boot-settled micad apid' <<<"$out" && echo yes || echo no)"
check "healthy -> every required member concluded OK" "3" \
    "$(grep -c 'required member .*: OK' <<<"$out")"

new_case idempotent
healthy_fakes
run_health >/dev/null 2>&1
out=$(run_health 2>&1) && rc=0 || rc=$?
check "second run -> exit 0" "0" "$rc"
check "second run -> mark-good again" "2" "$(grep -cx 'mica-deploy confirm' "$CALLS")"

# --- health gate: a failed unit is REPORTED, never fatal (PLAN-089)
#
# THIS IS THE INVERSION. Before PLAN-089 the gate refused to confirm the slot
# when ANY unit was failed and not named in a `tolerate-failed` allowlist that
# shipped EMPTY, so on 2026-09-08 a cx3576 spent a boot credit every boot on a
# oneshot that governs nothing on that SKU and fell to a zero-filled slot B.
# The unit still has to be VISIBLE: losing the sweep must not mean nobody
# learns it failed, so the same enumeration now reports instead.
new_case failed-unit-reported
healthy_fakes
out=$(run_health FAKE_SYS_STATE=degraded FAKE_FAILED_UNITS='mica-regdb-reload.service loaded failed failed X
' 2>&1) && rc=0 || rc=$?
check "failed unit -> exit 0" "0" "$rc"
check "failed unit -> mark-good, so the boot credit is NOT spent" "yes" "$(marked_good)"
check "failed unit -> named in the journal" "yes" \
    "$(grep -q 'note: failed unit: mica-regdb-reload.service' <<<"$out" && echo yes || echo no)"
check "failed unit -> flagged not fatal" "yes" \
    "$(grep -q 'REPORTED, not fatal' <<<"$out" && echo yes || echo no)"
check "failed unit -> reported to micad, naming it" "yes" \
    "$(grep -q 'ReportHealth sss units degraded 1 failed: mica-regdb-reload.service' "$CALLS" &&
        echo yes || echo no)"

new_case no-failed-units
healthy_fakes
out=$(run_health 2>&1) && rc=0 || rc=$?
check "no failed units -> reported ok" "yes" \
    "$(grep -q 'ReportHealth sss units ok' "$CALLS" && echo yes || echo no)"

# micad caps a health detail at 1024 bytes and refuses a longer one, so the
# report names a bounded sample and says how many it left out. The journal
# above and the snapshot's own `failures.units` reader carry the whole list.
new_case failed-units-capped
healthy_fakes
units=
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    units="${units}u${i}.service loaded failed failed X"$'\n'
done
out=$(run_health FAKE_SYS_STATE=degraded FAKE_FAILED_UNITS="$units" 2>&1) && rc=0 || rc=$?
check "twelve failed units -> exit 0" "0" "$rc"
check "twelve failed units -> all twelve in the journal" "12" \
    "$(grep -c 'note: failed unit:' <<<"$out")"
check "twelve failed units -> the report is capped and says so" "yes" \
    "$(grep -q 'ReportHealth sss units degraded 12 failed: u1.service .* u10.service (+2 more)' "$CALLS" &&
        echo yes || echo no)"

# --- health gate: systemd states
new_case maintenance
healthy_fakes
out=$(run_health FAKE_SYS_STATE=maintenance 2>&1) && rc=0 || rc=$?
check "maintenance -> exit 1" "1" "$rc"
check "maintenance -> no mark-good" "no" "$(marked_good)"
check "maintenance -> named as the required member" "yes" \
    "$(grep -q 'required member boot-settled' <<<"$out" && echo yes || echo no)"

# The mutation that proves the `require=` line is what makes the member fatal:
# drop it and the SAME system state confirms. Without this the required set
# could be decoration held up only by the empty-set refusal.
new_case maintenance-boot-settled-not-required
healthy_fakes
set_required micad apid
out=$(run_health FAKE_SYS_STATE=maintenance 2>&1) && rc=0 || rc=$?
check "maintenance with boot-settled dropped -> exit 0" "0" "$rc"
check "maintenance with boot-settled dropped -> mark-good" "yes" "$(marked_good)"
check "maintenance with boot-settled dropped -> says what it would have failed on" "yes" \
    "$(grep -q 'would have failed' <<<"$out" && echo yes || echo no)"

# --- health gate: `starting`, which is the state this gate ALWAYS sees
#
# mica-health.service is WantedBy=multi-user.target, so it is a job in the
# initial transaction and `is-system-running` cannot report anything but
# `starting` while it runs. Until these cases existed the suite only ever
# handed the probe `running` (the stub's default), so the one state the gate
# actually meets on a device was the one state never tested -- and the gate
# failed every real boot while the suite stayed green.
#
# The `list-jobs` columns are, in order: JOB, UNIT, then TYPE and STATE. A job
# in state `waiting` is blocked on ordering (mica-status-led.service waits on
# this gate by design); only a job still `running` means something else is
# genuinely in flight.

new_case starting-self-only
healthy_fakes
# This gate is the only job running, and mica-status-led is waiting on it.
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mica-health.service start running
2 mica-status-led.service start waiting
' 2>&1) && rc=0 || rc=$?
check "starting with only this gate running -> exit 0" "0" "$rc"
check "starting with only this gate running -> mark-good" "yes" "$(marked_good)"

new_case starting-other-job-running
healthy_fakes
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mica-health.service start running
2 something-slow.service start running
' 2>&1) && rc=0 || rc=$?
check "starting with another job running -> exit 1" "1" "$rc"
check "starting with another job running -> no mark-good" "no" "$(marked_good)"
check "starting with another job running -> names the job" "yes" \
    "$(grep -q 'something-slow.service' <<<"$out" && echo yes || echo no)"

new_case starting-self-only-with-failed-unit
healthy_fakes
# Settled by the self-only rule with a unit failed. Before PLAN-089 this path
# refused; now it confirms and reports, because a failed unit says nothing
# about whether this slot can be recovered.
out=$(run_health FAKE_SYS_STATE=starting FAKE_JOBS='1 mica-health.service start running
' FAKE_FAILED_UNITS='broken.service loaded failed failed X
' 2>&1) && rc=0 || rc=$?
check "starting + failed unit -> exit 0" "0" "$rc"
check "starting + failed unit -> mark-good" "yes" "$(marked_good)"
check "starting + failed unit -> reported" "yes" \
    "$(grep -q 'ReportHealth sss units degraded' "$CALLS" && echo yes || echo no)"

# --- health gate: the required members, driven from the FAILING side
#
# What a genuinely broken slot looks like under the new criterion: the device
# cannot be RECOVERED. Every case here asserts exit 1 AND that `mark-good` was
# never called — a gate that fails and confirms anyway is the defect this whole
# file exists to catch.
#
# The two daemon cases run with NO failed unit at all, and that is their point.
# A daemon that owns its bus name and stops answering is `active (running)` to
# systemd, never `failed`, so the allowlist sweep these replace marked such a
# slot GOOD. The required set is stronger here, not just kinder above.
new_case micad-wedged
healthy_fakes
out=$(run_health FAKE_BUSCTL_RC=1 2>&1) && rc=0 || rc=$?
check "micad wedged -> exit 1" "1" "$rc"
check "micad wedged -> no mark-good" "no" "$(marked_good)"
check "micad wedged -> named as the required member" "yes" \
    "$(grep -q 'required member micad' <<<"$out" && echo yes || echo no)"
check "micad wedged -> and systemd saw no failed unit at all" "no" \
    "$(grep -q 'note: failed unit:' <<<"$out" && echo yes || echo no)"

new_case apid-wedged
healthy_fakes
out=$(run_health FAKE_CURL_RC=22 2>&1) && rc=0 || rc=$?
check "apid healthz fails -> exit 1" "1" "$rc"
check "apid healthz fails -> no mark-good" "no" "$(marked_good)"
check "apid healthz fails -> named as the required member" "yes" \
    "$(grep -q 'required member apid' <<<"$out" && echo yes || echo no)"

# The bad update as a whole: every unit fine, both daemons wedged. The device
# is up and cannot be reached or fixed, which is the one thing rollback buys.
new_case bad-update-both-daemons-wedged
healthy_fakes
out=$(run_health FAKE_BUSCTL_RC=1 FAKE_CURL_RC=22 2>&1) && rc=0 || rc=$?
check "bad update -> exit 1" "1" "$rc"
check "bad update -> no mark-good" "no" "$(marked_good)"
check "bad update -> names micad, the first member it could not establish" "yes" \
    "$(grep -q 'required member micad' <<<"$out" && echo yes || echo no)"

# --- health gate: a required member the gate CANNOT PROBE is a refusal
#
# Not the SKIP it used to be. `require=` naming something the image does not
# ship means the gate was told to establish what it has no way to establish,
# and a green there confirms a slot with no route into it. An image that
# genuinely ships no apid drops the line; that is a build-time decision in a
# file inside the read-only root.
new_case require-micad-not-installed
healthy_fakes
out=$(run_health FAKE_UNITS=apid.service 2>&1) && rc=0 || rc=$?
check "micad.service absent while required -> exit 1" "1" "$rc"
check "micad.service absent while required -> no mark-good" "no" "$(marked_good)"
check "micad.service absent while required -> says the image does not ship it" "yes" \
    "$(grep -q 'micad.service is not installed' <<<"$out" && echo yes || echo no)"

new_case require-apid-not-installed
healthy_fakes
out=$(run_health FAKE_UNITS=micad.service 2>&1) && rc=0 || rc=$?
check "apid.service absent while required -> exit 1" "1" "$rc"
check "apid.service absent while required -> no mark-good" "no" "$(marked_good)"
check "apid.service absent while required -> says the image does not ship it" "yes" \
    "$(grep -q 'apid.service is not installed' <<<"$out" && echo yes || echo no)"

# The hole `health-gate-http-client` was written for: with neither curl nor
# wget in the image, probe c used to log SKIP and the gate went green having
# never touched apid. `no_http_client` is what makes the host's own curl absent
# without touching the host.
new_case require-apid-no-http-client
healthy_fakes
no_http_client
out=$(run_health 2>&1) && rc=0 || rc=$?
check "no curl and no wget while apid required -> exit 1" "1" "$rc"
check "no curl and no wget -> no mark-good" "no" "$(marked_good)"
check "no curl and no wget -> says so" "yes" \
    "$(grep -q 'neither curl nor wget' <<<"$out" && echo yes || echo no)"

# --- health gate: the required set, and its two vacuity guards
#
# AN EMPTY REQUIRED SET IS "ALWAYS MARK GOOD" — the empty `tolerate-failed`
# allowlist read from the other side, and the one failure this gate cannot
# have. It is reachable in production and not only here: /etc/mica/health.conf
# missing from the overlay, unreadable, or shipped with its `require=` lines
# deleted all produce it. There is deliberately no compiled-in default set to
# fall back to.
new_case require-empty
healthy_fakes
set_required
out=$(run_health 2>&1) && rc=0 || rc=$?
check "empty required set -> exit 1" "1" "$rc"
check "empty required set -> no mark-good" "no" "$(marked_good)"
check "empty required set -> refuses rather than confirming" "yes" \
    "$(grep -q 'always mark good' <<<"$out" && echo yes || echo no)"

new_case require-conf-absent
healthy_fakes
rm -f "$CONF"
out=$(run_health 2>&1) && rc=0 || rc=$?
check "conf absent -> exit 1" "1" "$rc"
check "conf absent -> no mark-good" "no" "$(marked_good)"
check "conf absent -> names the file" "yes" \
    "$(grep -q "$CONF" <<<"$out" && echo yes || echo no)"

# The empty set arriving by instalments: one typo and the set silently shrinks.
new_case require-unknown-member
healthy_fakes
set_required boot-settled micad apid micadd
out=$(run_health 2>&1) && rc=0 || rc=$?
check "unknown required member -> exit 1" "1" "$rc"
check "unknown required member -> no mark-good" "no" "$(marked_good)"
check "unknown required member -> named" "yes" \
    "$(grep -q 'requires `micadd`' <<<"$out" && echo yes || echo no)"
check "unknown required member -> lists the vocabulary" "yes" \
    "$(grep -q 'boot-settled, micad, apid' <<<"$out" && echo yes || echo no)"

# --- health gate: each `require=` line is what makes ITS member fatal
#
# Removing a line has to change the verdict for that member and no other, or
# the set is decoration and only the empty-set refusal is holding the gate up.
new_case apid-down-but-not-required
healthy_fakes
set_required boot-settled micad
out=$(run_health FAKE_CURL_RC=22 2>&1) && rc=0 || rc=$?
check "apid down but not required -> exit 0" "0" "$rc"
check "apid down but not required -> mark-good" "yes" "$(marked_good)"
check "apid down but not required -> never probed at all" "no" \
    "$(grep -q '^curl ' "$CALLS" && echo yes || echo no)"

new_case micad-down-but-not-required
healthy_fakes
set_required boot-settled apid
out=$(run_health FAKE_BUSCTL_RC=1 2>&1) && rc=0 || rc=$?
check "micad down but not required -> exit 0" "0" "$rc"
check "micad down but not required -> mark-good" "yes" "$(marked_good)"
check "micad down but not required -> GetState never called" "no" \
    "$(grep -q 'com.mica.micad1 GetState' "$CALLS" && echo yes || echo no)"

# --- health gate: /var pressure is reported, never fatal
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


echo
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
