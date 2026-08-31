#!/usr/bin/env bash
# THE DUAL-BUILD GATE: x64 built both ways from one tree, and the two roots compared.
#
#   bash os/tests/dual-build-gate.sh
#
# PLAN-036 section 6's last paragraph, as a command. It builds x64 through the
# stage chain and through the package composer, extracts both factory roots and
# hands them to os/build/run.sh --compare-roots, which judges every difference
# against the written ledger in os/tests/dual-build-sanctions.md.
#
# THIS SCRIPT BUILDS AND MEASURES. It decides nothing about which differences are
# allowed: that is the ledger's job and the comparator's, and there is no flag
# here that adds a sanction, skips a build or reuses a root from an earlier run.
#
# Exit codes -- the comparator's contract, propagated and never collapsed:
#
#   0  compared: every difference is sanctioned, every active sanction matched
#      something, no pending sanction has come live, and the drift control found
#      no package moving underneath the two builds.
#   1  compared, and something is not accounted for: an unsanctioned difference,
#      a stale sanction, a pending sanction that has come live, or PACKAGE
#      DRIFT.
#   2  REFUSED -- no comparison was made, or one was made that could not mean
#      what it says: a missing pool, a tree that moved between the two builds,
#      the two paths having run DIFFERENT finalizer code, roots that are the
#      wrong way round, or a ledger with no boundary clause in it.
#
# 2 is separate from 1 because a gate that cannot tell "the two roots agree"
# from "nothing was compared" is not a gate.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
for anchor in "${REPO_ROOT}/Makefile" "${REPO_ROOT}/os/rootfs/build-v2.sh" \
    "${REPO_ROOT}/os/build/run.sh" "${REPO_ROOT}/os/tests/dual-build-sanctions.md"; do
    [ -e "${anchor}" ] || {
        echo "error: ${anchor} does not exist; os/tests/dual-build-gate.sh derives the repository as two levels above itself" >&2
        exit 2
    }
done
cd "${REPO_ROOT}"

LEDGER="${REPO_ROOT}/os/tests/dual-build-sanctions.md"
WORK="${MOS_GATE_WORK:-${REPO_ROOT}/tmp/dual-build-gate}"

# x64 AND NOT A --board ARGUMENT. PLAN-036 section 6 runs this comparison on
# x64 only, and the ledger's own boundary clause -- printed with the verdict
# below -- is written about that choice: cx3576 is covered by the composed
# image's verify and smoke runs instead. A --board flag here would offer a
# cx3576 run whose result no stanza in that file was written for.
BOARD=x64

usage() {
    sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}
case "${1:-}" in
--help | -h) usage; exit 0 ;;
'') ;;
*) echo "error: unknown argument '$1'; this gate takes none" >&2; exit 2 ;;
esac

refuse() {
    echo >&2
    echo "REFUSED: $*" >&2
    echo "         No comparison was made, or one was made that could not mean what it says." >&2
    exit 2
}

# --- the finalizer, proved shared before anything is built --------------------
#
# The whole instrument rests on this. If the chain and the composition run
# DIFFERENT close-and-pack code, every difference reported below is ambiguous
# between "the composition differs" and "the finalizer differs", and the gate
# stops answering the question it exists for. Two statements, and the second is
# the one that cannot be faked by a copy: the structure now, and the content
# hash the driver records for each build afterwards.
CHAIN_PACK="${REPO_ROOT}/os/rootfs/stages/90-pack.Dockerfile"
COMPOSE_PACK="${REPO_ROOT}/os/rootfs/compose/90-pack.Dockerfile"
[ -L "${COMPOSE_PACK}" ] ||
    refuse "${COMPOSE_PACK} is not a symlink. The composition reaches the finalizer through one, so that there is one definition of it; a regular file here is a copy, and a copy drifts."
link_target="$(readlink "${COMPOSE_PACK}")"
[ "${link_target}" = "../stages/90-pack.Dockerfile" ] ||
    refuse "${COMPOSE_PACK} points at '${link_target}', not at ../stages/90-pack.Dockerfile."
[ "$(sha256sum <"${CHAIN_PACK}" | cut -d' ' -f1)" = "$(sha256sum <"${COMPOSE_PACK}" | cut -d' ' -f1)" ] ||
    refuse "the two 90-pack.Dockerfile paths do not read as the same bytes, which a symlink cannot do -- something is between them."

