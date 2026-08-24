#!/usr/bin/env bash
# Boot the x64 image with apid reachable from outside it, and run the API
# suite against the running daemon.
#
#   bash test/apid-api/run.sh
#   bash test/apid-api/run.sh --dry-run
#
# WHAT THIS IS FOR. Every other check in this repository reads apid's source,
# its binary, or the image that ships it. This one TALKS TO IT: over a real
# socket, to a daemon on a machine that came up through OVMF, GRUB and its own
# unit ordering. It is therefore the only place where a route that exists in
# routes.rs but is unreachable in the running daemon looks different from one
# that works.
#
# IT BUILDS NOTHING, deliberately. The image is an INPUT. A harness that
# quietly rebuilt would turn a check into a forty-minute build, and it would
# then be testing the tree rather than the artefact somebody meant to test --
# so a missing image is refused by name, with the two commands that make it.
#
# THREE DOORS BETWEEN HERE AND apid, and every one of them fails as "connection
# refused" with nothing to say which door was shut:
#
#   1. QEMU's user-mode `hostfwd` binds inside the container running QEMU.
#   2. That container must publish the port, which os/qemu-run.sh does.
#   3. `-p 127.0.0.1:...` publishes on the DOCKER HOST's loopback. This script
#      runs INSIDE a container; that loopback is not ours and there is no route
#      to it. Measured 2026-08-24: this session sits on a docker network at
#      172.18.0.0/16 while a plain `docker run` lands on the default bridge at
#      172.17.0.0/16, with nothing between them.
#
# So the guest's address is THE QEMU CONTAINER'S OWN ADDRESS on a network we
# share with it, and that network is DISCOVERED rather than named here: this
# script reads its own eth0 address and asks each docker network whether it
# holds it. Hardcoding a network name would work on this host and nowhere else,
# and `hostname` is the container's short id about as often as it is a name.
#
# THE CONSOLE IS THE ONLY JOURNAL. mos keeps journald at Storage=volatile
# because /var is the EPHEMERAL partition, so a guest's log dies with the
# guest. os/qemu-journal.sh does not work and is committed as known-broken for
# exactly that reason; it is not called here. Instead every boot is captured to
# a file under _out/, MOS_QEMU_APPEND puts journald on the serial line, and
# apid's own `APID_LISTENING` line becomes a readiness signal that can be
# waited on. Dropping that append to "simplify" a run deletes the signal the
# wait depends on -- which has already cost this campaign one investigation.
#
# ONE RUN DIRECTORY, SHARED. os/qemu-run.sh's RUN_DIR is the single fixed path
# _out/x64/.qemu, and the x64 verification line uses it too. Two runs at once
# clobber each other's disk.img, so this script refuses to start while another
# container holds it. That check is not politeness: the path cannot be moved
# from here, because os/qemu-run.sh belongs to the image line and is not ours
# to edit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# The board layout is the board definition; the image's name is read from it
# rather than repeated here, the same way os/qemu-run.sh reads it. `:?` on the
# one key used turns a layout that stopped defining it into a sentence instead
# of an empty path that fails four lines later as "image missing".
# shellcheck source=/dev/null  # a data file of assignments, resolved at runtime
. "${REPO_ROOT}/os/layout/x64-v2.env"

OUT_DIR="${REPO_ROOT}/_out/x64"
IMG="${OUT_DIR}/${IMAGE_LATEST_NAME:?os/layout/x64-v2.env did not define IMAGE_LATEST_NAME}"
RUN_DIR="${OUT_DIR}/.qemu"
ART_DIR="${OUT_DIR}/apid-api"

# Resolved once, and used for every comparison against a docker mount source.
# `docker inspect` reports the path it was GIVEN, not the path it resolved --
# measured 2026-08-24 against a symlinked bind, which inspected as the symlink.
# A run directory reached through a symlink (a git worktree pointing _out at
# the checkout that built the image is the ordinary case) would therefore slip
# past a string comparison, and the guard below would wave through exactly the
# collision it exists to stop.
RUN_DIR_REAL="$(readlink -f "${RUN_DIR}")"
OUT_REAL="$(readlink -f "${REPO_ROOT}/_out")"

# Ports: the same names os/qemu-run.sh reads, so a caller sets them once and
# the two halves cannot disagree about which port was opened.
HTTPS_PORT="${MOS_QEMU_HTTPS_PORT:-18443}"
HTTP_PORT="${MOS_QEMU_HTTP_PORT:-18080}"

