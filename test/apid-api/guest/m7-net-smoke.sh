#!/bin/bash
# PLAN-022 M7: the kernel half of VLAN, bridge and WireGuard, proved by USING it
# on a booted device rather than by reading a config file.
#
# This runs INSIDE the guest. `os/verify`'s two kernel checks read
# `/boot/config-*` and the module indexes out of an unpacked squashfs, which is
# a claim about what the image CONTAINS; nothing offline can answer whether the
# running kernel will actually hand back a device. `ip link add` is the only
# thing that asks that question, and it has to be asked where the kernel is.
#
# Every conclusion is one `M7-SMOKE: <id> PASS|FAIL <detail>` line on the
# console, which is the harness's only channel into this guest: the image keeps
# journald at `Storage=volatile` and there is no login and no route in. The
# suite reads these lines back out of the captured serial log.
#
# It creates nothing that outlives it. The three links are torn down in the
# order they were made, and the key fixture is removed, because a device left
# behind would be indistinguishable from one mosd rendered and would be swept
# by the next reconcile.

set -u

STATE_DIR=/var/lib/mos
KEY_DIR="${STATE_DIR}/networkd-secrets"
SECRETS_DIR="${STATE_DIR}/secrets"
NET_USER=systemd-network

# Names nothing else in this suite writes. 05b-wireguard owns `wg-e2e`; a
# collision would make one phase's teardown another phase's failure.
VLAN_ID=4094
BRIDGE_DEV=m7br0
WG_DEV=m7wg0

say() { echo "M7-SMOKE: $*"; }
pass() { say "$1 PASS ${2-}"; }
fail() { say "$1 FAIL ${2-}"; }

# `set -u` plus a subshell would hide a failure; each check reports its own
# verdict and none of them aborts the script, because a run that stopped at the
# first red would report nothing about the checks after it and the console would
# look identical to a run that never started.

# STATE is mounted by local-fs.target and this unit is generated from the kernel
# command line, so the ordering between the two is systemd's to decide rather
# than ours to declare. Waiting for the mount is cheap; concluding "the key
# directory is unreadable" because it had not been mounted yet would be a
# fabricated defect in M5's work.
wait_for_state() {
    local i=0
    while [ "$i" -lt 120 ]; do
        if mountpoint -q "${STATE_DIR}" 2>/dev/null; then return 0; fi
        i=$((i + 1))
        sleep 1
    done
    return 1
}

say "BEGIN $(uname -r)"

if wait_for_state; then
    pass state-mounted "${STATE_DIR} is a mount point"
else
    fail state-mounted "${STATE_DIR} was not mounted within 120s; the key-store checks below cannot run"
fi

# 1. modprobe resolution, against the running kernel's own view. `-n` is a dry
# run: it resolves the name and the dependency chain and loads nothing, which is
# what makes this safe to run before the link checks that need the real thing.
for m in 8021q bridge wireguard; do
    if out=$(modprobe -n "$m" 2>&1); then
        pass "modprobe-${m}" "modprobe -n ${m} resolved${out:+ (${out})}"
    else
        fail "modprobe-${m}" "modprobe -n ${m} failed: ${out}"
    fi
done

# 2. The links. A VLAN needs a declared parent, so the parent is DISCOVERED --
# the interface carrying the default route, which is the one this suite's own
# traffic arrives on. Writing a name down here would make the check fail on a
# guest whose NIC is enumerated differently, which is a fact about the host's
# QEMU and not about the kernel under test.
#
# Nothing here disturbs the parent. A VLAN is a new device hanging off it, the
# bridge takes no ports, and the tunnel is created from nothing -- enslaving the
# parent to the bridge would drop the port forward and take the rest of the
# suite with it.
PARENT=$(ip -o -4 route show default 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="dev") print $(i+1); exit}')
if [ -z "${PARENT}" ]; then
    PARENT=$(ip -o link show up 2>/dev/null | awk -F': ' '$2 != "lo" {print $2; exit}')
fi

VLAN_DEV="${PARENT}.${VLAN_ID}"

link_check() {
    local id="$1" dev="$2"; shift 2
    local out
    if ! out=$("$@" 2>&1); then
        fail "$id" "ip link add ${dev} failed: ${out}"
        return
    fi
    if out=$(ip -o link show dev "${dev}" 2>&1); then
        pass "$id" "${out}"
    else
        # `ip link add` exited 0 and the device is not there. Reported as its
        # own sentence because the repair is not the same one: the command
        # succeeding and the device not existing is a kernel that accepted the
        # netlink message and created nothing.
        fail "$id" "ip link add ${dev} exited 0 but the device is absent: ${out}"
    fi
    ip link del "${dev}" >/dev/null 2>&1
}

if [ -z "${PARENT}" ]; then
    fail link-vlan "no interface carries the default route and no non-loopback link is up, so there is no declared parent to hang a VLAN off"