# --- one tree, one commit -----------------------------------------------------
#
# The two builds are two runs of two different assemblers over ONE source tree.
# An edit landing between them would move the composition, the chain or both,
# and the difference set would then describe two trees rather than two paths.
# Both the commit and the working-tree state are captured, because a change to a
# tracked file that is never committed moves the build just as far.
tree_state() {
    printf '%s %s' \
        "$(git -C "${REPO_ROOT}" rev-parse HEAD)" \
        "$(git -C "${REPO_ROOT}" status --porcelain | sha256sum | cut -d' ' -f1)"
}
git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 ||
    refuse "${REPO_ROOT} is not a git checkout, so 'one tree at one commit' cannot be asserted at all."
TREE_AT_START="$(tree_state)"
COMMIT="${TREE_AT_START%% *}"
DIRTY=no
[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || DIRTY=yes
echo "gate: ${BOARD}, commit ${COMMIT}, uncommitted changes: ${DIRTY}"

assert_tree_unmoved() {
    [ "$(tree_state)" = "${TREE_AT_START}" ] ||
        refuse "the tree moved during the gate (after $1). The two roots would then differ because the SOURCE differed, and every stanza in the ledger is written about two paths over one tree."
}

# --- the pool -----------------------------------------------------------------
#
# Refused HERE and at exit 2, rather than left to the composed build, because a
# missing pool is not a difference between two roots -- it is a run in which the
# second root was never made. os/rootfs/build-v2.sh makes the full set of pool
# checks (index verification, staleness, the version this tree stamps); this is
# the subset that decides whether a comparison is possible at all.
case "${BOARD}" in
x64) ARCH=amd64 ;;
*) refuse "no architecture is known for board '${BOARD}'" ;;
esac
POOL="${REPO_ROOT}/_out/debs/${ARCH}"
[ -d "${POOL}" ] && [ -s "${POOL}/manifest.txt" ] ||
    refuse "${POOL} carries no indexed package pool, so the composed side of this gate cannot be built. Build it with: make os-debs"
POOL_N="$(grep -vc '^#' "${POOL}/manifest.txt" || true)"
[ "${POOL_N}" -gt 0 ] ||
    refuse "${POOL}/manifest.txt names no package. Build the pool with: make os-debs"
echo "gate: pool ${POOL}, ${POOL_N} package(s)"

# --- a private builder --------------------------------------------------------
#
# mos-rootfs-stage:<board>-<stage> are DAEMON-GLOBAL unprefixed tags. On the
# docker driver two worktrees building x64 at once blend their layers into a
# complete, plausible, wrong root -- and this gate's whole output is a
# difference set between two roots, so a blended one would be reported as a
# composition difference. A docker-container builder makes
# os/build/src/stages-cli.ts chain by OCI layout under this worktree's own
# _out/<board>/stages/ instead, where no sibling can re-point anything.
#
# Exported, so os/rootfs/build-v2.sh takes it for both builds. Nothing else in
# either build reads BUILDX_BUILDER: os/pkgs/rauc/build.sh and
# os/pkgs/podman/build.sh do, and neither is on this path -- their output is a
# prerequisite of the chain build, not a step of it.
BUILDER="mos-gate-$(printf '%s' "${REPO_ROOT}" | sha256sum | cut -c1-8)"
docker buildx inspect "${BUILDER}" >/dev/null 2>&1 ||
    docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
export BUILDX_BUILDER="${BUILDER}"
cleanup() {
    status=$?
    docker buildx rm "${BUILDER}" >/dev/null 2>&1 || true
    exit "${status}"
}
trap cleanup EXIT
echo "gate: private buildx builder ${BUILDER} (docker-container)"

rm -rf "${WORK}"
mkdir -p "${WORK}"
# Resolved, because os/build/src/compare-roots.ts reports the REALPATH of each
# side and this script checks the two report lines against what it meant to
# hand over. A symlinked component anywhere above the work directory would make
# that check fail over a spelling rather than over an orientation.
WORK="$(realpath "${WORK}")"