# A TCG boot on this host reaches a login prompt in ~200-260s when the machine
# is quiet and four to five times that when it is not -- measured, repeatedly.
# Under contention the guest goes two minutes without printing a line, which is
# indistinguishable from a stall unless the waiting loop says what it is doing.
# So: a generous deadline, an override, and progress lines carrying the elapsed
# time and the last thing the console said.
READY_TIMEOUT="${MOS_APID_READY_TIMEOUT:-900}"
CONTAINER_TIMEOUT="${MOS_APID_CONTAINER_TIMEOUT:-240}"
POLL_INTERVAL="${MOS_APID_POLL_INTERVAL:-5}"
PROGRESS_INTERVAL="${MOS_APID_PROGRESS_INTERVAL:-15}"

# The QEMU-side backstops. RUN_SECONDS is when os/qemu-run.sh presses the
# virtual power button; TIMEOUT is when it gives up on the container entirely,
# and it must exceed RUN_SECONDS by more than the 90s grace that script allows
# a guest which ignores ACPI. Both are generous because the normal end of a run
# is this script tearing the container down after the suite, not a backstop
# firing -- and a backstop firing mid-suite looks exactly like apid dying.
RUN_SECONDS="${MOS_QEMU_RUN_SECONDS:-2400}"
QEMU_TIMEOUT="${MOS_QEMU_TIMEOUT:-2700}"

# The second boot is ON by default. It was gated off while 07b-postreboot and
# 08-poweroff did not exist -- a harness whose own verification depended on
# modules that were not there could not be verified at all -- and both landed,
# so the default now matches what the suite can actually do. Off by default
# would mean the reboot phase takes the guest down and NOTHING observes it come
# back: 07 ends with the machine deliberately gone, so a run that stops there
# leaves the most expensive evidence in the campaign uncollected.
# MOS_APID_BOOT2=0 turns it off for a boot-1-only run.
BOOT2="${MOS_APID_BOOT2:-1}"
BOOT2_PHASES="${MOS_APID_BOOT2_PHASES:-07b-postreboot,08-poweroff}"

PHASES="${MOS_APID_PHASES:-}"
BUN_IMAGE="${MOS_APID_BUN_IMAGE:-oven/bun:1}"
KEEP_DISK="${MOS_APID_KEEP_DISK:-0}"

DRY_RUN=0
case "${1:-}" in
--dry-run) DRY_RUN=1 ;;
"") ;;
*) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

# --- reporting, in the register os/verify-image-v2.sh uses ------------------
# One PASS/FAIL line per assertion and a final RESULT with DYNAMIC totals. The
# totals are counted, never written down: a hand-maintained constant stops
# being true the first time somebody adds a check, and the obvious repair --
# "no FAIL lines means success" -- is equally true of a run in which nothing
# executed at all. Three checks on this campaign have already passed while
# asserting nothing, so ZERO CHECKS IS A FAILURE here and says so.
CHECKS_PASSED=0
CHECKS_FAILED=0
pass() { CHECKS_PASSED=$((CHECKS_PASSED + 1)); echo "PASS: $*"; }
fail() { CHECKS_FAILED=$((CHECKS_FAILED + 1)); echo "FAIL: $*"; }
note() { echo "note: $*"; }

# --- docker observation -----------------------------------------------------
# Every template below is deliberately free of Go template VARIABLES. `range`
# over a map with no variable binds the dot to the VALUE, which is all these
# need, and it keeps the format strings free of `$` -- which inside a shell
# script would otherwise mean a shellcheck suppression on every one of them.

# Running containers whose bind mounts RESOLVE to the shared run directory.
# Prints `<short-id> <name>` per holder, nothing when there are none.
run_dir_holders() {
    local ids id src resolved name mounts
    ids="$(docker ps -q 2>/dev/null)" || return 0
    [ -n "${ids}" ] || return 0
    while read -r id; do
        [ -n "${id}" ] || continue
        mounts="$(docker inspect "${id}" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' 2>/dev/null)" || continue
        while read -r src; do
            [ -n "${src}" ] || continue
            resolved="$(readlink -f "${src}" 2>/dev/null)" || continue
            [ "${resolved}" = "${RUN_DIR_REAL}" ] || continue
            name="$(docker inspect "${id}" --format '{{.Name}}' 2>/dev/null)"
            printf '%s %s\n' "${id:0:12}" "${name#/}"
            break
        done <<<"${mounts}"
    done <<<"${ids}"
}

