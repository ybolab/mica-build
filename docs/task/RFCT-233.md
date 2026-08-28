# RFCT-233 PLAN-025 M4: the harness facts, committed as one citation-gated page

- **status**: completed
- **priority**: P2
- **owner**: bkd/vnb7pi2x
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M4)
- **design**: `docs/design/build-harness.md` (new, this task)

How this repository's checks are RUN lived in task records and in operators'
heads. Every new tool rediscovered the same half-dozen facts, and rediscovered
them by failing first: a bun image with no docker client, a Rust gate whose test
runner is not in its own image, a bind mount that silently delivers nothing, an
arm64 builder that builds what the daemon cannot execute. This milestone commits
them as `docs/design/build-harness.md`, in the one directory a gate reads.

## Scope

| file | change |
| --- | --- |
| `docs/design/build-harness.md` | new — eight sections, every host claim dated and every file claim quote-armed |
| `docs/README.md` | one `design/` row, and the parked `.zh.md` recorded in the existing exception paragraph |
| `docs/task/RFCT-233.md` | new — this record |
| `docs/task/index.md` | one row, after RFCT-232 |

No source file was touched. `os/**` and `test/**` are untouched by design: this
task documents the harness, and `os/pkgs/mosd/hack/check.sh` in particular was
run **unmodified**, because the harness is the container it runs in.

## 1. Why `docs/design/` and not `test/apid-api/`

PLAN-025 offered "docs/ or test/apid-api/HARNESS extension, citation-gated". The
two halves of that are in tension and only one resolves them. `docs/verify-citations.sh`
scans "docs/design/*.md, docs/task/*.md and" (`docs/verify-citations.sh:10`)
`docs/research/*.md` plus `docs/architecture.md` — and nothing under `test/`. A
page at `test/apid-api/HARNESS.md` would be gated by nothing at all, which is the
opposite of the milestone's requirement. So `docs/design/build-harness.md`, which
also puts it where `docs/verify-index.sh` requires a matching `docs/README.md`
row: "1. docs/design/*.md      <-> docs/README.md" (`docs/verify-index.sh:9`).

## 2. The retracted premise, and what replaced it

The task as issued told me to record, as a dated host measurement, that this
host's bun cannot parse the committed lockfile and that the container is
therefore the only route that works here. **That is false, and it was measured
false before anything was written.** L2 independently retracted it mid-task;
RFCT-230 had already measured the same thing and recorded it in its section 1.

Measured here, 2026-08-28, on the merged tree:

| claim | command | result |
| --- | --- | --- |
| a host bun exists | `command -v bun; bun --version` | `/srv/bkd/runtime/bun`, `1.4.0` |
| it parses the committed lockfile | `cd test/apid-api && bun install --frozen-lockfile --dry-run` | five packages resolved, `[2.00ms] done` |
| it runs the suite selftest | `cd test/apid-api && bun run src/selftest.ts` | `RESULT: PASS (47/47 checks)` |
| the same, `os/verify` | `cd os/verify && bun install --frozen-lockfile` | `5 packages installed [48.00ms]` |

The page therefore states the true and more useful fact: the pinned container is
a **decision**, not a workaround. The reasoning is cited to where it was made
rather than restated — `run.sh` has "no host-bun route for any of its other bun
invocations" (`docs/task/RFCT-230.md:69`), so a host route for one caller of
three would be "a second route for one of three callers, and configurability"
(`docs/task/RFCT-230.md:71`) nobody asked for.

PLAN-025's own Context section carries the same falsified claim. No plan file was
edited here; L2 is routing that to L1 as a plan amendment.

## 3. What the page asserts, and how each claim is held

Two claim kinds, marked as such in the page itself, because a reader has to know
which ones a gate can catch:

- a **citation** is a fact about a file in this tree, quote-armed, and
  `docs/verify-citations.sh` checks that the quoted text is still at the cited
  lines;
- a claim marked **measured** is an observation of this host on a stated date.
  No gate validates it. The page says so, and the dates are there so a stale one
  is visible rather than merely wrong.