# --- the two builds -----------------------------------------------------------
#
# Sequential and into the same _out/<board>/, because that is where both
# assemblers write and neither takes an output directory. Each side's archive,
# package-manager log and stage manifest are preserved before the next build
# overwrites them, which is what the ledger's own evidence section did by hand.
OUT="${REPO_ROOT}/_out/${BOARD}"
build_side() {
    local mode="$1" label="$2" rc f
    echo
    echo "=== gate: building ${BOARD} in ${mode} mode ==="
    rc=0
    MOS_BOARD="${BOARD}" MOS_ROOTFS_MODE="${mode}" \
        bash "${REPO_ROOT}/os/rootfs/build-v2.sh" 2>&1 | tee "${WORK}/${label}-build.log" || rc=$?
    [ "${rc}" -eq 0 ] ||
        refuse "the ${mode} build exited ${rc}; see ${WORK}/${label}-build.log. A gate cannot compare a root that was not produced."
    for f in factory-root.oci rootfs-stages.txt rootfs-report-v2.txt pkg-logs/dpkg.log; do
        [ -s "${OUT}/${f}" ] ||
            refuse "the ${mode} build reported success and left no ${OUT}/${f}."
    done
    cp "${OUT}/factory-root.oci" "${WORK}/${label}.oci"
    cp "${OUT}/rootfs-stages.txt" "${WORK}/${label}-stages.txt"
    cp "${OUT}/rootfs-report-v2.txt" "${WORK}/${label}-report.txt"
    cp "${OUT}/pkg-logs/dpkg.log" "${WORK}/${label}-dpkg.log"
    echo "gate: ${mode} root preserved as ${WORK}/${label}.oci ($(stat -c%s "${WORK}/${label}.oci") bytes)"
    assert_tree_unmoved "the ${mode} build"
}

# A IS THE CHAIN AND B IS THE COMPOSER, and the order is not cosmetic. `added`
# means present in B and absent in A, and the two differences PLAN-036 sanctions
# in principle -- package documentation and the composition record -- are
# ADDITIONS, so a driver that swapped these two would find every one of them
# classified as a removal and unsanctioned. It is asserted twice below: once
# against the extracted material, and once against what the comparator says it
# was handed.
build_side chain chain
build_side composed composed

# --- one finalizer, proved from what the two builds RECORDED -------------------
#
# The symlink check above is structural. This one is over the two builds' own
# output: os/build/src/stages.ts hashes each Dockerfile as it reads it and
# stages-cli.ts writes `<name><TAB><content-hash><TAB><tag>` into
# rootfs-stages.txt, so an equal hash for 90-pack on both sides is the two runs
# saying they read the same bytes -- not this script saying they did.
pack_hash() {
    awk -F'\t' '$1 == "90-pack" { print $2 }' "$1"
}
CHAIN_STAGES="$(grep -vc '^#' "${WORK}/chain-stages.txt" || true)"
COMPOSED_STAGES="$(grep -vc '^#' "${WORK}/composed-stages.txt" || true)"
HASH_A="$(pack_hash "${WORK}/chain-stages.txt")"
HASH_B="$(pack_hash "${WORK}/composed-stages.txt")"
[ -n "${HASH_A}" ] && [ -n "${HASH_B}" ] ||
    refuse "one of the two builds recorded no 90-pack row in its rootfs-stages.txt, so there is nothing to compare the finalizers with (chain='${HASH_A}' composed='${HASH_B}')."
[ "${HASH_A}" = "${HASH_B}" ] ||
    refuse "the two builds ran DIFFERENT 90-pack content: chain ${HASH_A}, composed ${HASH_B}. Every difference this gate would report is then ambiguous between the composition and the finalizer."
echo
echo "gate: one finalizer -- ${CHAIN_STAGES} chain stage(s) and ${COMPOSED_STAGES} composed stage(s), 90-pack at ${HASH_A} on both"

# --- extraction ---------------------------------------------------------------
DIR_A="${WORK}/root-chain"
DIR_B="${WORK}/root-composed"
extract() {
    out="$(bash "${REPO_ROOT}/os/build/run.sh" --compare-roots --extract-oci "$1" "$2" 2>&1)" ||
        { printf '%s\n' "${out}" >&2; refuse "extracting $1 failed."; }
    printf '%s\n' "${out}"
}
echo
EXTRACT_A="$(extract "${WORK}/chain.oci" "${DIR_A}")"
EXTRACT_B="$(extract "${WORK}/composed.oci" "${DIR_B}")"
printf '%s\n%s\n' "${EXTRACT_A}" "${EXTRACT_B}"
PATHS_A="$(printf '%s' "${EXTRACT_A}" | sed -n 's/.*, \([0-9][0-9]*\) paths).*/\1/p')"
PATHS_B="$(printf '%s' "${EXTRACT_B}" | sed -n 's/.*, \([0-9][0-9]*\) paths).*/\1/p')"
for pair in "A:${PATHS_A}" "B:${PATHS_B}"; do
    n="${pair#*:}"
    [ -n "${n}" ] && [ "${n}" -gt 0 ] ||
        refuse "side ${pair%%:*} extracted ${n:-no} paths. A comparison over an empty tree agrees with everything."