# This container's own address, then the docker network that holds it. Two
# steps, because the second is what makes the answer an OBSERVATION: the
# network is whichever one lists our address, so a session moved to a different
# network keeps working, and a session on none of them is told why rather than
# left to fail later at connect time with a bare refusal.
own_address() {
    ip -4 -o addr show dev eth0 2>/dev/null | awk '{ split($4, a, "/"); print a[1]; exit }'
}

network_holding() {
    local want="$1" net members nets
    nets="$(docker network ls --format '{{.Name}}' 2>/dev/null)" || return 1
    while read -r net; do
        [ -n "${net}" ] || continue
        members="$(docker network inspect "${net}" \
            --format '{{range .Containers}}{{.IPv4Address}}{{"\n"}}{{end}}' 2>/dev/null)" || continue
        if awk -v want="${want}" -F/ '$1 == want { found = 1 } END { exit found ? 0 : 1 }' <<<"${members}"; then
            printf '%s\n' "${net}"
            return 0
        fi
    done <<<"${nets}"
    return 1
}

# A container's address on the discovered network, looked up BY NAME because
# the map key in `docker network inspect` is the container id and reading a map
# key needs a template variable. The name is stable for the life of the
# container. os/qemu-run.sh sets none, so it is docker's random name -- which is
# also why the QEMU container cannot simply be looked up by name to begin with.
address_on_network() {
    local cid name members
    cid="$1"
    name="$(docker inspect "${cid}" --format '{{.Name}}' 2>/dev/null)" || return 1
    name="${name#/}"
    members="$(docker network inspect "${NET}" \
        --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}' 2>/dev/null)" || return 1
    awk -v n="${name}" '$1 == n { split($2, a, "/"); print a[1]; exit }' <<<"${members}"
}

# --- teardown ---------------------------------------------------------------
# Idempotent, and run from BOTH the normal path and the EXIT trap, so the last
# line of stdout is always the RESULT rather than a teardown note that arrived
# after it. An argument error and a failure nine minutes into a boot therefore
# leave the same amount behind: nothing running, and every console log still on
# disk. The logs ARE the evidence and are never removed; the 4 GiB disk is not
# evidence, and is removed unless asked for.
QEMU_CID=""
QEMU_PID=""
PREPARED=0
TORN_DOWN=0
teardown() {
    local id
    [ "${TORN_DOWN}" -eq 0 ] || return 0
    TORN_DOWN=1
    if [ -n "${QEMU_PID}" ] && kill -0 "${QEMU_PID}" 2>/dev/null; then
        kill "${QEMU_PID}" 2>/dev/null || true
    fi
    if [ -n "${QEMU_CID}" ] && docker inspect "${QEMU_CID}" >/dev/null 2>&1; then
        note "stopping the QEMU container ${QEMU_CID:0:12}"
        docker stop -t 10 "${QEMU_CID}" >/dev/null 2>&1 || true
    elif [ "${PREPARED}" -eq 1 ]; then
        # The container came up but was never identified -- the run that would
        # otherwise leave one behind holding the shared directory. Anything
        # holding it NOW is ours: the precondition proved nothing held it when
        # this run started.
        while read -r id _; do
            [ -n "${id}" ] || continue
            note "stopping the QEMU container ${id} (found by its hold on the run directory)"
            docker stop -t 10 "${id}" >/dev/null 2>&1 || true
        done <<<"$(run_dir_holders)"
    fi
    if [ "${PREPARED}" -eq 1 ] && [ "${KEEP_DISK}" != "1" ]; then
        rm -f "${RUN_DIR}/disk.img"
    fi
}

finish() {
    local total
    teardown
    total=$((CHECKS_PASSED + CHECKS_FAILED))
    if [ "${CHECKS_FAILED}" -eq 0 ] && [ "${total}" -gt 0 ]; then
        echo "RESULT: PASS (${CHECKS_PASSED}/${total} checks)"
        exit 0
    fi
    echo "RESULT: FAIL (${CHECKS_PASSED}/${total} checks)"
    exit 1
}

# --- 1. preconditions -------------------------------------------------------
note "repository ${REPO_ROOT}"

if [ ! -e "${IMG}" ]; then
    fail "image ${IMG##*/} is missing; this harness builds nothing. Build it: MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/mkimage-x64.sh"
    finish
fi
pass "image present: ${IMG##*/} -> $(basename "$(readlink -f "${IMG}")")"

