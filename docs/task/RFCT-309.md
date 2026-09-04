# RFCT-309 The Rust gate runs in a derived image, not from a host directory

- **status**: completed
- **priority**: P1
- **owner**: rust-gate/bkd-zpqc1v2a
- **createdAt**: 2026-09-04 21:10
- **completedAt**: 2026-09-04 23:05

## Description

`pkgs/mosd/hack/check.sh` and its twin `pkgs/rauc-sign/hack/check.sh` need four
tools the compiler image does not carry — clippy, rustfmt, `cargo-nextest` and
`cargo-deny` — and until this task they came from `/srv/mos-rust-tools`, a host
directory bind-mounted at `/tools`. That directory was emptied on 2026-08-29 and
nothing failed, because nothing in the tree referenced it: `grep -rn
'mos-rust-tools'` over `*.sh`, `Makefile` and `*.ts` matches nothing, and no
Makefile target ran the gate.

This task moves the gate into a derived image, `localhost/mos-build-rust-check`,
and gives it a Makefile target.

**Two premises of the dispatched brief were wrong and were corrected before
work started** (reported to L1, ruling received):

- `pkgs/mosd/hack/check.sh` **exists** and is wired into
  `tests/apid-ui-build-contract-test.sh` and `build-env/build.sh`. Nothing had
  to be written or renamed.
- The gate was **not** un-run. `docs/design/build-harness.md` recorded a green
  run on 2026-08-28, and the script runs five commands rather than three — the
  brief's instruction to add clippy and rustfmt but not nextest and cargo-deny
  would have produced an image that could not run the entry point the docs name.
  L1 withdrew that instruction and ruled that both tools be pinned.

**A third premise was wrong in this task's own favour and is corrected here.**
`.github/workflows/check.yml` runs **both** `check.sh` scripts on every push and
pull request, on a rustup toolchain at the workspace MSRV with its own pinned
`cargo-nextest` and `cargo-deny`. So the workspace was never unchecked; what the
empty directory removed was the ability to run the gate **locally**, before
pushing. The four files that state this now say the narrower, true thing.

## ActiveForm

Moving the Rust gate off a host directory and into a pinned derived image, with
a Makefile target and the docs that make it true.

## Acceptance

- A derived image built `FROM` the pinned `mos-build-rust`, adding clippy and
  rustfmt **with no new sha256 pin**, and `cargo-nextest`, `cargo-deny` and
  `dbus-daemon`, following the conventions of the other `build-env/` images.
- `make os-rust-gate` runs both `hack/check.sh` scripts **unmodified** in that
  image.
- The gate's findings reported honestly, with nothing silenced: no `#[allow]`,
  no softened `-D warnings`, no trimmed command set.
- `docs/design/build-harness.md` and its zh mirror describe what exists, keep
  the dated 2026-08-28 baseline, and keep the `bash -lc` finding only if it
  still applies.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green;
  `cargo test --locked -p mosd -p apid` green in the new image.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## What the gate found — 2026-09-04

**Both workspaces are green, and the clippy finding count is zero.** That is the
deliverable; the paragraph below it is what makes it worth anything.

| command | mosd | rauc-sign |
| --- | --- | --- |
| `cargo fmt --all --check` | clean, **0-byte diff** | clean, **0-byte diff** |
| clippy, `--workspace --all-targets --locked -- -D warnings` | **0 findings** (38.88 s) | **0 findings** |
| `cargo nextest run --workspace --locked` | `1023 tests run: 1023 passed, 0 skipped` | `62 tests run: 62 passed, 0 skipped` |
| `cargo test --doc --workspace --locked` | green | green |
| `cargo deny check licenses bans advisories` | `advisories ok, bans ok, licenses ok` | `advisories ok, bans ok, licenses ok` |
| `bash hack/check.sh` end to end | `ALL CHECKS PASSED` | `ALL CHECKS PASSED` |

Nothing was reformatted for this: `cargo fmt --all --check` produced an empty
diff in both workspaces, so the question of whether to reformat the tree never
arose.

**Zero findings on a gate nobody could run for a week needed breaking, not
believing.** Both workspaces were copied under `tmp/`, one
`pub fn probe(v: &Vec<u8>) -> usize` was appended per crate —
`clippy::ptr_arg`, a `style` lint inside the `clippy::all` the workspace sets to
`warn` — and the gate's own clippy line was run against the copy. All eight
crates go red, `rc=101`: `busname`, `mosd-settings`, `ui-bundle`, `mqttd`,
`mosd`, `apid`, `mos-mqtt-broker`, `rauc-sign`. Cargo stops at the first failing
crate, so the members had to be driven one at a time (`-p apid`, `-p mosd`,
`-p mos-mqtt-broker`, `-p mos-ui-bundle`) to show that each is actually reached
— `apid` in particular never prints a `Checking apid` line, because a package
with a build script gets one `Compiling` status for the whole package, and
reading that as "apid was skipped" is the mistake this probe rules out. The tree
was not modified; the copy was discarded.

## Decisions

