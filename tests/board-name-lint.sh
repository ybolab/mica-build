#!/usr/bin/env bash
# No board name in the engine. A board is data in ybolab/mica-boards and a
# pin here; the assembly dispatches on its facts (build/src/board-facts.ts:
# the boot backend, the firmware format, the FIT load map, the architecture)
# and never on its name. The names are read from the pins, so a board added
# tomorrow is covered the day it is pinned.
#
#   bash tests/board-name-lint.sh          lint the tree
#   bash tests/board-name-lint.sh --test   prove the lint goes red on a planted literal
#
# Scope: Makefile, build/src, verify/src, rootfs/, tools/. Not tests/ and not
# *.test.ts (fixtures name boards on purpose), not the pinned rootfs/debian/,
# not products/ (a product names its board) and not deps/. A comment line,
# and a Makefile help line (`@echo "  ...`), may name a board: prose is not
# dispatch. tests/board-name-lint.allow lists files still to be re-keyed, one
# repository-relative path per line; it is empty when phase 3 of
# mica:20260913-0416-board-product-build-architecture is done.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"
ALLOW="${REPO_ROOT}/tests/board-name-lint.allow"

lint() { # <root>: prints every finding, returns 1 when there is one
    local root="$1" names pattern findings=0 f
    names="$(for p in "${root}"/deps/packages/mica-kernel-*.json; do [ -e "${p}" ] || continue; b="${p##*/mica-kernel-}"; printf '%s\n' "${b%.json}"; done | sort -u)"
    [ -n "${names}" ] || { echo "error: ${root}/deps/packages pins no mica-kernel-<board>.json, so the lint has no name to look for" >&2; return 2; }
    pattern="\\b($(printf '%s\n' ${names} | paste -sd'|'))\\b"
    local allowed=""
    [ ! -f "${ALLOW}" ] || allowed="$(grep -vE '^\s*(#|$)' "${ALLOW}" || true)"
    while IFS= read -r f; do
        rel="${f#"${root}"/}"
        case " ${allowed} " in *" ${rel} "*) continue ;; esac
        # Comment lines and Makefile help lines are prose.
        hits="$(grep -nE "${pattern}" "${f}" | grep -vE '^[0-9]+:\s*(#|//|\*|/\*)' | grep -vE '^[0-9]+:\s*@echo "  ' || true)"
        [ -z "${hits}" ] || { printf '%s\n' "${hits}" | sed "s|^|${rel}:|"; findings=$((findings + 1)); }
    done < <({ printf '%s\n' "${root}/Makefile"; find "${root}/build/src" "${root}/verify/src" "${root}/rootfs" "${root}/tools" -type f \( -name '*.ts' -o -name '*.sh' -o -name '*.py' -o -name 'Dockerfile' -o -name '*.Dockerfile' \) \
        -not -path '*/node_modules/*' -not -name '*.test.ts' -not -path "${root}/rootfs/debian/*" 2>/dev/null; } | sort)
    [ "${findings}" -eq 0 ]
}

case "${1:-}" in
--test)
    work="$(mktemp -d "${REPO_ROOT}/tmp/board-name-lint.XXXXXX")"
    trap 'rm -rf "${work}"' EXIT
    mkdir -p "${work}/deps/packages" "${work}/build/src" "${work}/verify/src" "${work}/rootfs" "${work}/tools"
    cp "${REPO_ROOT}"/deps/packages/mica-kernel-*.json "${work}/deps/packages/"
    cp "${REPO_ROOT}/Makefile" "${work}/Makefile"
    first="$(for p in "${work}"/deps/packages/mica-kernel-*.json; do b="${p##*/mica-kernel-}"; printf '%s\n' "${b%.json}"; break; done)"
    # A clean copy passes...
    printf 'export const x = 1\n' >"${work}/build/src/clean.ts"
    if ALLOW=/dev/null lint "${work}" >/dev/null; then echo "PASS: a tree with no board name is clean"; else echo "FAIL: a clean tree was reported" >&2; exit 1; fi
    # ...a planted literal is red, naming the file and the line...
    printf "export const board = '%s'\n" "${first}" >"${work}/build/src/planted.ts"
    if out="$(ALLOW=/dev/null lint "${work}")"; then echo "FAIL: a planted '${first}' in build/src/planted.ts was not reported" >&2; exit 1; fi
    case "${out}" in *"build/src/planted.ts:1:"*) echo "PASS: the planted literal is reported at build/src/planted.ts:1" ;; *) echo "FAIL: the report does not name build/src/planted.ts:1: ${out}" >&2; exit 1 ;; esac
    # ...and a comment is not dispatch.
    printf "// the %s board\nexport const y = 2\n" "${first}" >"${work}/build/src/planted.ts"
    if ALLOW=/dev/null lint "${work}" >/dev/null; then echo "PASS: a board name in a comment is prose"; else echo "FAIL: a comment was reported" >&2; exit 1; fi
    echo "RESULT: PASS (3/3)"
    ;;
'')
    if out="$(lint "${REPO_ROOT}")"; then
        echo "RESULT: PASS (no board name in the engine; pins: $(for p in deps/packages/mica-kernel-*.json; do b="${p##*/mica-kernel-}"; printf '%s ' "${b%.json}"; done))"
    else
        printf '%s\n' "${out}"
        echo "RESULT: FAIL ($(printf '%s\n' "${out}" | wc -l) line(s) dispatch on a board name; see tests/board-name-lint.sh)"
        exit 1
    fi
    ;;
*) echo "usage: bash tests/board-name-lint.sh [--test]" >&2; exit 1 ;;
esac
