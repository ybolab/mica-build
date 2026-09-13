#!/usr/bin/env bash
# The INSTALL-time gates of PLAN-036 section 6, over the built pools.
#
#   bash tests/install-closure-gate.sh
#
#   reads   _out/debs/<arch>/{pool/*.deb,Packages}   (built by `make os-debs`)
#           rootfs/packages/resolve.sh            (the package set per board)
#   builds  clean roots from the digest-pinned Debian base, per architecture,
#           and asserts what only an INSTALLED root can answer
#
# build-env/deb/package-gate.sh says in its own header that it does not do this:
# it reads archives with dpkg-deb and never installs one. Everything an archive
# cannot answer lives here -- whether APT can satisfy the closure at all,
# whether a wants-symlink points at a unit some package actually ships, whether
# an ELF finds its libraries, whether the accounts the units name exist, and
# what the self-built binaries report when they are asked.
#
# WHAT IS CHECKED
#
#   1  CLEAN-ROOT INSTALL, PER ARCHITECTURE. The package set comes from
#      rootfs/packages/resolve.sh, for the board that declares this pool's
#      MOS_ARCH -- not from a list here, which would be a second manifest set
#      agreeing with the first until either is edited. Then, inside that root:
#      `apt-get check` and `dpkg --audit` clean; every payload path present;
#      every wants-symlink resolving to a unit file that is also payload; every
#      `User=`/`Group=` a shipped unit names resolving in the root's passwd and
#      group databases; `ldd` over every dynamically linked ELF in the payload
#      with no unresolved soname; and each self-built component asked for its
#      version.
#
#   2  THE SAME MANIFEST WITH `mqtt` DECLINED. Install the reduced package set
#      in a separate clean root and repeat the ELF closure checks. Require the
#      MQTT payload to be absent and report the package delta and ELF count.
#      Other components must declare their own dependencies without relying on
#      an optional feature to bring them in.
#
#   3  BOTH ARCHITECTURES. arm64 is the half nothing had ever apt-installed. It
#      runs under the emulated buildkit executor, because this host has no
#      binfmt registration -- the same route mica-podman:build.sh and
#      build-env/deb/build.sh take, and the one verify's smoke runner
#      calls "the emulated buildkit route" when it reports `executor-limited`.
#      That verdict is REUSED here rather than a second vocabulary invented for
#      it: a component may be excused only under emulation, only against a
#      signature this file declares for it by name, and only when the observed
#      status AND stderr match that signature. Anything else is a FAIL, and on
#      the native route the same failure stays a FAIL.
#
#   4  THE RADIO PACKAGES, SEPARATELY. mica-wifi, mica-wifi-ap and mica-bluetooth
#      each go into their OWN clean root -- three installs, not one with three
#      names, because the claim under test is that they are independent. Their
#      non-directory payloads must be disjoint, no root may end up holding
#      another radio package, and `rfkill` must be declared and installed in all
#      three. Whether the other two were AVAILABLE is asserted first: a root
#      that could not have pulled them proves nothing about whether it would
#      have.
#
#   5  THE APT EXPERIMENT behind PLAN-036 decision (g). `micad` declares
#      `Depends: mica-profile`, a virtual name that mica-profile-dev and
#      mica-profile-prod both Provide and that they Conflict over. What APT does
#      when that dependency is UNSATISFIABLE, and what it does when TWO mutually
#      conflicting packages offer it, are OBSERVATIONS and not assertions: the
#      ruling assumed a behaviour nobody had run. This gate records the
#      transcript and the exit status verbatim and judges neither. What it does
#      assert is that the experiment had material -- that the micad archive
#      really names mica-profile, that the "neither" root really offers neither
#      provider and the "both" root really offers both. Without those three the
#      transcript is a recording of nothing.
#
# THE HOST JUDGES, THE CONTAINER MEASURES. Every stage writes a report and is
# not allowed to fail its build: a stage that died would take its report with
# it, and a missing report is indistinguishable from a clean one. Each report
# ends in a terminator line this script requires, so one that stops mid-sentence
# is a failure rather than a short pass.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
FROM_SH="${REPO_ROOT}/build-env/from.sh"
RESOLVE_SH="${REPO_ROOT}/rootfs/packages/resolve.sh"
VERSION_SH="${REPO_ROOT}/build-env/deb/version.sh"
PODMAN_VERSIONS="${REPO_ROOT}/deps/packages/mica-podman.versions.env"
DIST="${REPO_ROOT}/_out/debs"
for p in "${FROM_SH}" "${VERSION_SH}" "${PODMAN_VERSIONS}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. This gate derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done
# resolve.sh is named on its own because its absence needs a different message.
# It decides WHAT is installed, and this gate deliberately has no fallback set:
# a board set written here would be a second manifest set, and a clean install
# of a subset is a green report over the packages it chose for itself.
[ -e "${RESOLVE_SH}" ] || {
    echo "error: ${RESOLVE_SH} does not exist, so there is no package set to install. It is the only authority on what a board's rootfs contains, and this gate carries no list of its own: one here would be a second manifest set, and installing a subset of the real one would report a green closure over whatever it happened to name" >&2
    exit 1
}

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. The roots are built with buildx, which is also the only route to an arm64 root on a host with no binfmt registration" >&2
    exit 1
}

# The two pools, written here rather than discovered under _out/debs, for
# build-env/deb/package-gate.sh's reason: a discovered list turns a pool that was
# never built into a gate that checks one architecture and reports green.
ARCHES=(amd64 arm64)
for arch in "${ARCHES[@]}"; do
    for f in "${DIST}/${arch}/pool" "${DIST}/${arch}/Packages"; do
        [ -e "${f}" ] || {
            echo "error: ${f} does not exist, so there is nothing to install for ${arch}. Build and index both pools with \`make os-debs\`; a gate that skipped the missing architecture would report on half a pool, and arm64 is the half nothing had ever apt-installed" >&2
            exit 1
        }
    done
done

case "$(uname -m)" in
x86_64) HOST_ARCH=amd64 ;;
aarch64 | arm64) HOST_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture build-env/images.env pins a base image for" >&2
    exit 1
    ;;
esac

# The base, resolved from images.env by key exactly as tests/quadlet-doc-test.sh
# resolves it. mapfile cannot fail, so an empty array is what a refusal looks
# like from here -- and an empty array would build with no FROM at all.
mapfile -t BASE_ARGS < <(bash "${FROM_SH}" MOS_BASE=IMAGE_DEBIAN_TRIXIE)
[ "${#BASE_ARGS[@]}" -eq 2 ] || {
    echo "error: build-env/from.sh did not yield IMAGE_DEBIAN_TRIXIE (see its message above); every root below would have been built from an empty FROM" >&2
    exit 1
}

WORK="${REPO_ROOT}/tmp/install-closure-gate"
rm -rf "${WORK}"
mkdir -p "${WORK}"

# ---------------------------------------------------------------- the pins
#
# What each self-built binary must report, read from the file that owns the
# number and from nowhere else. verify/src/smoke-pins.ts says why at length:
# a version written down twice is a version that stops matching the binary the
# first time one copy moves.
#
# The four Rust binaries take theirs from build-env/deb/version.sh, which is
# this tree's one reader of the crate manifests and already refuses a workspace
# whose crates disagree. Its output is <crate version>+git<commit>-1, so the
# crate version is the part before the `+`; splitting that is one rule about one
# format, where a second sed over Cargo.toml would be a second parser for the
# manifests.
POOL_VERSION="$(bash "${VERSION_SH}")"
CRATE_VERSION="${POOL_VERSION%%+*}"
# The version an imported package's pin records, with the pool stamp cut off:
# what the crate that built the binary carries, and so what it reports.
pinned_version() {
    python3 -c 'import json,re,sys; v={t["version"] for t in json.load(open(sys.argv[1]))["targets"].values()}; assert len(v)==1, v; print(re.sub(r"\+git[0-9a-f]{12}(\.dirty)?-\d+$", "", v.pop()))' "${REPO_ROOT}/deps/packages/$1.json"
}
case "${CRATE_VERSION}" in
[0-9]*.[0-9]*.[0-9]*) ;;
*)
    echo "error: build-env/deb/version.sh printed '${POOL_VERSION}', whose part before the '+' is '${CRATE_VERSION}' and is not <major>.<minor>.<patch>. That prefix is the version the four Rust binaries must report; an unrecognised shape would be compared against every --version output and match none of them" >&2
    exit 1
    ;;
