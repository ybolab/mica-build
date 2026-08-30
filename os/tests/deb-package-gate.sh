#!/usr/bin/env bash
# The package-level gates of PLAN-036 section 6, over the built pools.
#
#   bash os/tests/deb-package-gate.sh
#
#   reads   _out/debs/<arch>/pool/*.deb          (built by `make os-debs`)
#   asserts the seven facts listed below, per architecture
#
# Every fact is read OUT OF an archive with `dpkg-deb`, never from a list kept
# here: a gate that compares the pool against a table in its own file reports
# on the table. The only things written down are the EXPECTATIONS, and even
# those are derived from the tree where they can be -- the package names come
# out of os/pkgs/mosd/deb/*/control/*.control rather than from four strings
# below, so a producer that gains or loses a package is covered without this
# file being edited.
#
# WHAT IS CHECKED
#
#   a  unique file ownership across the local packages of one pool. No
#      non-directory path is in two archives; directories are shared on purpose
#      (/usr, /usr/bin, the wants directory) and are not flagged. `Replaces` is
#      refused outright -- it is the field that would make an overlap install
#      cleanly, and no control template in this tree has one.
#   b  Package, Version, Architecture and the Depends closure. Each archive
#      declares the architecture of the pool it sits in; the pool's package set
#      is the producers' set; one version spans the whole pool; every LOCAL
#      dependency is pinned to that exact version and is present in the pool.
#      Everything else is EXTERNAL and is reported, not judged: `mos-system`
#      and `passwd` are external and expected.
#   c  two builds under one SOURCE_DATE_EPOCH are byte-identical. See the long
#      comment on the cache below -- this is the check that most easily passes
#      without having run anything.
#   d  every package ships a non-empty /usr/share/doc/<package>/copyright.
#   e  the mosd producer's packages ship exactly one multi-user.target.wants
#      symlink each and the mqtt producer's ship none. mosd renders the MQTT
#      configuration and starts both units from `mqtt.enabled`, so a link in
#      either MQTT payload would start a broker nobody asked for; this is the
#      check a later "helpful" enablement has to get past.
#   f  no package carries DEBIAN/conffiles. The root is an immutable dm-verity
#      squashfs, so a conffile promises a three-way merge that cannot happen.
#   g  every maintainer script that exists parses as POSIX sh. Nothing else in
#      the tree covers them: os/tests/shell-pipefail-lint.sh scans files that
#      enable pipefail, and these are #!/bin/sh and do not.
#
# NOT CHECKED HERE, deliberately: installing the four packages into a clean root
# with APT -- mosd depends on `mos-system`, which the composer workstream owns
# and this pool does not contain, so the install would fail for a reason that is
# not a defect.
#
# The host carries no dpkg, so the reading happens inside
# localhost/mos-build-deb -- the same arrangement os/build-env/deb/repo.sh uses,
# and for the same reason.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
BUILD_DEB="${REPO_ROOT}/os/pkgs/mosd/hack/build-deb.sh"
DEB_DIR="${REPO_ROOT}/os/pkgs/mosd/deb"
DIST="${REPO_ROOT}/_out/debs"
for p in "${FROM_SH}" "${BUILD_DEB}" "${DEB_DIR}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. This gate derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. dpkg-deb runs inside localhost/mos-build-deb rather than on the host, and the reproducibility check drives a real package build" >&2
    exit 1
}

# The two architectures os/build-env/images.env pins a mos-build-deb for, and
# the two `make os-debs` builds. Written here rather than discovered from
# _out/debs, because a discovered list turns a pool that was never built into a
# gate that checks one architecture and reports green.
ARCHES=(amd64 arm64)
for arch in "${ARCHES[@]}"; do
    [ -d "${DIST}/${arch}/pool" ] || {
        echo "error: ${DIST}/${arch}/pool does not exist, so there is nothing to check for ${arch}. Build it with \`make os-debs\`; a gate that skipped the missing architecture would report on half a pool" >&2
        exit 1
    }
done

case "$(uname -m)" in
x86_64) IMAGE_ARCH=amd64 ;;
aarch64 | arm64) IMAGE_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture os/build-env/images.env builds a mos-build-deb for, so there is no container to read the archives in" >&2
    exit 1
    ;;