if ! docker info >/dev/null 2>&1; then
    fail "docker is not usable from here; QEMU, the readiness probe and the bun suite all run in containers"
    finish
fi
pass "docker is usable"

HOLDERS="$(run_dir_holders)"
if [ -n "${HOLDERS}" ]; then
    fail "another container already binds ${RUN_DIR_REAL}: ${HOLDERS//$'\n'/, }"
    note "  that is os/qemu-run.sh's single fixed run directory and it is SHARED with the x64"
    note "  verification line. Continuing would overwrite its disk.img underneath a running"
    note "  boot, so this run refuses rather than clobbering it. Wait for that run to finish."
    finish
fi
pass "no competing run: nothing binds ${RUN_DIR_REAL}"

if [ ! -f "${SCRIPT_DIR}/src/main.ts" ]; then
    # Said HERE rather than left to the container, because inside it the same
    # situation prints `Module not found` -- which on this host is ALSO what a
    # bind mount that did not propagate looks like, and telling those two apart
    # cost a measured afternoon. Not fatal at this point: the boot half of the
    # harness is still worth running and is still checkable without the suite.
    note "test/apid-api/src/main.ts does not exist yet; the suite step will FAIL loudly rather than be skipped quietly"
fi

# --- 2. discover the network by observation ---------------------------------
MY_IP="$(own_address)"
if [ -z "${MY_IP}" ]; then
    fail "could not read this container's own eth0 address; without it the docker network holding this session cannot be identified, and the guest then has no address that is reachable from here"
    finish
fi
if ! NET="$(network_holding "${MY_IP}")"; then
    fail "no docker network lists ${MY_IP}, so the suite cannot route to the guest: QEMU publishes its forward on the DOCKER HOST's loopback, which is not this container's, and a shared network is the only way in"
    finish
fi
pass "docker network discovered by observation: ${NET} (this container is ${MY_IP})"

mkdir -p "${ART_DIR}"
CONSOLE1="${ART_DIR}/console-boot1.log"
CONSOLE2="${ART_DIR}/console-boot2.log"
# The path the SUITE is given has to resolve inside the bun container, which
# mounts the repository root at /w. _out is bound over the top of it a second
# time so that a checkout whose _out is a symlink -- a worktree borrowing the
# artefacts of the checkout that built them -- does not hand the suite a
# dangling link, because the symlink's target does not exist in that container.
# Where _out is a real directory the second bind is the same directory twice
# and costs nothing.
ART_IN_CONTAINER="/w/_out/x64/apid-api"

if [ "${DRY_RUN}" -eq 1 ]; then
    note "--dry-run: nothing will be booted"
    note "would prepare  ${RUN_DIR}/disk.img from ${IMG##*/} (os/qemu-run.sh --prepare-only)"
    note "would boot     os/qemu-run.sh --capture ${CONSOLE1}"
    note "               MOS_QEMU_FORWARD=1 MOS_QEMU_NETWORK=${NET}"
    note "               MOS_QEMU_APPEND=systemd.journald.forward_to_console=1"
    note "               MOS_QEMU_RUN_SECONDS=${RUN_SECONDS} MOS_QEMU_TIMEOUT=${QEMU_TIMEOUT}"
    note "would find     the container binding ${RUN_DIR_REAL} and read its address on ${NET}"
    note "would wait     up to ${READY_TIMEOUT}s for APID_LISTENING on the console AND for"
    note "               https://<guest>:${HTTPS_PORT}/healthz to answer 200 from inside ${BUN_IMAGE}"
    note "would run      docker run --network ${NET} -v ${REPO_ROOT}:/w -v ${OUT_REAL}:/w/_out -w /w/test/apid-api ${BUN_IMAGE} bun run src/main.ts"
    note "               APID_HOST=<guest> APID_HTTPS_PORT=${HTTPS_PORT} APID_HTTP_PORT=${HTTP_PORT}"
    note "               APID_CONSOLE=${ART_IN_CONTAINER}/console-boot1.log APID_PHASES=${PHASES:-<all>}"
    if [ "${BOOT2}" = "1" ]; then
        note "would then    boot a second time on the same disk for ${BOOT2_PHASES}"
    else
        note "second boot is OFF (MOS_APID_BOOT2=0 was set; the default is on)"
    fi
    finish
fi

trap 'teardown' EXIT

