#!/usr/bin/env bash
# The kernel symbols netavark needs, asserted against every board's config.
#
#   bash tests/netavark-kernel-config-test.sh
#
# WHY THIS FILE EXISTS. podman bridge networking on cx3576 was unusable because
# the board kernel was built with `# CONFIG_NFT_FIB_IPV4 is not set`, the same
# for IPV6, and CONFIG_NFT_FIB_INET absent entirely. netavark opens its
# port-forwarding path with `fib daddr type local jump <dnat_chain>` in the
# prerouting and output chains of its inet table; on a kernel with no fib
# expression that rule cannot be programmed, so setup_network fails and every
# container on a bridge network fails with it. Nothing in this repository
# required those symbols, so the gap was invisible to every gate: the board
# config said "not set", and that was simply accepted.
#
# WHAT IS PROVED HERE, AND WHAT IS NOT. This reads the COMMITTED configs, which
# are build inputs, not outputs. `make olddefconfig` runs after them and can
# still drop a symbol whose dependencies are unmet -- silently, because a
# dropped symbol simply is not in the output. That direction is proved by the
# post-olddefconfig grep loops in the board kernel Dockerfiles, which fail the
# image build. Assertion 2 below therefore requires every symbol in this list to
# be named by one of those loops: two lists free to disagree are one list that
# is not enforced, and the built config is the only one the hardware ever sees.
#
# EVERY BOARD, since PLAN-074. x64 used to be out of scope because it ran
# Debian's kernel, where these are modules the distribution ships and nothing in
# this tree chose the .config. It builds its own now, so its committed config is
# read here too -- and the symbols themselves moved into
# boards/common/mos-required.fragment, which both boards merge before
# olddefconfig and both assert afterwards. That is what assertion 2 accepts as
# the gate: the board's own loop, or the shared fragment both loops enforce.
#
# WHERE THE LIST COMES FROM. Every entry cites a line of netavark that programs
# the rule needing it, read from the tag pkgs/podman/versions.env pins.
# Assertion 3 requires that pin to still be the version the citations were read
# against -- a citation into a version nobody ships is decoration.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
# One row per board: the committed config a build starts from, and the
# Dockerfile that asserts the result. Discovered from neither -- written here,
# because a board with no kernel build has no row and a glob would give it one.
BOARD_CONFIGS="cx3576:boards/cx3576/bsp/kernel/config/kernel-cx3576z.config x64:boards/x64/bsp/kernel/config/x64.config"
BOARD_DOCKERFILES="cx3576:boards/cx3576/bsp/kernel/Dockerfile x64:boards/x64/bsp/kernel/Dockerfile"
FRAGMENT="${REPO_ROOT}/boards/common/mos-required.fragment"
VERSIONS_ENV="${REPO_ROOT}/pkgs/podman/versions.env"

# The netavark the citations below were read against.
CITED_NETAVARK=v2.1.0

# SYMBOL and the netavark line that needs it. Paths are relative to the netavark
# source tree at ${CITED_NETAVARK}.
#
# The inet family is what makes the fib entries the ones that were missing:
# netavark puts every chain in one inet table, so its fib lookup is the inet one,
# and NFT_FIB_INET depends on BOTH address families being built (6.1
# net/netfilter/Kconfig: `depends on NFT_FIB_IPV4`, `depends on NFT_FIB_IPV6`),
# each of which selects the shared NFT_FIB core.
REQUIRED=$(cat <<'LIST'
VETH               src/network/bridge.rs:937,945 CreateLinkOptions::new(.., InfoKind::Veth) -- the container/host veth pair
BRIDGE             src/network/bridge.rs:832 InfoKind::Bridge -- the network's bridge link
NF_TABLES          src/firewall/nft.rs:70 NfListObject::Table -- netavark 2.x programs nftables and ships no iptables driver
NF_TABLES_INET     src/firewall/nft.rs:72 family: NfFamily::INet -- one inet table holds every chain
NF_TABLES_IPV4     src/firewall/nft.rs:455 NATFamily::IP -- the IPv4 half of that inet table
NF_TABLES_IPV6     src/firewall/nft.rs:493 NATFamily::IP6 -- the IPv6 half of that inet table
NF_NAT             src/firewall/nft.rs:92,98,104 NfChainType::NAT on postrouting/prerouting/output
NFT_NAT            src/firewall/nft.rs:451,489 Statement::SNAT and 1101,1258 Statement::DNAT -- published ports
NFT_MASQ           src/firewall/nft.rs:160,473,511 Statement::Masquerade -- outbound container traffic
NF_NAT_MASQUERADE  src/firewall/nft.rs:160 the masquerade above; NFT_MASQ selects it
NF_CONNTRACK       src/firewall/nft.rs:246,560 ct state {invalid} and {established,related}
NFT_CT             src/firewall/nft.rs:246,560 the ct expression those rules match on
NF_CONNTRACK_MARK  src/firewall/nft.rs:286,1090 ct mark -- the dnat mark netavark sets and matches
NFT_FIB_IPV4       src/firewall/nft.rs:206 fib daddr type local -- the IPv4 lookup the inet fib delegates to
NFT_FIB_IPV6       src/firewall/nft.rs:206 fib daddr type local -- the IPv6 lookup the inet fib delegates to
NFT_FIB_INET       src/firewall/nft.rs:206 fib daddr type local, in an inet table: the expression itself
NFT_FIB            src/firewall/nft.rs:206 the shared fib core both address families select
LIST
)

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

# The per-board files are checked inside the loops that read them, where a
# missing one can name its board. These are the two this file reads directly.
for f in "${FRAGMENT}" "${VERSIONS_ENV}"; do
    [ -f "${f}" ] || { echo "error: ${f} not found; there is nothing to check" >&2; exit 1; }