esac
# The HOST architecture's image, not each pool's: dpkg-deb --field and
# dpkg-deb --contents parse an archive, they do not execute it, and a host with
# no binfmt registration cannot run a foreign-architecture image at all.
mapfile -t FROM_ARGS < <(bash "${FROM_SH}" --arch="${IMAGE_ARCH}" MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB)
[ "${#FROM_ARGS[@]}" -eq 2 ] || {
    echo "error: os/build-env/from.sh did not yield localhost/mos-build-deb:${IMAGE_ARCH} (see its message above); it is built by \`make build-env\`" >&2
    exit 1
}
IMAGE="${FROM_ARGS[1]#MOS_BUILD_DEB=}"

WORK="${REPO_ROOT}/tmp/deb-package-gate"
rm -rf "${WORK}"
mkdir -p "${WORK}"

# ------------------------------------------------------ a, b, d, e, f, g
#
# One container reading both pools. The control templates come in beside them
# so the expected package set is the producers' own statement of it.

STATIC_LOG="${WORK}/static.log"
static_status=0
docker run --rm -i \
    --label ai-agent=true \
    -v "${DIST}:/dist:ro" \
    -v "${DEB_DIR}:/tmpl:ro" \
    --entrypoint /bin/bash \
    "${IMAGE}" -s "${ARCHES[@]}" 2>&1 <<'INNER' | tee "${STATIC_LOG}" || static_status=1
set -euo pipefail

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

ARCHES=("$@")

# The package set, out of the producers' control templates: /tmpl is
# os/pkgs/mosd/deb, and every <producer>/control/<package>.control in it is one
# package this repository builds. Read from the Package: field and not from the
# filename, because the filename is a convention and the field is the fact.
mapfile -t TEMPLATES < <(find /tmpl -mindepth 3 -maxdepth 3 -type f -name '*.control' | LC_ALL=C sort)
[ "${#TEMPLATES[@]}" -gt 0 ] || {
    echo "error: no <producer>/control/*.control under /tmpl, so this gate has no expected package set and every check below would pass by comparing nothing" >&2
    exit 1
}

LOCAL_NAMES=()
declare -A WANTS_EXPECTED=()
for t in "${TEMPLATES[@]}"; do
    name="$(awk '/^Package:/ { sub(/^Package:[[:space:]]*/, ""); print; exit }' "${t}")"
    [ -n "${name}" ] || {
        echo "error: ${t} declares no Package:, so the package it describes has no name to check the pool against" >&2
        exit 1
    }
    rel="${t#/tmpl/}"
    producer="${rel%%/*}"
    # THE ENABLEMENT ASYMMETRY, per producer. mosd and mos-apid each own the
    # multi-user.target.wants symlink that starts them; the MQTT packages own
    # none, because mosd renders their configuration into /run and starts them
    # from the mqtt settings subtree. A producer with no entry here is refused
    # rather than defaulted, since defaulting to zero would let a new package
    # ship a unit nothing ever starts and still report green.
    case "${producer}" in
    mosd) WANTS_EXPECTED["${name}"]=1 ;;
    mqtt) WANTS_EXPECTED["${name}"]=0 ;;
    *)
        echo "error: '${producer}' is a producer this gate has no enablement expectation for. Decide whether its packages start themselves and register the answer in os/tests/deb-package-gate.sh" >&2
        exit 1
        ;;
    esac
    LOCAL_NAMES+=("${name}")
done
EXPECTED_SET="$(printf '%s\n' "${LOCAL_NAMES[@]}" | LC_ALL=C sort | tr '\n' ' ')"

ARCHIVES_N=0
PATHS_N=0
SCRIPTS_N=0
VERSIONS=()
EXTERNALS=()