# --- 3. boot ----------------------------------------------------------------
# --prepare-only makes the disk copy, grows it so systemd-repart has somewhere
# to extend into, and applies MOS_QEMU_APPEND to the copy's grub.cfg. It boots
# nothing. Every boot after it REUSES that disk, which is what makes two boots
# off one disk state possible at all -- and what lets the reboot in phase 07 be
# observed as a change to the disk rather than as a fresh machine.
#
# The append is passed on every invocation, not only on the prepare.
# os/qemu-run.sh adds it to the linux line unconditionally, so over a run it
# lands two or three times; a repeated systemd.journald.forward_to_console=1 is
# the same value twice and costs nothing, whereas one boot that silently lacks
# it deletes the readiness signal this entire script waits on.
QEMU_ENV=(
    MOS_QEMU_FORWARD=1
    MOS_QEMU_NETWORK="${NET}"
    MOS_QEMU_APPEND=systemd.journald.forward_to_console=1
    MOS_QEMU_HTTPS_PORT="${HTTPS_PORT}"
    MOS_QEMU_HTTP_PORT="${HTTP_PORT}"
    MOS_QEMU_RUN_SECONDS="${RUN_SECONDS}"
    MOS_QEMU_TIMEOUT="${QEMU_TIMEOUT}"
)

note "preparing the disk from ${IMG##*/} (a ~2 GiB copy; nothing boots yet)"
if ! env "${QEMU_ENV[@]}" bash "${REPO_ROOT}/os/qemu-run.sh" --prepare-only >"${ART_DIR}/prepare.log" 2>&1; then
    PREPARED=1  # a partial copy still has to be cleaned up
    fail "os/qemu-run.sh --prepare-only failed; see ${ART_DIR}/prepare.log"
    tail -n 20 "${ART_DIR}/prepare.log" >&2 || true
    finish
fi
PREPARED=1
pass "disk prepared at ${RUN_DIR}/disk.img"

launch_boot() {
    local label="$1" console="$2"
    : >"${console}"
    QEMU_CID=""
    env "${QEMU_ENV[@]}" MOS_QEMU_REUSE_DISK=1 \
        bash "${REPO_ROOT}/os/qemu-run.sh" --capture "${console}" \
        >"${ART_DIR}/launch-${label}.log" 2>&1 &
    QEMU_PID=$!
    note "[${label}] QEMU launched in the background (pid ${QEMU_PID}); console -> ${console##*/}"
}

# --- 4. find the guest ------------------------------------------------------
# Two conditions, held apart because they fail for different reasons and the
# message has to say which. os/qemu-run.sh starts its container with `--rm` and
# no `--name`, so the only handle on it is the bind mount -- and the SAME mount
# is held for a moment by the short-lived mtools container that writes the
# kernel append into the ESP, which is NOT on the discovered network. Requiring
# an address on that network is what tells the two apart; matching on the mount
# alone latches onto the wrong container and then reports "no address on that
# network" about a container that was never going to have one.
GUEST_CID=""
GUEST_IP=""
find_guest() {
    local label="$1" start elapsed last_report holders holder cid ip
    start="${SECONDS}"
    last_report=0
    while :; do
        elapsed=$((SECONDS - start))
        holders="$(run_dir_holders)"
        holder="${holders%%$'\n'*}"
        if [ -n "${holder}" ]; then
            cid="${holder%% *}"
            ip="$(address_on_network "${cid}")"
            if [ -n "${ip}" ]; then
                GUEST_CID="${cid}"
                GUEST_IP="${ip}"
                QEMU_CID="${cid}"
                return 0
            fi
        fi
        if [ "${elapsed}" -ge "${CONTAINER_TIMEOUT}" ]; then
            if [ -z "${holder}" ]; then
                fail "[${label}] no container bound ${RUN_DIR_REAL} within ${CONTAINER_TIMEOUT}s: QEMU never started"
            else
                fail "[${label}] container ${holder} is up but still has no address on ${NET} after ${CONTAINER_TIMEOUT}s: the forward may exist, but nothing here can route to it"
            fi
            tail -n 20 "${ART_DIR}/launch-${label}.log" >&2 2>/dev/null || true
            return 1
        fi
        if [ $((elapsed - last_report)) -ge "${PROGRESS_INTERVAL}" ]; then
            last_report="${elapsed}"
            if [ -z "${holder}" ]; then
                note "[${label}] ${elapsed}s/${CONTAINER_TIMEOUT}s waiting for the QEMU container to bind the run directory"
            else
                note "[${label}] ${elapsed}s/${CONTAINER_TIMEOUT}s container ${holder%% *} is up; waiting for its address on ${NET}"
            fi
        fi
        sleep "${POLL_INTERVAL}"
    done
}

