# RFCT-081 Close the repository audit: a CI gate, a no-op build target, an unreferenced 12 MB asset, two stale suppressions, and the apid login curve

- **status**: completed — eight findings, seven changed, one recorded as no-action
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 03:05
- **claimedAt**: 2026-08-21 03:10
- **completedAt**: 2026-08-21 04:05

Base `5d2f28f`.

```
$ git rev-parse HEAD
5d2f28f6cfb46b15f862fbb91647f24101f4a0d5
```

This is not a campaign task and follows no L1/L3 split. It is the remediation
half of a whole-repository audit run against `5d2f28f`, and every item below was
a finding from that audit rather than a step in a plan.

## Description

The audit measured the tree rather than reading it: `mosd/hack/check.sh` was run
(`fmt`, `clippy -D warnings`, `nextest`, `cargo deny` — all four green, 383
tests), as were the five offline suites (`docs-verify`, `docs-verify-test`,
`os-health-test`, `os-shadow-test`, `os-ui-location-test` — 54/54, 220/220,
14/14, 267/267, 8/8). It found the code in unusually good shape: nine
`unwrap`/`expect` sites in non-test code, all `Mutex::lock`; `unsafe_code =
"forbid"`; a path-traversal resolver with five ordered rules and a
canonicalisation backstop.

**The one structural finding was that none of that runs automatically.** There
is no CI configuration of any kind in the tree — no `.gitea/`, no `.github/`,
no `.pre-commit-config.yaml`. `mosd/hack/check.sh` and the six `make` test
targets are the definition of "checked", and at `5d2f28f` nothing but a human
memory invoked them, across 310 commits landed in five days.

The remaining findings are smaller and are listed with their measurements below.

## Deliverable

| file | what |
| --- | --- |
| `.gitea/workflows/check.yml` | two jobs: `mosd/hack/check.sh`, and the five offline `make` targets |
| `Makefile` | `os` gets a recipe that fails; the `help` line stops advertising a Talos build |
| `board/cx3576/rootfs/assets/splash.png` | replaces `splash.ppm`, same pixels, 76 KB instead of 12 MB |
| `docs/design/display.md`, `display.zh.md` | §4 names the asset and states that it has no consumer |
| `mosd/mosd/src/reconciler/mod.rs` | a `#[allow(dead_code)]` that is no longer needed, deleted |
| `mosd/apid/src/bundle.rs` | the module-wide `#![allow(dead_code)]` replaced by six per-item ones |
| `mosd/apid/src/auth.rs` | the login guard moves onto `access.md` §3.3's backoff curve |
| `mosd/apid/src/routes.rs` | the auth gate checks the session before it calls the bus |
| `mosd/apid/src/tests.rs` | two tests that asserted the old flat login rule |
| `docs/task/index.md` | the RFCT-080 row moved to the end; this record's row appended |

```
 Makefile                              |     14 +-
 board/cx3576/rootfs/assets/splash.png |    Bin 0 -> 76180 bytes
 board/cx3576/rootfs/assets/splash.ppm | 408267 ------------------------------
 docs/design/display.md                |     12 +-
 docs/design/display.zh.md             |      7 +-
 docs/task/index.md                    |      2 +-
 mosd/apid/src/auth.rs                 |    129 +-
 mosd/apid/src/bundle.rs               |     31 +-
 mosd/apid/src/routes.rs               |     37 +-
 mosd/apid/src/tests.rs                |     35 +-
 mosd/mosd/src/reconciler/mod.rs       |      2 -
```

Nothing under `os/` was changed: no finding pointed there. `Cargo.toml` and
`Cargo.lock` are untouched — no dependency was added, including for the PNG
re-encode (see below).

## 1. The CI gate

`.gitea/workflows/check.yml` **invokes** the gates rather than restating them.
The `rust` job's only assertion step is `bash mosd/hack/check.sh`; the
`offline-suites` job's steps are `make` targets. A workflow that spelled out
`cargo clippy -- -D warnings` would be a second copy of the gate definition,
free to drift from the one a developer runs locally, and the drift would be
invisible until the two disagreed about a commit.

The toolchain is read back out of the manifest rather than pinned to a literal:

```
$ sed -n 's/^rust-version *= *"\([^"]*\)".*/\1/p' mosd/Cargo.toml | head -1
1.96
```