done

# --- the orientation control, on real material --------------------------------
#
# /usr/share/doc/mos-system/copyright is in the composed root because
# mos-system is a real .deb with a real per-package copyright, and it is in no
# chain root because the chain installs those bytes by copying files. So it is
# present on exactly one side, and WHICH side is the whole question. The
# comparator's own report is then checked to have been handed the two
# directories the right way round.
MARKER=usr/share/doc/mos-system/copyright
[ -e "${DIR_B}/${MARKER}" ] ||
    refuse "/${MARKER} is not in the composed root ${DIR_B}. Either the arguments are the wrong way round or the composition did not install mos-system, and the two look identical in a difference set."
[ ! -e "${DIR_A}/${MARKER}" ] ||
    refuse "/${MARKER} IS in the chain root ${DIR_A}. That path is a package payload; finding it on the baseline side means these two directories are not the two roots this gate believes they are."
echo "gate: orientation -- /${MARKER} present in B (${DIR_B}), absent from A (${DIR_A}); 'added' therefore means composed"

# --- the drift control --------------------------------------------------------
#
# What this separates: "the composition differs" from "a package moved
# underneath us". Both builds run apt against the live Debian archive -- the
# BASE IMAGE is digest-pinned, the package versions are not -- so a Debian
# package released between the two builds would land in one root and not the
# other, and the comparator would report it as a composition difference in a
# tree the composition never touched.
#
# The stripped full diff CANNOT be empty here and it is not the verdict: the two
# paths install different sets in a different order by construction -- that is
# what PLAN-036 changed -- so its size is printed as context and nothing more.
# The verdict is over the packages the two builds have IN COMMON: for those, one
# version on each side is the same input, and two versions is drift.
strip_timestamps() {
    sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} //' "$1"
}
installed_versions() {
    awk '$3 == "status" && $4 == "installed" { split($5, a, ":"); v[a[1]] = $6 }
         END { for (k in v) printf "%s\t%s\n", k, v[k] }' "$1" | LC_ALL=C sort
}
strip_timestamps "${WORK}/chain-dpkg.log" >"${WORK}/chain-dpkg.stripped"
strip_timestamps "${WORK}/composed-dpkg.log" >"${WORK}/composed-dpkg.stripped"
diff -u "${WORK}/chain-dpkg.stripped" "${WORK}/composed-dpkg.stripped" >"${WORK}/dpkg.diff" || true
DPKG_DIFF_LINES="$(grep -cE '^[+-][^+-]' "${WORK}/dpkg.diff" || true)"
installed_versions "${WORK}/chain-dpkg.log" >"${WORK}/chain-versions.txt"
installed_versions "${WORK}/composed-dpkg.log" >"${WORK}/composed-versions.txt"
CHAIN_PKGS="$(grep -c . "${WORK}/chain-versions.txt" || true)"
COMPOSED_PKGS="$(grep -c . "${WORK}/composed-versions.txt" || true)"
[ "${CHAIN_PKGS}" -gt 0 ] && [ "${COMPOSED_PKGS}" -gt 0 ] ||
    refuse "one of the two dpkg.log files yielded no configured package at all (chain ${CHAIN_PKGS}, composed ${COMPOSED_PKGS}). The drift control would then compare an empty set with anything and report no drift."
join -t "$(printf '\t')" "${WORK}/chain-versions.txt" "${WORK}/composed-versions.txt" >"${WORK}/common-versions.txt"
COMMON_PKGS="$(grep -c . "${WORK}/common-versions.txt" || true)"
[ "${COMMON_PKGS}" -gt 0 ] ||
    refuse "the two builds configured no package in common, which cannot be true of two Debian roots -- the drift control is reading the wrong thing."
awk -F'\t' '$2 != $3 { printf "  %s: chain %s, composed %s\n", $1, $2, $3 }' \
    "${WORK}/common-versions.txt" >"${WORK}/drift.txt"
