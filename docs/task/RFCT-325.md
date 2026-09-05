# RFCT-325 `rauc-update` names the file it cannot find, and reaches exit 3 on the path that documents it

- **status**: completed
- **priority**: P1
- **owner**: bkd/n270h6xr
- **createdAt**: 2026-09-05
- **baseline**: `9b05d4399a204476b3915407cc0e2fc7f002bb68`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/n270h6xr`, branch `bkd/n270h6xr`

## Description

[RFCT-323](RFCT-323.md) ran `pkgs/rauc-sign/hack/check.sh` and reported
`tests/update.rs` `the_cli_reports_readiness_with_its_own_exit_code` red on
`main`:

```
Output { status: ExitStatus(unix_wait_status(256)),
  stdout: "", stderr: "rauc-update: No such file or directory (os error 2)\n" }
left: Some(1)
right: Some(3)
```

Two defects, one visible and one structural, both introduced by
[`c9514b49`](../task/RFCT-315.md) (`feat(trust): F7/F8/F9 -- the client reads
the baked anchor`, committed compile-only and expecting exactly this class of
fixture failure).

1. **The error names nothing.** `anchor::root_bytes` opens the baked anchor
   with three bare `?`s on `io::Error`. `main` prints `{err:#}` — the whole
   colon-joined context chain — so a bare `io::Error` reaches the operator as
   `No such file or directory (os error 2)` and no path. Three different
   missing things (`/usr/share/mos/meta`, `/usr/share/mos/meta/updates`,
   `/usr/share/mos/meta/updates/manifest.json`) produced the same six words.

2. **`EXIT_UNREADY` was unreachable on the path that documents it.**
   `Command::Fetch` ran `check_baked` → `client::verify_baked` → the baked
   anchor read *before* it ever constructed the `Workspace`. So whenever
   anything in the metadata walk failed, the workspace's own state was never
   asked and exit 3 could not be produced — the ordering, not the error type,
   is what closed the path. `Command::Import` had the identical hole.

## ActiveForm

Naming the missing anchor file, and reordering the acquiring subcommands so
the workspace's readiness is decided before the repository is walked.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `pkgs/rauc-sign/src/anchor.rs`: every stat in `root_bytes` names its path.
  §1.
- `pkgs/rauc-sign/src/bin/rauc-update.rs`: `Fetch` and `Import` validate the
  invocation, then the device, then the repository — so `EXIT_UNREADY` is
  reachable on both. §2, §3.
- The test's expectations are unchanged: `3` stays the contract. §4.
- `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings` on
  `pkgs/rauc-sign` — clean. §5.
- **Not run**: `cargo nextest`, doctests, `cargo deny`, the full
  `hack/check.sh`. Per the batch working mode; owed to L1. §5.

## 1. The context, so the file is named

`root_bytes` had three bare `?`s on `io::Error`, all of them in the first
twelve lines, all of them reachable on a machine that is simply not a device:

```rust
fs::symlink_metadata(directory)?.is_dir()          // × 2, the two directories
fs::symlink_metadata(MANIFEST)?.is_file()          // the manifest
let entry = entry?;                                // a metadata/ dirent
```

Each now carries a `with_context` that names the path. `fs::read_dir`'s own
context named the operation but not the directory; it names it now too.

The operator-visible change:

```
before: rauc-update: No such file or directory (os error 2)
after:  rauc-update: stat baked anchor directory /usr/share/mos/meta: \
        No such file or directory (os error 2)
```

This half is worth having on its own — it is what an operator reads when the
baked trust is missing or has been tampered into a link — and it is
independent of the exit code.

## 2. Why the ordering changed rather than the error type

The task offered two routes to a reachable `EXIT_UNREADY`: change the
ordering, or make the error carry the readiness fact through. **The second one
does not apply.** The error on this path is not a readiness fact — a missing
`/usr/share/mos/meta` is a genuine failure and exit 1 is the right answer for
it. No amount of context turns it into `Unready`, and it should not be turned
into one. Every route that leaves `check_baked` first leaves exit 3
conditional on the repository walk succeeding, which is precisely the property
that made it unreachable.

So the ordering changed, to one rule that covers all three tiers:

> **Validate the invocation, then the device, then the repository.**

- The **invocation** is `--identity`/`--board`/… and `--reserve-dir`. A
  reserve directory outside `downloads/` is a wrong argument and stays exit 1
  whatever the device is doing — which is why the argument check has to come
  *before* the probe, not after it.
- The **device** is the workspace: `/mos` mounted from DATA, writable, not
  exhausted. This is a local fact that does not depend on the repository at
  all, so asking it before the metadata walk is both cheaper and the only
  ordering under which exit 3 survives a repository fault.
- The **repository** is the TUF walk and the compatibility selection.

Corroboration that this is the intended shape rather than a convenience:
`pkgs/mosd/mosd/src/update_lifecycle.rs` already orchestrates it this way —
its module doc says the workspace "is probed (`rauc-update probe`) BEFORE" the
acquisition, and `run_check` calls `self.probe(...)` before `sync`/`check`.
The CLI was the only surface that asked in the other order.

### The cost, stated

A degraded workspace now answers `3` on `fetch` where an up-to-date device
would previously have answered `2` ("nothing compatible"). That is a real
semantic change and it is deliberate: a device that cannot store a bundle
cannot fetch one, and reporting the storage fault is more actionable than
reporting that there was nothing to store anyway. `check` still answers the
"am I up to date" question without touching the workspace, and mosd
distinguishes both codes already (`parse_fetch` maps `Some(2)` →
`NoneCompatible` and `Some(3)` → `Unready`), so no consumer conflates them.

## 3. Import had the same hole, and was changed too

The task asked whether other commands share the ordering. The answer:

| subcommand | `check_baked` before `Workspace::from_env()`? | changed |
| --- | --- | --- |
| `sync` | no workspace at all | — |
| `check` | never constructs a `Workspace` | — |
| `probe` | workspace only; no repository walk | — |
| `fetch` | **yes** — the reported defect | yes |
| `import` | **yes** — identical, with the lockbox walk standing in | yes |

`import` is the same bug with the same consequence: an unready workspace plus
an unreadable lockbox reported the lockbox and never the workspace. It is
three lines and leaving a known-identical hole open was the worse option, so
it moved too. `import` has no `--reserve-dir`, so its ordering is
invocation → probe → lockbox walk.

`rauc-verify` has no workspace and no `EXIT_UNREADY`; it is unaffected.

## 4. What the test asserts, and what now satisfies it

Nothing in `tests/update.rs` changed. The two assertions that were failing (or
would have failed next) are satisfied by the new ordering:

- `fetch` with a valid reserve dir against a read-only workspace:
  `Workspace::from_env` → `reserve_dir` (ok) → `probe` → `Err(Unready {
  ReadOnly })` → `anyhow::Error::new` → `main` prints `degraded read-only: …`
  and downcasts to `Unready` → **exit 3**. Nothing is acquired, because
  `namespace_mount` returns before `write_probe_file` and before the walk.
- `fetch --reserve-dir /var/lib/mos/update/reserve` against the *same*
  read-only workspace: the argument check fails first with `… is outside …` →
  **exit 1**. This is why the argument tier has to precede the device tier;
  with probe first, this case would have become a 3.

## 5. Verification, and what is owed

Run, in the worktree, against `pkgs/rauc-sign`:

- `cargo fmt --all --check` — clean.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — clean.
  `--all-targets` compiles `tests/update.rs`, so the test tree builds against
  the reordered binary.

**Not run, and owed to L1's gate battery**: `cargo nextest run --workspace
--locked`, `cargo test --doc --workspace --locked`, `cargo deny check`, and
therefore the red test itself. The batch working mode for this dispatch trades
per-task test execution for wall-clock and moves it to L1; the reasoning in §4
is a trace of the code, not an observation of a passing run, and should be
read as such.

## 6. What was deliberately not touched

- **`docs/design/release-signing.md` §4 and `docs/design/updates.md` §5.3
  still show `--root` on `rauc-update check`/`import`.** `c9514b49` removed
  that flag from both device binaries. The drift is real and pre-existing;
  it belongs to RFCT-315's follow-up, not to a bug fix in the ordering, and
  fixing it here would have hidden it in an unrelated diff.
- **The anchor has no test seam and did not get one.** `root_bytes` pins
  `/usr/share/mos/meta/updates/manifest.json` as a constant and the module
  says so on purpose ("There is no environment, argument or operator-document
  anchor override"). That is why the CLI test can only exercise the paths that
  answer *before* the anchor is read — which the new ordering now gives it —
  and why `fetch`'s and `import`'s success paths remain reachable only on a
  device. Naming this as a gap: nothing off-device executes
  `client::verify_baked` end to end.