esac

# A leading `v` immediately followed by a digit is what a git TAG carries and a
# --version output does not. The rule, and the reason it is applied on the PIN
# side once rather than per binary, are verify/src/smoke-pins.ts's.
pin() {
    local file="$1" key="$2" v
    v="$(sed -n "s/^${key}=//p" "${file}" | head -n1)"
    [ -n "${v}" ] || {
        echo "error: ${file} declares no non-empty ${key}. That value is what the binary is required to report; an empty expectation is not a weaker check but a different one, matched by nothing and failing for a reason nobody can act on" >&2
        exit 1
    }
    case "${v}" in
    v[0-9]*) printf '%s\n' "${v#v}" ;;
    *) printf '%s\n' "${v}" ;;
    esac
}

# name  path  expected  pin-origin  emulated-only-status  emulated-only-stderr
#
# The installed paths are the ones verify/src/smoke-register.ts measured, and
# five of the seven container binaries are not in /usr/bin: a wrong path here
# fails as "no such file" rather than passing quietly. `-` in the last two
# columns means the component declares no executor limit and can therefore only
# pass or fail, under emulation exactly as natively.
COMPONENTS="${WORK}/components.tsv"
{
    printf 'micad\t/usr/bin/micad\t%s\tdeps/packages/micad.json\t-\t-\n' "$(pinned_version micad)"
    printf 'apid\t/usr/bin/apid\t%s\tdeps/packages/mica-apid.json\t-\t-\n' "$(pinned_version mica-apid)"
    printf 'mica-mqttd\t/usr/bin/mica-mqttd\t%s\tdeps/packages/mica-mqttd.json\t-\t-\n' "$(pinned_version mica-mqttd)"
    printf 'mica-mqtt-broker\t/usr/bin/mica-mqtt-broker\t%s\tdeps/packages/mica-mqtt-broker.json\t-\t-\n' "$(pinned_version mica-mqtt-broker)"
    # Imported through the lock: the pin's archive version, with the pool's
    # git stamp cut off, is what the binary reports.
    printf 'mica-deploy\t/usr/bin/mica-deploy\t%s\tdeps/packages/mica-deploy.json\t-\t-\n' "$(pinned_version mica-deploy)"
    printf 'podman\t/usr/bin/podman\t%s\tPODMAN_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" PODMAN_VERSION)"
    printf 'quadlet\t/usr/libexec/podman/quadlet\t%s\tPODMAN_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" PODMAN_VERSION)"
    # crun 1.29.1 re-executes libcrun out of a memory file descriptor -- its
    # CVE-2024-21626 mitigation -- before it parses argv, and qemu-user cannot
    # service that fexecve. Declared as ONE entry with ONE status and ONE stderr
    # substring rather than as a pattern every component is measured against,
    # for verify/src/smoke-register.ts's reason: an entry that declares
    # nothing can never be excused, so the category cannot spread to a binary
    # nobody measured.
    printf 'crun\t/usr/bin/crun\t%s\tCRUN_VERSION\t1\tFailed to re-execute libcrun via memory file descriptor\n' "$(pin "${PODMAN_VERSIONS}" CRUN_VERSION)"
    printf 'conmon\t/usr/libexec/podman/conmon\t%s\tCONMON_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" CONMON_VERSION)"
    printf 'netavark\t/usr/libexec/podman/netavark\t%s\tNETAVARK_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" NETAVARK_VERSION)"
    printf 'aardvark-dns\t/usr/libexec/podman/aardvark-dns\t%s\tAARDVARK_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" AARDVARK_VERSION)"
    printf 'catatonit\t/usr/libexec/podman/catatonit\t%s\tCATATONIT_VERSION\t-\t-\n' "$(pin "${PODMAN_VERSIONS}" CATATONIT_VERSION)"
} >"${COMPONENTS}"

# The direction that catches a component nobody asked about. The rows above name
# the binaries; the two versions.env files name the pins the tree actually
# carries, and every one of those has to be claimed by at least one row. Without
# it, adding an eighth binary under mica-podman: -- with its pin, its hash and
# its install line -- would leave this gate reporting a full green over seven of
# eight, which is the drift verify/src/smoke-pins.ts exists to refuse in its
# own register.
UNCLAIMED=""
PINS_N=0
for f in "${PODMAN_VERSIONS}"; do
    while read -r key; do
        [ -n "${key}" ] || continue
        PINS_N=$((PINS_N + 1))
        awk -F'\t' -v k="${key}" '$4 == k { found = 1 } END { exit !found }' "${COMPONENTS}" ||
            UNCLAIMED="${UNCLAIMED} ${key}"
    done < <(sed -n 's/^\([A-Z0-9_]*_VERSION\)=.*/\1/p' "${f}")
done
[ "${PINS_N}" -gt 0 ] || {
    echo "error: ${PODMAN_VERSIONS} declare no *_VERSION pin at all, so the coverage check compared the component rows against an empty set and would have accepted any of them" >&2
    exit 1
}
[ -z "${UNCLAIMED}" ] || {
    echo "error: ${PINS_N} version pin(s) were read out of the two versions.env files and no component row claims:${UNCLAIMED}. A pin nothing claims is a binary this gate installs and never asks, so its version goes unchecked while the RESULT line stays green" >&2
    exit 1
}
echo "install-closure-gate: ${PINS_N} upstream version pin(s) claimed by $(grep -c . "${COMPONENTS}") component row(s); the four Rust binaries expect ${CRATE_VERSION} from ${POOL_VERSION}"

# ------------------------------------------------------- the in-root scripts
#
# Staged into the build context rather than inlined into the Dockerfile: they
# are shell, and a RUN carrying three hundred lines of it is a Dockerfile whose
# diffs nobody can read.
IN="${WORK}/in"
mkdir -p "${IN}"
cp "${COMPONENTS}" "${IN}/components.tsv"

cat >"${IN}/lib.sh" <<'LIB'
# Shared by every in-root script: the counters, the ELF classification, and the
# ldd sweep. The sweep is a FUNCTION and not two copies because two roots run it
# -- the full resolution and the one with `mqtt` declined -- and the whole value
# of the second is that it is the same sweep over a different root.
PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

# The ELF header's magic and its e_type, read once per file.
#
# e_type is what decides whether `ldd` means anything. ET_EXEC (2) and ET_DYN
# (3) are loaded by the dynamic linker and have sonames to resolve; ET_REL (1)
# is an object the kernel links itself -- every .ko in mica-board-cx3576 is one,
# and `ldd` over those would be thousands of meaningless invocations. Read out
# of the header rather than guessed from the path or the mode bit, so a module
# that arrived somewhere unexpected is still classified by what it is.
elf_type() {
    local hdr
    hdr="$(od -An -tx1 -N18 -- "$1" 2>/dev/null | tr -d ' \n')"
    case "${hdr}" in
    7f454c46*) ;;
    *) echo notelf; return ;;
    esac
    # Bytes 16 and 17, little-endian on both architectures this tree builds.
    case "${hdr:32:4}" in
    0100) echo rel ;;
    0200) echo exec ;;
    0300) echo dyn ;;
    *) echo other ;;
    esac
}