The page carries **34 in-scope citations at zero unquoted**, and this record a
further 4 — a new document's ratchet ceiling is 0, so every one of them is
content-checked, not merely resolved.

## 4. The measurements, and the three that corrected the brief

Everything in the page was run here. Three of them did not come out as the brief
predicted, and the page states what happened rather than what was expected.

**The `dbus-daemon` failure names a different test.** The brief said the missing
daemon shows up as `bus_roundtrip`. Measured, it surfaced as
`apid::e2e web_flow_end_to_end`, and nextest cancelled the other 648 tests at the
first failure. Both tests carry the identical refusal-to-skip, so which one lands
first is scheduling. The page states `rc=100` plus a `dbus-daemon was not found`
panic as the fact, and explicitly says the test name is not the signal.

**The `rust96` toolchain damages the run through `rustc`, not `rustfmt`.** The
brief described it as "a 1.96 formatter judging this workspace". Measured, that
is not the mechanism, and the narrower claim is not even reproducible: with
`/tools/rust96/bin` on PATH, `cargo fmt --all --check` on this workspace returns
`rc=0`. What actually breaks is `rustc`: `/tools/rust96/bin` shadows the image's
1.98 compiler with 1.96, whose sysroot has no `std` for the target, and the gate's
clippy line then reports damage that is not there —
`error[E0463]: can't find crate for 'std'` cascading into
`could not compile 'serde'`, `'libc'`, `'proc-macro2'` and five more, at `rc=101`.
`/tools/rust96/bin` also ships **no** `cargo-clippy`, `cargo-nextest` or
`cargo-deny`, so it cannot run this gate at all. The page documents the real
mechanism.

**The arm64 daemon measurement needed a control.** `docker run --platform
linux/arm64` first returned `context canceled` rather than a refusal. An amd64
control run returned `context canceled` too, so the failure was daemon starvation
(host load average 30 on 8 cores from concurrent work), not an arm64 fact. Rerun
after the daemon recovered, the amd64 control printed `x86_64` three times and
the arm64 run printed `exec /bin/uname: exec format error`. Without the control
this would have been written up as an arm64 property.

The `tonistiigi/binfmt --install arm64` remedy is the one claim in section 5 of
the page **not** re-run here: it is a `--privileged` container that mutates host
binfmt registration, and RFCT-206 already measured that it reports success and
changes nothing. It is attributed to that record by citation rather than
restated as my own measurement.

## 5. Verification

Every command below was run in this worktree on 2026-08-28. The Rust gate ran in
`localhost/mos-build-rust` with `/srv/mos-rust-tools` mounted at `/tools`, using
`bash -c` (never `bash -lc`) and the full PATH the page prints.

### The acceptance gates

| command | final line |
| --- | --- |
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 1457/1457 PASS` |
| `bash docs/verify-citations.sh` (per-document ratchet) | `no quote, by document: docs/design/build-harness.md 0` and `no quote, by document: docs/task/RFCT-233.md 0` |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 760/760 PASS` |

Baselines before this task: `1419/1419 PASS` and `760/760 PASS`. The citation
count rises by 38 — 34 in the page and 4 in this record — and the index count by
7, one added `design/` file and row and one added `task/` file and row.

### The Rust gate

| command | final line |
| --- | --- |
| `bash hack/check.sh` in `os/pkgs/mosd`, dbus installed | `Summary [ 80.990s] 705 tests run: 705 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED`, `rc=0` |
| `cargo nextest run --workspace --locked`, **no** dbus-daemon | `Summary [ 5.853s] 57/705 tests run: 56 passed, 1 failed, 0 skipped`, `error: test run failed`, `rc=100` |
| `cargo fmt --all --check` with `/tools/bin` first | `FMT CLEAN` |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` with `/tools/rust96/bin` first | `error[E0463]: can't find crate for 'std'`, `rc=101` |
| `command -v cargo-nextest` in the image, no `/tools` on PATH | `NOT FOUND in image` |
| `cargo --version` in the image | `cargo 1.98.0 (797e8a9bc 2026-08-05)` |
| `/opt/rust/bin/rustc --version` | `rustc 1.98.0 (88d9e12ae 2026-08-18)` |
| `/tools/rust96/bin/rustc --version` | `rustc 1.96.0 (ac68faa20 2026-05-25)` |
| `command -v dbus-daemon` in the image | `dbus-daemon: NOT INSTALLED` |
| `bash -lc 'echo $PATH'` with `-e PATH=/tools/bin:...` | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` — the passed PATH is gone |
| `bash -c 'echo $PATH'` with the same `-e PATH` | `/tools/bin:/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |
| `bash -lc 'command -v cargo'` with the same `-e PATH` | `cargo: NOT ON PATH under -lc` |