done

# A list that emptied itself would make every loop below report green without
# having compared anything.
mapfile -t SYMBOLS < <(awk 'NF {print $1}' <<<"${REQUIRED}")
[ "${#SYMBOLS[@]}" -ge 17 ] || {
    echo "error: the requirement list holds ${#SYMBOLS[@]} symbols; it held 17 when written." >&2
    echo "       Shrinking it is allowed, but not by accident -- move this floor with it." >&2
    exit 1
}

echo "--- 1. every symbol is =y in every board's committed config"
# =y and not =m: boards/common/mos-required.fragment states the rule -- a
# dm-verity root with no initramfs cannot load a module before the rootfs is up,
# and each board Dockerfile's own loop greps for =y for the same reason.
#
# A board whose committed config is the RESOLVED one (x64 records the result of
# merging the fragments over x86_64_defconfig) and one whose committed config is
# the vendor INPUT (cx3576) are read the same way here: in both, a line that is
# not `=y` is a build this tree agreed to make.
BOARDS_CHECKED=0
for row in ${BOARD_CONFIGS}; do
    board="${row%%:*}"
    cfg="${REPO_ROOT}/${row#*:}"
    [ -f "${cfg}" ] || {
        echo "error: ${row#*:} does not exist, so ${board}'s config would be checked by nothing." >&2
        exit 1
    }
    BOARDS_CHECKED=$((BOARDS_CHECKED + 1))
    while IFS= read -r line; do
        [ -n "${line}" ] || continue
        sym="${line%% *}"
        why="${line#"${sym}"}"
        why="${why#"${why%%[! ]*}"}"
        if grep -qx "CONFIG_${sym}=y" "${cfg}"; then
            pass "${board}: CONFIG_${sym}=y (${why})"
        else
            have="$(grep -E "^(CONFIG_${sym}=.*|# CONFIG_${sym} is not set)$" "${cfg}" || true)"
            fail "CONFIG_${sym} is not =y in ${cfg#"${REPO_ROOT}/"} (found: ${have:-nothing}). netavark needs it: ${why}"
        fi
    done <<<"${REQUIRED}"
done
[ "${BOARDS_CHECKED}" -ge 2 ] || {
    echo "error: only ${BOARDS_CHECKED} board config(s) were read; both shipped boards build a kernel." >&2
    exit 1
}

echo
echo "--- 2. each symbol is re-asserted after olddefconfig, on every board"
# The committed configs are inputs. This is the only check that survives
# olddefconfig deciding a symbol's dependencies are unmet and dropping it.
#
# TWO WAYS TO BE GATED, and they are equally binding. A board Dockerfile's own
# `for option in` loop names board facts; boards/common/mos-required.fragment
# names engine facts, and EVERY board Dockerfile greps every `=y` line of it
# against the final .config. So a symbol in the fragment is gated on every
# board at once, which is where these symbols live since PLAN-074 -- and the
# check below requires the fragment's own enforcement to exist in each
# Dockerfile before it accepts that route.
FRAGMENT_SYMS="$(sed -n 's/^CONFIG_\([A-Z0-9_]*\)=y$/\1/p' "${FRAGMENT}")"
[ -n "${FRAGMENT_SYMS}" ] || {
    echo "error: ${FRAGMENT#"${REPO_ROOT}/"} yields no =y symbols, so the fragment route would gate nothing." >&2
    exit 1
}
for row in ${BOARD_DOCKERFILES}; do
    board="${row%%:*}"
    dockerfile="${REPO_ROOT}/${row#*:}"
    [ -f "${dockerfile}" ] || {
        echo "error: ${row#*:} does not exist, so ${board}'s post-olddefconfig gate would be read from nothing." >&2
        exit 1
    }
    # The fragment loop itself: `for line in $(sed ... /mos-required.fragment)`
    # followed by a grep of the final .config. Without it, membership in the
    # fragment gates nothing on this board and the route below would be a
    # claim about a loop that is not there.
    grep -q 'mos-required.fragment' "${dockerfile}" || {
        echo "error: ${row#*:} does not read /mos-required.fragment, so the shared floor is not enforced on ${board}." >&2
        exit 1
    }
    LOOP="$(awk '/for option in/ {f = 1} f {print} f && /; do/ {exit}' "${dockerfile}")"
    for sym in "${SYMBOLS[@]}"; do
        if grep -qw "${sym}" <<<"${LOOP}"; then
            pass "${board}: the built config is gated on CONFIG_${sym}=y by the board loop"
        elif grep -qx "${sym}" <<<"${FRAGMENT_SYMS}"; then
            pass "${board}: the built config is gated on CONFIG_${sym}=y by the shared fragment"
        else
            fail "neither ${row#*:}'s post-olddefconfig loop nor boards/common/mos-required.fragment names ${sym}, so olddefconfig could drop it on ${board} and the image would still build"
        fi
    done
done

echo
echo "--- 3. the citations point at the netavark this tree ships"
pinned="$(sed -n 's/^NETAVARK_VERSION=\(.*\)$/\1/p' "${VERSIONS_ENV}")"
if [ "${pinned}" = "${CITED_NETAVARK}" ]; then
    pass "pkgs/podman/versions.env still pins netavark ${CITED_NETAVARK}"
else
    fail "versions.env pins netavark ${pinned:-nothing}, but the citations above were read from ${CITED_NETAVARK}. Re-read src/firewall/nft.rs at the new tag and move the list and CITED_NETAVARK together."
fi

echo
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${PASS_N} assertions)"
else
    echo "RESULT: FAIL (${FAIL_N} of $((PASS_N + FAIL_N)) assertions failed)"
    exit 1
fi