DRIFT_N="$(grep -c . "${WORK}/drift.txt" || true)"
echo
echo "gate: drift control -- ${CHAIN_PKGS} package(s) configured on A, ${COMPOSED_PKGS} on B, ${COMMON_PKGS} in common, ${DPKG_DIFF_LINES} differing dpkg.log line(s) after stripping timestamps"

# --- the comparison -----------------------------------------------------------
#
# ABSOLUTE paths: os/build/run.sh runs bun with os/build/ as its working
# directory, so a relative argument resolves against that and the failure
# surfaces as "does not exist" naming a path this script can see.
echo
COMPARE_RC=0
bash "${REPO_ROOT}/os/build/run.sh" --compare-roots "${DIR_A}" "${DIR_B}" 2>&1 |
    tee "${WORK}/compare.txt" || COMPARE_RC=$?

# What the comparator says it was handed, checked against what this script
# meant. The on-disk control above proves the two roots are the two roots; this
# proves the argument order that reached the comparator is the one the ledger's
# stanzas are written for.
grep -qxF "A (baseline): ${DIR_A}" "${WORK}/compare.txt" ||
    refuse "the comparator did not report ${DIR_A} as its baseline; the arguments it received are not the ones this gate composed."
grep -qxF "B (candidate): ${DIR_B}" "${WORK}/compare.txt" ||
    refuse "the comparator did not report ${DIR_B} as its candidate; the arguments it received are not the ones this gate composed."

# --- the three paths that may not be sanctioned -------------------------------
#
# L1's written ruling. Two of them are FIXED -- the initrd is built under
# SOURCE_DATE_EPOCH and the ldconfig aux-cache is deleted by the finalizer's
# tree surgery -- and the third, the shadow last-change field, is being fixed
# separately. So each one appearing in a difference set is a REGRESSION in that
# fix, not a candidate stanza; and each one appearing in the LEDGER is a
# decision nobody may take here.
#
# The initrd's name carries the kernel version, so it is read out of the root
# rather than written down: a literal that stopped matching would make this
# check pass by looking for a path that does not exist.
FORBIDDEN=()
for r in "${DIR_A}" "${DIR_B}"; do
    for f in "${r}"/boot/initrd.img-*; do
        [ -e "${f}" ] || continue
        FORBIDDEN+=("/boot/${f##*/}")
    done
done
FORBIDDEN+=(/usr/share/factory/var/cache/ldconfig/aux-cache /usr/share/factory/etc/shadow /etc/shadow-)
mapfile -t FORBIDDEN < <(printf '%s\n' "${FORBIDDEN[@]}" | LC_ALL=C sort -u)
[ "${#FORBIDDEN[@]}" -ge 4 ] ||
    refuse "only ${#FORBIDDEN[@]} of the four forbidden paths could be named; no initrd was found in either root, so the check below would look for nothing."

