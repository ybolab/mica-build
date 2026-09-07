# RFCT-342 Fetch the pinned Debian archives from a mirror

- **status**: completed
- **priority**: P2
- **owner**: bkd/57xb8wti
- **createdAt**: 2026-09-06 23:55

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

`rootfs/debian/packages/*.json` pins 172 archives by absolute
`https://snapshot.debian.org/archive/debian/<SNAPSHOT>/pool/...` URL, and
`run.sh cache` hands each one to `fetch.ts` verbatim. snapshot.debian.org is
slow and frequently rate-limits, and there is no way to point a cold cache
population at a nearer host.

`sources.env`'s `MIRROR` looks like the answer and is not: `run.sh` only uses
it to spell debootstrap's `apt_dest` index filename (line 180) and to pass it
to debootstrap itself (line 196), both after every archive is already local.
Nothing downloads through it.

## ActiveForm

Adding an optional fetch-time mirror for the pinned archives

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- An optional mirror that rewrites the prefix of each record's URL at fetch
  time, leaving the record — the provenance statement — untouched.
- Mirror first, canonical URL as fallback, committed SHA256 always. A mirror
  404 is normal; mirror bytes that do not match the pin are fatal and say so.
- The split (mirror / fallback) reported, so a decorative mirror is visible.
- Nothing reaches the network outside `cache`.
- No mirror in the committed defaults; an unconfigured build is unchanged.
- `tests/debian-base-test.sh` and `tests/debian-lock-test.sh` green, with the
  mirror path and its fallback covered.
- A real run against a real mirror, with the split reported.
- Documentation, and `sources.env`'s comment corrected about `MIRROR`.
- `make docs-verify` green from a `git archive` into an empty directory.

## Notes

- **The shape: a prefix rewrite, and the record never moves.** `MOS_DEBIAN_MIRROR`
  is read by `run.sh cache` and by nothing else. `mirror_url()` maps a record's
  URL to a mirror URL; the JSON keeps saying which snapshot and which pool path
  the pin came from, because that is provenance and a mirror is one host's
  configuration. Two shapes, declared by the value itself:
  `<base>` / `pool:<base>` gives `<base>/pool/<path>`, `snapshot:<base>` gives
  `<base>/archive/debian/<SNAPSHOT>/pool/<path>`. A value that is neither, and
  not `https://`, is refused by name.

- **Mirror first, the record's own URL as fallback, the committed SHA256
  always.** The hash check did not move and was not softened; it sits after
  whichever host answered, and its message now names the URL that produced the
  bytes. A mirror whose bytes do not match is fatal *and does not fall back* —
  the test asserts the canonical URL was never even asked, so no second attempt
  can launder a wrong mirror. Only a 404 falls back; any other mirror failure
  stops the run, because a broken mirror that silently fell back would be
  indistinguishable from a working one.

- **The split is reported because the fallback is silent.** A pool mirror
  carries the current pool while these pins are a snapshot, so a superseded pin
  is simply absent — normal, and more common the older the snapshot gets. `cache`
  prints `(N from the mirror, M from the pinned URL)` whenever a mirror is
  configured, and warns when a configured mirror served none of the archives
  downloaded. Unconfigured, the line is byte-identical to what it was.

- **Only `cache` can reach the network, and `docker.sh` enforces it at the
  boundary**: the `-e MOS_DEBIAN_MIRROR` forward exists in the `cache` branch
  only. `verify`, `select`, `install` and `configure` keep `--network none` and
  do not receive the variable; a test drives `verify` and `select` with a value
  `cache` would refuse, and both stay green.

- **Nine new checks (43 -> 52), and the transport is real where it has to be.**
  The 404 -> exit 44 mapping lives in `fetch.ts`, so a stubbed `fetch.ts`
  exiting 44 on command would be asserting the test's own arithmetic. Instead a
  Bun HTTPS server on loopback — which `--network none` still provides, so
  nothing is reached — serves the real `fetch.ts` a real 200 and a real 404. The
  404 case then falls back to the record's own snapshot.debian.org URL, which
  this container cannot route to, and the refusal naming that URL is the
  evidence that the fallback leg ran. The remaining cases stub the transport
  only; the branching under test is the real `run.sh`.

- **Seven mutations, each red in its own assertion**: `fetch.ts` losing the
  404 -> 44 mapping; a mirror 404 made fatal; the mismatch message no longer
  naming its source; every mirror error falling back instead of only absence;
  the split dropped from the report; the decorative-mirror warning dropped; and
  the snapshot layout rewritten as if it were the pool layout.

- **A real run against a real mirror, four ways** (`--cache-dir` under this
  worktree; `_out/debian-base` was not touched):
  - `https://deb.debian.org/debian`, full 172-package selection:
    `downloaded 104 archives (104 from the mirror, 0 from the pinned URL)`.
    Nothing fell back — the pins are two days old, so no version has been
    superseded yet. That is the healthy case, not the interesting one.
  - `https://deb.debian.org/debian-debug`, a real Debian archive with a real
    `/pool` that does not carry this file: `(0 from the mirror, 1 from the
    pinned URL)` plus the warning, with the fallback going to
    snapshot.debian.org for real, through its 302, and verifying.
  - `snapshot:https://snapshot-cloudflare.debian.org`, a different host serving
    the snapshot layout: `(1 from the mirror, 0 from the pinned URL)`.
  - no mirror configured: `verified 1 packages; downloaded 1 archives; cache
    ...` — the old line exactly.

- **What is documented where.** `rootfs/README.md` gains "Fetching through a
  mirror"; there is no `rootfs/debian/README.md` in this tree and adding a
  second file describing the same pipeline would be two documents to keep
  agreeing. `sources.env`'s comment now says what `MIRROR` actually does —
  debootstrap's index filename and debootstrap's own argument, both after every
  archive is already local — and points at the variable that does redirect
  downloads.

- **Not done, and named rather than expanded into**: nothing in this tree
  refreshes the pins. `packages/*.json` is 172 hand-written records, and the
  next base bump still edits all of them; a generator would have to resolve a
  dependency closure against a snapshot's `Packages` index, pick the consumer
  mapping, and keep the `base` floor stable, which is a plan of its own and not
  a by-product of this change. The fallback is what keeps a live-pool mirror
  useful while those pins age.

- **Verification.** `bash tests/debian-base-test.sh` (52 checks) and
  `bash tests/debian-lock-test.sh` green; `tests/host-toolchain-lint.sh`
  (111/111) and `tests/shell-pipefail-lint.sh` (83/83) green, both touched by
  the new shell; `make docs-verify` green from a `git archive` of this branch
  into an empty directory.