That is also the only thing that makes `rust-version` an enforced claim instead
of documentation — nothing in the tree checked it before.

**Coverage is stated in the file rather than implied.** `os-dbus-policy-test`,
`os-repart-test` and the image assembly/verification pair are *not* run: they
need root or privileged docker, and a runner that silently lacked those would
convert a skipped proof into a green tick. The last step of `offline-suites`
prints what was not covered.

### What was verified, and how

The `offline-suites` job was run end to end in a clean `debian:bookworm-slim`
with only `make` added, over an export of this tree — not on the development
host, which has tooling a runner will not:

```
### docs-verify + negative test
RESULT: PASS (8/8 cases)
### os-health-test
RESULT: PASS (54/54 checks)
### os-shadow-test
RESULT: PASS (220/220 checks)
### os-ui-location-test
RESULT: PASS (14/14 cases)
```

The `rust` job was run the same way in `rust:1.96-bookworm`, including the two
tool installs the workflow performs.

**One thing this does not establish, and it is the important one: no run of this
workflow has been observed on the actual Gitea instance.** `git.ds.cc` answers
`/api/v1/version` with 403 and no `GITEA_*` credentials are configured, so the
instance could not be queried. What *was* established is local: the instance is
Gitea 1.26.1, whose `app.ini` carries no `[actions]` section — Actions is
enabled by default at that version — and **no runner is registered**. Until one
is, this file is inert. Registering it is a server-side action and is not part
of this task.

## 2. `make os` reported success for a build that no longer exists

At the base, `os` was declared `.PHONY`, advertised by `help` as *"build the
Talos-based OS artifacts (see talos/)"*, and had **no recipe**:

```
$ make -n os
make: Nothing to be done for 'os'.
$ echo $?
0
```

PLAN-010 retired the Talos base. A retired build path that exits 0 is precisely
the failure mode the rest of this repository is built to prevent, and the fix is
the one `x64-%` already models — a recipe that says what happened and fails:

```
$ make os
os: retired by PLAN-010 (Talos base -> systemd + mosd).
    v1 image: make os-image-cx3576 / os-verify-cx3576
    v2 (A/B): make os-image-cx3576-v2 / os-verify-cx3576-v2 / os-bundle-cx3576
make: *** [Makefile:42: os] Error 1
```

Deleting the target instead would also have failed loudly, but with make's own
message and none of the routing.

## 3. `splash.ppm`: 12 MB, unreferenced, two thirds of the repository

`board/cx3576/rootfs/assets/splash.ppm` was 12,441,619 bytes — **63% of the
whole tracked tree** — and no build step read it. It is referenced only in prose,
by `design/display.md` §4 (*"assets exist in board dirs"*) and its phase-1 row.
It entered at the first scaffold commit, `feb448e`.

**It was not deleted**, because `display.md` states it exists and phase 1 plans a
splash-to-kiosk handoff that will want it. It was re-encoded.

The format was the defect. `P6 / 1920 1080 / 65535` is 16 bits per channel,
uncompressed:

```
$ head -c 16 splash.ppm | od -c | head -2
0000000   P   6  \n   1   9   2   0       1   0   8   0  \n   6   5   5
```

**The 16-bit samples are real, not an upsampled 8-bit image** — 6,080,964 of
6,220,800 samples have differing high and low bytes — so an 8-bit reduction
would have been lossy and was rejected. The re-encode is a lossless 16-bit RGB
PNG, and the round trip was verified rather than assumed:

```
dims  : (1920, 1080) (1920, 1080) match
bytes : 12441600 12441600
PIXELS IDENTICAL: True
```

12,441,619 -> 76,180 bytes, a factor of 163, every bit preserved. The image is a
dark-background "RK3576" boot splash; the flat background is where the ratio
comes from.

No image dependency was added to do it. The encoder and the verifying decoder
were throwaway Python over stdlib `zlib`, run once and not committed — a
`convert(1)` in the build would have been a new undeclared tool for a file the
build does not read.

**What this does and does not buy.** The working tree drops from ~18.6 MB to
~6.1 MB of tracked content. The 12 MB blob remains in history and every clone
still pays it once; only a history rewrite would change that, and this task does
not propose one on a shared repository.

## 4. Two stale `dead_code` suppressions

Both were measured by deleting the attribute and compiling, not by reading.

