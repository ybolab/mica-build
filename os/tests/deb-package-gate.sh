#!/usr/bin/env bash
# The package-level gates of PLAN-036 section 6, over the built pools.
#
#   bash os/tests/deb-package-gate.sh
#
#   reads   _out/debs/<arch>/pool/*.deb          (built by `make os-debs`)
#   asserts the facts listed below, per architecture
#
# Every fact is read OUT OF an archive with `dpkg-deb`, never from a list kept
# here: a gate that compares the pool against a table in its own file reports on
# the table. The only things written down are the EXPECTATIONS, and even those
# are derived from the tree -- the producers come out of
# os/build-env/deb/producers.sh and what each emits out of its own producer.env
# -- so a producer that gains or loses a package, and a repository that gains or
# loses a producer, are both covered without this file being edited.
#
# WHAT IS CHECKED
#
#   a  unique file ownership across the local packages of ONE pool. No
#      non-directory path is in two archives of that pool; directories are
#      shared on purpose (/usr, /usr/bin, the wants directory) and are not
#      flagged. `Replaces` is refused outright -- it is the field that would
#      make an overlap install cleanly, and no control template in this tree has
#      one. `Provides` and `Conflicts` are NOT refused: they are different
#      fields with legitimate uses, and one of them is checked at (i).
#   b  Package, Version, Architecture and the Depends closure. Each archive
#      declares the architecture of the pool it sits in OR `all`; the pool's
#      package set is what the producers building for that pool declare; one
#      version spans the whole pool. See (i) for how a dependency is classified.
#   c  two builds under one SOURCE_DATE_EPOCH are byte-identical. See the long
#      comment on the cache below -- this is the check that most easily passes
#      without having run anything.
#   d  every package ships a non-empty /usr/share/doc/<package>/copyright.
#   e  each PACKAGE ships exactly as many multi-user.target.wants symlinks as
#      its producer declares for it in ENABLEMENT. Per package and never a
#      universal count: some packages own the unit that starts them, some own no
#      unit at all, and both are correct. The symlink IS the fact under test, so
#      the expectation cannot be derived from the archive; a package with no row
#      is a hard failure by name, and zero is spelled out rather than inferred
#      from a missing row.
#   f  no package carries DEBIAN/conffiles. The root is an immutable dm-verity
#      squashfs, so a conffile promises a three-way merge that cannot happen.
#   g  every maintainer script that exists parses as POSIX sh. Nothing else in
#      the tree covers them: os/tests/shell-pipefail-lint.sh scans files that
#      enable pipefail, and these are #!/bin/sh and do not.
#   h  the pool and the producer set account for each other, BOTH DIRECTIONS.
#      Every producer that builds for a pool contributed archives to it, and
#      every archive maps back to a discovered producer. A producer
#      `make os-debs` silently skipped, and an archive left behind by a producer
#      that was deleted, each fail by name -- naming the PRODUCER, which is the
#      thing to go and look at. PACKAGES is also cross-checked against the
#      control templates actually present, so the declaration and the templates
#      cannot drift apart.
#   i  ARCHITECTURE: ALL, and VIRTUAL PROVIDES.
#      An `Architecture: all` archive is a legitimate member of EVERY pool: its
#      producer runs one build and exports it into both. So it is not an
#      ownership collision, and the one-version rule spans it. What IS checked is
#      that the copies are the SAME BYTES -- the composer resolves each pool
#      independently, and two pools holding different archives under one filename
#      is a device whose package set depends on which pool it installed from.
#      A dependency is LOCAL-REAL when a producer emits a package of that name,
#      and then it must be pinned to the exact version and be in the pool.
#      It is LOCAL-VIRTUAL when no producer emits it but an archive in the pool
#      declares it in `Provides` -- `mos-profile` is provided by both
#      mos-profile-dev and mos-profile-prod and no archive of that name exists.
#      A virtual name is satisfied by the Provides and is NOT version-pinned: an
#      unversioned Provides cannot satisfy an exact-version dependency at all, so
#      requiring one would be requiring something unsatisfiable. Anything else is
#      EXTERNAL and is reported, not judged: `mos-system` and `passwd` are
#      external and expected.
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
BUILD_SH="${REPO_ROOT}/os/build-env/deb/build.sh"
DIST="${REPO_ROOT}/_out/debs"
for p in "${FROM_SH}" "${PRODUCERS_SH}" "${BUILD_SH}"; do
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
# the two pools `make os-debs` indexes. Written here rather than discovered from
# _out/debs, because a discovered list turns a pool that was never built into a
# gate that checks one architecture and reports green. NOT the producers'
# ARCHES: those say what each producer builds, and this says what must exist.
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