for arch in "${ARCHES[@]}"; do
    pool="/dist/${arch}/pool"
    [ -d "${pool}" ] || {
        echo "error: ${pool} does not exist, so there is nothing to check for ${arch}" >&2
        exit 1
    }
    mapfile -t debs < <(find "${pool}" -maxdepth 1 -type f -name '*.deb' -printf '%f\n' | LC_ALL=C sort)
    # An empty pool is a hard failure naming the directory, the way
    # os/build-env/deb/repo.sh refuses one: every check below is of the form
    # "no archive does X", and over nothing they all hold.
    [ "${#debs[@]}" -gt 0 ] || {
        echo "error: ${pool} holds no .deb. Every assertion below is a property of the archives in it, and over an empty pool they are all true" >&2
        exit 1
    }
    ARCHIVES_N=$((ARCHIVES_N + ${#debs[@]}))

    got_names=()
    pool_versions=()
    for d in "${debs[@]}"; do
        got_names+=("$(dpkg-deb --field "${pool}/${d}" Package)")
        pool_versions+=("$(dpkg-deb --field "${pool}/${d}" Version)")
    done
    VERSIONS+=("${pool_versions[@]}")

    got_set="$(printf '%s\n' "${got_names[@]}" | LC_ALL=C sort | tr '\n' ' ')"
    if [ "${got_set}" = "${EXPECTED_SET}" ]; then
        pass "${arch}: the pool holds exactly the packages the producers declare (${got_set% })"
    else
        fail "${arch}: the pool holds [${got_set% }], but os/pkgs/mosd/deb/*/control/ declares [${EXPECTED_SET% }]. A missing package is one the composer cannot install; an extra one is an archive no producer owns"
    fi

    # One version across the pool. The four packages are built from one
    # workspace commit and three of them pin the fourth exactly, so a pool
    # holding two versions is a half-rebuilt one -- and the exact-version
    # dependency below has no single value to be checked against.
    pool_version="$(printf '%s\n' "${pool_versions[@]}" | LC_ALL=C sort -u | tr '\n' ' ')"
    if [ "$(printf '%s\n' "${pool_versions[@]}" | LC_ALL=C sort -u | wc -l)" -eq 1 ]; then
        pass "${arch}: one version across the pool (${pool_version% })"
    else
        fail "${arch}: the pool holds more than one version [${pool_version% }]. Rebuild it whole with \`make os-debs\`"
    fi
    VERSION="${pool_versions[0]}"

    unset owner
    declare -A owner=()
    for d in "${debs[@]}"; do
        deb="${pool}/${d}"
        name="$(dpkg-deb --field "${deb}" Package)"
        version="$(dpkg-deb --field "${deb}" Version)"
        declared_arch="$(dpkg-deb --field "${deb}" Architecture)"
        depends="$(dpkg-deb --field "${deb}" Depends)"
        replaces="$(dpkg-deb --field "${deb}" Replaces)"

        # b -- architecture. A cross-packed archive is well formed and installs
        # nowhere.
        if [ "${declared_arch}" = "${arch}" ]; then
            pass "${name} ${arch}: declares Architecture: ${declared_arch}"
        else
            fail "${name} in the ${arch} pool declares Architecture: ${declared_arch}. It was packed in the wrong container or filed under the wrong architecture"
        fi

        # a -- Replaces. There is none in any control template in this tree, and
        # its only use here would be to let two packages own one path.
        if [ -z "${replaces}" ]; then
            pass "${name} ${arch}: declares no Replaces"
        else
            fail "${name} ${arch}: declares Replaces: ${replaces}. That field exists to let one package take a path from another, which is the overlap the ownership check below refuses; no control template in this tree has one"
        fi

        # b -- the Depends closure. An entry is LOCAL when it names a package
        # these producers build, and EXTERNAL otherwise. A local one has to be
        # pinned to the exact version and to be in this pool; an external one is
        # reported and not judged, because `mos-system` -- which the composer
        # workstream owns and this pool does not hold -- and `passwd` are both
        # expected.
        local_deps=" "
        IFS=',' read -ra entries <<<"${depends}"
        for entry in "${entries[@]}"; do
            IFS='|' read -ra alts <<<"${entry}"
            for alt in "${alts[@]}"; do
                read -r dep_name _rest <<<"${alt}"
                dep_name="${dep_name%%(*}"
                [ -n "${dep_name}" ] || continue
                is_local=0
                for n in "${LOCAL_NAMES[@]}"; do
                    [ "${dep_name}" != "${n}" ] || is_local=1
                done
                if [ "${is_local}" = 0 ]; then
                    EXTERNALS+=("${dep_name}")
                    continue
                fi
                local_deps="${local_deps}${dep_name} "
                case "${alt}" in
                *"(= ${VERSION})"*)
                    pass "${name} ${arch}: depends on ${dep_name} at the exact version (= ${VERSION})"
                    ;;
                *)
                    fail "${name} ${arch}: depends on the local package ${dep_name} as '${alt# }', which is not the exact version (= ${VERSION}) this pool was built at. These are built from one workspace commit across interfaces that carry no compatibility promise"
                    ;;
                esac
                in_pool=0
                for g in "${got_names[@]}"; do
                    [ "${dep_name}" != "${g}" ] || in_pool=1
                done
                [ "${in_pool}" = 1 ] ||
                    fail "${name} ${arch}: depends on the local package ${dep_name}, which is not in ${pool}. The closure over our own packages has to be satisfiable from the pool itself"
            done
        done
        # mosd is the base of the local closure: it owns the D-Bus surface the
        # other three speak, and each of them is built from the same commit.
        if [ "${name}" != mosd ]; then
            case "${local_deps}" in
            *" mosd "*) pass "${name} ${arch}: pins mosd" ;;
            *) fail "${name} ${arch}: declares no dependency on mosd. Every package here but mosd itself is built from mosd's commit and speaks its interface" ;;
            esac
        fi

        # The payload, read once and used by a, d and e.
        listing="$(dpkg-deb --contents "${deb}")"

        # a -- unique file ownership. Directories are excluded because sharing
        # them is how Debian works: /usr, /usr/bin and
        # /etc/systemd/system/multi-user.target.wants are in several of these
        # payloads and none of that is a defect.
        dup=""
        while read -r mode _own _size _date _time path _rest; do
            [ -n "${mode}" ] || continue
            case "${mode}" in
            d*) continue ;;
            esac
            path="${path#./}"
            path="${path%/}"
            [ -n "${path}" ] || continue
            PATHS_N=$((PATHS_N + 1))
            if [ -n "${owner[${path}]:-}" ]; then
                dup="${dup} /${path} (also in ${owner[${path}]})"
            else
                owner["${path}"]="${name}"
            fi
        done <<<"${listing}"
        if [ -z "${dup}" ]; then
            pass "${name} ${arch}: owns no non-directory path another package in the pool owns"
        else
            fail "${name} ${arch}: ships path(s) another package already owns:${dup}. Two packages owning one file means whichever unpacks second wins, and there is no Replaces here to make that defined"
        fi

        # d -- copyright, present and non-empty. The size column is the
        # archive's own record of it.
        copy_size="$(awk -v p="./usr/share/doc/${name}/copyright" '$6 == p { print $3; exit }' <<<"${listing}")"
        if [ -n "${copy_size}" ] && [ "${copy_size}" -gt 0 ]; then
            pass "${name} ${arch}: ships /usr/share/doc/${name}/copyright (${copy_size} bytes)"
        else
            fail "${name} ${arch}: ships no non-empty /usr/share/doc/${name}/copyright (size: ${copy_size:-absent})"
        fi

        # e -- the enablement links, counted as SYMLINKS and not as paths: a
        # regular file with the right name would not start anything.
        links="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { print $6 }' <<<"${listing}" | LC_ALL=C sort | tr '\n' ' ')"
        link_n="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { n++ } END { print n + 0 }' <<<"${listing}")"
        want="${WANTS_EXPECTED[${name}]:-}"
        if [ -z "${want}" ]; then
            fail "${name} ${arch}: no producer declares it, so this gate has no enablement expectation for it"
        elif [ "${link_n}" = "${want}" ]; then
            pass "${name} ${arch}: ${link_n} multi-user.target.wants symlink(s), as its producer requires${links:+ (${links% })}"
        else
            fail "${name} ${arch}: ships ${link_n} multi-user.target.wants symlink(s)${links:+ (${links% })}, but its producer requires ${want}. mosd owns the MQTT lifecycle and starts those units from the mqtt settings subtree; a link in an MQTT payload starts a broker nobody asked for"
        fi

        # f and g -- the control archive.
        ctl="/work/${arch}/${name}"
        mkdir -p "${ctl}"
        dpkg-deb --control "${deb}" "${ctl}"
        if [ -e "${ctl}/conffiles" ]; then
            fail "${name} ${arch}: carries DEBIAN/conffiles. This root is an immutable dm-verity squashfs; a conffile promises dpkg a three-way merge against local edits that cannot exist and cannot be applied"
        else
            pass "${name} ${arch}: carries no DEBIAN/conffiles"
        fi
        for s in preinst postinst prerm postrm; do
            [ -f "${ctl}/${s}" ] || continue
            SCRIPTS_N=$((SCRIPTS_N + 1))
            if err="$(sh -n "${ctl}/${s}" 2>&1)"; then
                pass "${name} ${arch}: DEBIAN/${s} parses as POSIX sh"
            else
                fail "${name} ${arch}: DEBIAN/${s} is not valid POSIX sh: ${err}"
            fi
        done
    done
