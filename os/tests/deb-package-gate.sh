#!/usr/bin/env bash
# The package-level gates of PLAN-036 section 6, over the built pools.
#
#   bash os/tests/deb-package-gate.sh
#
#   reads   _out/debs/<arch>/pool/*.deb          (built by `make os-debs`)
#   asserts the facts listed below, per architecture
#
# Every fact is read OUT OF an archive with `dpkg-deb`, never from a list kept
# here: a gate that compares the pool against a table in its own file reports
# on the table. The only things written down are the EXPECTATIONS, and even
# those are derived from the tree where they can be -- the producers come out of
# os/build-env/deb/producers.sh and the package names out of their
# <producer>/control/*.control, so a producer that gains or loses a package, and
# a repository that gains or loses a producer, are both covered without this
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
#      is the discovered producers' set; one version spans the whole pool; every
#      LOCAL dependency is pinned to that exact version and is present in the
#      pool. Everything else is EXTERNAL and is reported, not judged:
#      `mos-system` and `passwd` are external and expected.
#   c  two builds under one SOURCE_DATE_EPOCH are byte-identical. See the long
#      comment on the cache below -- this is the check that most easily passes
#      without having run anything.
#   d  every package ships a non-empty /usr/share/doc/<package>/copyright.
#   e  each package ships exactly as many multi-user.target.wants symlinks as
#      its producer DECLARES in os/pkgs/<component>/deb/<producer>/enablement.
#      The symlink is the fact under test, so it cannot also be the source of
#      the expectation; a producer that declares nothing is refused by name
#      rather than defaulted to zero, and a package that ships no link says so
#      explicitly. This is the check a later "helpful" enablement has to get
#      past.
#   f  no package carries DEBIAN/conffiles. The root is an immutable dm-verity
#      squashfs, so a conffile promises a three-way merge that cannot happen.
#   g  every maintainer script that exists parses as POSIX sh. Nothing else in
#      the tree covers them: os/tests/shell-pipefail-lint.sh scans files that
#      enable pipefail, and these are #!/bin/sh and do not.
#   h  the pool and the producer set account for each other, BOTH DIRECTIONS.
#      Every discovered producer contributed archives, and every archive maps
#      back to a discovered control template. A producer `make os-debs` silently
#      skipped, and an archive left behind by a producer that was deleted, each
#      fail by name -- naming the PRODUCER, which is the thing to go and look at.
#
# NOT CHECKED HERE, deliberately: installing the packages into a clean root with
# APT -- mosd depends on `mos-system`, which the composer workstream owns and
# this pool does not contain, so the install would fail for a reason that is not
# a defect.
#
# The host carries no dpkg, so the reading happens inside
# localhost/mos-build-deb -- the same arrangement os/build-env/deb/repo.sh uses,
# and for the same reason.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
PRODUCERS_SH="${REPO_ROOT}/os/build-env/deb/producers.sh"
DIST="${REPO_ROOT}/_out/debs"
for p in "${FROM_SH}" "${PRODUCERS_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. This gate derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. dpkg-deb runs inside localhost/mos-build-deb rather than on the host, and the reproducibility check drives a real package build" >&2
    exit 1
}