# The producers' own declarations, staged into one tree the container is handed:
# the discovery rows, and each producer's control templates beside them. Staged
# rather than mounting the repository, for the reason os/build-env/deb/repo.sh
# mounts _out/debs/<arch> and nothing above it -- this reads declarations and
# has no business seeing every package's sources.
TMPL="${WORK}/tmpl"
mkdir -p "${TMPL}"
printf '%s\n' "${ROWS[@]}" >"${TMPL}/producers.tsv"
for row in "${ROWS[@]}"; do
    read -r producer dir _arches _packages _enablement <<<"${row}"
    mkdir -p "${TMPL}/p/${producer}"
    # Copied only when it exists: its ABSENCE is a fact the container reports by
    # name. Failing here would move that message out of the gate's own PASS/FAIL
    # accounting.
    [ ! -d "${REPO_ROOT}/${dir}/control" ] || cp -R "${REPO_ROOT}/${dir}/control" "${TMPL}/p/${producer}/control"
done

# ------------------------------------------------- a, b, d, e, f, g, h, i
#
# One container reading both pools. The producers' declarations come in beside
# them so every expectation is the producers' own statement of it.

STATIC_LOG="${WORK}/static.log"
static_status=0
docker run --rm -i \
    --label ai-agent=true \
    -v "${DIST}:/dist:ro" \
    -v "${TMPL}:/tmpl:ro" \
    --entrypoint /bin/bash \
    "${IMAGE}" -s "${ARCHES[@]}" 2>&1 <<'INNER' | tee "${STATIC_LOG}" || static_status=1
set -euo pipefail

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

ARCHES=("$@")

mapfile -t ROWS < /tmpl/producers.tsv
[ "${#ROWS[@]}" -gt 0 ] || {
    echo "error: /tmpl/producers.tsv is empty, so no producer reached this container and every expectation below would be derived from nothing" >&2
    exit 1
}