done

# One version across every pool, not merely within one. A pool built at an
# older commit than its neighbour ships a device an image whose packages come
# from two trees.
all_versions="$(printf '%s\n' "${VERSIONS[@]}" | LC_ALL=C sort -u | tr '\n' ' ')"
if [ "$(printf '%s\n' "${VERSIONS[@]}" | LC_ALL=C sort -u | wc -l)" -eq 1 ]; then
    pass "one version across every pool (${all_versions% })"
else
    fail "the pools hold more than one version [${all_versions% }]: they were not built from one commit"
fi

echo "note: external dependencies resolved by the composer, not by this pool: $(printf '%s\n' ${EXTERNALS[@]+"${EXTERNALS[@]}"} | LC_ALL=C sort -u | tr '\n' ' ')"
echo "GATE-COUNTS ${PASS_N} ${FAIL_N} ${ARCHIVES_N} ${PATHS_N} ${SCRIPTS_N}"
INNER

read -r STATIC_PASS STATIC_FAIL ARCHIVES_N PATHS_N SCRIPTS_N < <(sed -n 's/^GATE-COUNTS //p' "${STATIC_LOG}") || true
[ -n "${STATIC_PASS:-}" ] || {
    echo "error: the container run produced no GATE-COUNTS line, so nothing above it was actually asserted; its output is in ${STATIC_LOG}" >&2
    exit 1
}