**The image is a `build-env/` row, not an on-demand build.** `verify/Dockerfile`
is built on demand by its caller, which was the other candidate; the row was
chosen because it is what makes the pins first-class. `build-env/build.sh`
refuses a `PENDING` whose prefix no row consumes, so pins for an image outside
the table could not use the bump flow at all. It is the one row whose parent is
a sibling (`LOCAL_MOS_BUILD_RUST`) rather than the base, and it takes two lock
prefixes, `RUSTCHECK_` and `RUST_`.

**`RUSTCHECK_` and not `RUST_CHECK_`.** The lock filter is
`RUST_[A-Za-z0-9_]*`, so the second spelling would put the gate's pins into
`mos-build-rust`'s lock — bumping nextest would rebuild the image every Rust deb
producer pulls.

**clippy and rustfmt add no pin; nextest and deny add four.** The first two are
`clippy-preview` and `rustfmt-preview` out of the tarball `RUST_SHA256_*`
already names, fetched through the same `id=mos-fetch-rust` download cache —
measured, the stage logged `using the cached ... which already matches the
recorded hash`, so there was not even a second download. The other two are in no
Rust tarball: `RUSTCHECK_NEXTEST_*` and `RUSTCHECK_DENY_*`, URL and sha256 per
architecture, resolved through the existing PENDING flow and **cross-checked
against upstream's own published `.sha256` sidecars** — all four matched.

**cargo-deny 0.19.9 and not 0.20.2.** Both `deny.toml` files open with
"cargo-deny 0.19.x configuration", and the config schema is what that version
changes; pinning the newest release of the declared series keeps their first
line true. Moving to 0.20 is a schema review of both files, not a bump.

**musl builds of both.** cargo-deny publishes no gnu Linux binary at all, and
the musl builds are static, so one choice for both is also the only choice for
one.

**`dbus-daemon` is in the image — yes, it was added.** Several mosd and apid
tests assert real bus behaviour and are written to fail rather than skip without
it; it was installed by hand into the container on every run of this gate that
has ever happened. `cargo test --locked -p mosd -p apid` in this image is
**823 passed** (apid 318 + 1, mosd 496 + 1 + 7) with no `apt-get` step.

**One image serves both workspaces.** They differ only in `Cargo.lock`;
`tests/rust-gate.sh` gives each its own `CARGO_TARGET_DIR` because two lock
files in one target directory rebuild each other's dependencies on every
alternation.

**CI's four pin literals were replaced by the same keys.** `check.yml` now
sources `build-env/images.env` for `cargo-nextest` and `cargo-deny` rather than
carrying `deny_ver=0.19.5` / `nextest_ver=0.9.133` of its own. This was not in
the brief; it is caused by it — the moment the image installed those two tools,
the tree had two pins per tool in two files, free to disagree, which is the
argument that same workflow already makes about the bun pin two jobs below. The
compiler deliberately still differs: CI checks at the MSRV, the image checks at
`RUST_VERSION`, and `docs/design/build-harness.md` §3.5 says why that is two
questions rather than a drift.

## The nextest / cargo-deny recommendation, now that they are in

The brief asked for a recommendation and not an implementation; L1's ruling
reversed that, so this section records what they cost, measured rather than
estimated.

- **Cost**: two pins per architecture (four keys), two downloads of ~5 MB and
  ~11 MB, and 90 MB of image — `mos-build-rust` is 1.83 GB, `mos-build-rust-check`
  is 1.92 GB. None of it lands in `mos-build-rust`, so no producer build pays it.
- **`cargo-deny` earns it.** It is the only check in this tree that reads the
  licence inventory and the advisory database a shipped release's SBOM asserts.
  Both `deny.toml` files carry reviewed exceptions — the CC0-1.0 allowance for
  `tiny-keccak` on one named chain, the RUSTSEC-2025-0134 ignore for
  `rustls-pemfile` — and an exception nothing ever evaluates is not a decision,
  it is a comment.
- **`nextest` earns less on its own** — `cargo test` runs the same tests — but
  the gate is written against it, its `rc=100` and cancellation behaviour is
  what the dbus finding above is stated in, and swapping it out would be an edit
  to a script this task exists to run unmodified. It also does not run doctests,
  which is why `check.sh` carries a separate `cargo test --doc` line.

## Still open

- **The gate is not in CI as this image.** CI runs the same two scripts by
  installing its own toolchain, because a GitHub runner has no
  `localhost/mos-build-*`. Making CI use this image means publishing the builder
  family somewhere a runner can pull it, which is a decision about the whole
  `build-env/` family and not about this gate.
- **arm64 is pinned but unbuilt.** `RUSTCHECK_*_ARM64` is recorded and
  cross-checked, but no arm64 gate image was built here: the gate compiles and
  *runs* tests, and this host executes only its own architecture.
- `docs/design/build.md:41` lists the builder family as
  `{base,c,go,rust}` — already missing `deb` before this task, and now missing
  `rust-check` too. Not touched: it is one line in a file another task is
  editing, and correcting it means correcting `deb` as well.