# dpkg's own record of what each named package shipped, so a package that gained
# or lost a file is covered without this script being edited.
collect_payload_paths() {
    local out="$1" p
    shift
    : >"${out}"
    for p in "$@"; do
        dpkg -L "${p}" 2>/dev/null >>"${out}" || true
    done
}

# ldd over every dynamically linked object a payload path names. Sets ELF_N,
# LDD_N and REL_N for the caller's COUNT lines; a zero is a hard failure, since
# "no unresolved soname" over no binaries is the report this gate exists to
# refuse.
ldd_sweep() {
    local paths_file="$1" label="$2" path out unresolved=""
    ELF_N=0
    LDD_N=0
    REL_N=0
    while IFS= read -r path; do
        [ -f "${path}" ] || continue
        case "$(elf_type "${path}")" in
        notelf) continue ;;
        rel)
            ELF_N=$((ELF_N + 1))
            REL_N=$((REL_N + 1))
            continue
            ;;
        *) ELF_N=$((ELF_N + 1)) ;;
        esac
        LDD_N=$((LDD_N + 1))
        out="$(ldd "${path}" 2>&1 || true)"
        case "${out}" in
        *"not found"*)
            unresolved="${unresolved} ${path}[$(printf '%s\n' "${out}" | awk '/not found/ { printf "%s ", $1 }')]"
            ;;
        esac
    done <"${paths_file}"
    echo "install-closure: ${label}: ${ELF_N} ELF file(s) in the payload; ${LDD_N} loaded by the dynamic linker and examined with ldd; ${REL_N} ET_REL objects (kernel modules) not examined"
    if [ "${LDD_N}" -eq 0 ]; then
        fail "${label}: ldd examined ZERO objects. That is not 'everything linked', it is 'no binary was found', and a report of no unresolved sonames over no binaries is the exact shape this gate exists to refuse"
    elif [ -z "${unresolved}" ]; then
        pass "${label}: ldd over ${LDD_N} dynamically linked payload object(s) reports no unresolved soname"
    else
        fail "${label}: unresolved soname(s) in the installed root:${unresolved}"
    fi
}

# Every package the root holds, mos and Debian alike, for the host to diff one
# root's against another's. Written out rather than summarised: which packages a
# declined feature took with it is the fact, and a count of them is not.
dump_pkgdb() {
    dpkg-query -W -f='PKGDB: ${Package} ${Version}\n' 2>/dev/null | sort || true
}
LIB

cat >"${IN}/assert-full.sh" <<'FULL'
#!/bin/bash
# The clean-root install, and everything only an installed root can answer.
# Never exits non-zero: the host judges the report, and a stage that died would
# take its report with it.
set -uo pipefail
. /in/lib.sh

PKGS="$(tr '\n' ' ' </in/packages.txt)"
PKG_N="$(grep -c . /in/packages.txt || true)"
echo "install-closure: installing ${PKG_N} package(s) from the local pool: ${PKGS}"

apt-get update >/tmp/update.log 2>&1 || { fail "apt-get update failed"; tail -n 20 /tmp/update.log; }

# The whole set in ONE transaction, which is the question being asked: whether
# APT can satisfy the closure of what a board resolves to. Installing them one
# at a time would answer a weaker question and would hide a conflict between two
# members of the same set.
install_status=0
apt-get install -y --no-install-recommends ${PKGS} >/tmp/install.log 2>&1 || install_status=$?
echo "install-closure: apt-get install exited ${install_status}"
if [ "${install_status}" -eq 0 ]; then
    pass "apt-get install resolved and configured the ${PKG_N}-package set in one transaction"
else
    fail "apt-get install exited ${install_status} over the resolved ${PKG_N}-package set"
fi
tail -n 40 /tmp/install.log

if apt-get check >/tmp/check.log 2>&1; then
    pass "apt-get check reports no broken dependency in the installed root"
else
    fail "apt-get check failed: $(tail -n 5 /tmp/check.log | tr '\n' ' ')"
fi
audit="$(dpkg --audit 2>&1)"
if [ -z "${audit}" ]; then
    pass "dpkg --audit reports nothing: no package is unpacked-but-unconfigured"
else
    fail "dpkg --audit reports: $(printf '%s' "${audit}" | tr '\n' ' ')"
fi

# --- every resolved package installed and configured
INSTALLED_N=0
for p in ${PKGS}; do
    st="$(dpkg-query -W -f='${Status} ${Version}' "${p}" 2>/dev/null || true)"
    case "${st}" in
    "install ok installed "*) INSTALLED_N=$((INSTALLED_N + 1)) ;;
    *) fail "${p} is not installed and configured: dpkg-query says '${st:-nothing at all}'" ;;
    esac
done
if [ "${PKG_N}" -gt 0 ] && [ "${INSTALLED_N}" -eq "${PKG_N}" ]; then
    pass "all ${INSTALLED_N} resolved packages are 'install ok installed'"
fi
[ "${PKG_N}" -gt 0 ] ||
    fail "the resolver named NO package, so this root is plain Debian and every assertion below is over nothing"