**`mosd/mosd/src/reconciler/mod.rs`** carried `#[allow(dead_code)]` on the
`Reconciler` trait with the comment *"unused until the daemon loop lands; drop
this then"*. The daemon loop landed: `bus.rs:129` and `:205-207` call `apply`,
`:206` calls `subtree`, and `record` uses `name`. With the attribute removed,
`cargo clippy -p mosd --all-targets` emits **zero warnings**. Deleted.

**`mosd/apid/src/bundle.rs`** carried a module-wide `#![allow(dead_code)]`
justified by *"the asset router and the start-up re-check are separate phase-4
work"*. That work landed too (`assets/serve.rs:41`, `startup.rs:51`). Removing
it does not go quiet, and what it says is the finding:

```
warning: struct `ManifestSummary` is never constructed
warning: struct `RecordedState` is never constructed
warning: struct `CustomUi` is never constructed
warning: enum `Installed` is never used
warning: method `describe` is never used
warning: method `incompatible` is never used
warning: method `status` is never used
```

Six of the seven are §5.3's status read — *"what is installed right now?"* —
complete, tested, and reachable from no route. The file-wide suppression was
absorbing that fact along with the obsolete one it was written for. Replaced by
six per-item `#[allow(dead_code)]`s that each name the reason, so the gap is
visible in the source and any **new** unreachable entry point in the file is a
warning again.

(`Recheck::incompatible` is the seventh and is a different case: `startup`
reaches the same verdict by matching `CompatCheck` directly. It is kept as the
named predicate beside `corrupt`, which *is* called, so §6.1's two triggers read
as a pair.)

## 5. The apid login guard

At the base: five consecutive failures armed a flat 30-second refusal, and an
elapsed window reset the counter. Two consequences, neither recorded anywhere:

- **The cost per guess never rose.** Five guesses per 30 seconds, indefinitely —
  about 14,400 a day — because riding out a window was free.
- The first four guesses were free of any delay at all.

`docs/design/access.md` §3.3 already specifies the intended shape:
`bruteForce: { backoffBase: 1s, backoffMax: 300s, lockoutThreshold: 20 }`. The
guard now implements that curve: `backoff_for(n) = min(1s * 2^(n-1), 300s)`,
armed from the first failure, and **the run survives an expired window** — only
a successful login resets it. Past the cap that is under 300 guesses a day.

**§3.3's `lockoutThreshold` is deliberately not armed, and the reason is
recorded in the source.** §6 pairs it with *"releasable only with physical
presence"*, and apid has no presence check to release one with. On an appliance
whose only management surface is this daemon, a threshold nothing can clear
would let a guessing attempt become a permanent denial of management. The cap is
therefore the whole control, and `the_lockout_is_never_permanent` asserts it
after a thousand failures.

**Still not implemented, and unchanged:** §6 requires the counters live in META
rather than RAM. An apid restart is still a reset. That needs storage apid does
not have and remains §6's work — §6's own status marker (*not implemented*) is
still correct after this change.

Five unit tests were added, all clock-free: the curve is a pure function, and
the window-expiry case is driven by writing `locked_until` into the past rather
than by sleeping.

**Two existing tests asserted the old flat rule and were changed, not deleted.**
`five_failures_lock_out_logins` became
`the_first_failure_arms_the_backoff_window`, which asserts the first failure is
answered `401` and everything inside the window — the *correct* password
included — is `429` with no cookie minted. `login_logout_flow` lost an
incidental wrong-password probe that would now arm a window and reject the
correct password following it; that refusal is asserted in the new test instead.

## 6. The auth gate no longer calls the bus on an authenticated request

`gate` is layered onto every route and called `get_settings("access")` over the
system bus **before** looking at the session cookie — one D-Bus round trip per
request, including for every static asset. Tolerable for one server-rendered
pane; not once a custom UI bundle (§4) serves dozens of assets per page, none of
which need mosd.

The fix is an ordering change, not a cache: check the session first and return
if it verifies. No new state, no TTL, no staleness window.

**It is sound because of an invariant, and the invariant is stated in the
source.** A session is minted in exactly two places — `login_submit`, only after
`password_hash` returned `Some` and verified, and `setup_submit`, only after the
`access.webAdmin` write that *creates* the hash succeeded. No route removes a
hash. So "session verifies" cannot coexist with "no admin password configured",
which is the only thing the bus call decided. If an unset-password operation is
ever added it must clear the session table in the same step; the comment says so.

