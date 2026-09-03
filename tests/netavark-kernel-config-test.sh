#!/usr/bin/env bash
# The kernel symbols netavark needs, asserted against the cx3576 board config.
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
# WHAT IS PROVED HERE, AND WHAT IS NOT. This reads the COMMITTED config, which
# is the build input, not its output. `make olddefconfig` runs after it and can
# still drop a symbol whose dependencies are unmet -- silently, because a
# dropped symbol simply is not in the output. That direction is proved by the
# `for option in ...` loop in boards/cx3576/bsp/kernel/Dockerfile, which greps
# the config AFTER olddefconfig and fails the image build. Assertion 2 below
# therefore requires that loop to name every symbol in this list: two lists free
# to disagree are one list that is not enforced, and the built config is the
# only one the hardware ever sees.
#
# x64 is out of scope. It runs Debian's kernel, where these are modules the
# distribution already ships; nothing in this tree chooses its .config.
#
# WHERE THE LIST COMES FROM. Every entry cites a line of netavark that programs
# the rule needing it, read from the tag pkgs/podman/versions.env pins.
# Assertion 3 requires that pin to still be the version the citations were read
# against -- a citation into a version nobody ships is decoration.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
CONFIG="${REPO_ROOT}/boards/cx3576/bsp/kernel/config/kernel-cx3576z.config"
DOCKERFILE="${REPO_ROOT}/boards/cx3576/bsp/kernel/Dockerfile"
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

for f in "${CONFIG}" "${DOCKERFILE}" "${VERSIONS_ENV}"; do
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

echo "--- 1. every symbol is =y in the committed cx3576 config"
# =y and not =m: boards/common/mos-required.fragment states the rule -- a
# dm-verity root with no initramfs cannot load a module before the rootfs is up,
# and the board Dockerfile's own loop greps for =y for the same reason.
while IFS= read -r line; do
    [ -n "${line}" ] || continue
    sym="${line%% *}"
    why="${line#"${sym}"}"
    why="${why#"${why%%[! ]*}"}"
    if grep -qx "CONFIG_${sym}=y" "${CONFIG}"; then
        pass "CONFIG_${sym}=y (${why})"
    else
        have="$(grep -E "^(CONFIG_${sym}=.*|# CONFIG_${sym} is not set)$" "${CONFIG}" || true)"
        fail "CONFIG_${sym} is not =y in ${CONFIG#"${REPO_ROOT}/"} (found: ${have:-nothing}). netavark needs it: ${why}"
    fi
done <<<"${REQUIRED}"

echo
echo "--- 2. the board Dockerfile re-asserts each one after olddefconfig"
# The committed config is the input. This is the only check that survives
# olddefconfig deciding a symbol's dependencies are unmet and dropping it.
LOOP="$(awk '/for option in/ {f = 1} f {print} f && /; do/ {exit}' "${DOCKERFILE}")"
grep -c 'for option in' <<<"${LOOP}" >/dev/null || {
    echo "error: no \`for option in\` loop found in ${DOCKERFILE}." >&2
    echo "       That loop is what assertion 2 reads; without it this check compares nothing." >&2
    exit 1
}
for sym in "${SYMBOLS[@]}"; do
    if grep -qw "${sym}" <<<"${LOOP}"; then
        pass "the built config is gated on CONFIG_${sym}=y too"
    else
        fail "${DOCKERFILE#"${REPO_ROOT}/"} does not name ${sym} in its post-olddefconfig loop, so olddefconfig could drop it and the image would still build"
    fi
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
echo "--- 4. the shared floor and this list do not disagree about a symbol"
# Since the eBPF/firewall floor landed, boards/common/mos-required.fragment
# pins most of the list above =y for EVERY board. Two floors naming the same
# symbol are only safe while they agree: if the fragment ever stated one of
# these as =m or "is not set", cx3576 would still be green here -- the board
# Dockerfile's own loop covers it -- while every other board silently got the
# weaker answer. So each symbol the fragment mentions at all must be pinned
# there as =y. Symbols the fragment does not mention are this file's alone and
# are skipped, which is why the overlap is counted rather than assumed.
FRAGMENT="${REPO_ROOT}/boards/common/mos-required.fragment"
[ -f "${FRAGMENT}" ] || {
    echo "error: ${FRAGMENT} not found; assertion 4 has nothing to compare against" >&2
    exit 1
}
OVERLAP_N=0
for sym in "${SYMBOLS[@]}"; do
    stated="$(grep -E "^(CONFIG_${sym}=.*|# CONFIG_${sym} is not set)$" "${FRAGMENT}" || true)"
    [ -n "${stated}" ] || continue
    OVERLAP_N=$((OVERLAP_N + 1))
    if [ "${stated}" = "CONFIG_${sym}=y" ]; then
        pass "the shared fragment pins CONFIG_${sym}=y too"
    else
        fail "the shared fragment states CONFIG_${sym} as '${stated}', not =y. Every board merges that file, so a weaker statement there is a weaker floor everywhere except the board whose Dockerfile happens to re-assert it"
    fi
done
# The loop above is silent when the overlap is empty, and an empty overlap is
# exactly what a moved or emptied fragment looks like from here.
if [ "${OVERLAP_N}" -ge 15 ]; then
    pass "the two floors overlap on ${OVERLAP_N} symbols"
else
    fail "only ${OVERLAP_N} of the ${#SYMBOLS[@]} symbols above are stated in ${FRAGMENT#"${REPO_ROOT}/"}; 15 were when this assertion was written. Shrinking the overlap is allowed, but not by accident -- move this floor with it"
fi

echo
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${PASS_N} assertions)"
else
    echo "RESULT: FAIL (${FAIL_N} of $((PASS_N + FAIL_N)) assertions failed)"
    exit 1
fi