# --- 5. wait for apid, and make the waiting legible -------------------------
# BOTH signals, because either alone is a different claim. APID_LISTENING says
# the daemon reached the point in its own start-up where it binds; a 200 from
# /healthz says the three doors between here and that socket are open. A run
# that had the first and not the second used to look like apid being down.
#
# /healthz is the probe because it is the ONLY route the auth gate lets through
# unauthenticated. Anything else answers a redirect to /setup on a device that
# has never been set up, and a redirect is not evidence that the daemon is
# serving. Redirects are also not followed here on principle: apid's :80 -> :443
# redirect names the GUEST's port 443, which is not followable through a port
# forward, and a client that follows it blindly hangs in a way that reads as
# apid being down.
#
# The probe runs in the bun image ON THE DISCOVERED NETWORK -- the suite's own
# runtime over the suite's own path -- so a green wait is evidence about the
# thing that is about to run rather than about this shell's networking. apid's
# certificate is self-signed, so verification is switched off EXPLICITLY, and
# only here: measured 2026-08-24, bun rejects that certificate by default with
# "self signed certificate", which is the right default and the reason the
# opt-out is written down rather than inherited from an environment variable.
# shellcheck disable=SC2016  # this is JavaScript: ${process.env.H} and the
# backtick template are for bun to expand, not the shell. Substituting them
# here would bake this run's values into a string that is then evaluated in a
# different process, which is how a probe ends up asking about the wrong host.
HEALTHZ_JS='
const url = `https://${process.env.H}:${process.env.P}/healthz`;
let out;
try {
  const r = await fetch(url, { redirect: "manual", tls: { rejectUnauthorized: false } });
  out = { status: r.status, body: (await r.text()).slice(0, 120) };
} catch (e) {
  out = { status: 0, error: String(e && e.message ? e.message : e) };
}
console.log(JSON.stringify(out));
process.exit(out.status === 200 ? 0 : 1);
'

probe_healthz() {
    docker run --rm --network "${NET}" \
        -e H="$1" -e P="${HTTPS_PORT}" \
        "${BUN_IMAGE}" bun -e "${HEALTHZ_JS}" >"${ART_DIR}/healthz.last" 2>&1
}

console_tail_line() {
    tail -n 1 "$1" 2>/dev/null | tr -d '\r' | tr -dc '[:print:]' | cut -c1-100
}

wait_for_apid() {
    local label="$1" console="$2" ip="$3" start elapsed last_report console_seen
    start="${SECONDS}"
    last_report=0
    console_seen=0
    while :; do
        elapsed=$((SECONDS - start))
        if [ "${console_seen}" -eq 0 ] && grep -q 'APID_LISTENING' "${console}" 2>/dev/null; then
            console_seen=1
            pass "[${label}] APID_LISTENING on the console after ${elapsed}s: $(grep -m1 'APID_LISTENING' "${console}" | tr -d '\r' | tr -dc '[:print:]' | cut -c1-120)"
        fi
        if [ "${console_seen}" -eq 1 ] && probe_healthz "${ip}"; then
            pass "[${label}] https://${ip}:${HTTPS_PORT}/healthz answered 200 from inside ${BUN_IMAGE} after ${elapsed}s: $(cut -c1-160 "${ART_DIR}/healthz.last")"
            return 0
        fi
        if [ "${elapsed}" -ge "${READY_TIMEOUT}" ]; then
            if [ "${console_seen}" -eq 0 ]; then
                fail "[${label}] APID_LISTENING never appeared on the console within ${READY_TIMEOUT}s"
            else
                fail "[${label}] apid announced itself but https://${ip}:${HTTPS_PORT}/healthz never answered 200 within ${READY_TIMEOUT}s: $(cut -c1-160 "${ART_DIR}/healthz.last" 2>/dev/null)"
            fi
            # A timeout with no evidence is the failure mode this campaign
            # keeps paying for. The tail of the console goes out BEFORE
            # anything unwinds, because the container is about to be stopped
            # and the reader would otherwise be told only that it took too long.
            echo "--- last 40 lines of ${console} ---" >&2
            tail -n 40 "${console}" 2>/dev/null | tr -d '\r' >&2 || true
            echo "--- end of console ---" >&2
            return 1
        fi
        if [ $((elapsed - last_report)) -ge "${PROGRESS_INTERVAL}" ]; then
            last_report="${elapsed}"
            if [ "${console_seen}" -eq 0 ]; then
                note "[${label}] ${elapsed}s/${READY_TIMEOUT}s waiting for APID_LISTENING | console: $(console_tail_line "${console}")"
            else
                note "[${label}] ${elapsed}s/${READY_TIMEOUT}s apid announced; waiting for /healthz | last: $(cut -c1-100 "${ART_DIR}/healthz.last" 2>/dev/null)"
            fi
        fi
        sleep "${POLL_INTERVAL}"
    done
}

