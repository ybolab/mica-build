#!/usr/bin/env bash
# Feed every example in docs/design/containers.md to the Quadlet generator this
# image ships.
#
#   bash os/tests/quadlet-doc-test.sh

# A document full of configuration examples rots silently: Quadlet gains a key,
# drops one, renames a section, and the examples go on looking correct to every
# reader, because nothing in a markdown file can fail. So the examples are
# extracted from the document and run through the real generator -- the arm64
# binary in os/podman/out-arm64, under emulation, the one the device runs.

# The marker is an HTML comment, `<!-- quadlet: NAME -->`, immediately before
# the fenced block. Invisible when the document is rendered, unambiguous to
# parse, and it names the file the block is, because Quadlet's behaviour
# depends on the extension: a `.network` and a `.container` holding identical
# bytes generate different units.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
DOC="${REPO_ROOT}/docs/design/containers.md"
QUADLET="${MOS_QUADLET_BIN:-${REPO_ROOT}/os/podman/out-arm64/quadlet}"

[ -f "${DOC}" ] || { echo "error: ${DOC} not found" >&2; exit 1; }
[ -f "${QUADLET}" ] || {
    echo "error: ${QUADLET} not found. This test runs the generator the image ships, not a description of it; build it with 'make podman'" >&2
    exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
UNITS="${WORK}/units"
mkdir -p "${UNITS}"

# --- extract
# Every `<!-- quadlet: NAME -->` followed by a fenced block becomes NAME.
python3 - "${DOC}" "${UNITS}" <<'PY'
import io, re, sys
doc, out = sys.argv[1], sys.argv[2]
text = io.open(doc, encoding="utf-8").read()
pattern = re.compile(
    r"<!--\s*quadlet:\s*(?P<name>[A-Za-z0-9._-]+)\s*-->\s*\n```[a-z]*\n(?P<body>.*?)```",
    re.S,
)
names = []
for m in pattern.finditer(text):
    name = m.group("name")
    io.open(f"{out}/{name}", "w", encoding="utf-8").write(m.group("body"))
    names.append(name)
if not names:
    sys.stderr.write(
        "error: no `<!-- quadlet: NAME -->` blocks found in the document. "
        "Either the examples lost their markers or this extractor's pattern no "
        "longer matches them -- and an extractor that finds nothing makes every "
        "assertion below pass over an empty set.\n"
    )
    sys.exit(1)
print(" ".join(names))
PY
EXTRACTED="$(python3 - "${DOC}" <<'PY'
import io, re, sys
text = io.open(sys.argv[1], encoding="utf-8").read()
print(" ".join(re.findall(r"<!--\s*quadlet:\s*([A-Za-z0-9._-]+)\s*-->", text)))
PY
)"
count="$(printf '%s\n' ${EXTRACTED} | grep -c .)"
echo "extracted ${count} example(s): ${EXTRACTED}"

# The document's own claim about how many examples it carries. Without this a
# document that lost five of six examples would still pass, on the one left.
if [ "${count}" -lt 5 ]; then
    echo "error: only ${count} examples were extracted. docs/design/containers.md is the integrator's guide to interconnection, dependency and persistence, and it cannot demonstrate those in fewer than five files" >&2
    exit 1
fi

# --- run the real generator
# In a container, because the binary is aarch64 and this host is not. Same
# builder selection as os/podman/build.sh: buildx's docker-container driver
# bundles QEMU, so no host binfmt registration is needed.
BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -c 'linux/arm64' >/dev/null; then
    docker buildx inspect mos-arm64 >/dev/null 2>&1 ||
        docker buildx create --name mos-arm64 --driver docker-container >/dev/null
    BUILDER_ARGS=(--builder mos-arm64)
fi

cp "${QUADLET}" "${WORK}/quadlet"

# The base, from os/build-env/images.env, and by the --build-arg form rather
# than by interpolating a reference into the heredoc. That is forced by the
# heredoc's own body: the RUN below relies on ${out} reaching the Dockerfile
# unexpanded, so the delimiter has to stay quoted and nothing in here expands
# on the host side. `ARG` before `FROM` is the shape every Dockerfile in the
# tree uses -- declared with no default, so a build that forgets the argument
# is refused rather than falling back to something.

