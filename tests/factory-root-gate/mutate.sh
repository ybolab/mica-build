#!/bin/bash
# Can inner.sh's four comparisons fail? Runs INSIDE the tool container, against
# the trees inner.sh already extracted.
#
#   bash mutate.sh <work-dir>
#
# A comparison that has only ever been seen agreeing is not a check, and this
# campaign has found six or more passes of exactly that kind in code that had
# been green for months. Each mutation below is applied to the OCI side ALONE,
# the comparison it targets is re-run and required to go red, the mutation is
# reverted, and the comparison is re-run and required to go silent -- so a pass
# here means the check fired AND that it is not now permanently red.
#
# THE CAPABILITY CASE IS THE ONE THAT MATTERS MOST. This root carries ZERO file
# capabilities, so inner.sh's caps comparison compares an empty file with an
# empty file and prints agreement. Without the mutation below, that line says
# "nothing looked" while reading as "no capability was lost".
#
# gate.sh always runs this. It is not an optional second pass.
set -euo pipefail

work="${1:?usage: mutate.sh <work>}"
sq="${work}/sq"
oci="${work}/ocix"
[ -d "${sq}" ] && [ -d "${oci}" ] || {
    echo "error: ${sq} and ${oci} are not both there; run inner.sh first" >&2
    exit 1
}

fails=0
inventory() { ( cd "$1" && find . -mindepth 1 -printf '%M %U %G %P\n' | LC_ALL=C sort ); }
caps() { ( cd "$1" && getcap -r . 2>/dev/null | LC_ALL=C sort ); }
links() { ( cd "$1" && find . -type f -links +1 -printf '%n %P\n' | LC_ALL=C sort ); }

meta_cmp() { diff -q <(inventory "${sq}") <(inventory "${oci}"); }
content_cmp() { diff -r --no-dereference "${sq}" "${oci}"; }
caps_cmp() { diff -q <(caps "${sq}") <(caps "${oci}"); }
links_cmp() { diff -q <(links "${sq}") <(links "${oci}"); }

# $1 label, $2 comparison name, $3.. the comparison to run
expect_differs() {
    if "${@:3}" >/dev/null 2>&1; then
        echo "  !! $1: the $2 comparison still agreed. It cannot see this, so every run of"
        echo "     it so far has been a check that could not fail."
        fails=$((fails + 1))
    else
        echo "  ok $1: the $2 comparison went red"
    fi
}
expect_agrees() {
    if "${@:3}" >/dev/null 2>&1; then
        echo "  ok $1: reverted, $2 agrees again"
    else
        echo "  !! $1: NOT reverted -- $2 is still red, so the run above proved nothing"
        fails=$((fails + 1))
    fi
}

target="${oci}/usr/bin/rauc"
[ -f "${target}" ] || {
    echo "error: ${target} is not in the export, so there is nothing to mutate here." >&2
    echo "       Either the rauc feature stage was declined, or this is not a factory root." >&2
    exit 1
}

echo "== 1. a single mode bit =="
orig_mode="$(stat -c %a "${target}")"
chmod 0700 "${target}"
expect_differs "mode 0${orig_mode} -> 0700" "metadata" meta_cmp
chmod "0${orig_mode}" "${target}"
expect_agrees "mode" "metadata" meta_cmp

echo "== 2. a single gid =="
orig_gid="$(stat -c %g "${target}")"
chown ":42" "${target}"
expect_differs "gid ${orig_gid} -> 42" "metadata" meta_cmp
chown ":${orig_gid}" "${target}"
expect_agrees "gid" "metadata" meta_cmp

echo "== 3. a renamed path =="
mv "${target}" "${target}-renamed"
expect_differs "usr/bin/rauc -> usr/bin/rauc-renamed" "metadata" meta_cmp
mv "${target}-renamed" "${target}"
expect_agrees "rename" "metadata" meta_cmp

echo "== 4. a single byte =="
cp -a "${target}" "${work}/rauc.orig"
printf 'x' | dd of="${target}" bs=1 seek=64 conv=notrunc status=none
expect_differs "one byte at offset 64" "content" content_cmp
# Restored by copy rather than by writing the byte back: a revert that left the
# mode or the mtime changed would make the next check pass for the wrong reason.
cp -a "${work}/rauc.orig" "${target}"
expect_agrees "byte" "content" content_cmp

echo "== 5. a file capability =="
# The one this root cannot demonstrate on its own, added to the OCI side only,
# so the comparison has something to notice for the first time.
setcap cap_net_raw+ep "${target}"
expect_differs "cap_net_raw+ep added to usr/bin/rauc" "capabilities" caps_cmp
setcap -r "${target}"
expect_agrees "capability" "capabilities" caps_cmp

echo "== 6. a broken hardlink =="
# `| sed -n '1p'` and not `| head -1`: this file sets pipefail, and head exits
# as soon as it has its line, so the producer dies of SIGPIPE and the whole
# substitution reports failure -- under `set -e`, an exit with no message at
# all. It happened here. tests/shell-pipefail-lint.sh exists for the grep -q
# form of the same trap.
linked="$(cd "${oci}" && find . -type f -links +1 -printf '%P\n' | LC_ALL=C sort | sed -n '1p')"
[ -n "${linked}" ] || { echo "  !! no multiply-linked file in the export to break" >&2; exit 1; }
inode="$(stat -c %i "${oci}/${linked}")"
sibling="$(cd "${oci}" && find . -inum "${inode}" -printf '%P\n' | { grep -vx "${linked}" || true; } | sed -n '1p')"
[ -n "${sibling}" ] || { echo "  !! ${linked} claims >1 link and no sibling was found" >&2; exit 1; }
rm "${oci}/${linked}"
cp -a "${oci}/${sibling}" "${oci}/${linked}"
expect_differs "hardlink ${linked} <-> ${sibling} broken into two files" "hardlink" links_cmp
rm "${oci}/${linked}"
ln "${oci}/${sibling}" "${oci}/${linked}"
expect_agrees "hardlink" "hardlink" links_cmp

echo
if [ "${fails}" -eq 0 ]; then
    echo "MUTATION: all four comparisons were driven from the failing side and fired"
else
    echo "MUTATION: ${fails} check(s) could not be made to fail, so inner.sh's agreement"
    echo "          on them means nothing."
    exit 1
fi
