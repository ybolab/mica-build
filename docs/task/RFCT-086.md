# RFCT-086 The privileged CI lane, and the production key ceremony runbook

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-21 10:25
- **claimedAt**: 2026-08-21 10:25

Base `db57f2c` (RFCT-083 commit). One of the five roadmap workstreams the
RFCT-083 audit named and deferred: the "CI privileged-runner suites" item and
the "production key ceremony for bundle signing" item, which RFCT-083 closed
tooling-side ("the tooling now accepts real keys, owning them is an
operational act") and left as exactly that act.

## Scope

Two deliverables, both additive — no existing gate, script or image content
changed:

1. `.gitea/workflows/privileged.yml` — the suites `check.yml`'s closing
   summary discloses as not covered, on a dedicated `privileged` runner
   label. check.yml itself is untouched.
2. `docs/design/release-signing.md` — the production key ceremony runbook
   for both trust chains (TUF role keys via `mos-sign`, RAUC CMS CA via
   openssl), plus its index row in `docs/README.md`.

## Part 1: the privileged lane, and what shaped it

Measured before writing, not assumed: `mosd/hack/dbus-policy-test.sh` needs
root (drops to uid 65534 via setpriv), dbus-daemon and python3, and fails
loudly rather than skipping; `os/mkimage-v2-selftest.sh` fabricates every
BSP/rootfs input synthetically but needs docker with a **daemon-visible**
TMPDIR (its own preflight prints the `TMPDIR=_out/tmp` remedy);
`os/repart-loader-test.sh` needs privileged docker (loop devices) **and a
built image**, which no cheap job can supply.

That split dictates the two jobs:

- **`root-and-docker-suites`** (every push to main + PR): `make
  os-dbus-policy-test` and `bash os/mkimage-v2-selftest.sh` with TMPDIR
  pointed into the checkout. Minutes, no BSP artifacts.
- **`image-pipeline`** (`workflow_dispatch` + weekly cron, Mon 03:00 UTC):
  `cx3576-kernel` → `cx3576-uboot-mos` → `os-image-cx3576-v2` →
  `os-verify-cx3576-v2` → `os-devkeys` → `os-bundle-cx3576` → `os-repart-test`
  against the image just built. The comments state the duration honestly
  (RFCT-083 recorded the BSP builds as "hours"; nobody has measured a real
  runner) and note that layer-cache retention is a runner property this file
  deliberately does not configure, because no runner-agnostic stanza could be
  verified true.

Same discipline as check.yml: no `|| true`, no `continue-on-error`, plain
scripts (only `actions/checkout@v4`), fail-loud dependency installs, and
preflight steps that check the runner label's promises (root/sudo, docker
daemon, buildx, a `--privileged` loop-device probe) before hours are spent on
them. The concurrency group includes `github.event_name` so a push to main
cannot cancel the weekly deep run; superseded runs of the same kind still
cancel each other.

The header states the absent-runner semantics plainly: until a `privileged`
runner is registered these jobs are never scheduled — the run sits visibly
waiting, which is Gitea's behavior for an unmatched `runs-on` label, and is
not a green checkmark. Nothing converts "no runner" into a pass.

## Part 2: the runbook, and its honest gaps

`docs/design/release-signing.md`, in the access.md section-0 marker
discipline with a runbook-appropriate set (`[runbook]` /
`[not implemented]`). English-only, joining the recorded RFCT-045 exception
in `docs/README.md` — the zh siblings are hand-maintained, their revival is
parked with the user, and seven of them already carry RFCT-082 staleness
banners; a new translation was deliberately not started.

What it pins down: the offline TUF root ceremony around what `mos-sign`
actually does (one ed25519 key per role, `init` the only consumer of
`root.pk8`, `--threshold` capped at the key count since RFCT-083 so today it
is 1, explicit RFC 3339 expiries with a role-by-role horizon table, `verify`
requiring the out-of-band `--root`, `--allow-rollback` reserved for recorded
incidents); the RAUC production CA as an offline openssl mirror of
`os/rauc/gen-dev-keys.sh` with production subject/validity choices and the
same recorded no-EKU reasoning; the release bundle procedure through
`os/bundle.sh`'s CERT/KEY/KEYRING environment (the RFCT-083 fix that made a
production bundle buildable at all) into `mos-sign add`/`verify`; and a
"what never happens" list.

Gaps stated as `[not implemented]` rather than papered over: `mos-sign` has
no root-rotation command, so online-key revocation currently means a fresh
lineage and re-anchoring, and even the annual same-key root refresh is
blocked on the same missing command — dated against the 1-year root horizon;
and **no provisioning path ships a production keyring today** —
`build-v2.sh`/`verify-image-v2.sh` fail closed on a baked keyring
(`MOS_EXPECT_DEV_KEYRING=1` is a bench-only waiver), so a production image
cannot install any bundle until the RFCT-088 trust-anchor provisioning work
(running in parallel) lands. Both gaps cross-reference RFCT-088.

## Files changed

- `.gitea/workflows/privileged.yml` — new
- `docs/design/release-signing.md` — new
- `docs/README.md` — one index row under `design/`
- `docs/task/RFCT-086.md` — this record

## Verification

- `python3 -c "yaml.safe_load(...)"` parses `privileged.yml`; both jobs and
  all four triggers present.
- `make docs-verify` and `docs-verify-test` pass (the new document is
  indexed, both directions, once).
- No shell scripts were added; the workflow's `run:` blocks are
  `set -euo pipefail` throughout.
- Runtime-unverified, stated plainly: the workflow has never met a real
  `privileged` runner — first contact will measure the deep lane's duration
  and may surface runner-deployment quirks (rootless docker daemons fail the
  selftest's visible-workspace preflight by design). The runbook's commands
  are transcribed from the shipped tools' actual interfaces, but no
  production ceremony has been performed.

## Open questions

- Whether the deep lane's weekly cadence and 720-minute timeout survive
  contact with a real runner; both are stated as correctable in comments.
- The root-rotation gap: §1.6 of the runbook dates it against the 1-year
  root expiry. It needs a task of its own before that horizon.
- `check-purpose=` in `system.conf` (tightening the signer EKU) is flagged
  in the runbook as a decision to take with the CA ceremony, not decided
  here.