# --- 6. run the suite -------------------------------------------------------
# The REPOSITORY ROOT is mounted, never a temporary directory. Measured
# 2026-08-24: a /tmp bind does NOT propagate to the docker daemon on this host
# -- it is a sibling-container arrangement, so our /tmp is ours and the
# daemon's is the daemon's. The container then sees an EMPTY directory and says
# `Module not found`, which reads like a bug in the suite and is not.
SUITE_RC=0
run_suite() {
    local label="$1" ip="$2" console_name="$3" phases="$4" log rc p f
    log="${ART_DIR}/suite-${label}.log"
    if [ ! -f "${SCRIPT_DIR}/src/main.ts" ]; then
        fail "[${label}] the suite entry point test/apid-api/src/main.ts does not exist, so nothing was asserted about apid"
        SUITE_RC=1
        return 0
    fi
    note "[${label}] running the suite against ${ip}:${HTTPS_PORT}${phases:+ (phases: ${phases})}"
    set +e
    docker run --rm --network "${NET}" \
        -v "${REPO_ROOT}:/w" -v "${OUT_REAL}:/w/_out" -w /w/test/apid-api \
        -e APID_HOST="${ip}" \
        -e APID_HTTPS_PORT="${HTTPS_PORT}" \
        -e APID_HTTP_PORT="${HTTP_PORT}" \
        -e APID_CONSOLE="${ART_IN_CONTAINER}/${console_name}" \
        -e APID_RESULT_JSON="${ART_IN_CONTAINER}/result-${label}.json" \
        -e APID_PHASES="${phases}" \
        "${BUN_IMAGE}" bun run src/main.ts 2>&1 | tee "${log}"
    rc="${PIPESTATUS[0]}"
    set -e
    # The suite's own PASS/FAIL lines are folded into this run's totals, so the
    # final RESULT counts ASSERTIONS and not scripts. An exit code with no FAIL
    # line behind it is recorded as its own failure: a suite that died before
    # asserting anything must not be able to leave a clean report.
    p="$(grep -c '^PASS:' "${log}" 2>/dev/null || true)"
    f="$(grep -c '^FAIL:' "${log}" 2>/dev/null || true)"
    CHECKS_PASSED=$((CHECKS_PASSED + p))
    CHECKS_FAILED=$((CHECKS_FAILED + f))
    note "[${label}] suite exited ${rc} with ${p} PASS and ${f} FAIL lines"
    if [ "${rc}" -ne 0 ] && [ "${f}" -eq 0 ]; then
        fail "[${label}] the suite exited ${rc} without emitting a single FAIL line; it did not get far enough to assert anything"
    fi
    [ "${rc}" -eq 0 ] || SUITE_RC="${rc}"
    return 0
}

# --- the run ----------------------------------------------------------------
BOOT1_START="${SECONDS}"
launch_boot boot1 "${CONSOLE1}"
find_guest boot1 || finish
pass "boot1 guest found: container ${GUEST_CID} at ${GUEST_IP} on ${NET} after $((SECONDS - BOOT1_START))s"
wait_for_apid boot1 "${CONSOLE1}" "${GUEST_IP}" || finish
note "boot1 was ready $((SECONDS - BOOT1_START))s after launch"

run_suite boot1 "${GUEST_IP}" "console-boot1.log" "${PHASES}"

