# RFCT-112 PLAN-014 M6: the assemblers ported to TS under the byte-identity gate

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 21:42
- **completedAt**: 2026-08-26 07:05
- **plan**: PLAN-014 (M6)

Port `mkimage-v2.sh` (cx3576), `mkimage-x64.sh`, `bundle.sh` and build
orchestration to TypeScript in `os/build/` (decision 3). The shell versions
are the comparison oracle: byte-identical output from identical inputs, then
they are deleted. No permanent dual maintenance.

## Scope

- Same external toolset (sgdisk, mtools, dd, mkimage, veritysetup, rauc via
  the pinned containers) driven through Bun.$; geometry typed from
  `boards/<b>/board.env`.
- The guards move with the code: slot-pin strict mode, boot-attempts range,
  stale-partition-number and loader-content refusals, the uboot-mos-only
  rule — each with the selftest coverage `mkimage-v2-selftest.sh` gives
  them today (ported to `os/tests/`).
- Bundle building and dev-key signing (`update/`) included.

## Acceptance

- Shell and TS assemblers produce byte-identical images from identical
  inputs, both boards; byte-identical bundles for cx3576.
- The ported selftest still refuses the deliberately-stale inputs.
- Shell assemblers and selftest deleted afterwards;
  `shell-pipefail-lint` scope shrinks to the remaining device-side shell.

## Dependencies

- After RFCT-109; oracle comparison needs the pre-port shell scripts, so the
  deletion is the last commit of this task.

## M6e: the gate, and the deletion

Closed by M6e on 2026-08-26. M6a–M6d ported; M6e re-measured the gate on the
tree that ships, recorded the defects the deletion would freeze, deleted the
four shell files, and repointed every reader. Three commits, in that order,
which is M4e's shape at `5dfa880` / `6eadc65` / `1a98767`.

### Acceptance, clause by clause

**1. "Shell and TS assemblers produce byte-identical images from identical
inputs, both boards" — HOLDS, re-measured here.**

| board | images | sha256 |
|---|---|---|
| cx3576 | 4 (shell ×2, TS ×2) | `f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce` |
| x64 | 4 (shell ×2, TS ×2) | `bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f` |

Two shell runs precede the two TS runs on each board because an oracle that does
not reproduce itself gives nothing to compare against. Both boards carry a live
control: one byte of `rootfs-verity.img`, both implementations to the same new
hash, byte restored, both back. `cmp -l` bucketed into MiB shows the difference
confined to `rootfs-a` (cx3576) and to `rootfs-a` **and** `rootfs-b` (x64) —
the two boards differ there because one seeds a single slot at assembly and the
other seeds both, so a control reporting the same shape for both would have been
measuring nothing.

**2. "byte-identical bundles for cx3576" — HOLDS in the only sense any correct
implementation can satisfy it, and the deviation is stated rather than glossed.**

```
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea   shell, shell, TS
```

**The comparison is the squashfs PAYLOAD, not the bundle file.** A byte-identical
bundle *file* is not achievable by anything: rauc salts the bundle's own
dm-verity hash tree at random and the CMS signature carries a `signingTime`, so
two runs of the **same** implementation differ. Measured here, not assumed —
the three runs above produced file hashes `ff303973…`, `f0c991e1…` and
`42bd670c…`, and `rauc info`'s bundle `hash` moved on every one. The payload is
the part that is a pure function of the inputs, `os/update/bundle.sh`'s own
`verify_bundle` said so in as many words, and it is what was compared.

**The x64 bundle was gated too, which this clause does not require.** M6d
recorded that branch as ported but never built by either implementation. It was
buildable after all — `288894976 bytes 66bb6dc1d1bef49485069142b82570ad914e54336dde50cfc6edc2b54320e716`,
four bundles, one payload, with its own live control. Taken because after the
deletion there is no oracle to take it against, ever.

**3. "The ported selftest still refuses the deliberately-stale inputs" — HOLDS,
and the ported form is the TS suite rather than a shell script under
`os/tests/`.** All 33 refusals of `os/mkimage-v2.sh` and all 14 reachable ones of
`os/mkimage-x64.sh` + `os/mkimage-common.sh` are driven from the failing side
with a positive control beside each; `os/build/HARNESS.md` tables them one by
one. `make os-build-test` is green at **674/674 across 25 files**.

**4. "Shell assemblers and selftest deleted afterwards" — DONE.** Four shell
files and both selftests. `os/` now holds no top-level files at all. Both
selftests ran green immediately before deletion — 166 and 196 assertions, rc=0 —
so they went at parity rather than in place of a failure.