# Against the LEDGER first: a stanza whose pattern would cover one of these is
# refused, because it would make the regression invisible on every later run.
# The patterns are read out of the file's own `### ` headings and matched as
# globs, so `/boot/**` is caught as well as the literal path.
# Only the stanzas UNDER `## Sanctions`, which is the section
# os/build/src/compare-roots.ts parses (SANCTIONS_HEADING). Everything above it
# is prose, including a `### /usr/share/doc/**` inside the format example and
# several `### ` prose headings, and reading those as patterns would count
# sanctions this ledger does not grant.
mapfile -t STANZAS < <(awk '/^## Sanctions$/ { f = 1; next }
                            f && /^### / { sub(/^### */, ""); gsub(/`/, ""); print }' "${LEDGER}")
[ "${#STANZAS[@]}" -gt 0 ] ||
    refuse "${LEDGER} carries no '### <pattern>' stanza under its '## Sanctions' heading; the check for a forbidden sanction would have nothing to read."
for pattern in "${STANZAS[@]}"; do
    for path in "${FORBIDDEN[@]}"; do
        # shellcheck disable=SC2053 # deliberate: $pattern is a glob, not a literal.
        if [[ ${path} == ${pattern} ]]; then
            refuse "${LEDGER} carries a stanza '${pattern}', which covers ${path}. L1's ruling is that these three paths may not be sanctioned: two are fixed and one is being fixed, so a stanza over them would hide the regression rather than record a decision."
        fi
    done
done

REGRESSIONS=()
for path in "${FORBIDDEN[@]}"; do
    # Anchored on the space either side so that /etc/shadow- cannot be found
    # inside /usr/share/factory/etc/shadow-, and reading the comparator's own
    # report rather than re-deriving the difference set: what matters is what
    # the instrument SAID, not a second opinion about the same trees.
    if grep -qF -- " ${path} " "${WORK}/compare.txt"; then
        REGRESSIONS+=("${path}")
    fi
done

# --- the boundary clause, read out of the ledger ------------------------------
#
# Printed with the verdict rather than restated here, so that a verdict cannot
# outlive the limits it was earned under. Extracted from the ledger's own
# section: a summary written in this file would be a second copy that stops
# matching the first time either moves.
BOUNDARY="$(awk '/^## What an x64-only comparison does not cover/ { f = 1; print; next }
                 f && /^## / { exit }
                 f { print }' "${LEDGER}")"
BOUNDARY_LINES="$(printf '%s\n' "${BOUNDARY}" | grep -c .)"
[ "${BOUNDARY_LINES}" -ge 20 ] ||
    refuse "${LEDGER} has no '## What an x64-only comparison does not cover' section, or it is ${BOUNDARY_LINES} lines long. That clause is what keeps a verdict from being read as covering cx3576, and a gate that prints it from an empty read prints nothing while looking as though it printed it."

echo
echo "================================ BOUNDARY ================================="
printf '%s\n' "${BOUNDARY}"
echo "==========================================================================="

# --- the verdict --------------------------------------------------------------
echo
echo "=== dual-build gate ==="
echo "commit:            ${COMMIT} (uncommitted changes: ${DIRTY})"
echo "A (baseline):      ${DIR_A}   -- the stage chain, ${PATHS_A} paths"
echo "B (candidate):     ${DIR_B}   -- the composer,    ${PATHS_B} paths"
echo "finalizer:         one definition, 90-pack content ${HASH_A} on both sides"
echo "pool:              ${POOL}, ${POOL_N} package(s)"
echo "drift control:     ${COMMON_PKGS} package(s) common to both builds, ${DRIFT_N} at differing versions"
echo "ledger:            ${LEDGER}, ${#STANZAS[@]} stanza(s), none covering a forbidden path"
echo "boundary clause:   printed above, ${BOUNDARY_LINES} lines from the ledger"
sed -n '/^differences found:/,/^  unsanctioned:/p' "${WORK}/compare.txt" | sed 's/^/comparator:        /'
echo "work directory:    ${WORK}"

if [ "${#REGRESSIONS[@]}" -gt 0 ]; then
    echo
    echo "REGRESSION: the difference set names path(s) L1 ruled may not be sanctioned:" >&2
    printf '  %s\n' "${REGRESSIONS[@]}" >&2
    echo "  The initrd is built under SOURCE_DATE_EPOCH and the ldconfig aux-cache is deleted by" >&2
    echo "  the finalizer's tree surgery; the shadow last-change field is being fixed separately." >&2
    echo "  Each of these appearing here is that fix having come undone, and it goes to L1 rather" >&2
    echo "  than into the ledger." >&2
    echo "RESULT: FAIL (regression in a fix, ${#REGRESSIONS[@]} path(s))"
    exit 1
fi

if [ "${DRIFT_N}" -gt 0 ]; then
    echo
    echo "PACKAGE DRIFT: ${DRIFT_N} package(s) configured by BOTH builds at different versions:" >&2
    cat "${WORK}/drift.txt" >&2
    echo "  The base image is digest-pinned and the archive it points at is not, so a package" >&2
    echo "  released between the two builds lands in one root and not the other. Every file those" >&2
    echo "  packages own would be reported above as a composition difference, which it is not." >&2
    echo "  Rebuild both sides closer together, or pin the package, before reading the set above." >&2
    echo "RESULT: FAIL (package drift; the comparison exited ${COMPARE_RC} and was made under it)"
    exit 1
fi

case "${COMPARE_RC}" in
0) echo "RESULT: PASS (every difference sanctioned, every active sanction used, no drift)" ;;
1) echo "RESULT: FAIL (the ledger does not account for the result; the comparator named each above)" ;;
*) refuse "the comparator exited ${COMPARE_RC}: it refused, so no comparison was made." ;;
esac
exit "${COMPARE_RC}"