if [ "${static_status}" != 0 ] || [ "${STATIC_FAIL}" != 0 ]; then
    # The rebuild below takes minutes and would compare archives the checks
    # above have just called malformed -- and worse, it OVERWRITES them, which
    # would erase the evidence of whatever went wrong. Stop here instead.
    echo "note: the reproducibility check was not run; fix the failures above first"
    echo "RESULT: FAIL ($((STATIC_PASS))/$((STATIC_PASS + STATIC_FAIL)) checks passed, ${ARCHIVES_N} archives, ${PATHS_N} payload paths, ${SCRIPTS_N} maintainer scripts)"
    exit 1
fi

# ------------------------------------------------------------------- c
#
# TWO BUILDS UNDER ONE SOURCE_DATE_EPOCH, BYTE-IDENTICAL.
#
# DEFEATING THE CACHE IS THE ENTIRE DIFFICULTY. The producers are built through
# buildx, and a second run of os/pkgs/mosd/hack/build-deb.sh normally replays
# the cached packing layer and re-exports the same bytes it exported the first
# time. That proves the EXPORT is deterministic and says nothing about pack.sh:
# it would report identical archives even if pack.sh stamped `date` into every
# control file.
#
# So the second build runs on a buildx builder CREATED HERE, moments ago, whose
# cache is empty by construction -- there is no earlier result in it to replay.
# build-deb.sh honours BUILDX_BUILDER, so this needs no flag it does not have.
#
# HOW A READER CAN TELL IT IS STILL DEFEATED, later, without trusting this
# comment: pack.sh prints one line per archive it writes, and a layer served
# from cache prints nothing at all. The build below runs under
# BUILDKIT_PROGRESS=plain and is REQUIRED to contain pack.sh's own line for
# every package compared. If a future change lets the cache back in, that line
# disappears and this check fails -- it does not quietly become a comparison of
# an archive with itself.
REBUILD_PRODUCER=mosd
mapfile -t REBUILD_PACKAGES < <(
    for t in "${DEB_DIR}/${REBUILD_PRODUCER}"/control/*.control; do
        awk '/^Package:/ { sub(/^Package:[[:space:]]*/, ""); print; exit }' "${t}"
    done | LC_ALL=C sort
)
[ "${#REBUILD_PACKAGES[@]}" -gt 0 ] || {
    echo "error: ${DEB_DIR}/${REBUILD_PRODUCER}/control/ declares no package, so the rebuild below would compare nothing" >&2
    exit 1
}

