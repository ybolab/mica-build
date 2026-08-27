# RFCT-167 PLAN-019 M3: update/sign becomes os/pkgs/rauc-sign, its own workspace

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-019 (M3)

`git mv update/sign os/pkgs/rauc-sign`, `update/README.md` folded into the
crate's own README, and `update/` gone. The move is three lines; the substance
is the workspace extraction and the binary rename that rides with it.

This is also the milestone that produced the campaign's sharpest lesson about
what the citation checker does and does not protect, recorded below as a worked
example rather than as a maxim.

## Scope

| file | change |
| --- | --- |
| `update/sign/**` | `git mv` to `os/pkgs/rauc-sign/**` |
| `update/README.md` | folded into `os/pkgs/rauc-sign/README.md`; `update/` is gone |
| `os/pkgs/rauc-sign/Cargo.toml` | its own `[workspace]`, `[workspace.package]`, `[workspace.lints]`, `[workspace.dependencies]` |
| `os/pkgs/rauc-sign/Cargo.lock` | new, 146 packages |
| `os/pkgs/mosd/Cargo.toml` | the one `../` member entry deleted |
| `os/pkgs/mosd/Cargo.lock` | 19 packages leave |
| `os/pkgs/rauc-sign/deny.toml`, `hack/check.sh` | new; the second gate |
| `.github/workflows/check.yml` | the second workspace's step; the two-manifest MSRV agreement |
| `.gitignore` | the devkeys rule |
| binary names | `mos-sign` → `rauc-sign`, `mos-update-verify` → `rauc-verify`, lib `mos_sign` → `rauc_sign` |

## The gap this milestone could have left

`os/pkgs/mosd/hack/check.sh` runs `cargo clippy --workspace` and
`cargo nextest run --workspace`. The moment this crate left that workspace those
flags stopped reaching it — and a `--workspace` that spans less does not
complain. It exits 0 having checked less. So the crate gets its own
`hack/check.sh`, a line-for-line twin of mosd's, and `check.yml` runs it as a
second gate. The workflow's MSRV step now reads BOTH manifests and requires them
to agree, because the job installs one toolchain: taking the higher would let a
crate claim an MSRV never proven, taking the first would let the other drift.

`os/pkgs/mosd/Cargo.lock` was regenerated with `cargo metadata` rather than
`cargo generate-lockfile`: the latter re-resolves from scratch and silently
bumped 13 unrelated packages, which is a dependency change and not this one. The
diff is removals only. `url` stays — it is declared by no mosd crate, but
reqwest, cookie_store and tower-http pull it in transitively, so its subtree
does not leave with tough's.

## The worked example: six citations that a green run did not check

The fold of `update/README.md` into `os/pkgs/rauc-sign/README.md` made `update`
stop being a repository-root directory. `docs/verify-citations.sh` keeps a
citation in scope only while its first path segment exists at the repo root;
once `update/` was gone, six gated citations were **silently reclassified from
in-scope to skipped-as-outside**. The ledger:

| run | in scope | skipped-as-outside | rc |
| --- | --- | --- | --- |
| baseline, pre-edit | 902 | 50 | 0 |
| after the move, before repair | 896 | 56 | 0 |
| after repair | 902 | 50 | 0 |

The intermediate run printed `896/896 PASS` and exited 0. That is a green tick
over six unchecked citations.

The six, with the line targets the fold moved:

| citation | target |
| --- | --- |
| `api.md:3465` | `:6-7` held |
| `api.md:3469` | `:34` → `:41` |
| `api.md:3470` | `:44` → `:51` |
| `api.md:3559` | `:25` → `:32` |
| `remote-management.md:106` | `:12` held |
| `remote-management.md:135` | `:44-45` → `:51-52` |

Because the fold shifted the README's middle by seven lines, a prefix-only sweep
would have left all six **resolving** with four pointing at wrong text — two
quoted, which would have gone red, and two unquoted, which would have passed
silently. The targets were re-derived by locating each quoted fragment, not by
arithmetic on the shift.

### The unit of measurement, which is the transferable part

M1's census and the coordinator's both measured the four **moving trees**.
`update/README.md` sits at the top of `update/`, under none of them. The correct
unit is **the first path segment that disappears**, because that is exactly what
the checker's scope rule tests. A census taken per moving tree cannot see a file
that is a sibling of the moving tree and shares its vanishing parent.

The consequence for the rest of the campaign, ratified into PLAN-019's Risks:
the binding acceptance for a whole-tree move is the **exact in-scope count held
constant**, with a per-first-segment census before and after. `rc` alone proves
nothing for this class.

## Two rename sites outside the M1 inventory

RFCT-165 section D drew the rename inventory from `git grep`. Two sites were not
on it, and one is functional:

- `src/main.rs:13` — `DEFAULT_KEYS_DIR` was the literal `"update/sign/.devkeys"`,
  the runtime default paired with `.gitignore:8`.
- `src/client.rs:29` — pointed a reader at the README being folded.

## Measurements

- `docs/verify-citations.sh`: 902/902, split and skip buckets restored to
  baseline.
- The rename has no build-graph consumers: no Makefile target, no CI step and no
  `os/**` script invokes either binary, and `build-target.sh` cross-builds only
  `-p mosd -p apid -p mos-mqttd -p mos-mqtt-broker`.
- Both built binaries report the new names in their own `--help`.

## Reported, not acted on

- `os/pkgs/mosd/Cargo.toml:42-44` still pins `tough = "=0.18.0"` although no
  member declares it and it has left the lock. Not removed here: `api.md:3462`
  cited those exact lines, and deleting them would have shifted every line below
  under a citation. M5 was licensed to remove it, queried that licence, and the
  licence was withdrawn — this deferral was correct. RFCT-169 records the
  measured consequences and the six citations a future plan must repoint.
- `os/pkgs/mosd/hack/build-target.sh:123-128` justified mounting the repository
  rather than the workspace by appealing to the member this milestone deletes.
  The decision stands on the reproducibility argument already in the same file;
  the comment now rests on that instead. The `../*` member guard below it is
  marked dormant rather than removed — zero iterations today, still the general
  form.