**5. "`shell-pipefail-lint` scope shrinks to the remaining device-side shell" —
DONE, 32 → 26 files.** Counted before and after by running it. The drop is 4 + 2,
not 4: both selftests enabled `pipefail` and were in scope, which the first draft
of this record got wrong.

### The floor, re-measured at the closing commit

```
docs-verify 375/375 · docs-verify-test 8/8
os-shell-pipefail-lint 26/26 (26 scanned)      <- was 32/32
os-layout-lint 26/26 · os-layout-lint-test 42/42
os-verify-test 922/922 across 27 files
os-build-test 674/674 across 25 files          (alone on the host; no flake seen)
os-health-test 57/57 · build-env "20 Dockerfile(s) agree"
```

`os-mkimage-v2-test` and `os-mkimage-x64-test` **no longer exist**; they were
removed with the assemblers they drove, not repointed, on M4e's precedent that a
target passing with nothing behind it is worse than no target.

### The `$`-expansion defect: recorded first, then FIXED

M6e first recorded this as shipping. **L2 ruled that it is M6's own to fix, and
the ruling is right.** `os/build/src/bundle.ts` was created by M6d (`eee58ca`,
tests in `020d003`) and `git log --follow` returns only those two commits, so no
other subtask owns it; PLAN-014:220-223 excludes device-side runtime behaviour,
image content contracts, `board/`, `mosd/` and `test/apid-api`, none of which is
`os/build/src/`; and the spec's record-not-fix instruction was about the
*shell's* defect, where fixing a file about to be deleted is pointless.

`sed` expands `&`; JavaScript expands `$&`, `` $` ``, `$'`, `$$` and `$n` in a
replacement string, and `replaceAll` is not exempt. The port had fixed `&` and
reintroduced the same class under `$`, while its comment claimed the
substitution was literal.

**A second site was found by sweeping, not by being told.** Every
`replaceAll`/`replace` in `os/build/src/` was checked. `src/grub-x64.ts:155` had
the identical defect and a comment making the same claim in stronger words
("no right-hand-side syntax at all"), and **its input is freer**:
`BOARD_CMDLINE_ARGS` is an arbitrary kernel command line, where
`BUNDLE_COMPATIBLE` is only ever `mos-<board>`. Three other `replace` sites were
checked and are correct as written.

Both fixed with a replacer **function** — never scanned for `$` sequences —
rather than an escape list, which is a list that can go stale.

**Driven from the failing side by reverting the fix**: 4 of 6 bundle cases and
4 of 5 grub cases go red (`$&`, `` $` ``, `$'`, `$$`). The cases that do not are
the controls — a bare `&` and a `$1` with no capture group are literal in
JavaScript either way, and a set where everything went red would have been
failing indiscriminately. A positive control asserts an ordinary
`mos-x64`/`0.0.0-dev` renders unchanged.

**The fix moves no bytes, proven against the dead oracle's recorded output.**
The oracle cannot be re-run — it was deleted in `c55c7b0` — but a recorded hash
is a sound regression oracle for a change that claims to move none. No shipped
board can carry a trigger (`render-config.sh:88` is `COMPATIBLE="mos-${LAYOUT_BOARD}"`;
both `BOARD_CMDLINE_ARGS` values are `$`- and `&`-free, checked). All four gates
re-run against the fixed tree, all four unchanged:

| gate | before fix | after fix |
|---|---|---|
| cx3576 image | `f36bf809…` | `f36bf809…` |
| x64 image | `bdf340e9…` | `bdf340e9…` |
| cx3576 bundle payload | 114425856 `d7506b62…` | 114425856 `d7506b62…` |
| x64 bundle payload | 288894976 `66bb6dc1…` | 288894976 `66bb6dc1…` |

The x64 image is load-bearing for `grub-x64.ts`: the rendered `grub.cfg` is
written onto the ESP, so a substitution that moved a byte would have moved that
hash.

### Still recorded, not fixed

`os/build/HARNESS.md` carries these with their reproductions: the shell's own
`sed`/`&` site at `os/update/bundle.sh:289`, **deleted along with its container**
rather than fixed; four stale `Dockerfile.v2` references in `os/build/src/`
(successor `os/rootfs/scripts/pack-verity.sh`); and `verify-image-v2.sh:2674`,
confirmed MOOT because M4e deleted that file.

### Left alone deliberately

`test/apid-api/run.sh` carries a remedy naming the deleted `os/mkimage-x64.sh`.
It was repointed and then **reverted**: PLAN-014's scope (`docs/plan/PLAN-014.md`
:220-223) excludes `test/apid-api`. Same for the two `board/*/board.yaml`
citations, under the same sentence's `board/` exclusion. Finding is in scope;
acting is not. Both are stale and neither is this task's to change.
