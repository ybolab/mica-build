#!/usr/bin/env bash
# Exercise producer input accounting in an isolated repository fixture.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT=$PWD
mkdir -p "$REPO_ROOT/tmp"
TMP=$(mktemp -d "$REPO_ROOT/tmp/deb-preflight.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
PASS_N=0 FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }
says() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
fixture="$TMP/repo"
mkdir -p "$fixture/build-env/deb" "$fixture/pkgs/component" "$fixture/payload"
cp build-env/deb/{preflight,producers}.sh "$fixture/build-env/deb/"
printf 'fixture\n' > "$fixture/Makefile"
printf '#!/bin/bash\nprintf "fixture-image\\n"\n' > "$fixture/build-env/from.sh"
printf 'FROM scratch\n' > "$fixture/pkgs/component/Dockerfile"
cat > "$fixture/pkgs/component/producer.env" <<'ENV'
PACKAGES=mos-fixture
ARCHES=all
BUILD_CONTEXTS=payload=payload
VERSION_FROM=version.env:FIXTURE_VERSION
PREPARE=prepare.sh
PREFLIGHT=1
ENV
printf 'FIXTURE_VERSION=1.0\n' > "$fixture/version.env"
cat > "$fixture/pkgs/component/prepare.sh" <<'HOOK'
#!/bin/bash
set -eu
test "$MOS_DEB_PREFLIGHT" = 1
test -z "${MOS_DEB_STAGE:-}"
for count in examined missing warned; do
    test "${OMIT_COUNT:-}" != "$count" || continue
    case "$count" in
        examined) value=${EXAMINED:-3};;
        missing) value=${MISSING:-0};;
        warned) value=${WARNED:-0};;
    esac
    printf 'preflight-%s: %s\n' "$count" "$value"
done
exit "${HOOK_EXIT:-0}"
HOOK
run_fixture() {
    PF_RC=0
    PF_OUT=$(env "$@" bash "$fixture/build-env/deb/preflight.sh" 2>&1) || PF_RC=$?
}
run_fixture
if [ "$PF_RC" = 0 ] && says "$PF_OUT" '7 of 7 examined inputs are present'; then pass 'complete producer accounts for all inputs'; else fail "$PF_OUT"; fi
mv "$fixture/payload" "$fixture/payload.saved"
mv "$fixture/version.env" "$fixture/version.saved"
run_fixture
if [ "$PF_RC" != 0 ] && says "$PF_OUT" '2 of 7 examined inputs are missing' && says "$PF_OUT" 'payload does not exist' && says "$PF_OUT" 'version.env does not exist'; then pass 'missing context and version are both reported'; else fail "$PF_OUT"; fi
mv "$fixture/payload.saved" "$fixture/payload"
mv "$fixture/version.saved" "$fixture/version.env"
for name in examined missing warned; do
    run_fixture "OMIT_COUNT=$name"
    if [ "$PF_RC" != 0 ] && says "$PF_OUT" "usable preflight-$name count"; then pass "missing $name hook count is refused"; else fail "$PF_OUT"; fi
done
run_fixture EXAMINED=0
if [ "$PF_RC" != 0 ]; then pass 'zero examined hook count is refused'; else fail 'empty hook was accepted'; fi
run_fixture WARNED=2
if [ "$PF_RC" = 0 ] && says "$PF_OUT" 'a further 2 of 7'; then pass 'producible inputs warn without failing'; else fail "$PF_OUT"; fi
run_fixture HOOK_EXIT=9
if [ "$PF_RC" != 0 ] && says "$PF_OUT" 'exited 9'; then pass 'unexplained hook failure is preserved'; else fail "$PF_OUT"; fi
run_fixture MISSING=2 HOOK_EXIT=1
if [ "$PF_RC" != 0 ] && says "$PF_OUT" '2 of 7 examined inputs are missing'; then pass 'missing hook inputs are counted individually'; else fail "$PF_OUT"; fi
printf 'UNRELATED=1\n' > "$fixture/version.env"
run_fixture
if [ "$PF_RC" != 0 ] && says "$PF_OUT" 'no non-empty FIXTURE_VERSION'; then pass 'missing version key is named'; else fail "$PF_OUT"; fi

# The podman versions stamp and its pre-flight (the former section D) are
# exercised in ybolab/mica-podman, beside the producer they belong to.

echo "RESULT: $PASS_N passed, $FAIL_N failed"
test "$FAIL_N" = 0