LOCAL_NAMES=()
declare -A PKG_PRODUCER=()
declare -A PKG_DIR=()
declare -A WANTS_EXPECTED=()
declare -A PRODUCER_PACKAGES=()
declare -A PRODUCER_ARCHES=()
for row in "${ROWS[@]}"; do
    read -r producer dir arches packages enablement <<<"${row}"
    packages="$(printf '%s' "${packages}" | tr ',' ' ')"
    arches="$(printf '%s' "${arches}" | tr ',' ' ')"
    PRODUCER_PACKAGES["${producer}"]=" ${packages} "
    PRODUCER_ARCHES["${producer}"]=" ${arches} "

    # PACKAGES against the control templates actually present, BOTH directions.
    # producer.env says what the producer emits and pack.sh needs one template
    # per package; the two are separate statements of one fact and this is what
    # stops them drifting. A package declared with no template would fail at
    # build time; a template for a package not declared is one nothing packs and
    # nothing expects, which fails nowhere at all.
    mapfile -t templates < <(find "/tmpl/p/${producer}/control" -mindepth 1 -maxdepth 1 -type f -name '*.control' 2>/dev/null | LC_ALL=C sort)
    tmpl_names=""
    for t in ${templates[@]+"${templates[@]}"}; do
        n="$(awk '/^Package:/ { sub(/^Package:[[:space:]]*/, ""); print; exit }' "${t}")"
        [ -n "${n}" ] || {
            echo "error: ${dir}/control/$(basename "${t}") declares no Package:, so the package it describes has no name to check the pool against" >&2
            exit 1
        }
        tmpl_names="${tmpl_names}${n} "
    done
    want_sorted="$(printf '%s\n' ${packages} | LC_ALL=C sort | tr '\n' ' ')"
    got_sorted="$(printf '%s\n' ${tmpl_names} | LC_ALL=C sort | tr '\n' ' ')"
    [ "${want_sorted}" = "${got_sorted}" ] || {
        echo "error: the producer '${producer}' declares PACKAGES='${want_sorted% }' and ${dir}/control/ holds templates for '${got_sorted% }'. Those are two statements of one fact and they have come apart: pack.sh needs a template per package, and a template nothing declares is packed by nothing and expected by nothing" >&2
        exit 1
    }

    # THE ENABLEMENT DECLARATION, PER PACKAGE. A producer emitting two packages
    # needs a row for each: one of them may own the unit that starts it while
    # the other owns no unit at all, and both are correct. Zero is spelled out.
    [ "${enablement}" != "-" ] || {
        echo "error: the producer '${producer}' declares no ENABLEMENT. Add ENABLEMENT='<package>=<count> ...' to ${dir}/producer.env with a row per package it emits, stating how many /etc/systemd/system/multi-user.target.wants symlinks that package ships -- 0 for a package that ships none. There is no default: a missing row and a deliberate zero look identical, and only one of them is a decision. See os/build-env/deb/README.md" >&2
        exit 1
    }
    declared=""
    for e in $(printf '%s' "${enablement}" | tr ',' ' '); do
        pkg="${e%%=*}"
        count="${e#*=}"
        [ -n "${pkg}" ] && [ "${pkg}" != "${e}" ] || {
            echo "error: the producer '${producer}' declares ENABLEMENT entry '${e}', which is not <package>=<count>" >&2
            exit 1
        }
        case "${count}" in
        '' | *[!0-9]*)
            echo "error: the producer '${producer}' declares ENABLEMENT '${e}', whose count is not a non-negative integer. It is the NUMBER of multi-user.target.wants symlinks that package ships" >&2
            exit 1
            ;;
        esac
        case " ${packages} " in
        *" ${pkg} "*) ;;
        *)
            echo "error: the producer '${producer}' declares ENABLEMENT for '${pkg}', which it does not emit. It emits: ${packages}" >&2
            exit 1
            ;;
        esac
        WANTS_EXPECTED["${pkg}"]="${count}"
        declared="${declared}${pkg} "
    done
    for pkg in ${packages}; do
        case " ${declared}" in
        *" ${pkg} "*) ;;
        *)
            echo "error: the producer '${producer}' emits '${pkg}' and its ENABLEMENT does not mention it. Add '${pkg}=<count>' to ${dir}/producer.env; a package left out has no stated enablement, and inferring one from what it happens to ship is what this gate exists to not do" >&2
            exit 1
            ;;
        esac
    done

    for pkg in ${packages}; do
        [ -z "${PKG_PRODUCER[${pkg}]:-}" ] || {
            echo "error: the package '${pkg}' is declared by two producers, '${PKG_PRODUCER[${pkg}]}' and '${producer}'. They write into one shared pool under one filename, so whichever builds second silently replaces the other" >&2
            exit 1
        }
        PKG_PRODUCER["${pkg}"]="${producer}"
        PKG_DIR["${pkg}"]="${dir}"
        LOCAL_NAMES+=("${pkg}")
    done
done