# --- 7. the second boot -----------------------------------------------------
# os/qemu-run.sh:167 passes `-no-reboot`, so a guest-initiated reboot makes
# QEMU EXIT rather than reset. That file belongs to the image line and is not
# ours to change, so the harness works WITH the flag: phase 07 posts
# /power/reboot, QEMU exits, and that exit IS the evidence the guest asked for
# a reset. The second boot reuses the same disk.img and comes up through
# firmware, GRUB and the grubenv the reboot just wrote.
#
# Which of the two happened is decided BY LOOKING -- is the QEMU container
# still running -- and never by assuming. If a future os/qemu-run.sh drops
# `-no-reboot`, the guest resets in place, the container is still there, and
# the right move is to wait for apid to come back on the SAME container rather
# than to start a second one against a disk something is already booting.
if [ "${BOOT2}" = "1" ]; then
    if [ "$(docker inspect "${GUEST_CID}" --format '{{.State.Running}}' 2>/dev/null)" = "true" ]; then
        pass "the QEMU container is still running after the reboot phase: the guest reset in place, so no second boot is needed"
        wait_for_apid boot1-again "${CONSOLE1}" "${GUEST_IP}" || finish
        run_suite boot2 "${GUEST_IP}" "console-boot1.log" "${BOOT2_PHASES}"
    else
        pass "the QEMU container exited after the reboot phase: under -no-reboot that exit IS the guest asking for a reset"
        QEMU_CID=""
        BOOT2_START="${SECONDS}"
        launch_boot boot2 "${CONSOLE2}"
        find_guest boot2 || finish
        pass "boot2 guest found: container ${GUEST_CID} at ${GUEST_IP} on ${NET} after $((SECONDS - BOOT2_START))s"
        wait_for_apid boot2 "${CONSOLE2}" "${GUEST_IP}" || finish
        run_suite boot2 "${GUEST_IP}" "console-boot2.log" "${BOOT2_PHASES}"
    fi
fi

# --- 8. one machine-readable result for the whole run -----------------------
# The envelope is this harness's; what each boot wrote is embedded VERBATIM and
# is not reinterpreted here. The suite owns the shape of its own file, and a
# merger that reached inside it would have to be changed in step with it -- and
# would silently produce zeros on the day it was not.
MERGED="${ART_DIR}/result.json"
# The IMAGE IDENTITY goes in the envelope, because a result file that does not
# say which artefact it covered is a result file that cannot be trusted a week
# later. `x64-mos-v2-latest.img` is a symlink and its target changes under it
# every time somebody builds; the resolved name and the mtime are what pin a run
# to a surface. This is also what makes the /mqtt skew guard in 04-readonly
# legible: when that check goes red, this block says whether the image moved.
IMG_RESOLVED="$(readlink -f "${IMG}" 2>/dev/null || echo "${IMG}")"
IMG_MTIME_EPOCH="$(stat -c %Y "${IMG_RESOLVED}" 2>/dev/null || echo 0)"
IMG_MTIME_ISO="$(date -u -d "@${IMG_MTIME_EPOCH}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
IMG_BYTES="$(stat -c %s "${IMG_RESOLVED}" 2>/dev/null || echo 0)"
{
    printf '{\n'
    printf '  "image": {\n'
    printf '    "latest": "%s",\n' "${IMG##*/}"
    printf '    "resolved": "%s",\n' "${IMG_RESOLVED##*/}"
    printf '    "resolvedPath": "%s",\n' "${IMG_RESOLVED}"
    printf '    "mtime": "%s",\n' "${IMG_MTIME_ISO}"
    printf '    "mtimeEpoch": %s,\n' "${IMG_MTIME_EPOCH}"
    printf '    "bytes": %s\n' "${IMG_BYTES}"
    printf '  },\n'
    printf '  "boots": [\n'
    sep=""
    for label in boot1 boot2; do
        rf="${ART_DIR}/result-${label}.json"
        [ -f "${rf}" ] || continue
        printf '%s    { "boot": "%s", "result": ' "${sep}" "${label}"
        cat "${rf}"
        printf ' }'
        sep=$',\n'
    done
    printf '\n  ],\n'
    printf '  "passed": %d,\n  "failed": %d,\n  "checks": %d\n}\n' \
        "${CHECKS_PASSED}" "${CHECKS_FAILED}" "$((CHECKS_PASSED + CHECKS_FAILED))"
} >"${MERGED}"
note "merged result written to ${MERGED}"
note "image under test: ${IMG_RESOLVED##*/} (mtime ${IMG_MTIME_ISO})"
note "console logs kept: ${CONSOLE1}$([ -s "${CONSOLE2}" ] && printf ' %s' "${CONSOLE2}")"

if [ "${SUITE_RC}" -ne 0 ] && [ "${CHECKS_FAILED}" -eq 0 ]; then
    fail "the suite exited ${SUITE_RC} but no assertion recorded a failure"
fi

finish