REPRO_PASS=0
REPRO_FAIL=0
COMPARED_N=0
GATE_BUILDERS=()
cleanup_builders() {
    for b in ${GATE_BUILDERS[@]+"${GATE_BUILDERS[@]}"}; do
        docker buildx rm "${b}" >/dev/null 2>&1 || true
    done
}
trap cleanup_builders EXIT

for arch in "${ARCHES[@]}"; do
    pool="${DIST}/${arch}/pool"
    before="${WORK}/before/${arch}"
    mkdir -p "${before}"
    names=()
    for p in "${REBUILD_PACKAGES[@]}"; do
        mapfile -t found < <(find "${pool}" -maxdepth 1 -type f -name "${p}_*_${arch}.deb" -printf '%f\n')
        [ "${#found[@]}" -eq 1 ] || {
            echo "error: ${pool} holds ${#found[@]} archives matching ${p}_*_${arch}.deb; the reproducibility check needs exactly the one the rebuild will replace" >&2
            exit 1
        }
        cp "${pool}/${found[0]}" "${before}/${found[0]}"
        names+=("${found[0]}")
    done

    builder="mos-deb-gate-${arch}-$$"
    docker buildx create --name "${builder}" --driver docker-container >/dev/null
    GATE_BUILDERS+=("${builder}")

    log="${WORK}/rebuild-${arch}.log"
    echo "deb-package-gate: rebuilding the ${REBUILD_PRODUCER} producer for ${arch} on the empty-cache builder '${builder}'"
    rebuild_status=0
    BUILDX_BUILDER="${builder}" BUILDKIT_PROGRESS=plain \
        bash "${BUILD_DEB}" --producer "${REBUILD_PRODUCER}" --arch "${arch}" >"${log}" 2>&1 || rebuild_status=1
    if [ "${rebuild_status}" != 0 ]; then
        REPRO_FAIL=$((REPRO_FAIL + 1))
        echo "FAIL: ${arch}: the second build of the ${REBUILD_PRODUCER} producer did not complete; its output is in ${log}"
        tail -n 20 "${log}"
        continue
    fi

    for n in "${names[@]}"; do
        COMPARED_N=$((COMPARED_N + 1))
        # pack.sh ran, rather than a cached layer being replayed: this is the
        # line it prints for the archive it just wrote.
        if [ "$(grep -c "pack\.sh: ${n} " "${log}" || true)" -gt 0 ]; then
            REPRO_PASS=$((REPRO_PASS + 1))
            echo "PASS: ${arch}: the second build re-ran pack.sh for ${n} rather than replaying a cached layer"
        else
            REPRO_FAIL=$((REPRO_FAIL + 1))
            echo "FAIL: ${arch}: ${log} carries no 'pack.sh: ${n}' line, so the packing layer was served from cache and the comparison below is of an archive with itself. The empty-cache builder is what prevents this"
            continue
        fi
        if cmp -s "${before}/${n}" "${pool}/${n}"; then
            REPRO_PASS=$((REPRO_PASS + 1))
            echo "PASS: ${arch}: ${n} is byte-identical across two builds at one SOURCE_DATE_EPOCH"
        else
            REPRO_FAIL=$((REPRO_FAIL + 1))
            echo "FAIL: ${arch}: ${n} differs between two builds at one SOURCE_DATE_EPOCH ($(stat -c%s "${before}/${n}") bytes then, $(stat -c%s "${pool}/${n}") bytes now). Something in the packing path is not a function of its inputs"
        fi
    done

    docker buildx rm "${builder}" >/dev/null 2>&1 || true
done

[ "${COMPARED_N}" -gt 0 ] || {
    echo "error: no archive was rebuilt and compared, so the reproducibility check asserted nothing" >&2
    exit 1
}

PASS_N=$((STATIC_PASS + REPRO_PASS))
FAIL_N=$((STATIC_FAIL + REPRO_FAIL))
echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) ($((PASS_N))/$((PASS_N + FAIL_N)) checks passed, ${ARCHIVES_N} archives, ${PATHS_N} payload paths, ${SCRIPTS_N} maintainer scripts, ${COMPARED_N} rebuilt archives compared)"
[ "${FAIL_N}" -eq 0 ]