ARCHIVES_N=0
PATHS_N=0
SCRIPTS_N=0
VERSIONS=()
EXTERNALS=()
VIRTUALS=()
# sha256 of every Architecture: all archive, per pool, keyed <package>|<pool>.
declare -A ALL_SHA=()
ALL_PKGS=""

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

    # The producers that build for THIS pool: the ones whose ARCHES names it,
    # plus every `all` producer, whose one archive is a member of every pool.
    pool_producers=""
    expected=""
    for producer in "${!PRODUCER_ARCHES[@]}"; do
        case "${PRODUCER_ARCHES[${producer}]}" in
        *" ${arch} "* | *" all "*)
            pool_producers="${pool_producers}${producer} "
            expected="${expected}${PRODUCER_PACKAGES[${producer}]# } "
            ;;
        esac
    done
    EXPECTED_SET="$(printf '%s\n' ${expected} | LC_ALL=C sort | tr '\n' ' ')"

    got_names=()
    pool_versions=()
    for d in "${debs[@]}"; do
        got_names+=("$(dpkg-deb --field "${pool}/${d}" Package)")
        pool_versions+=("$(dpkg-deb --field "${pool}/${d}" Version)")
    done
    VERSIONS+=("${pool_versions[@]}")

    got_set="$(printf '%s\n' "${got_names[@]}" | LC_ALL=C sort | tr '\n' ' ')"
    if [ "${got_set}" = "${EXPECTED_SET}" ]; then
        pass "${arch}: the pool holds exactly the packages its producers declare (${got_set% })"
    else
        fail "${arch}: the pool holds [${got_set% }], but the producers building for ${arch} declare [${EXPECTED_SET% }]. A missing package is one the composer cannot install; an extra one is an archive no producer owns"
    fi

    # h -- THE VACUITY GUARD, both directions, per producer.
    #
    # The set comparison above already fails on either of these; what it cannot
    # say is WHICH PRODUCER to go and look at, and with ten producers in the
    # tree that is the whole cost of the diagnosis.
    for producer in ${pool_producers}; do
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
            fail "${arch}: the producer '${producer}' contributed NO archive to ${pool}, though it declares [${want_pkgs# }] and builds for ${arch}. \`make os-debs\` runs every discovered producer; this one built nothing, or its output went somewhere else"
        elif [ -n "${missing}" ]; then
            fail "${arch}: the producer '${producer}' contributed only part of what it declares -- missing:${missing}. A producer emits its whole package set or the pool is a half-built one"
        else
            pass "${arch}: the producer '${producer}' contributed all of [${want_pkgs# }]"
        fi
    done
    orphan=""
    for g in "${got_names[@]}"; do
        [ -n "${PKG_PRODUCER[${g}]:-}" ] || orphan="${orphan} ${g}"
    done
    if [ -z "${orphan}" ]; then
        pass "${arch}: every archive in the pool maps back to a discovered producer"
    else
        fail "${arch}: ${pool} holds archive(s) no discovered producer declares:${orphan}. Most likely a producer was deleted or renamed and its output was left behind; repo.sh indexes it and the composer would install it"
    fi

    # One version across the pool, SPANNING the Architecture: all archives in it.
    # They are built from the same commit as everything else, so an `all` archive
    # at another version is the same half-rebuilt pool a native one would be.
    pool_version="$(printf '%s\n' "${pool_versions[@]}" | LC_ALL=C sort -u | tr '\n' ' ')"
    if [ "$(printf '%s\n' "${pool_versions[@]}" | LC_ALL=C sort -u | wc -l)" -eq 1 ]; then
        pass "${arch}: one version across the pool (${pool_version% })"
    else
        fail "${arch}: the pool holds more than one version [${pool_version% }]. Rebuild it whole with \`make os-debs\`"
    fi
    VERSION="${pool_versions[0]}"

    # LOCAL-VIRTUAL names: what the archives of this pool declare in Provides.
    # Collected before the closure below, because a dependency may name one.
    declare -A PROVIDED_BY=()
    for d in "${debs[@]}"; do
        prov="$(dpkg-deb --field "${pool}/${d}" Provides)"
        pname="$(dpkg-deb --field "${pool}/${d}" Package)"
        IFS=',' read -ra pentries <<<"${prov}"
        for pe in ${pentries[@]+"${pentries[@]}"}; do
            read -r vname _rest <<<"${pe}"
            vname="${vname%%(*}"
            [ -n "${vname}" ] || continue
            PROVIDED_BY["${vname}"]="${PROVIDED_BY[${vname}]:-}${pname} "
        done
    done

    unset owner
    declare -A owner=()
    for d in "${debs[@]}"; do
        deb="${pool}/${d}"
        name="$(dpkg-deb --field "${deb}" Package)"
        version="$(dpkg-deb --field "${deb}" Version)"
        declared_arch="$(dpkg-deb --field "${deb}" Architecture)"
        depends="$(dpkg-deb --field "${deb}" Depends)"
        replaces="$(dpkg-deb --field "${deb}" Replaces)"

        # b/i -- architecture. A cross-packed archive is well formed and installs
        # nowhere. `all` is correct in EVERY pool: one build, exported to both.
        if [ "${declared_arch}" = "${arch}" ]; then
            pass "${name} ${arch}: declares Architecture: ${declared_arch}"
        elif [ "${declared_arch}" = all ]; then
            pass "${name} ${arch}: declares Architecture: all, a member of every pool"
            ALL_SHA["${name}|${arch}"]="$(sha256sum "${deb}" | cut -d' ' -f1)"
            case " ${ALL_PKGS} " in
            *" ${name} "*) ;;
            *) ALL_PKGS="${ALL_PKGS}${name} " ;;
            esac
        else
            fail "${name} in the ${arch} pool declares Architecture: ${declared_arch}. It was packed in the wrong container or filed under the wrong architecture"
        fi

        # a -- Replaces. There is none in any control template in this tree, and
        # its only use here would be to let two packages own one path. Provides
        # and Conflicts are deliberately NOT refused: they are how one package
        # stands in for a virtual name and how two alternatives exclude each
        # other, and neither lets two packages own one file.
        if [ -z "${replaces}" ]; then
            pass "${name} ${arch}: declares no Replaces"
        else
            fail "${name} ${arch}: declares Replaces: ${replaces}. That field exists to let one package take a path from another, which is the overlap the ownership check below refuses; no control template in this tree has one"
        fi

        # b/i -- the Depends closure, three classes.
        local_deps=" "
        IFS=',' read -ra entries <<<"${depends}"
        for entry in ${entries[@]+"${entries[@]}"}; do
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
                    # LOCAL-VIRTUAL before EXTERNAL: a name no producer emits but
                    # an archive in this pool Provides is satisfied here, and
                    # calling it external would stop checking it at all.
                    if [ -n "${PROVIDED_BY[${dep_name}]:-}" ]; then
                        VIRTUALS+=("${dep_name}")
                        pass "${name} ${arch}: depends on the local virtual ${dep_name}, provided in this pool by ${PROVIDED_BY[${dep_name}]% }"
                    else
                        EXTERNALS+=("${dep_name}")
                    fi
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
        # mosd is the base of the local closure WITHIN THE mosd WORKSPACE: it
        # owns the D-Bus surface the other packages of that workspace speak, and
        # each of them is built from the same commit. Scoped to the producers
        # under os/pkgs/mosd/ rather than to the pool, because that is the scope
        # the claim was ever true at -- a rauc, podman or profile package has no
        # reason to speak mosd's interface, and asserting it over them would be
        # asserting something nobody believes.
        case "${PKG_DIR[${name}]}" in
        os/pkgs/mosd/*)
            if [ "${name}" != mosd ]; then
                case "${local_deps}" in
                *" mosd "*) pass "${name} ${arch}: pins mosd" ;;
                *) fail "${name} ${arch}: declares no dependency on mosd. Every package of the mosd workspace but mosd itself is built from mosd's commit and speaks its interface" ;;
                esac
            fi
            ;;
        esac

        # The payload, read once and used by a, d and e.
        listing="$(dpkg-deb --contents "${deb}")"

        # a -- unique file ownership, WITHIN one pool. Directories are excluded
        # because sharing them is how Debian works: /usr, /usr/bin and
        # /etc/systemd/system/multi-user.target.wants are in several of these
        # payloads and none of that is a defect. An `all` archive is compared
        # against the other members of the pool it is sitting in, and the map is
        # reset per pool -- the same archive appearing in both pools is one
        # package in two pools, not two packages claiming one path.
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
        # expectation is this PACKAGE's own declared row.
        links="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { print $6 }' <<<"${listing}" | LC_ALL=C sort | tr '\n' ' ')"
        link_n="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { n++ } END { print n + 0 }' <<<"${listing}")"
        want="${WANTS_EXPECTED[${name}]:-}"
        if [ -z "${want}" ]; then
            fail "${name} ${arch}: no producer declares an ENABLEMENT row for it, so this gate has no enablement expectation for it"
        elif [ "${link_n}" = "${want}" ]; then
            pass "${name} ${arch}: ${link_n} multi-user.target.wants symlink(s), as ${PKG_DIR[${name}]}/producer.env declares${links:+ (${links% })}"
        else
            fail "${name} ${arch}: ships ${link_n} multi-user.target.wants symlink(s)${links:+ (${links% })}, but ${PKG_DIR[${name}]}/producer.env declares ${want}. Either the payload gained a link nothing asked for, or lost one it needs, or the declaration is behind the package"
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
    unset PROVIDED_BY
done

# i -- THE SAME BYTES IN EVERY POOL, for each Architecture: all package.
#
# This is what makes accepting `all` in both pools a check rather than a hole.
# One build exports into both pools, so the two copies are identical by
# construction -- and the composer resolves each pool independently, so if that
# ever stops being true a device's package set depends on which pool it was
# installed from, under one filename and one version.
for pkg in ${ALL_PKGS}; do
    seen=""
    where=""
    for arch in "${ARCHES[@]}"; do
        s="${ALL_SHA[${pkg}|${arch}]:-}"
        [ -n "${s}" ] || continue
        where="${where}${arch}=${s:0:16} "
        case " ${seen} " in
        *" ${s} "*) ;;
        *) seen="${seen}${s} " ;;
        esac
    done
    if [ "$(printf '%s\n' ${seen} | wc -l)" -eq 1 ]; then
        pass "${pkg}: Architecture: all, byte-identical in every pool (${where% })"
    else
        fail "${pkg}: Architecture: all, but the pools hold DIFFERENT bytes under that one filename (${where% }). One build exports into every pool; two differing copies mean the composer installs a different package depending on which pool it resolved"
    fi
done

# One version across every pool, not merely within one. A pool built at an older
# commit than its neighbour ships a device an image whose packages come from two
# trees.
all_versions="$(printf '%s\n' "${VERSIONS[@]}" | LC_ALL=C sort -u | tr '\n' ' ')"
if [ "$(printf '%s\n' "${VERSIONS[@]}" | LC_ALL=C sort -u | wc -l)" -eq 1 ]; then
    pass "one version across every pool (${all_versions% })"
else
    fail "the pools hold more than one version [${all_versions% }]: they were not built from one commit"
fi

echo "note: local virtual dependencies satisfied by a Provides in the pool: $(printf '%s\n' ${VIRTUALS[@]+"${VIRTUALS[@]}"} | LC_ALL=C sort -u | tr '\n' ' ')"
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
# buildx, and a second run of os/build-env/deb/build.sh normally replays the
# cached packing layer and re-exports the same bytes it exported the first time.
# That proves the EXPORT is deterministic and says nothing about pack.sh: it
# would report identical archives even if pack.sh stamped `date` into every
# control file.
#
# So the second build runs on a buildx builder CREATED HERE, moments ago, whose
# cache is empty by construction -- there is no earlier result in it to replay.
# The driver honours BUILDX_BUILDER, so this needs no flag it does not have.
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
# architecture takes a different row of the producers that build for it. One
# producer rebuilt twice would leave every other producer's packing path
# unexercised, and the two architectures agreeing on which one to skip is the
# least useful pair of runs available. With a single producer discovered the two
# necessarily coincide; there is nothing else to choose.
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

for i in "${!ARCHES[@]}"; do
    arch="${ARCHES[${i}]}"

    # The rows that build for this pool, in discovery order.
    candidates=()
    for row in "${ROWS[@]}"; do
        read -r producer dir arches packages _enablement <<<"${row}"
        case ",${arches}," in
        *",${arch},"* | *",all,"*) candidates+=("${row}") ;;
        esac
    done
    [ "${#candidates[@]}" -gt 0 ] || {
        echo "error: no discovered producer builds for ${arch}, yet ${DIST}/${arch}/pool was checked above. The reproducibility check would rebuild nothing" >&2
        exit 1
    }
    read -r producer dir arches packages _enablement <<<"${candidates[$((i % ${#candidates[@]}))]}"

    # The architecture to rebuild AT: an `all` producer is rebuilt as `all`,
    # which writes every pool; a native one is rebuilt at this pool's.
    case ",${arches}," in
    *",all,"*) rebuild_arch=all ;;
    *) rebuild_arch="${arch}" ;;
    esac

    pool="${DIST}/${arch}/pool"
    before="${WORK}/before/${arch}"
    mkdir -p "${before}"
    names=()
    for p in $(printf '%s' "${packages}" | tr ',' ' '); do
        mapfile -t found < <(find "${pool}" -maxdepth 1 -type f \( -name "${p}_*_${arch}.deb" -o -name "${p}_*_all.deb" \) -printf '%f\n')
        [ "${#found[@]}" -eq 1 ] || {
            echo "error: ${pool} holds ${#found[@]} archives matching ${p}_*_{${arch},all}.deb; the reproducibility check needs exactly the one the rebuild will replace" >&2
            exit 1
        }
        cp "${pool}/${found[0]}" "${before}/${found[0]}"
        names+=("${found[0]}")
    done

    builder="mos-deb-gate-${arch}-$$"
    docker buildx create --name "${builder}" --driver docker-container >/dev/null
    GATE_BUILDERS+=("${builder}")

    log="${WORK}/rebuild-${arch}.log"
    echo "deb-package-gate: rebuilding the '${producer}' producer at --arch ${rebuild_arch} for the ${arch} pool on the empty-cache builder '${builder}'"
    rebuild_status=0
    BUILDX_BUILDER="${builder}" BUILDKIT_PROGRESS=plain \
        bash "${BUILD_SH}" --producer "${producer}" --arch "${rebuild_arch}" >"${log}" 2>&1 || rebuild_status=1
    if [ "${rebuild_status}" != 0 ]; then
        REPRO_FAIL=$((REPRO_FAIL + 1))
        echo "FAIL: ${arch}: the second build of the '${producer}' producer did not complete; its output is in ${log}"
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