else
    link_check link-vlan "${VLAN_DEV}" \
        ip link add link "${PARENT}" name "${VLAN_DEV}" type vlan id "${VLAN_ID}"
fi
link_check link-bridge "${BRIDGE_DEV}" ip link add name "${BRIDGE_DEV}" type bridge
link_check link-wireguard "${WG_DEV}" ip link add dev "${WG_DEV}" type wireguard

# 3. The traversal check RFCT-204 handed forward.
#
# Run AS the user, never by reading mode bits. The M5 defect the amendment
# corrected -- a key under a 0700 `secrets/` -- left every mode assertion green
# while `PrivateKeyFile=` was EACCES on every real image, because the mode of
# the key says nothing about whether its PATH can be walked. `setpriv
# --reuid/--regid --clear-groups` drops to the account systemd-networkd runs as
# and the kernel answers the question that mode bits cannot.
if ! id "${NET_USER}" >/dev/null 2>&1; then
    fail netuser-exists "no ${NET_USER} account on this image; mosd's key store chowns to a group that does not exist and PrivateKeyFile= could not be read by anyone but root"
else
    pass netuser-exists "$(id "${NET_USER}")"

    NET_UID=$(id -u "${NET_USER}")
    NET_GID=$(id -g "${NET_USER}")
    as_netuser() { setpriv --reuid "${NET_UID}" --regid "${NET_GID}" --clear-groups -- "$@"; }

    # The fixture is written at the production path with the production modes,
    # so what is being read is the store's own directory rather than a lookalike
    # somewhere traversable. A key mosd generated would be a stronger subject
    # still, but it exists only once a wireguard interface has been configured,
    # and a check that depended on another phase's timing would report EACCES
    # for "not created yet". Both are asserted: the fixture unconditionally, and
    # every real key beside it when there is one.
    FIXTURE="${KEY_DIR}/m7-probe.key"
    mkdir -p "${KEY_DIR}" 2>/dev/null
    chmod 0750 "${KEY_DIR}" 2>/dev/null
    chown "root:${NET_USER}" "${KEY_DIR}" 2>/dev/null
    printf 'not-a-key\n' >"${FIXTURE}" 2>/dev/null
    chmod 0640 "${FIXTURE}" 2>/dev/null
    chown "root:${NET_USER}" "${FIXTURE}" 2>/dev/null

    if out=$(as_netuser cat "${FIXTURE}" 2>&1); then
        pass keystore-readable "${NET_USER} read ${FIXTURE} (mode $(stat -c '%a %U:%G' "${FIXTURE}" 2>/dev/null)); every path component is traversable by that user"
    else
        fail keystore-readable "${NET_USER} could NOT read ${FIXTURE} (mode $(stat -c '%a %U:%G' "${FIXTURE}" 2>/dev/null)): ${out}. systemd-networkd would fail PrivateKeyFile= with the same error and every mode assertion in mosd's own tests would still be green"
    fi
    rm -f "${FIXTURE}"

    real=0
    for key in "${KEY_DIR}"/wg-*.key; do
        [ -e "${key}" ] || continue
        real=$((real + 1))
        if out=$(as_netuser cat "${key}" >/dev/null 2>&1); then
            pass keystore-real-readable "${NET_USER} read the key mosd generated at ${key} (mode $(stat -c '%a %U:%G' "${key}" 2>/dev/null))"
        else
            fail keystore-real-readable "${NET_USER} could NOT read mosd's own key at ${key} (mode $(stat -c '%a %U:%G' "${key}" 2>/dev/null)): ${out}"
        fi
    done
    [ "${real}" -eq 0 ] && say "keystore-real-readable SKIP no wg-*.key in ${KEY_DIR} on this boot"

    # The negative, and it is not decoration. If `systemd-network` could read
    # `secrets/` then the amendment's whole premise -- that a key cannot live
    # under it -- would be false, and the path correction this milestone
    # verifies would have been unnecessary. A check that only ever asserts
    # access cannot tell a correctly scoped grant from a wide-open state dir.
    if [ ! -d "${SECRETS_DIR}" ]; then
        say "secrets-unreadable SKIP ${SECRETS_DIR} does not exist on this boot"
    elif as_netuser cat "${SECRETS_DIR}/device-password" >/dev/null 2>&1; then
        fail secrets-unreadable "${NET_USER} CAN read ${SECRETS_DIR}/device-password (dir mode $(stat -c '%a %U:%G' "${SECRETS_DIR}" 2>/dev/null)); the plaintext device password is readable by the network account"
    else
        pass secrets-unreadable "${NET_USER} cannot read ${SECRETS_DIR}/device-password (dir mode $(stat -c '%a %U:%G' "${SECRETS_DIR}" 2>/dev/null)), which is why the key store is a SIBLING of secrets/ and not a directory under it"
    fi
fi

say "END"