# It matters for this test specifically because what runs in the container is
# the quadlet binary out of os/podman/out-arm64, generating systemd units that
# are then asserted against docs/design/containers.md. It is dynamically
# linked, so the base decides the glibc it loads against, and a base that
# drifted would surface as a documentation test failing about unit content.
mapfile -t FROM_ARGS < <(bash "${REPO_ROOT}/os/build-env/from.sh" \
    MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE)
# mapfile cannot fail, so its status says nothing about the process inside the
# substitution; an empty array is what a refusal looks like from here, and an
# empty array would build with no --build-arg and no FROM at all. Same check,
# and for the same reason, as os/podman/build.sh's.
[ "${#FROM_ARGS[@]}" -eq 2 ] || {
    echo "error: os/build-env/from.sh did not yield the base image (see its message above); this build would have run with an empty FROM" >&2
    exit 1
}

cat >"${WORK}/Dockerfile" <<'DOCKERFILE'
ARG MOS_IMAGE_DEBIAN_TRIXIE
FROM ${MOS_IMAGE_DEBIAN_TRIXIE} AS run
COPY quadlet /usr/libexec/podman/quadlet
COPY units/ /etc/containers/systemd/
RUN set -eu; \
    out="$(/usr/libexec/podman/quadlet --dryrun 2>&1)"; \
    printf '%s\n' "${out}" >/generated.txt; \
    printf '%s\n' "${out}"
FROM scratch AS artifact
COPY --from=run /generated.txt /
DOCKERFILE

docker buildx build "${BUILDER_ARGS[@]}" \
    "${FROM_ARGS[@]}" \
    --platform linux/arm64 \
    -f "${WORK}/Dockerfile" \
    -o "${WORK}/out" \
    "${WORK}" >"${WORK}/build.log" 2>&1 || {
    echo "error: the Quadlet generator failed on the document's examples:" >&2
    tail -40 "${WORK}/build.log" >&2
    exit 1
}
GENERATED="${WORK}/out/generated.txt"

# --- assert
pass=0
fail=0
check() {
    if eval "$2"; then
        printf '  PASS: %s\n' "$1"; pass=$((pass + 1))
    else
        printf '  FAIL: %s\n' "$1"; fail=$((fail + 1))
    fi
}

# The generator prints this when it parsed nothing. Asserted FIRST, because
# every other assertion below is about the content of its output, and an empty
# output would make a grep for an absent string look like a passing negative.
check "the generator parsed the document's files rather than reporting none" \
    "! grep -q 'No files parsed from' '${GENERATED}'"

for name in ${EXTRACTED}; do
    stem="${name%.*}"
    ext="${name##*.}"
    case "${ext}" in
    container) unit="${stem}.service" ;;
    volume)    unit="${stem}-volume.service" ;;
    network)   unit="${stem}-network.service" ;;
    *)         echo "  FAIL: ${name} has an extension this test does not map to a unit name"; fail=$((fail + 1)); continue ;;
    esac
    check "${name} generates ${unit}" \
        "grep -q '${unit}' '${GENERATED}'"
done

# The claims the document makes IN PROSE, checked against what the generator
# actually produced. These are the sentences an integrator acts on.
check "web.container's ExecStart invokes the podman this image installs" \
    "grep -qE 'ExecStart=/usr/bin/podman' '${GENERATED}'"
check "api.service is ordered after db.service, as section 5 says" \
    "grep -qE 'After=.*db\\.service' '${GENERATED}'"
# `grep -q db` was the first version of this and matched `db.service` -- it
# would have passed with NetworkAlias silently dropped, which is precisely the
# failure section 5 tells the integrator cannot happen.
check "section 5's promise that api reaches db BY NAME reaches podman as --network-alias" \
    "grep -qE -- '--network-alias db' '${GENERATED}'"
check "db.container's volume dependency is wired without the document saying so" \
    "grep -qE 'Requires=pgdata-volume\\.service' '${GENERATED}'"
check "joining a .network wires the network unit dependency too" \
    "grep -qE 'Requires=app-network\\.service' '${GENERATED}'"

echo
if [ "${fail}" -eq 0 ]; then
    echo "RESULT: PASS (${pass}/${pass} checks)"
else
    echo "RESULT: FAIL ($((pass)) passed, ${fail} failed of $((pass + fail)))"
    echo "--- generator output ---"
    cat "${GENERATED}"
    exit 1
fi