# --- the payload paths
#
# Derived from dpkg's own record of what each package shipped, so a package that
# gained or lost a file is covered without this script being edited. Directories
# are counted apart: a shared directory is not a promise either package made
# alone, which is the distinction build-env/deb/package-gate.sh's ownership rule
# draws for the same reason.
PATHS_N=0
DIRS_N=0
MISSING=""
UNITS_N=0
WANTS_N=0
WANTS_BAD=""
ALL_PATHS=/tmp/all-paths.txt
collect_payload_paths "${ALL_PATHS}" ${PKGS}
while IFS= read -r path; do
    case "${path}" in /*) ;; *) continue ;; esac
    if [ -L "${path}" ]; then
        :
    elif [ -d "${path}" ]; then
        DIRS_N=$((DIRS_N + 1))
        continue
    elif [ ! -e "${path}" ]; then
        MISSING="${MISSING} ${path}"
        continue
    fi
    PATHS_N=$((PATHS_N + 1))
    case "${path}" in
    */systemd/system/*.wants/*)
        WANTS_N=$((WANTS_N + 1))
        # The link has to land on a unit FILE, and the resolution happens in the
        # INSTALLED root: no archive can say whether the unit its wants-link
        # names was shipped by anybody at all. A dangling one is a service
        # systemd will not start and nothing else in this tree would notice.
        [ -f "${path}" ] || WANTS_BAD="${WANTS_BAD} ${path}"
        ;;
    */systemd/system/*.service | */systemd/system/*.mount | */systemd/system/*.target | */systemd/system/*.socket | */systemd/system/*.timer)
        UNITS_N=$((UNITS_N + 1))
        ;;
    esac
done <"${ALL_PATHS}"
echo "install-closure: ${PATHS_N} non-directory payload path(s) and ${DIRS_N} directory entr(ies) over ${PKG_N} package(s)"
if [ "${PATHS_N}" -eq 0 ]; then
    fail "dpkg -L over ${PKG_N} installed package(s) listed NO non-directory path, so the existence check examined nothing"
elif [ -z "${MISSING}" ]; then
    pass "all ${PATHS_N} non-directory payload paths are present in the installed root"
else
    fail "payload path(s) dpkg records and the root does not have:${MISSING}"
fi
echo "install-closure: ${UNITS_N} unit path(s) and ${WANTS_N} wants-symlink(s) in the payload"
if [ "${WANTS_N}" -eq 0 ]; then
    fail "the payload carries NO wants-symlink at all, so the resolution check examined nothing. Enablement in this tree is package-owned symlink payload, and a set carrying none of it is a set nothing starts"
elif [ -z "${WANTS_BAD}" ]; then
    pass "all ${WANTS_N} wants-symlinks resolve to a unit file present in the root"
else
    fail "wants-symlink(s) that do not resolve to a unit file:${WANTS_BAD}"
fi

# --- enablement in the root that no package payload put there
#
# This tree's rule is that enablement IS package-owned symlink payload: no
# composer, script or maintainer script calls `systemctl enable`, and each
# producer declares its multi-user.target count in ENABLEMENT. A DEBIAN
# package's postinst does not know that rule -- openssh-server leaves its
# [Install] symlink behind, and the composed x64 root ships ssh.service enabled
# where the chain image does not.
#
# Only an installed root can see it. The symlink is in nobody's archive, so
# build-env/deb/package-gate.sh's per-package ENABLEMENT count is correct and
# blind to it at the same time. Reported by name and NOT failed: the mos rule
# governs mos producers, and what an upstream Debian maintainer script does with
# its own unit is a fact for the composer workstream to rule on rather than one
# this gate should decide by going red.
# The classification is PAYLOAD versus NOT, asked of dpkg about the LINK itself
# -- not about the unit it points at. A .wants symlink that some package's file
# list claims was shipped, whoever shipped it: systemd's own
# sockets.target.wants links are payload exactly as mos's multi-user.target.wants
# links are. One that NO package's file list claims was written by a maintainer
# script, and that is the whole category. Classifying by the TARGET's owner
# instead would put all seventy of Debian's vendor-shipped links in the finding
# and bury the one that matters.
#
# One pass over every installed package's file list rather than a `dpkg -S` per
# link: a hundred forks under the emulated executor is minutes, and this answers
# the same question once.
OWNED_WANTS=/tmp/owned-wants.txt
dpkg-query -Wf='${binary:Package}\n' 2>/dev/null | xargs -r dpkg -L 2>/dev/null |
    grep -F '.wants/' | LC_ALL=C sort -u >"${OWNED_WANTS}" || true
OWNED_WANTS_N="$(grep -c . "${OWNED_WANTS}" || true)"
[ "${OWNED_WANTS_N}" -gt 0 ] ||
    fail "no installed package's file list names a single .wants path, so the classification below would call every symlink in the root undeclared"

ROOT_WANTS_N=0
UNDECLARED_N=0
for d in /etc/systemd/system/*.wants /usr/lib/systemd/system/*.wants; do
    [ -d "${d}" ] || continue
    for link in "${d}"/*; do
        { [ -e "${link}" ] || [ -L "${link}" ]; } || continue
        ROOT_WANTS_N=$((ROOT_WANTS_N + 1))
        grep -Fxc -- "${link}" "${OWNED_WANTS}" >/dev/null && continue
        UNDECLARED_N=$((UNDECLARED_N + 1))
        target="$(readlink "${link}" 2>/dev/null || echo '(not a symlink)')"
        owner="$(dpkg -S "$(readlink -f "${link}" 2>/dev/null)" 2>/dev/null | cut -d: -f1 | head -n1)"
        echo "UNDECLARED-ENABLEMENT: ${link} -> ${target}, in no package's file list; the unit it enables belongs to ${owner:-no package at all}, so a maintainer script wrote this link"
    done
done
echo "install-closure: ${ROOT_WANTS_N} .wants symlink(s) present in the installed root, ${OWNED_WANTS_N} claimed by some package's file list (${WANTS_N} of them mos payload), ${UNDECLARED_N} written by a maintainer script"
if [ "${ROOT_WANTS_N}" -eq 0 ]; then
    fail "the installed root holds NO .wants symlink at all, so this enumeration examined nothing -- not even the base system's"
elif [ "${UNDECLARED_N}" -eq 0 ]; then
    pass "every one of the ${ROOT_WANTS_N} .wants symlinks in the root is some package's payload; no maintainer script enabled a unit"
fi

# --- the accounts the units name
#
# Derived from the units themselves rather than from a list of names: a `User=`
# in a shipped unit IS the promise, and it is the one that fails at boot with
# "Failed to determine user credentials" when the package that owns the account
# did not create it.
ACCOUNTS_N=0
ACCOUNTS_BAD=""
SEEN=" "
while IFS= read -r unit; do
    [ -f "${unit}" ] || continue
    while IFS= read -r line; do
        kind="${line%%=*}"
        who="${line#*=}"
        [ -n "${who}" ] || continue
        case "${SEEN}" in *" ${kind}:${who} "*) continue ;; esac
        SEEN="${SEEN}${kind}:${who} "
        ACCOUNTS_N=$((ACCOUNTS_N + 1))
        case "${kind}" in
        User) getent passwd "${who}" >/dev/null 2>&1 || ACCOUNTS_BAD="${ACCOUNTS_BAD} ${unit}:User=${who}" ;;
        Group) getent group "${who}" >/dev/null 2>&1 || ACCOUNTS_BAD="${ACCOUNTS_BAD} ${unit}:Group=${who}" ;;
        esac
    done < <(grep -hE '^(User|Group)=' "${unit}" 2>/dev/null || true)
done < <(grep -E '/systemd/system/[^/]*\.(service|socket|mount)$' "${ALL_PATHS}" | sort -u)
echo "install-closure: ${ACCOUNTS_N} distinct User=/Group= declaration(s) in the shipped units"
if [ "${ACCOUNTS_N}" -eq 0 ]; then
    fail "no shipped unit names a User= or Group= at all, so the account check examined nothing"
elif [ -z "${ACCOUNTS_BAD}" ]; then
    pass "all ${ACCOUNTS_N} User=/Group= declarations resolve in the installed root's passwd/group databases"
else
    fail "unit account declaration(s) with no matching entry in the installed root:${ACCOUNTS_BAD}"
fi

# --- ldd over the payload. The same sweep the mqtt-declined root runs, which is
# the whole point of it being a function in /in/lib.sh rather than written twice.
ldd_sweep "${ALL_PATHS}" "full resolution"

# --- the version commands
#
# EMULATED comes from the Dockerfile stage: 1 when this root is a foreign
# architecture running under the buildkit executor's emulator. A declared
# executor limit is consulted only then, and only when the status AND the stderr
# both match what that component declared.
COMPONENTS_N=0
LIMITED_N=0
while IFS="$(printf '\t')" read -r name path expected origin lim_status lim_stderr; do
    [ -n "${name}" ] || continue
    [ -e "${path}" ] || continue
    COMPONENTS_N=$((COMPONENTS_N + 1))
    status=0
    "${path}" --version >/tmp/vout 2>/tmp/verr || status=$?
    out="$(cat /tmp/vout /tmp/verr)"
    stderr="$(cat /tmp/verr)"
    said="$(printf '%s' "${out}" | head -n 2 | tr '\n' ' ')"
    # The expected version has to appear as a whole token: a bare substring test
    # would accept 5.8.60 for a pin of 5.8.6, and `catatonit` reports
    # `tini version 0.2.1_catatonit`, where the boundary is an underscore.
    #
    # `grep -c ... >/dev/null` and not `grep -q`: -q on the right of a pipe under
    # pipefail reports the pipeline as failing BECAUSE the pattern matched, which
    # tests/shell-pipefail-lint.sh refuses by name.
    if [ "${status}" -eq 0 ] &&
        printf '%s' "${out}" | grep -cE "(^|[^0-9A-Za-z.])$(printf '%s' "${expected}" | sed 's/\./\\./g')([^0-9A-Za-z.]|\$)" >/dev/null; then
        pass "${name} --version reports ${expected} (${origin}) [said: \"${said}\"]"
        continue
    fi
    excused=0
    if [ "${EMULATED:-0}" = 1 ] && [ "${lim_status}" != "-" ] && [ "${status}" = "${lim_status}" ]; then
        case "${stderr}" in *"${lim_stderr}"*) excused=1 ;; esac
    fi
    if [ "${excused}" -eq 1 ]; then
        LIMITED_N=$((LIMITED_N + 1))
        echo "EXECUTOR-LIMITED: ${name} exited ${status} under the emulated buildkit executor with its declared signature (\"${lim_stderr}\") -- the emulator's limit, not the binary's. The native route holds this entry strict"
        continue
    fi
    fail "${name} --version exited ${status} and did not report ${expected} (${origin}) [said: \"${said}\"]"
done </in/components.tsv
echo "install-closure: ${COMPONENTS_N} self-built component(s) asked for a version, ${LIMITED_N} executor-limited"
[ "${COMPONENTS_N}" -gt 0 ] ||
    fail "no component named in components.tsv is present in this root, so no version was checked at all"

# Every package this root ended up holding, for the host to diff against the
# mqtt-declined root's. What a declined feature TOOK WITH IT is the fact that
# decides whether that root's ldd sweep could have failed at all.
dump_pkgdb

echo "COUNT packages ${INSTALLED_N}"
echo "COUNT paths ${PATHS_N}"
echo "COUNT wants ${WANTS_N}"
echo "COUNT rootwants ${ROOT_WANTS_N}"
echo "COUNT undeclared ${UNDECLARED_N}"
echo "COUNT accounts ${ACCOUNTS_N}"
echo "COUNT ldd ${LDD_N}"
echo "COUNT elfs ${ELF_N}"
echo "COUNT components ${COMPONENTS_N}"
echo "COUNT limited ${LIMITED_N}"
echo "RESULT-FULL: ${PASS_N} pass, ${FAIL_N} fail"
echo "-- end full --"
FULL

cat >"${IN}/assert-declined.sh" <<'DECLINED'
#!/bin/bash
# The SAME manifest with `mqtt` declined, and the same ldd sweep over it.
#
# Check the reduced manifest independently so optional MQTT dependencies cannot
# conceal unresolved libraries in another package.
set -uo pipefail
. /in/lib.sh

PKGS="$(tr '\n' ' ' </in/packages-declined.txt)"
PKG_N="$(grep -c . /in/packages-declined.txt || true)"
echo "install-closure: declined-mqtt: installing ${PKG_N} package(s): ${PKGS}"

apt-get update >/tmp/update.log 2>&1 || { fail "apt-get update failed"; tail -n 20 /tmp/update.log; }

install_status=0
apt-get install -y --no-install-recommends ${PKGS} >/tmp/install.log 2>&1 || install_status=$?
echo "install-closure: declined-mqtt: apt-get install exited ${install_status}"
if [ "${install_status}" -eq 0 ]; then
    pass "declined-mqtt: apt-get install resolved and configured the ${PKG_N}-package set with mqtt declined"
else
    fail "declined-mqtt: apt-get install exited ${install_status}"
    tail -n 40 /tmp/install.log
fi

# mica-mqttd really absent. Without this the sweep below runs over a root that
# still holds the package whose dependencies are the entire question, and it
# could not have failed.
st="$(dpkg-query -W -f='${Status}' mica-mqttd 2>/dev/null || true)"
case "${st}" in
'install ok installed'*) fail "declined-mqtt: mica-mqttd is installed in the root that declined it, so this sweep is over the same closure as the full root and proves nothing about what its dependencies were carrying" ;;
*) pass "declined-mqtt: mica-mqttd is absent, as required by the reduced manifest" ;;
esac

ALL_PATHS=/tmp/all-paths.txt
collect_payload_paths "${ALL_PATHS}" ${PKGS}
PATHS_N="$(grep -c . "${ALL_PATHS}" || true)"
[ "${PATHS_N}" -gt 0 ] ||
    fail "declined-mqtt: dpkg -L over ${PKG_N} package(s) listed no path at all, so the sweep below examined nothing"
ldd_sweep "${ALL_PATHS}" "mqtt declined"

dump_pkgdb

echo "COUNT packages ${PKG_N}"
echo "COUNT ldd ${LDD_N}"
echo "COUNT elfs ${ELF_N}"
echo "RESULT-DECLINED: ${PASS_N} pass, ${FAIL_N} fail"
echo "-- end declined --"
DECLINED

cat >"${IN}/assert-radio.sh" <<'RADIO'
#!/bin/bash
# ONE radio package into a clean root. Three roots, one per package, because the
# claim under test is that they are independent -- a single root holding all
# three would answer a question nobody asked.
set -uo pipefail
. /in/lib.sh

PKG="$1"
OTHERS="$2"

apt-get update >/tmp/update.log 2>&1 || { fail "apt-get update failed"; tail -n 20 /tmp/update.log; }

# That the OTHER radio packages were AVAILABLE, asserted before the install:
# "this root does not hold mica-bluetooth" is worth nothing if mica-bluetooth was
# not installable here in the first place, and that check would then be over a
# pool that could not have failed it.
AVAILABLE_N=0
for o in ${OTHERS}; do
    cand="$(apt-cache policy "${o}" 2>/dev/null | sed -n 's/^  Candidate: //p')"
    case "${cand}" in
    '' | '(none)')
        fail "${o} has no candidate in this root's sources, so '${PKG} did not pull ${o}' would be a statement about an absent package"
        ;;
    *) AVAILABLE_N=$((AVAILABLE_N + 1)) ;;
    esac
done
[ "${AVAILABLE_N}" -ne 2 ] ||
    pass "${PKG}: both other radio packages (${OTHERS}) were available and could have been pulled"

status=0
apt-get install -y --no-install-recommends "${PKG}" >/tmp/install.log 2>&1 || status=$?
if [ "${status}" -eq 0 ]; then
    pass "${PKG} installs on its own into a clean root"
else
    fail "${PKG} alone did not install: exit ${status}"
    tail -n 30 /tmp/install.log
fi

for o in ${OTHERS}; do
    # Captured and matched with `case`, never `dpkg-query | grep -q`: -q closes
    # the pipe at its first match and pipefail then reports the pipeline as
    # having FAILED because the pattern was found. tests/shell-pipefail-lint.sh
    # refuses that shape by name.
    st="$(dpkg-query -W -f='${Status}' "${o}" 2>/dev/null || true)"
    case "${st}" in
    'install ok installed'*) fail "${PKG} pulled ${o} into its root; the three radio packages are meant to be independent" ;;
    *) pass "${PKG} did not pull ${o}" ;;
    esac
done

# rfkill, the shared dependency, in both halves: the installed package declares
# it, and the transaction actually resolved it.
deps="$(dpkg-query -W -f='${Depends}' "${PKG}" 2>/dev/null || true)"
case " ${deps//,/ } " in
*" rfkill "*) pass "${PKG} declares rfkill in Depends: ${deps}" ;;
*) fail "${PKG}'s Depends does not name rfkill: '${deps}'" ;;
esac
st="$(dpkg-query -W -f='${Status}' rfkill 2>/dev/null || true)"
case "${st}" in
'install ok installed'*) pass "${PKG} resolved rfkill into its root" ;;
*) fail "rfkill is not installed in ${PKG}'s root: dpkg-query says '${st:-nothing at all}'" ;;
esac

# The payload, for the disjointness comparison the HOST makes across the three
# roots -- no root can see another's. Non-directory paths only: directories are
# shared on purpose, exactly as build-env/deb/package-gate.sh's ownership rule
# has it.
PAYLOAD_N=0
while IFS= read -r path; do
    case "${path}" in /*) ;; *) continue ;; esac
    if [ -d "${path}" ] && [ ! -L "${path}" ]; then continue; fi
    PAYLOAD_N=$((PAYLOAD_N + 1))
    echo "PAYLOAD: ${path}"
done < <(dpkg -L "${PKG}" 2>/dev/null || true)
[ "${PAYLOAD_N}" -gt 0 ] ||
    fail "${PKG} lists no non-directory payload path, so the disjointness comparison would be over an empty set"

echo "COUNT payload ${PAYLOAD_N}"
echo "RESULT-RADIO ${PKG}: ${PASS_N} pass, ${FAIL_N} fail"
echo "-- end radio ${PKG} --"
RADIO

cat >"${IN}/experiment.sh" <<'EXP'
#!/bin/bash
# PLAN-036 decision (g)'s open question, RUN rather than reasoned about: what
# does APT do with `Depends: mica-profile` when neither provider is available,
# and what does it do when both are and they Conflict?
#
# This script asserts only that the experiment has material. The outcome is
# recorded verbatim and judged by nobody -- the ruling assumed a behaviour that
# had never been observed, and the record has to say which part APT enforces.
set -uo pipefail
. /in/lib.sh

MODE="$1"

if [ "${MODE}" = none ]; then
    before="$(grep -c '^Package: ' /dist/Packages)"
    rm -f /dist/pool/mica-profile-dev_*.deb /dist/pool/mica-profile-prod_*.deb
    awk 'BEGIN { RS = ""; FS = "\n"; ORS = "\n\n" }
         { keep = 1
           for (i = 1; i <= NF; i++)
               if ($i == "Package: mica-profile-dev" || $i == "Package: mica-profile-prod") keep = 0
           if (keep) print }' /dist/Packages >/dist/Packages.new
    mv /dist/Packages.new /dist/Packages
    after="$(grep -c '^Package: ' /dist/Packages)"
    if [ "$((before - after))" -eq 2 ]; then
        pass "the pool index lost exactly the two profile stanzas (${before} -> ${after})"
    else
        fail "filtering the pool index took ${before} stanzas to ${after}; exactly two were meant to go"
    fi
fi

apt-get update >/tmp/update.log 2>&1 || { fail "apt-get update failed"; tail -n 20 /tmp/update.log; }

# The material. Without these the transcript below records nothing: an
# unsatisfied dependency that was never declared, or an "unavailable" provider
# that was never in the pool to begin with.
micad_deps="$(apt-cache show micad 2>/dev/null | sed -n 's/^Depends: //p' | head -n1)"
case " ${micad_deps//,/ } " in
*" mica-profile "*) pass "the micad archive in this pool declares mica-profile: ${micad_deps}" ;;
*) fail "the micad archive does not name mica-profile in Depends ('${micad_deps}'); this experiment would be about a dependency that is not there" ;;
esac
for p in mica-profile-dev mica-profile-prod; do
    cand="$(apt-cache policy "${p}" 2>/dev/null | sed -n 's/^  Candidate: //p')"
    case "${MODE}" in
    none)
        case "${cand}" in
        '' | '(none)') pass "${p} is unavailable in this root, as the 'neither provider' case requires" ;;
        *) fail "${p} is still available as ${cand}; this root was meant to have neither provider" ;;
        esac
        ;;
    both)
        case "${cand}" in
        '' | '(none)') fail "${p} is unavailable; the 'both providers' case needs both in the pool" ;;
        *) pass "${p} is available as ${cand}, as the 'both providers' case requires" ;;
        esac
        ;;
    esac
done

echo "=== apt-cache policy mica-profile (the virtual name) ==="
apt-cache policy mica-profile 2>&1 || true
echo "=== apt-cache showpkg mica-profile ==="
apt-cache showpkg mica-profile 2>&1 | head -n 30 || true

echo "=== apt-get install -y micad : VERBATIM ==="
set +e
apt-get install -y --no-install-recommends micad 2>&1
apt_status=$?
set -e
echo "=== apt-get install -y micad : exit ${apt_status} ==="

echo "=== what the root holds afterwards ==="
for p in micad mica-system mica-profile-dev mica-profile-prod; do
    echo "${p}: $(dpkg-query -W -f='${Status} ${Version}' "${p}" 2>/dev/null || echo 'not present')"
done

echo "OBSERVED-${MODE}: aptExit=${apt_status} micad=[$(dpkg-query -W -f='${Status}' micad 2>/dev/null || echo absent)] dev=[$(dpkg-query -W -f='${Status}' mica-profile-dev 2>/dev/null || echo absent)] prod=[$(dpkg-query -W -f='${Status}' mica-profile-prod 2>/dev/null || echo absent)]"
echo "RESULT-EXP ${MODE}: ${PASS_N} pass, ${FAIL_N} fail"
echo "-- end exp ${MODE} --"
EXP

# ------------------------------------------------------------- the Dockerfile
#
# One build per architecture, six roots inside it. Six separate builds would
# transfer the pool six times and serialise what buildkit runs concurrently.
#
# No `# syntax=` line, like tests/quadlet-doc-test.sh's generated Dockerfile:
# build-env/build.sh checks that pin across the Dockerfiles the tree SHIPS,
# and a file generated under tmp/ is not one of them.
cat >"${WORK}/Dockerfile" <<'DOCKERFILE'
ARG MOS_BASE
FROM ${MOS_BASE} AS poolbase
ARG EMULATED=0
ENV DEBIAN_FRONTEND=noninteractive
ENV EMULATED=${EMULATED}
COPY dist /dist
COPY in /in
RUN printf 'deb [trusted=yes] file:/dist ./\n' >/etc/apt/sources.list.d/mos-pool.list && mkdir -p /report

FROM poolbase AS full
RUN bash /in/assert-full.sh >/report/full.txt 2>&1; cat /report/full.txt

FROM poolbase AS declined-mqtt
RUN bash /in/assert-declined.sh >/report/declined.txt 2>&1; cat /report/declined.txt

FROM poolbase AS radio-wifi
RUN bash /in/assert-radio.sh mica-wifi "mica-wifi-ap mica-bluetooth" >/report/radio.txt 2>&1; cat /report/radio.txt

FROM poolbase AS radio-wifi-ap
RUN bash /in/assert-radio.sh mica-wifi-ap "mica-wifi mica-bluetooth" >/report/radio.txt 2>&1; cat /report/radio.txt

FROM poolbase AS radio-bluetooth
RUN bash /in/assert-radio.sh mica-bluetooth "mica-wifi mica-wifi-ap" >/report/radio.txt 2>&1; cat /report/radio.txt

FROM poolbase AS exp-none
RUN bash /in/experiment.sh none >/report/exp.txt 2>&1; cat /report/exp.txt

FROM poolbase AS exp-both
RUN bash /in/experiment.sh both >/report/exp.txt 2>&1; cat /report/exp.txt

FROM scratch AS reports
COPY --from=full /report/full.txt /full.txt
COPY --from=declined-mqtt /report/declined.txt /declined.txt
COPY --from=radio-wifi /report/radio.txt /radio-mica-wifi.txt
COPY --from=radio-wifi-ap /report/radio.txt /radio-mica-wifi-ap.txt
COPY --from=radio-bluetooth /report/radio.txt /radio-mica-bluetooth.txt
COPY --from=exp-none /report/exp.txt /exp-none.txt
COPY --from=exp-both /report/exp.txt /exp-both.txt
DOCKERFILE

# ------------------------------------------------------------------ the runs
PASS_N=0
FAIL_N=0
ROOTS_N=0
PKGS_TOTAL=0
PATHS_TOTAL=0
LDD_TOTAL=0
ACCOUNTS_TOTAL=0
WANTS_TOTAL=0
COMPONENTS_TOTAL=0
LIMITED_TOTAL=0
RADIO_PATHS_TOTAL=0
ROOT_WANTS_TOTAL=0
UNDECLARED_TOTAL=0
DECLINED_LDD_TOTAL=0
DECLINED_LOST_TOTAL=0
BUILDERS_CREATED=()
cleanup() {
    for b in ${BUILDERS_CREATED[@]+"${BUILDERS_CREATED[@]}"}; do
        docker buildx rm "${b}" >/dev/null 2>&1 || true
    done
}
trap cleanup EXIT
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }
# Zero when the key is absent, so that a report which never reached its COUNT
# lines lands in the RESULT line as the zero it is rather than as an arithmetic
# syntax error that hides which root was short.
count_of() {
    local v
    v="$(sed -n "s/^COUNT $2 //p" "$1" | head -n1)"
    printf '%s\n' "${v:-0}"
}

REPORTS=(full.txt declined.txt radio-mica-wifi.txt radio-mica-wifi-ap.txt radio-mica-bluetooth.txt exp-none.txt exp-both.txt)
TERMINATORS=("-- end full --" "-- end declined --" "-- end radio mica-wifi --" "-- end radio mica-wifi-ap --" "-- end radio mica-bluetooth --" "-- end exp none --" "-- end exp both --")

for arch in "${ARCHES[@]}"; do
    echo
    echo "=================== ${arch} ==================="
    ctx="${WORK}/ctx-${arch}"
    out="${WORK}/out-${arch}"
    rm -rf "${ctx}" "${out}"
    mkdir -p "${ctx}"
    cp -R "${IN}" "${ctx}/in"

    # The board whose MOS_ARCH is this pool's, found the way
    # pkgs/mqtt/deb/mqtt/prepare.sh finds it: the board files are the one
    # authority on which architecture a board is, and a table here would be a
    # second one.
    case "$arch" in amd64) board=x64;; arm64) board=cx3576;; esac
    test "$(sed -n 's/^MOS_ARCH=//p' "$REPO_ROOT/boards/$board/board.env")" = "$arch"
    radios="$(sed -n 's/^BOARD_RADIOS="\(.*\)"$/\1/p' "${REPO_ROOT}/boards/${board}/board.env" | head -n1)"

    # `dev`, and it is the profile whose promise a missing profile package
    # silently reverses: micad fails closed to prod, so a dev resolution that
    # lost its profile package is the composition that looks green and ships
    # with SSH off. Installing the profile the failure mode is about is the
    # useful half of the pair.
    mapfile -t PKG_SET < <(bash "${RESOLVE_SH}" --board "${board}" --profile dev --radios "${radios}" --without "")
    [ "${#PKG_SET[@]}" -gt 0 ] || {
        echo "error: rootfs/packages/resolve.sh yielded no package for --board ${board} --profile dev --radios '${radios}' (see its message above)" >&2
        exit 1
    }
    printf '%s\n' "${PKG_SET[@]}" >"${ctx}/in/packages.txt"
    echo "install-closure-gate: ${arch}: board ${board}, radios '${radios}', ${#PKG_SET[@]} package(s): ${PKG_SET[*]}"

    # The same manifest with `mqtt` declined. Resolved through resolve.sh rather
    # than by subtracting a name from the set above: `--without` is what a build
    # actually says, and the resolver's own refusals -- an empty resolution, one
    # with no board package -- are the ones that must fire if declining this
    # feature is not a configuration the manifests can express.
    mapfile -t PKG_SET_DECLINED < <(bash "${RESOLVE_SH}" --board "${board}" --profile dev --radios "${radios}" --without "mqtt")
    [ "${#PKG_SET_DECLINED[@]}" -gt 0 ] || {
        echo "error: rootfs/packages/resolve.sh yielded no package for --board ${board} --profile dev --without mqtt (see its message above). That would mean the manifests cannot express a mqtt-declined image at all, which is the configuration this root exists to install" >&2
        exit 1
    }
    printf '%s\n' "${PKG_SET_DECLINED[@]}" >"${ctx}/in/packages-declined.txt"
    echo "install-closure-gate: ${arch}: mqtt declined, ${#PKG_SET_DECLINED[@]} package(s): ${PKG_SET_DECLINED[*]}"

    # The pool, hardlinked where the filesystem allows it: it carries a kernel
    # and its modules, and buildx wants it inside the context.
    cp -al "${DIST}/${arch}" "${ctx}/dist" 2>/dev/null || cp -a "${DIST}/${arch}" "${ctx}/dist"

    emulated=0
    [ "${arch}" = "${HOST_ARCH}" ] || emulated=1

    # The builder, chosen as build-env/deb/build.sh chooses one: a caller who
    # named BUILDX_BUILDER meant it; otherwise the default builder is used only
    # for the native architecture, and the docker-container builder whose
    # buildkit image bundles the emulators is created for the foreign one.
    if [ -n "${BUILDX_BUILDER:-}" ]; then
        builder="${BUILDX_BUILDER}"
    elif [ "${emulated}" -eq 0 ]; then
        builder=default
    else
        builder="mos-${arch}"
        if ! docker buildx inspect "${builder}" >/dev/null 2>&1; then
            docker buildx create --name "${builder}" --driver docker-container >/dev/null
            BUILDERS_CREATED+=("${builder}")
        fi
    fi

    log="${WORK}/build-${arch}.log"
    echo "install-closure-gate: building ${#REPORTS[@]} ${arch} roots on builder '${builder}' (emulated=${emulated}); the build log is ${log}"
    build_status=0
    docker buildx build --label ai-agent=true --builder "${builder}" \
        "${BASE_ARGS[@]}" \
        --build-arg "EMULATED=${emulated}" \
        --platform "linux/${arch}" \
        --target reports \
        -f "${WORK}/Dockerfile" \
        -o "${out}" \
        "${ctx}" >"${log}" 2>&1 || build_status=1
    if [ "${build_status}" != 0 ]; then
        fail "${arch}: the root builds did not complete; the tail of ${log} follows"
        tail -n 40 "${log}"
        continue
    fi

    for i in "${!REPORTS[@]}"; do
        r="${out}/${REPORTS[${i}]}"
        [ -f "${r}" ] || {
            fail "${arch}: ${REPORTS[${i}]} was not produced at all"
            continue
        }
        # A report that stops mid-sentence reads as a pass to anything counting
        # FAIL lines. The terminator is what tells "it finished and found
        # nothing wrong" apart from "it was killed".
        #
        # `tail` and not `grep`, for two reasons. The marker begins with `--`,
        # which grep parses as the end of its own options and then reports as an
        # unrecognised one -- a check that fails whatever the file contains is
        # as uninformative as one that always passes, and it never looks at the
        # transcript at all. And the marker has to be the LAST line: found
        # anywhere, it would pass for a report that was cut off after it, which
        # is the case this exists to catch.
        [ "$(tail -n 1 "${r}")" = "${TERMINATORS[${i}]}" ] || {
            fail "${arch}: ${REPORTS[${i}]} does not END in '${TERMINATORS[${i}]}' (its last line is '$(tail -n 1 "${r}")'), so it was truncated and its silence is not a pass"
            continue
        }
        ROOTS_N=$((ROOTS_N + 1))
        p="$(grep -c '^PASS: ' "${r}" || true)"
        f="$(grep -c '^FAIL: ' "${r}" || true)"
        PASS_N=$((PASS_N + p))
        FAIL_N=$((FAIL_N + f))
        echo "--- ${arch}/${REPORTS[${i}]}: ${p} pass, ${f} fail"
        grep -E '^(PASS: |FAIL: |EXECUTOR-LIMITED: |UNDECLARED-ENABLEMENT: |OBSERVED-|install-closure: )' "${r}" | sed 's/^/  /' || true
    done

    # The denominators the full root measured, lifted off its own COUNT lines
    # rather than recomputed here from something else.
    full="${out}/full.txt"
    if [ -f "${full}" ]; then
        PKGS_TOTAL=$((PKGS_TOTAL + $(count_of "${full}" packages)))
        PATHS_TOTAL=$((PATHS_TOTAL + $(count_of "${full}" paths)))
        WANTS_TOTAL=$((WANTS_TOTAL + $(count_of "${full}" wants)))
        ROOT_WANTS_TOTAL=$((ROOT_WANTS_TOTAL + $(count_of "${full}" rootwants)))
        UNDECLARED_TOTAL=$((UNDECLARED_TOTAL + $(count_of "${full}" undeclared)))
        ACCOUNTS_TOTAL=$((ACCOUNTS_TOTAL + $(count_of "${full}" accounts)))
        LDD_TOTAL=$((LDD_TOTAL + $(count_of "${full}" ldd)))
        COMPONENTS_TOTAL=$((COMPONENTS_TOTAL + $(count_of "${full}" components)))
        LIMITED_TOTAL=$((LIMITED_TOTAL + $(count_of "${full}" limited)))
    fi

    # --- what declining mqtt actually took out of the root.
    #
    # Diffed HERE because no root can see another's package database, and it is
    # this difference that decides whether the declined root's ldd sweep could
    # have failed at all: a sweep over a root that lost nothing is a sweep that
    # was never going to find an undeclared dependency. Reported as the measured
    # list rather than as a count, because WHICH libraries left with mica-mqttd is
    # the fact the ruling turns on.
    declined="${out}/declined.txt"
    if [ -f "${full}" ] && [ -f "${declined}" ]; then
        DECLINED_LDD_TOTAL=$((DECLINED_LDD_TOTAL + $(count_of "${declined}" ldd)))
        sed -n 's/^PKGDB: \([^ ]*\) .*/\1/p' "${full}" | LC_ALL=C sort -u >"${WORK}/pkgdb-full-${arch}.txt"
        sed -n 's/^PKGDB: \([^ ]*\) .*/\1/p' "${declined}" | LC_ALL=C sort -u >"${WORK}/pkgdb-declined-${arch}.txt"
        full_n="$(grep -c . "${WORK}/pkgdb-full-${arch}.txt" || true)"
        declined_n="$(grep -c . "${WORK}/pkgdb-declined-${arch}.txt" || true)"
        lost="$(LC_ALL=C comm -23 "${WORK}/pkgdb-full-${arch}.txt" "${WORK}/pkgdb-declined-${arch}.txt" | tr '\n' ' ')"
        lost_n="$(LC_ALL=C comm -23 "${WORK}/pkgdb-full-${arch}.txt" "${WORK}/pkgdb-declined-${arch}.txt" | grep -c . || true)"
        if [ "${full_n}" -eq 0 ] || [ "${declined_n}" -eq 0 ]; then
            fail "${arch}: one of the two roots reported an empty package database (${full_n} full, ${declined_n} declined), so the comparison of what mqtt took with it was over nothing"
        else
            echo "install-closure-gate: ${arch}: the full root holds ${full_n} package(s), the mqtt-declined root ${declined_n}; declining mqtt removed ${lost_n}: ${lost:-nothing at all}"
            DECLINED_LOST_TOTAL=$((DECLINED_LOST_TOTAL + lost_n))
            case " ${lost} " in
            *" mica-mqttd "*)
                if [ "${lost_n}" -gt 1 ]; then
                    pass "${arch}: declining mqtt removed ${lost_n} package(s) beyond nothing, so the ldd sweep over that root had material that could have failed it"
                else
                    echo "install-closure-gate: ${arch}: mica-mqttd was the ONLY package that left. Nothing else's libraries went with it, so the sweep over the declined root could not have found an undeclared dependency -- it is a true green over an empty search space, and it is reported as that rather than quoted as a proof"
                fi
                ;;
            *)
                fail "${arch}: mica-mqttd is not among the packages the declined root lacks (${lost:-none}), so that root is not the mqtt-declined configuration it was meant to be"
                ;;
            esac
        fi
    fi

    # --- the disjointness the three radio roots exist for. Compared HERE and in
    # none of them: no root can see another's payload, which is the whole reason
    # there are three.
    declare -A OWNER=()
    overlap=""
    radio_paths=0
    for pkg in mica-wifi mica-wifi-ap mica-bluetooth; do
        r="${out}/radio-${pkg}.txt"
        [ -f "${r}" ] || continue
        while IFS= read -r path; do
            radio_paths=$((radio_paths + 1))
            prev="${OWNER[${path}]:-}"
            if [ -n "${prev}" ]; then
                overlap="${overlap} ${path}(${prev},${pkg})"
            else
                OWNER["${path}"]="${pkg}"
            fi
        done < <(sed -n 's/^PAYLOAD: //p' "${r}")
    done
    RADIO_PATHS_TOTAL=$((RADIO_PATHS_TOTAL + radio_paths))
    if [ "${radio_paths}" -eq 0 ]; then
        fail "${arch}: the three radio roots reported ZERO payload paths between them, so the disjointness comparison was over an empty set"
    elif [ -z "${overlap}" ]; then
        pass "${arch}: the three radio packages' payloads are disjoint over ${radio_paths} non-directory path(s)"
    else
        fail "${arch}: radio payload path(s) claimed by two packages:${overlap}"
    fi
    unset OWNER

    # --- the experiment, verbatim. Reported and not judged.
    for mode in none both; do
        r="${out}/exp-${mode}.txt"
        [ -f "${r}" ] || continue
        echo
        echo "--- ${arch}: APT with the mica-profile providers ${mode} available -- VERBATIM ---"
        sed -n '/^=== apt-cache policy mica-profile (the virtual name) ===$/,/^=== what the root holds afterwards ===$/p' "${r}" | sed 's/^/  /'
    done