A second-order effect, and it points the right way: a static asset now serves
while mosd is down. That is §6.1's reasoning — a failure in one part must not
take the surface that reports it — applied to the same gate.

All 130 apid tests pass unchanged apart from the two in §5.

## 7. The task index was out of append order

`docs/task/index.md` carried the RFCT-080 row between RFCT-075 and RFCT-076.
The file's own rules say new tasks append to the end; a row landing mid-file is
the signature of a two-row append conflict resolved the other way, which is the
same merge hazard RFCT-080 itself was written about. The row was **moved, not
rewritten** — no line was deleted and no marker changed.

## 8. The numbering gaps — recorded, no action

`RFCT-049..052`, `060..062` and `070` have neither a record nor a row.

```
$ for n in 049 050 051 052 060 061 062 070; do
    echo "RFCT-$n: $(git log --oneline --all -- docs/task/RFCT-$n.md | wc -l) commits"
  done
RFCT-049: 0 commits   ...   RFCT-070: 0 commits
```

**No file ever existed at any of those paths in any branch**, so this is not a
deleted record — the numbers were reserved and never used, which is what a
campaign that allocates numbers to siblings ahead of time looks like when not
every sibling lands. Nothing is owed and nothing was changed. It is recorded
here only so the next reader does not re-derive it.

## Checks run

| command | result |
| --- | --- |
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass, zero warnings |
| `cargo nextest run --workspace --locked` | **387 tests, 387 passed** (383 at base; §5 adds five and replaces one) |
| `cargo deny check licenses bans advisories` | `advisories ok, bans ok, licenses ok` |
| `make docs-verify` | see the count below |
| `make docs-verify-test` | `RESULT: PASS (8/8 cases)` |
| `make os-health-test` | `RESULT: PASS (54/54 checks)` |
| `make os-shadow-test` | `RESULT: PASS (220/220 checks)` |
| `make os-ui-location-test` | `RESULT: PASS (14/14 cases)` |
| the `offline-suites` job, in `debian:bookworm-slim` | all four green |
| the `rust` job, in `rust:1.96-bookworm` | `ALL CHECKS PASSED` |
| `make os-image-cx3576-v2` / `os-verify-cx3576-v2` | **not run, not owed**: no path under `os/` changed |
| `make os-dbus-policy-test`, `os-repart-test` | **not run**: need root / privileged docker; unchanged by this work |

### The docs-verify count

Predicted before the run, from RFCT-080's decomposition — three checks per task
link (forward, reverse, once-each), so this record and its row should move the
total by exactly **+3**:

```
$ bash docs/verify-index.sh      # base 5d2f28f
docs/verify-index.sh: 267/267 PASS

$ bash docs/verify-index.sh      # final tree
docs/verify-index.sh: 270/270 PASS
```

Moving the RFCT-080 row contributes 0, as it must: the checks are per name, not
per position.

## What is NOT claimed — hardware

**Nothing here was exercised on hardware, and nothing here could be.** No image
was built and nothing was flashed. The standing position is unmoved: a **v1**
image has reached `mos login:` on a real CX3576-Z, and the **v2** stack — verity
root, A/B, `rauc install`, apid — has never run on a board.

Two changes in this record would be observable on hardware and have not been
observed there: the apid login curve, and the gate reordering. Both are covered
by the apid suite, which is not the same thing.

**The splash asset was not rendered by U-Boot.** The round-trip proof is
byte-level; nothing has displayed the PNG, and nothing in the tree can — the
conversion to a format U-Boot's splash path accepts is still phase 1's work.

## Deliberately out of scope

- **Registering an Actions runner.** Server-side, on an instance this
  environment cannot authenticate to. Without it `check.yml` never fires.
- **Rewriting history to drop the 12 MB blob.** It would shrink clones and it
  would also rewrite every commit hash in a shared repository. That is the
  user's call, not a cleanup.
- **A route for §5.3's status read.** The six per-item allows in `bundle.rs` name
  the gap rather than closing it; §8.2's API phase owns it.
- **META-persisted brute-force counters.** §6's, unchanged and still marked *not
  implemented* there.
- **`connd`.** PLAN-008 is pending and design-only; the audit confirmed that is
  accurate rather than stale, and nothing was owed.