### bun

| command | final line |
| --- | --- |
| `command -v bun; bun --version` | `/srv/bkd/runtime/bun`, `1.4.0` |
| `cd test/apid-api && bun install --frozen-lockfile --dry-run` | `[2.00ms] done` |
| `cd test/apid-api && bun run src/selftest.ts` | `RESULT: PASS (47/47 checks)` |
| `cd os/verify && bun install --frozen-lockfile` | `5 packages installed [48.00ms]` |

### Scratch, and the silent empty mount

| command | final line |
| --- | --- |
| `T=$(mktemp -d); echo sentinel > "$T/marker.txt"; ls -l "$T"` | `-rw-r--r--. 1 root root 9 Aug 28 08:41 marker.txt` |
| `docker run --rm -v "$T:/probe" alpine:3.21 sh -c 'ls -A /probe \| wc -l'` | `0` — the mount succeeded and delivered nothing |
| `docker run --rm -v /srv/ai/mos/runtime/<id>:/probe alpine:3.21 sh -c 'ls -A /probe; cat /probe/marker.txt'` | `marker.txt`, `sentinel` |

### arm64

| command | final line |
| --- | --- |
| `docker buildx ls` | `mos-arm64` node reports `linux/amd64 (+3), linux/386` — no arm64 |
| `docker buildx inspect mos-arm64` | `Platforms: linux/amd64, linux/amd64/v2, linux/amd64/v3, linux/386` |
| `ls -A /proc/sys/fs/binfmt_misc/` | empty, `rc=0` |
| `docker buildx build --builder mos-arm64 --platform linux/arm64 --no-cache` on `FROM alpine:3.21` + `RUN uname -m` | `#5 0.244 aarch64`, `#5 DONE 11.3s` |
| `docker run --rm --platform linux/arm64 <that image> uname -m` | `exec /bin/uname: exec format error` |
| `docker run --rm alpine:3.21 uname -m` (the control) | `x86_64`, three consecutive runs |
| `cid=$(docker create --platform linux/arm64 <that image>); docker cp "$cid:/arch.txt" .` | `aarch64` — a file read needs no emulator |

## 6. What this task did NOT do

- **No `.zh.md`.** PLAN-025 parks it. `docs/README.md`'s existing exception
  paragraph is where such a decision is recorded, and the new document was added
  to that paragraph rather than to a new mechanism. No Chinese was written.
- **No source edits.** `os/**` and `test/**` are untouched; `git status` shows
  four documentation paths and nothing else.
- **No image build and no two-boot e2e.** L2 owns those. Section 6 of the page
  spells out the prerequisite chain from the tree without running it, because
  "no image" presents as a harness failure and the chain is what a reader needs.
- **No plan file edited**, including the falsified PLAN-025 Context claim; that
  routes to L1 as an amendment.

## 7. Known limits of the page

- Every *measured* line is this host on 2026-08-28 and can go stale silently. No
  gate can catch that; the page marks the class and dates each claim so a reader
  can tell what is checkable from what is not.
- The `tonistiigi/binfmt` behaviour is cited to RFCT-206, not re-measured here.
- RFCT-234 is acting on the arm64 build-versus-execute split. Its record had not
  landed in this tree at the time of writing, so the page states the measurement
  directly; when RFCT-234 lands, the consequence paragraph in section 5 is the
  place to cite it instead.