# THE PRODUCER SET, discovered rather than named here. producers.sh is the one
# implementation of what a producer is and where it lives; this gate and
# `make os-debs` read the same answer, so a producer cannot be built by one and
# unknown to the other. It refuses an empty discovery by name, which is what
# stops this whole file from checking nothing and reporting green.
#
# CAPTURED, never piped into a reader: `producers.sh | while` would report the
# reader's status and swallow exactly that refusal.
mapfile -t ROWS < <(bash "${PRODUCERS_SH}")
[ "${#ROWS[@]}" -gt 0 ] || {
    echo "error: os/build-env/deb/producers.sh named no producer (see its message above). Every expectation below is derived from that set, and over an empty one they all hold" >&2
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

# The producers' own declarations, staged into one tree the container is handed.
# Staged rather than mounting os/pkgs wholesale, for the reason
# os/build-env/deb/repo.sh mounts _out/debs/<arch> and nothing above it: this
# reads control templates and enablement declarations and has no business seeing
# every package's sources. The shape is fixed --
# <component>/<producer>/{control/<package>.control,enablement} -- so the
# container walks a known depth instead of re-deriving the layout.
TMPL="${WORK}/tmpl"
for row in "${ROWS[@]}"; do
    read -r component producer _driver <<<"${row}"
    src="${REPO_ROOT}/os/pkgs/${component}/deb/${producer}"
    dst="${TMPL}/${component}/${producer}"
    mkdir -p "${dst}"
    cp -R "${src}/control" "${dst}/control"
    # Copied only when it exists: its ABSENCE is a fact the container reports,
    # by name and per producer. Failing here instead would move that message out
    # of the gate's own PASS/FAIL accounting.
    [ ! -f "${src}/enablement" ] || cp "${src}/enablement" "${dst}/enablement"
done

# ------------------------------------------------------ a, b, d, e, f, g, h
#
# One container reading both pools. The producers' declarations come in beside
# them so every expectation is the producers' own statement of it.

STATIC_LOG="${WORK}/static.log"
static_status=0
docker run --rm -i \
    --label ai-agent=true \
    -v "${DIST}:/dist:ro" \
    -v "${TMPL}:/tmpl:ro" \
    -e "PRODUCER_N=${#ROWS[@]}" \
    --entrypoint /bin/bash \
    "${IMAGE}" -s "${ARCHES[@]}" 2>&1 <<'INNER' | tee "${STATIC_LOG}" || static_status=1
set -euo pipefail

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

ARCHES=("$@")

# The producers, off the staged tree: /tmpl/<component>/<producer>. The count is
# checked against what os/build-env/deb/producers.sh discovered on the host, so
# a staging step that silently dropped one cannot quietly shrink every
# expectation below.
mapfile -t PRODUCER_DIRS < <(find /tmpl -mindepth 2 -maxdepth 2 -type d | LC_ALL=C sort)
[ "${#PRODUCER_DIRS[@]}" -eq "${PRODUCER_N}" ] || {
    echo "error: ${#PRODUCER_DIRS[@]} producer(s) reached this container, but os/build-env/deb/producers.sh discovered ${PRODUCER_N}. Every expectation below is derived per producer, so a dropped one is a set of checks that silently do not happen" >&2
    exit 1
}

LOCAL_NAMES=()
declare -A WANTS_EXPECTED=()
declare -A PKG_PRODUCER=()
declare -A PRODUCER_PACKAGES=()
for d in "${PRODUCER_DIRS[@]}"; do
    rel="${d#/tmpl/}"
    producer="${rel}"

    # The package set, out of the producer's own control templates. Read from
    # the Package: field and not from the filename, because the filename is a
    # convention and the field is the fact.
    mapfile -t templates < <(find "${d}/control" -mindepth 1 -maxdepth 1 -type f -name '*.control' | LC_ALL=C sort)
    [ "${#templates[@]}" -gt 0 ] || {
        echo "error: the producer ${producer} declares no control/*.control, so it contributes nothing to the expected package set and every check over its packages would pass by comparing nothing" >&2
        exit 1
    }

    # THE ENABLEMENT DECLARATION. The multi-user.target.wants symlink IS the
    # fact check e tests, so the expectation cannot be derived from the archive
    # -- that would assert that whatever shipped is what was meant. Each
    # producer states it in the tree instead, and a producer that states nothing
    # is refused BY NAME rather than defaulted to zero: defaulting would let a
    # new package ship a unit nothing ever starts, or ship one that starts
    # itself, and still report green.
    [ -f "${d}/enablement" ] || {
        echo "error: the producer ${producer} ships no enablement declaration. Create os/pkgs/${producer}/enablement with one '<package> <count>' line per package it emits, stating how many /etc/systemd/system/multi-user.target.wants symlinks that package ships -- '0' for a package that must not start itself. There is no default: a missing file and a deliberate zero look identical, and only one of them is a decision. See os/build-env/deb/README.md" >&2
        exit 1
    }
    declare -A declared=()
    while read -r pkg count rest; do
        case "${pkg}" in '' | '#'*) continue ;; esac
        [ -z "${rest}" ] || {
            echo "error: os/pkgs/${producer}/enablement line '${pkg} ${count} ${rest}' carries more than a package and a count. The shape is '<package> <count>'" >&2
            exit 1
        }
        case "${count}" in
        '' | *[!0-9]*)
            echo "error: os/pkgs/${producer}/enablement declares '${pkg} ${count}', whose count is not a non-negative integer. It is the NUMBER of multi-user.target.wants symlinks that package ships" >&2
            exit 1
            ;;
        esac
        declared["${pkg}"]="${count}"
    done <"${d}/enablement"

    packages=""
    for t in "${templates[@]}"; do
        name="$(awk '/^Package:/ { sub(/^Package:[[:space:]]*/, ""); print; exit }' "${t}")"
        [ -n "${name}" ] || {
            echo "error: ${t} declares no Package:, so the package it describes has no name to check the pool against" >&2
            exit 1
        }
        # One package, one producer. Two producers emitting one name would
        # collide in the shared pool, and 'which producer owns this archive'
        # -- the question check h answers -- would have two answers.
        [ -z "${PKG_PRODUCER[${name}]:-}" ] || {
            echo "error: the package '${name}' is declared by two producers, ${PKG_PRODUCER[${name}]} and ${producer}. They write into one shared pool under one filename, so whichever builds second silently replaces the other" >&2
            exit 1
        }
        [ -n "${declared[${name}]:-}" ] || {
            echo "error: the producer ${producer} emits '${name}' and its enablement declaration does not mention it. Add a '${name} <count>' line to os/pkgs/${producer}/enablement; a package left out of that file has no stated enablement, and inferring one from what it happens to ship is what this gate exists to not do" >&2
            exit 1
        }
        WANTS_EXPECTED["${name}"]="${declared[${name}]}"
        PKG_PRODUCER["${name}"]="${producer}"
        LOCAL_NAMES+=("${name}")
        packages="${packages}${name} "
    done
    PRODUCER_PACKAGES["${producer}"]="${packages}"

    # The other direction of the same file: a line naming a package this
    # producer does not emit is a declaration about nothing -- most likely a
    # package that was renamed on one side only.
    for pkg in "${!declared[@]}"; do
        case " ${packages}" in
        *" ${pkg} "*) ;;
        *)
            echo "error: os/pkgs/${producer}/enablement declares '${pkg}', which that producer does not emit. It emits: ${packages% }" >&2
            exit 1
            ;;
        esac
    done
    unset declared
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
        fail "${arch}: the pool holds [${got_set% }], but os/pkgs/*/deb/*/control/ declares [${EXPECTED_SET% }]. A missing package is one the composer cannot install; an extra one is an archive no producer owns"
    fi

    # h -- THE VACUITY GUARD, both directions, per producer.
    #
    # The set comparison above already fails on either of these; what it cannot
    # say is WHICH PRODUCER to go and look at, and with ten producers in the
    # tree that is the whole cost of the diagnosis. It also compares two sets
    # that are both derived, so it stays silent about a producer whose archives
    # are absent from the pool AND whose packages are absent from the expected
    # set -- which is what a producer discovered but never run looks like from
    # here.
    for producer in "${!PRODUCER_PACKAGES[@]}"; do
        want_pkgs="${PRODUCER_PACKAGES[${producer}]}"
        found_n=0
        missing=""
        for pkg in ${want_pkgs}; do
            in_pool=0
            for g in "${got_names[@]}"; do
                [ "${pkg}" != "${g}" ] || in_pool=1
            done
            if [ "${in_pool}" = 1 ]; then
                found_n=$((found_n + 1))
            else
                missing="${missing} ${pkg}"
            fi
        done
        if [ "${found_n}" = 0 ]; then
            fail "${arch}: the producer ${producer} contributed NO archive to ${pool}, though it declares [${want_pkgs% }]. \`make os-debs\` runs every discovered producer; this one built nothing, or its output went somewhere else"
        elif [ -n "${missing}" ]; then
            fail "${arch}: the producer ${producer} contributed only part of what it declares -- missing:${missing}. A producer emits its whole package set or the pool is a half-built one"
        else
            pass "${arch}: the producer ${producer} contributed all of [${want_pkgs% }]"
        fi
    done
    orphan=""
    for g in "${got_names[@]}"; do
        [ -n "${PKG_PRODUCER[${g}]:-}" ] || orphan="${orphan} ${g}"
    done
    if [ -z "${orphan}" ]; then
        pass "${arch}: every archive in the pool maps back to a discovered producer's control template"
    else
        fail "${arch}: ${pool} holds archive(s) no discovered producer declares:${orphan}. Most likely a producer was deleted or renamed and its output was left behind; repo.sh indexes it and the composer would install it"
    fi

    # One version across the pool. The packages are built from one commit and
    # the local ones pin each other exactly, so a pool holding two versions is a
    # half-rebuilt one -- and the exact-version dependency below has no single
    # value to be checked against.
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
                    fail "${name} ${arch}: depends on the local package ${dep_name} as '${alt# }', which is not the exact version (= ${VERSION}) this pool was built at. These are built from one commit across interfaces that carry no compatibility promise"
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
        # mosd is the base of the local closure WITHIN THE mosd COMPONENT: it
        # owns the D-Bus surface the other packages of that workspace speak, and
        # each of them is built from the same commit. Scoped to the component
        # rather than to the pool, because that is the scope the claim was ever
        # true at -- a rauc or podman package has no reason to speak mosd's
        # interface, and asserting it over them would be asserting something
        # nobody believes. Every package of os/pkgs/mosd/ is still covered.
        if [ "${PKG_PRODUCER[${name}]%%/*}" = mosd ] && [ "${name}" != mosd ]; then
            case "${local_deps}" in
            *" mosd "*) pass "${name} ${arch}: pins mosd" ;;
            *) fail "${name} ${arch}: declares no dependency on mosd. Every package of the mosd workspace but mosd itself is built from mosd's commit and speaks its interface" ;;
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
        # regular file with the right name would not start anything. The
        # expectation is the producer's declaration, read above.
        links="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { print $6 }' <<<"${listing}" | LC_ALL=C sort | tr '\n' ' ')"
        link_n="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { n++ } END { print n + 0 }' <<<"${listing}")"
        want="${WANTS_EXPECTED[${name}]:-}"
        if [ -z "${want}" ]; then
            fail "${name} ${arch}: no producer declares it, so this gate has no enablement expectation for it"
        elif [ "${link_n}" = "${want}" ]; then
            pass "${name} ${arch}: ${link_n} multi-user.target.wants symlink(s), as os/pkgs/${PKG_PRODUCER[${name}]}/enablement declares${links:+ (${links% })}"
        else
            fail "${name} ${arch}: ships ${link_n} multi-user.target.wants symlink(s)${links:+ (${links% })}, but os/pkgs/${PKG_PRODUCER[${name}]}/enablement declares ${want}. Either the payload gained a link nothing asked for, or the declaration is behind the package"
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
# buildx, and a second run of a producer's driver normally replays the cached
# packing layer and re-exports the same bytes it exported the first time. That
# proves the EXPORT is deterministic and says nothing about pack.sh: it would
# report identical archives even if pack.sh stamped `date` into every control
# file.
#
# So the second build runs on a buildx builder CREATED HERE, moments ago, whose
# cache is empty by construction -- there is no earlier result in it to replay.
# The drivers honour BUILDX_BUILDER, so this needs no flag they do not have.
#
# HOW A READER CAN TELL IT IS STILL DEFEATED, later, without trusting this
# comment: pack.sh prints one line per archive it writes, and a layer served
# from cache prints nothing at all. The build below runs under
# BUILDKIT_PROGRESS=plain and is REQUIRED to contain pack.sh's own line for
# every package compared. If a future change lets the cache back in, that line
# disappears and this check fails -- it does not quietly become a comparison of
# an archive with itself.
#
# WHICH producer, per architecture: the discovered set is sorted, and each
# architecture takes a different row of it. One producer rebuilt twice would
# leave every other producer's packing path unexercised by this check, and the
# two architectures agreeing on which one to skip is the least useful pair of
# runs available. With a single producer discovered the two necessarily
# coincide; there is nothing else to choose.
for i in "${!ARCHES[@]}"; do
    arch="${ARCHES[${i}]}"
    read -r component producer driver <<<"${ROWS[$((i % ${#ROWS[@]}))]}"

    mapfile -t rebuild_packages < <(
        for t in "${REPO_ROOT}/os/pkgs/${component}/deb/${producer}"/control/*.control; do
            awk '/^Package:/ { sub(/^Package:[[:space:]]*/, ""); print; exit }' "${t}"
        done | LC_ALL=C sort
    )
    [ "${#rebuild_packages[@]}" -gt 0 ] || {
        echo "error: os/pkgs/${component}/deb/${producer}/control/ declares no package, so the rebuild for ${arch} would compare nothing" >&2
        exit 1
    }
    eval "REBUILD_PACKAGES_${arch}=(\"\${rebuild_packages[@]}\")"
    eval "REBUILD_PRODUCER_${arch}='${producer}'"
    eval "REBUILD_DRIVER_${arch}='${driver}'"
done

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
    eval "producer=\"\${REBUILD_PRODUCER_${arch}}\""
    eval "driver=\"\${REBUILD_DRIVER_${arch}}\""
    eval "packages=(\"\${REBUILD_PACKAGES_${arch}[@]}\")"

    pool="${DIST}/${arch}/pool"
    before="${WORK}/before/${arch}"
    mkdir -p "${before}"
    names=()
    for p in "${packages[@]}"; do
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
    echo "deb-package-gate: rebuilding the ${producer} producer for ${arch} on the empty-cache builder '${builder}'"
    rebuild_status=0
    BUILDX_BUILDER="${builder}" BUILDKIT_PROGRESS=plain \
        bash "${REPO_ROOT}/${driver}" --producer "${producer}" --arch "${arch}" >"${log}" 2>&1 || rebuild_status=1
    if [ "${rebuild_status}" != 0 ]; then
        REPRO_FAIL=$((REPRO_FAIL + 1))
        echo "FAIL: ${arch}: the second build of the ${producer} producer did not complete; its output is in ${log}"
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