done

[ "${ROOTS_N}" -gt 0 ] || {
    echo "error: no root reported at all, so nothing was installed and nothing was checked" >&2
    exit 1
}
EXPECTED_ROOTS=$((${#ARCHES[@]} * ${#REPORTS[@]}))
[ "${ROOTS_N}" -eq "${EXPECTED_ROOTS}" ] ||
    fail "${ROOTS_N} of ${EXPECTED_ROOTS} roots reported; a gate that read fewer reports than it built has one missing, not a smaller job"

echo
echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N}/$((PASS_N + FAIL_N)) checks passed, ${ROOTS_N} clean roots over ${#ARCHES[@]} architectures, ${PKGS_TOTAL} packages installed, ${PATHS_TOTAL} payload paths present, ${WANTS_TOTAL} payload wants-symlinks resolved of ${ROOT_WANTS_TOTAL} present in those roots, ${UNDECLARED_TOTAL} units enabled outside any payload, ${ACCOUNTS_TOTAL} unit accounts resolved, ${LDD_TOTAL} objects ldd-checked in the full roots, ${DECLINED_LDD_TOTAL} in the mqtt-declined roots over ${DECLINED_LOST_TOTAL} packages those roots lost, ${COMPONENTS_TOTAL} component versions asked, ${LIMITED_TOTAL} executor-limited, ${RADIO_PATHS_TOTAL} radio payload paths compared)"
[ "${FAIL_N}" -eq 0 ]
