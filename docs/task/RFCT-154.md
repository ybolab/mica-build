# RFCT-154 PLAN-015 M6: the index rows, the metric re-run and the aggregate survivor record

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 21:10
- **claimedAt**: 2026-08-26 21:10
- **completedAt**: 2026-08-26 22:40
- **plan**: PLAN-015 (M6)

The finishing subtask of the M6 form-compression workstream. The four content
subtasks (RFCT-150, 151, 152, 153) are merged; this one closes the index gate,
re-runs the milestone metric over the assembled branch, and consolidates the
justified 15+-line survivors into a single record.

No source comment was edited here, and no residue was swept: L1 withdrew both
the residue sweep and a second compression pass from this subtask's scope.
Where a measurement disagrees with a claim already written, it is reported
below rather than acted on -- with one exception carried by name from L1, the
threshold claim in `docs/task/RFCT-150.md`.

## Scope

Three files, and nothing else:

| file | change |
| --- | --- |
| `docs/task/index.md` | five claim rows appended, RFCT-150 .. RFCT-154 |
| `docs/task/RFCT-154.md` | this file, new |
| `docs/task/RFCT-150.md` | one incorrect threshold claim corrected, per L1 |

No source file is touched. The proof:

```
$ git diff --name-only main...HEAD -- . ':!docs/task' | wc -l
144
```

All 144 are the four merged subtasks' own files; `git diff main...HEAD --
docs/task` is the only place this subtask appears.

## Upstream sync

This branch was cut from `main` and did not contain the workstream. Merged
first, as instructed:

```
$ git merge bkd/f4u7fvgn
148 files changed, 7152 insertions(+), 7315 deletions(-)

$ git log --oneline main..HEAD | wc -l
86
```

The four L2 merges are present: `dcbb2bf` (RFCT-150), `e4b7cf3` (RFCT-151),
`454628f` (RFCT-152), `c0f0d52` (RFCT-153).

## Metric re-run, whole tree

The milestone's `m6metric.py`, unmodified, over the whole tree. `main` is the
merge base; HEAD is the assembled branch with all four subtasks merged.

```
$ python3 m6metric.py main
rev=main scanned=360 over_threshold=142 caps=773 banners=662 blocks15=381

$ python3 m6metric.py HEAD
rev=HEAD scanned=360 over_threshold=40 caps=63 banners=139 blocks15=190
```

| | main | HEAD | change |
| --- | ---: | ---: | ---: |
| files scanned | 360 | 360 | -- |
| files over threshold (score >= 8) | 142 | 40 | -72% |
| caps runs | 773 | 63 | -92% |
| banner lines | 662 | 139 | -79% |
| 15+-line blocks | 381 | 190 | -50% |

These reproduce L2's reference values exactly, on all eight numbers.

The 190 surviving blocks split cleanly by whether a subtask could reach the
file at all:

| | files | blocks |
| --- | ---: | ---: |
| in the 144 files the four subtasks edited | 143 | **136** |
| in the 217 files no subtask edited | 54 | 54 |

The 136 is the aggregate survivor table below, and the row count matches the
block count exactly.

## Residual caps and banners: which files, and why they were out of scope

74 files still carry a cap run or a banner line at HEAD. The dispatch threshold
was a score of 8 measured at `main`, so a file's `main` score is what decided
whether any subtask could touch it.

### Caps: 63 residual runs, all of them out of scope

Every one of the 63 residual cap runs is in a file that scored **below 8 at
`main`** and was therefore in no subtask's scope. Not one dispatched file
carries a residual cap run -- caps went to zero in all four scopes. Reported,
not edited.

The files, with their `main` score in brackets:

`os/build/src/geometry.test.ts` x3 [6], `os/build/src/toolbox.test.ts` x3 
[6], `os/verify/src/checks-shape.test.ts` x2 [7], 
`os/verify/src/parity.test.ts` x2 [5], `board/cx3576/Dockerfile.alpine` x2 
[4], `os/build/src/images.ts` x2 [4], `os/build/src/stages.test.ts` x2 [4], 
`os/build/src/tools/mtools.test.ts` x2 [4], 
`os/rootfs/scripts/firmware-install.sh` x2 [4], 
`os/rootfs/scripts/kernel-and-initramfs.sh` x2 [4], 
`os/verify/src/image-layout.ts` x2 [4], 
`os/verify/src/smoke-negative.test.ts` x2 [4], `os/verify/src/tools.test.ts` 
x2 [4], `mosd/mosd/src/fswrite.rs` [7], 
`os/build/src/pin-seeded-times.test.ts` [7], 
`os/build/src/tools/veritysetup.ts` [7], 
`os/rootfs/overlay-v2/etc/containers/registries.conf` [7], 
`os/rootfs/overlay-v2/etc/containers/storage.conf` [7], 
`os/tests/factory-root-gate/mutate.sh` [7], 
`os/tests/shadow-reconcile-test.sh` [7], `os/tools/qemu-journal.sh` [7], 
`os/verify/src/board-scope.ts` [7], `os/verify/src/checks-dbus.test.ts` [7], 
`os/verify/src/checks-fstab.test.ts` [7], `os/verify/src/checks-root.test.ts` 
[7], `os/verify/src/checks-system.test.ts` [7], `os/verify/src/paths.ts` [7], 
`test/apid-api/src/phases/08-poweroff.ts` [6], 
`board/cx3576/rootfs/alpine/Dockerfile` [4], 
`os/verify/src/checks-cmdline.test.ts` [4], 
`os/build/src/boot-cx3576.test.ts` [3], `board/cx3576/init/gadget.conf` [2], 
`board/cx3576/rootfs/alpine/rootfs/etc/resolv.conf` [2], 
`mosd/mosd/src/reconciler/container/tests.rs` [2], 
`os/build/src/images.test.ts` [2], `os/build/src/layout-cx3576.test.ts` [2], 
`os/build/src/mkimage-v2-cli.ts` [2], `os/build/src/tools/e2fsprogs.test.ts` 
[2], `os/build/src/tools/mkimage.ts` [2], `os/build/src/tools/rauc.test.ts` 
[2], `os/build/src/tools/sgdisk.test.ts` [2], 
`os/rootfs/scripts/mosd-install.sh` [2], 
`os/rootfs/scripts/pack-assert-shadow-chain.sh` [2], 
`os/rootfs/scripts/pack-verity.sh` [2], 
`os/update/rauc/Dockerfile.dockerignore` [2], 
`os/verify/src/checks-rauc.test.ts` [2], 
`os/verify/src/checks-shadow.test.ts` [2], 
`os/verify/src/smoke-negative-cli.ts` [2].

### Banners: 139 residual lines, and here the picture is not uniform

This is the one place where the framing "the residual is all below-threshold
work" does not hold, and the measurement says so plainly:

| | files | banner lines |
| --- | ---: | ---: |
| `main` score < 8 -- never dispatched | 57 | 37 |
| `main` score >= 8 -- **was** dispatched | 17 | **102** |

So 102 of the 139 residual banner lines are in files a subtask did edit. They
are not oversights. Classifying every one of the 139 by what the regex actually
matched:

| kind | count | disposition |
| --- | ---: | --- |
| rule-2 labelled section markers -- `# --- teardown -----`, `// ---- rendering ----` | 130 | kept, deliberately |
| metric false positives -- comment lines indented 20+ columns, so `(.)\1{19,}` matches the *leading whitespace*, not any banner | 9 | not banners at all |
| decorative separators | 0 | all deleted |

The 130 markers are the established sibling-script convention that rule 2
explicitly exempts, and `docs/verify-index.sh` -- the file rule 2 names as the
reference -- is itself written in it. RFCT-153 documented this for its own 38
files (94 markers + 8 false positives = 102); this re-run confirms the same
split holds tree-wide (130 + 9 = 139), with the 37 remaining lines spread over
files below the threshold.

The 9 false positives are `mosd/apid/src/routes.rs` (5, a comment nested in a
`maud` `html!` block at 24 columns), `mosd/mosd/src/reconciler/sshd.rs` (3, a
comment inside a nested `json!({...})` at 20 columns) and
`mosd/mosd/src/rauc.rs` (1). All are ordinary prose. This is a defect in the
metric, not in the tree.

### The 54 blocks in files no subtask edited

54 files outside all four scopes still carry exactly one 15+-line comment block
each. Every one scores 5 to 7 -- below the dispatch threshold -- and every one
scores identically at `main` and at HEAD, i.e. untouched by this milestone by
construction. A single 15+-line block is worth 5 on its own, which is why a
file can carry one and still sit under 8.

`mosd/mosd/src/fswrite.rs` (7), `os/build/src/pin-seeded-times.test.ts` (7), 
`os/build/src/tools/veritysetup.ts` (7), 
`os/rootfs/overlay-v2/etc/containers/registries.conf` (7), 
`os/rootfs/overlay-v2/etc/containers/storage.conf` (7), 
`os/tests/factory-root-gate/mutate.sh` (7), `os/tools/qemu-journal.sh` (7), 
`os/verify/src/board-scope.ts` (7), `os/verify/src/checks-dbus.test.ts` (7), 
`os/verify/src/checks-fstab.test.ts` (7), `os/verify/src/checks-root.test.ts` 
(7), `os/verify/src/checks-system.test.ts` (7), `os/verify/src/paths.ts` (7), 
`mosd/apid/tests/e2e.rs` (6), `mosd/mosd/src/rauc.rs` (6), 
`os/build/src/testing.ts` (6), 
`os/rootfs/overlay-v2/etc/containers/containers.conf` (6), 
`os/rootfs/overlay-v2/etc/fstab.in` (6), 
`os/rootfs/overlay-v2/etc/fw_env.config.in` (6), 
`mosd/apid/src/assets/mime.rs` (5), `mosd/apid/src/assets/path.rs` (5), 
`mosd/apid/src/bundle.rs` (5), `mosd/apid/src/main.rs` (5), 
`mosd/apid/src/tests.rs` (5), `mosd/apid/src/tests/power_bus.rs` (5), 
`mosd/broker/src/main.rs` (5), `mosd/deny.toml` (5), 
`mosd/mosd-settings/src/store.rs` (5), `mosd/mosd/src/actions.rs` (5), 
`mosd/mosd/src/bus.rs` (5), `mosd/mosd/src/reconciler/hostname.rs` (5), 
`mosd/mosd/src/reconciler/network.rs` (5), `mosd/mosd/src/scan.rs` (5), 
`mosd/mosd/tests/bus.rs` (5), `mosd/mosd/tests/scan.rs` (5), 
`mosd/mqttd/src/lib.rs` (5), `mosd/mqttd/src/runtime.rs` (5), 
`mosd/mqttd/src/source.rs` (5), `mosd/mqttd/src/topic.rs` (5), 
`os/boards/cx3576/overlay/etc/repart.d/10-uenv-a.conf` (5), 
`os/boards/cx3576/overlay/etc/repart.d/20-uenv-b.conf` (5), 
`os/build/src/verify-package.test.ts` (5), 
`os/rootfs/overlay-v2/etc/repart.d/80-data.conf` (5), 
`os/rootfs/overlay-v2/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf` (5), 
`os/tests/factory-root-gate/gate.sh` (5), 
`os/tests/factory-root-gate/inner.sh` (5), `os/tests/shell-pipefail-lint.sh` 
(5), `os/tools/qemu-seed-state.sh` (5), `os/verify/src/checks-connd.test.ts` 
(5), `os/verify/src/checks-engine.test.ts` (5), 
`os/verify/src/checks-home.test.ts` (5), `test/apid-api/src/runner.ts` (5), 
`update/sign/src/client.rs` (5), `update/sign/src/repo.rs` (5).

## The aggregate survivor table

Every 15+-line comment block that survives across the four subtasks, in one
place. 136 rows: **70** from RFCT-150, **22** from RFCT-151, **0** from
RFCT-152, **44** from RFCT-153. The count agrees with the metric, which reports
136 blocks across the 144 edited files.

This table is the record, not a review. L1 accepted the justified-survivor rule
and withdrew the numeric "single digits" target from PLAN-015 M6, so no row
here is re-litigated; each justification is carried verbatim from the subtask
that wrote it. Line numbers are as recorded at each subtask's own commit.

| # | subtask | file | line | lines | justification, as recorded by the subtask |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | RFCT-150 | `os/verify/src/board-env.ts` | 1 | 36 | the accepted and the refused board.env grammar, enumerated; each construct is a refusal the parser must keep making |
| 2 | RFCT-150 | `os/verify/src/checks-board.ts` | 1 | 33 | three derivation rules (skip matcher, derived board lists, one check per path) plus the measured 3/22 SKIP census |
| 3 | RFCT-150 | `os/verify/src/checks-system.ts` | 1 | 32 | the ten-site conclusion census (line numbers and per-board counts) plus the PLAN-014 Scope quote and the `grep -c` "0\n0" defect |
| 4 | RFCT-150 | `os/verify/src/checks-shadow.ts` | 1 | 31 | the access.md 4.2 credential property end to end, plus the two oracle checks that disagree about an empty password field |
| 5 | RFCT-150 | `os/verify/Dockerfile` | 1 | 31 | two digest pins, why build-env does not build it, and the measured `ldd` "Not a valid dynamic program" static-client fact |
| 6 | RFCT-150 | `os/verify/src/lint.ts` | 1 | 30 | the RAUC grub-backend incident quote plus four measured `${NAME:-}` holes, each with its own spelling |
| 7 | RFCT-150 | `os/verify/src/checks-connd.ts` | 1 | 30 | the PLAN-014 Scope quote plus the measured extractor-rot incident that forbids a fallback default |
| 8 | RFCT-150 | `os/verify/src/checks-bootchain.ts` | 1 | 30 | the five skip-group line numbers with their check counts, the PLAN-014 Scope quote, and the two cx3576 literals |
| 9 | RFCT-150 | `os/verify/src/tools.ts` | 1 | 27 | the two-route seam, the pinned-image key, and the no-empty-string-on-failure rule |
| 10 | RFCT-150 | `os/verify/src/checks-shape.ts` | 1 | 27 | the per-board `exactly N partitions` derivation plus the measured `getcap -r` vacuous pass |
| 11 | RFCT-150 | `os/verify/src/checks-ext4.ts` | 1 | 27 | the layout-offset extraction rule plus three measured oracle defects reproduced rather than repaired |
| 12 | RFCT-150 | `os/verify/src/parity.ts` | 1 | 26 | the by-name-not-by-count rule and the measured 398/312 verdict-line census |
| 13 | RFCT-150 | `os/verify/src/checks-mqtt.ts` | 1 | 26 | the inertness property plus the measured tag-normalisation ordering (:838-846) |
| 14 | RFCT-150 | `os/verify/src/checks-home.ts` | 1 | 26 | the read-the-tier rule, the separate-enablement rule, and the static-read rule for the seed scripts |
| 15 | RFCT-150 | `os/verify/src/checks-fstab.ts` | 1 | 25 | the one-check-seven-firings shape and the measured six-line `custom UI root` matcher |
| 16 | RFCT-150 | `os/verify/src/checks-dbus.ts` | 1 | 25 | three ported readers named against their oracle line numbers, plus the read-the-bus-name rule |
| 17 | RFCT-150 | `os/verify/src/script-commands.ts` | 1 | 24 | the pipeline-not-parser rule, the wrapper commands deliberately excluded, and the re-rooting difference |
| 18 | RFCT-150 | `os/verify/src/verify-cli.ts` | 1 | 23 | the output-format contract (MUST-KEEP class 7) plus the SKIP-is-not-PASS and zero-conclusions rules |
| 19 | RFCT-150 | `os/verify/src/smoke.ts` | 160 | 23 | the measured five-row `docker run` exit-status table (255/127/126/127/own status) with its stderr text |
| 20 | RFCT-150 | `os/verify/src/checks.ts` | 369 | 23 | the content-keyed cache rule and the publish-by-rename rule, both with the defect each prevents |
| 21 | RFCT-150 | `os/verify/src/checks-gpt.ts` | 121 | 23 | the measured substring census (` partitions` 3/3, `exactly ` 13/8) the matcher choice rests on |
| 22 | RFCT-150 | `os/verify/src/checks-cmdline.ts` | 1 | 23 | the U-Boot and GRUB command-line composition, both sources named, plus the leave-unexpanded rule |
| 23 | RFCT-150 | `os/verify/src/smoke-negative.ts` | 1 | 22 | the measured 255/127/126 correction to M7b's map, plus the no-op and positive-control rules |
| 24 | RFCT-150 | `os/verify/src/image.test.ts` | 50 | 22 | the measured `_out/` ENOENT incident (373/373 -> 332 of 333) and the filtered-run scratch leak |
| 25 | RFCT-150 | `os/verify/src/checks.ts` | 1 | 22 | the matcher-on-the-check rule and the shape of a register entry |
| 26 | RFCT-150 | `os/verify/src/checks-slots.ts` | 150 | 22 | the per-slot factory assertions and the oracle line numbers they come from |
| 27 | RFCT-150 | `os/verify/src/checks-root.ts` | 1 | 22 | the unpack-once cache rule, the same-text-on-both-boards admission rule, and the measured ` contains ` census |
| 28 | RFCT-150 | `os/verify/src/checks-engine.ts` | 1 | 22 | the one register shape that cannot be expressed, measured and recorded |
| 29 | RFCT-150 | `os/verify/src/board.ts` | 1 | 22 | the parser-throws / model-does-not split and the declared-empty-is-not-absent rule |
| 30 | RFCT-150 | `os/verify/src/tools.ts` | 100 | 21 | the measured apk index-fetch failure rate (3 of 40) with its exact error text, and the retry rule |
| 31 | RFCT-150 | `os/verify/src/checks-slots.ts` | 1 | 21 | the layout-offset rule plus the factory-only serial and label facts (:1796, :1804) |
| 32 | RFCT-150 | `os/verify/src/checks-bootchain.ts` | 341 | 21 | the PLAN-014 Scope quote about `board/` BSP files, at the check it constrains |
| 33 | RFCT-150 | `os/verify/src/board.ts` | 113 | 21 | the partition model fields and the geometry each one is read from |
| 34 | RFCT-150 | `os/verify/run.sh` | 1 | 21 | the usage block plus the tool-less-host seam and the zero-tests-is-a-failure rule |
| 35 | RFCT-150 | `os/verify/src/smoke-pins.ts` | 1 | 20 | the closed-version-loop rule and the three second-list defects it exists to prevent |
| 36 | RFCT-150 | `os/verify/src/smoke-negative.ts` | 250 | 20 | the mutation contract for one negative case, pre-state and post-state |
| 37 | RFCT-150 | `os/verify/src/checks-rauc.ts` | 1 | 20 | the slot-device consequence (an update over the running slot) and what is deliberately not here |
| 38 | RFCT-150 | `os/verify/src/lint.ts` | 514 | 19 | the backstop/vacuity rule with the measured shell-predecessor incident it exists for |
| 39 | RFCT-150 | `os/verify/src/lint.test.ts` | 1 | 19 | the declared-empty axis the shell pair never tested, with the measured 0/0 and 1/1 incidents |
| 40 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 190 | 19 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 41 | RFCT-150 | `os/verify/run.sh` | 210 | 19 | a measured route decision (bun invocation, or the vacuity guard) stated where it is taken |
| 42 | RFCT-150 | `os/verify/src/smoke-register.ts` | 211 | 18 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| 43 | RFCT-150 | `os/verify/src/smoke-pins.ts` | 137 | 18 | the measured two-spellings-in-one-file fact and why this is not a one-line regex |
| 44 | RFCT-150 | `os/verify/src/parity.ts` | 152 | 18 | the self-consistency guard and the identity assignment it depends on |
| 45 | RFCT-150 | `os/verify/src/layout.ts` | 1 | 18 | the size-resolution order and the walk rule that makes packing the thing under test |
| 46 | RFCT-150 | `os/verify/src/checks-gpt.ts` | 1 | 18 | the derivation of the expected table and the one number that crosses |
| 47 | RFCT-150 | `os/verify/src/checks-ext4.ts` | 382 | 18 | a measured oracle defect reproduced at the check that reproduces it |
| 48 | RFCT-150 | `os/verify/src/checks-board.test.ts` | 1 | 18 | the three-direction discipline and the branch never before driven failing |
| 49 | RFCT-150 | `os/verify/src/tools.ts` | 540 | 17 | a measured runtime decision stated at the code that takes it |
| 50 | RFCT-150 | `os/verify/src/smoke-register.ts` | 189 | 17 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| 51 | RFCT-150 | `os/verify/src/smoke-cli.ts` | 1 | 17 | the CLI contract and the refusals it makes before anything is executed |
| 52 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 553 | 17 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 53 | RFCT-150 | `os/verify/src/checks-board.ts` | 853 | 17 | a per-family derivation rule with the board declaration it reads |
| 54 | RFCT-150 | `os/verify/src/smoke.test.ts` | 1 | 16 | the five things asserted, each ruling out a different way of passing |
| 55 | RFCT-150 | `os/verify/src/smoke-register.ts` | 1 | 16 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| 56 | RFCT-150 | `os/verify/src/smoke-register.test.ts` | 36 | 16 | the lock and the edit it was built to force |
| 57 | RFCT-150 | `os/verify/src/smoke-pins.ts` | 60 | 16 | the measured two-spellings-in-one-file fact and why this is not a one-line regex |
| 58 | RFCT-150 | `os/verify/src/probe.ts` | 1 | 16 | the probe-is-not-a-check rule and the role walk |
| 59 | RFCT-150 | `os/verify/src/image.test.ts` | 1 | 16 | the stub-runtime rule and the four tools that must be refused |
| 60 | RFCT-150 | `os/verify/src/checks-home.ts` | 176 | 16 | the tier rule stated at the check that reads it |
| 61 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 451 | 16 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 62 | RFCT-150 | `os/verify/src/smoke-pins.test.ts` | 1 | 15 | the failing side of the pin normalisation |
| 63 | RFCT-150 | `os/verify/src/parity.ts` | 171 | 15 | the self-consistency guard and the identity assignment it depends on |
| 64 | RFCT-150 | `os/verify/src/checks.ts` | 276 | 15 | a register invariant stated at the code that holds it |
| 65 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 682 | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 66 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 359 | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 67 | RFCT-150 | `os/verify/src/checks-fixture.ts` | 1 | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| 68 | RFCT-150 | `os/verify/src/checks-ext4.test.ts` | 1 | 15 | the vacuous-pass cases asserted as their own cases |
| 69 | RFCT-150 | `os/verify/src/checks-board.ts` | 311 | 15 | a per-family derivation rule with the board declaration it reads |
| 70 | RFCT-150 | `os/verify/run.sh` | 145 | 15 | a measured route decision (bun invocation, or the vacuity guard) stated where it is taken |
| 71 | RFCT-151 | `os/build/src/mkimage-x64.ts` | 28-65 | 38 | Five byte-deciding constraints (pinned debian and its grub package, grub tools run with the work directory as cwd, three `mcopy -m` calls in vmlinuz/initrd.img/cmdline.cfg order against one `mcopy -s -m` of a staged tree with the 18-moving-byte `mmd` measurement, `cp -a` on the host with the SELinux/xattr reason, sectors with `-a 2048`) plus the determinism-control list and the nine-MiB measurement. Was 59 lines. |
| 72 | RFCT-151 | `os/build/src/stages.ts` | 491-527 | 37 | The two-invocation/one-export rule, the no-`--no-cache` rule, and the three-flag reproducibility record with every measurement (see the MUST-KEEP table). Was 46 lines. |
| 73 | RFCT-151 | `os/build/src/mkimage-v2.ts` | 25-56 | 32 | The determinism control list plus the four byte-deciding constraints and the `-a ${GPT_ALIGN_SECTORS}` maskrom consequence. Was 47 lines in one block with the module summary; the summary is now a separate 14-line header. |
| 74 | RFCT-151 | `os/build/src/bundle.ts` | 29-58 | 30 | The four things the port has to get right (mcopy order as a written-out list, no `-i`/no slot label with `BUNDLE_BOOT_FAT_LABEL` and `--invariant`, FILE_MTIME before mcopy, `--mksquashfs-args` verbatim) plus the one refusal the shell does not make, quoted with the exact `grep -oE 'BOOT_[AB]_LEFT [0-9]+' \| awk '{print $2}'` pipeline that makes the vacuous pass reachable. Was 50 lines in one block; the module summary above it is now a separate 14-line block. |
| 75 | RFCT-151 | `os/build/src/mkimage-x64.ts` | 522-548 | 27 | EPHEMERAL seeded at build time with the systemd-networkd-persistent-storage race, the two-call create-then-pin rule with the measured `touch -h` failure text, and why both run in the container. |
| 76 | RFCT-151 | `os/build/src/toolbox.ts` | 19-42 | 24 | Three separate rules: the container is the normal route (with this host's missing tools and e2fsprogs 1.46.5), per-toolset not per-tool, and the session timings (~320 ms vs ~40 ms, ~1.3 s apk). |
| 77 | RFCT-151 | `os/build/src/mkimage-x64.ts` | 178-200 | 23 | The ESP FAT32 floor: free-vs-total clusters, the measured 129021/129022/117119, why moving the call turns a type check into a free-space check, and the `-F 32` non-enforcement with the OVMF outcome. |
| 78 | RFCT-151 | `os/build/src/mkimage-x64.test.ts` | 1-23 | 23 | Pinned by the reserved HARNESS-pointer sentence at line 13, which may not move; the block cannot end before it. |
| 79 | RFCT-151 | `os/build/src/layout-x64.ts` | 15-37 | 23 | The three numbered differences from cx3576, each with its shell line number and arithmetic (`os/mkimage-x64.sh:117`, board.env sourced at :74 and read at :119, the 2048 alignment). |
| 80 | RFCT-151 | `os/build/src/layout-x64.ts` | 186-208 | 23 | Order-off-the-board, the explicit-alignment measurement, and why there is no loader read-back here although `checkPartitionsLanded` still reads the table back. |
| 81 | RFCT-151 | `os/build/src/bundle.ts` | 257-278 | 22 | Both slots' env files in one bundle, the unsuffixed-name rule, why these checks are not a duplicate of the assembler's, and the two documented differences from `mkverityenv()` (shared sentence for absent `dm-mod.create=`/`dm-mod.waitfor=`, salt additionally required in the table). Five distinct refusals. |
| 82 | RFCT-151 | `os/build/src/mkimage-v2.test.ts` | 1-22 | 22 | Same reserved-sentence pin at line 13, plus the lowercase/uppercase PARTUUID fixture rule that has to be stated before the fixtures. |
| 83 | RFCT-151 | `os/build/src/bundle.ts` | 422-442 | 21 | The `$&`/`` $` ``/`$'`/`$$`/`$n` expansion rule, the `sed`-`&` precedent at `os/update/bundle.sh:289`, the measured wrong render `compatible=mos-a@COMPATIBLE@b`, and the two value-shape guards (`^[A-Za-z0-9][A-Za-z0-9._+-]*$`, `mos-<board>`) that make it unreachable today. |
| 84 | RFCT-151 | `os/build/src/mkimage-x64.ts` | 274-294 | 21 | Why the read-back exists although no x64 start is relocatable, plus the measured `-a 4096` behaviour (ESP 2048 -> 4096, "Information: Moved requested sector", exit 0) against cx3576's exit 4, and the `-a 2048`-vs-no-alignment equivalence. |
| 85 | RFCT-151 | `os/build/src/bundle.ts` | 664-681 | 18 | Why `carry` cannot work on the host route, what `provenance: 'shipped'` then claims falsely, and why the refusal lives here rather than in `src/toolbox.ts`. |
| 86 | RFCT-151 | `os/build/src/stages-cli.ts` | 234-251 | 18 | The quoted three-line buildkit error and the one case it bites (docker-container fallback on an amd64 host building arm64 with no binfmt_misc). |
| 87 | RFCT-151 | `os/build/src/bundle-cli.ts` | 1-18 | 18 | The seam and epoch rule plus the two resolutions (signing material with its two distinct failure sentences, host architecture vs board). |
| 88 | RFCT-151 | `os/build/src/mkimage-x64.ts` | 1-17 | 17 | The nine-partition inventory plus the "not `mkimage-v2.ts` with a board parameter" rule and the list of what the two boards genuinely share. |
| 89 | RFCT-151 | `os/build/src/boot-cx3576.ts` | 1-17 | 17 | Purity-for-testability plus the GUID case rule, which has to state both spellings and both producers. |
| 90 | RFCT-151 | `os/build/src/bundle.test.ts` | 1-16 | 16 | The positive-control rule, the mutation-is-a-mutation rule, and the derived-fixtures rule naming `ROOTFS_A_GUID`/`ROOTFS_B_GUID`, `VERITY_SALT`, the shipped `boot.cmd` and `manifest.raucm.in`. |
| 91 | RFCT-151 | `os/build/src/mkimage-x64.test.ts` | 424-439 | 16 | The measured relocation *and* shrink (129024 sectors at 4096 vs 131072 at 2048, capped at the next partition's original start 133120) with why a start-only check would misreport it. |
| 92 | RFCT-151 | `os/build/src/toolbox.ts` | 296-311 | 16 | The apk retry measurement: 3 failures in 40 runs, the quoted `ERROR: unable to select packages` text, the exit-6 variant, ~7% per install over eight opens, and why three attempts hide nothing. |
| 93 | RFCT-153 | `mosd/busname/src/lib.rs` | 86 | 44 | Contains a 15-line rustdoc doctest that `cargo test --doc` executes; the prose above it was cut 41 -> 28 and the doctest is code, not comment form. |
| 94 | RFCT-153 | `mosd/apid/src/startup.rs` | 1 | 32 | Out of compression scope: startup.rs was added mid-task for one stale-fact fix only. Header untouched. |
| 95 | RFCT-153 | `mosd/apid/src/tests/broken_classes.rs` | 1 | 31 | Two named anti-patterns (pass-count invariance, same-observable collision) each with a cited model test, plus §6.1's layer table. 37 -> 31. |
| 96 | RFCT-153 | `mosd/mosd/src/provisioning.rs` | 97 | 27 | Seven-step seeding contract, one distinct fact per step, plus a rustdoc `# Errors` section. 32 -> 27. |
| 97 | RFCT-153 | `mosd/mosd/src/main.rs` | 1 | 27 | An environment-variable reference list: five variables, three of them MUST-KEEP safety invariants (`MOSD_SHADOW_PATH`, `MOSD_DRY_RUN`, the one-way `MOSD_SCAN` hook). 31 -> 27. |
| 98 | RFCT-153 | `mosd/mosd/src/reconciler/sshd.rs` | 1 | 26 | Three ordered system effects with their paths and modes, plus three separate MUST-KEEP rules (PAM, PasswordAuthentication gating, AuthorizedKeysFile precedence). 34 -> 26. |
| 99 | RFCT-153 | `mosd/mosd/src/reconciler/wifi_ap.rs` | 1 | 25 | Three ordered system effects, the single-radio conflict rule, and the PSK secret-hygiene invariant. 28 -> 25. |
| 100 | RFCT-153 | `mosd/mosd/src/reconciler/sshd.rs` | 314 | 25 | The reload-not-restart rule, the `KillMode` measurement, the `ExecReload` dependency and the no-fallback rule. 31 -> 25. |
| 101 | RFCT-153 | `mosd/hack/dbus-policy-test.sh` | 1 | 25 | Harness contract: what is proved, the both-directions rule, the three-bus separation and the refuse-rather-than-skip rule. 31 -> 25. |
| 102 | RFCT-153 | `mosd/apid/src/routes.rs` | 2208 | 25 | MUST-KEEP nested MQTT live-state shape plus the cross-crate test-pair contract. 31 -> 25. |
| 103 | RFCT-153 | `mosd/apid/src/auth.rs` | 49 | 24 | `docs/design/access.md` §3.3 curve, the counter-survives-expiry rule and the never-permanent cap, all §6 contract citations. 29 -> 24. |
| 104 | RFCT-153 | `mosd/apid/src/assets/serve.rs` | 1 | 23 | api.md §4.1/§4.2/§4.3 applied: the structural-precedence rule with its quoted clause, the five ordered conditions and the §4.3 header rules. 28 -> 23. |
| 105 | RFCT-153 | `mosd/hack/dbus-policy-test.sh` | 731 | 21 | The layered allow-over-deny question, the one-bus rationale and the username-substitution limit with its verifier pairing. 23 -> 21. |
| 106 | RFCT-153 | `mosd/apid/src/tests/broken_classes.rs` | 88 | 21 | MUST-KEEP `CAP_DAC_OVERRIDE` fixture quirk plus the socket-construction narrowing. 24 -> 21. |
| 107 | RFCT-153 | `test/apid-api/src/phases/07-reboot.ts` | 250 | 20 | Two exported constants, each with its measured 2026-08-24 status code (202/422) and the auth-gate 303 ambiguity. 23 -> 20. |
| 108 | RFCT-153 | `mosd/mosd/src/transient.rs` | 1 | 20 | The not-a-setting rule, the two STATE files, and the marker-vs-shadow disagreement rule that is the reason a marker exists. 26 -> 20. |
| 109 | RFCT-153 | `mosd/mosd/src/reconciler/container.rs` | 1 | 20 | Why the switch is not a service, the Quadlet generator mechanism, both switch states and the mandatory daemon-reload. 26 -> 20. |
| 110 | RFCT-153 | `mosd/mosd/src/identity.rs` | 83 | 20 | Three generated artefacts with their paths, the independent-draw rule, the not-saved rule and a `# Errors` section. 30 -> 20. |
| 111 | RFCT-153 | `mosd/mosd/src/transient.rs` | 76 | 19 | MUST-KEEP `with_file_name`-is-lexical quirk with its measured failure chain to apid's 502. 24 -> 19. |
| 112 | RFCT-153 | `mosd/mosd/src/reconciler/wifi_client.rs` | 1 | 19 | Three ordered system effects including the `wpa_supplicant@.service` filename contract. 22 -> 19. |
| 113 | RFCT-153 | `mosd/mosd/src/provisioning.rs` | 1 | 19 | The no-network invariant with its full exclusion list, and the one-`Store::save` atomicity rule. 25 -> 19. |
| 114 | RFCT-153 | `mosd/hack/dbus-policy-test.sh` | 497 | 19 | MUST-KEEP `own_prefix` measurement rationale and the separate-bus attribution rule. 22 -> 19. |
| 115 | RFCT-153 | `mosd/busname/src/lib.rs` | 1 | 19 | The two-grammar table (4 literal lines) plus the class-position rule and the bare-namespace case. 24 -> 19. |
| 116 | RFCT-153 | `mosd/mqttd/src/bridge.rs` | 1 | 18 | §10.1 alive-gate rule enumerating the five gated publications, plus the mirror/rate-limit rule. 25 -> 18. |
| 117 | RFCT-153 | `mosd/mosd/src/reconciler/systemd.rs` | 92 | 18 | MUST-KEEP `reset-failed` start-limit rule plus a `# Errors` section. 23 -> 18. |
| 118 | RFCT-153 | `mosd/mosd-settings/src/model.rs` | 76 | 18 | MQTT master-switch semantics, the deliberate non-coupling of `listen`/`auth`, and the default-false rationale. 22 -> 18. |
| 119 | RFCT-153 | `test/apid-api/src/phases/07-reboot.ts` | 1 | 17 | The console-not-status-code rule and the `-no-reboot` mechanism with the cross-process handoff. 27 -> 17. |
| 120 | RFCT-153 | `mosd/mosd-settings/src/migration.rs` | 152 | 17 | v2<->v3 up and down key lists and the three deliberate losses on rollback. 19 -> 17. |
| 121 | RFCT-153 | `mosd/apid/src/tests/broken_classes.rs` | 679 | 17 | §6.1 quoted clause plus the one case this layer cannot cover, with its cited substitute test. 19 -> 17. |
| 122 | RFCT-153 | `mosd/apid/src/routes.rs` | 674 | 17 | Session-before-bus ordering soundness argument and the two properties it buys. 20 -> 17. |
| 123 | RFCT-153 | `mosd/apid/src/routes.rs` | 121 | 17 | §6.3 unshadowable-prefix rule, the whole-subtree reservation and the two-spelling split. 19 -> 17. |
| 124 | RFCT-153 | `mosd/apid/src/auth.rs` | 324 | 17 | The 16-second seeding rationale with the whole-UNIX-second truncation measurement. 19 -> 17. |
| 125 | RFCT-153 | `test/apid-api/src/client.ts` | 283 | 16 | MUST-KEEP SNI tool quirk with the verbatim measured bun 1.4.0 TypeError. 24 -> 16. |
| 126 | RFCT-153 | `mosd/mosd/src/tree.rs` | 1 | 16 | §1.1 projection contract, the §1.2 single-writer rule and the §7 actions projection. 19 -> 16. |
| 127 | RFCT-153 | `mosd/mosd/src/reconciler/mqtt.rs` | 175 | 16 | The no-coupling rule plus the measured StartLimit numbers (60 s / burst 5 / ~25 s). 28 -> 16. |
| 128 | RFCT-153 | `mosd/hack/dbus-policy-test.sh` | 624 | 16 | The separate-bus attribution argument and the both-directions rule. 20 -> 16. |
| 129 | RFCT-153 | `test/apid-api/src/phases/07b-postreboot.ts` | 1 | 15 | Which files persist and why, keyed to the STATE bind mount, plus the regeneration finding. 32 -> 15. |
| 130 | RFCT-153 | `mosd/mosd/src/tree.rs` | 361 | 15 | The setting/action split with both §3 failure codes. 21 -> 15. |
| 131 | RFCT-153 | `mosd/mosd/src/reconciler/wifi_client.rs` | 265 | 15 | Determinism, priority ordering and the `update_config=0` rule, plus `# Errors`. 18 -> 15. |
| 132 | RFCT-153 | `mosd/mosd/src/reconciler/wifi_ap.rs` | 437 | 15 | WPA2-PSK-only and `ieee80211d=1` rules, plus `# Errors`. 17 -> 15. |
| 133 | RFCT-153 | `mosd/mosd/src/reconciler/mqtt.rs` | 1 | 15 | Two ordered system effects, the unconditional-render rule, the master-switch rule and the reversed start/stop order. 32 -> 15. |
| 134 | RFCT-153 | `mosd/mosd-settings/src/authorized_key.rs` | 53 | 15 | The no-`options`-field rule (an RCE surface) and canonical form, plus `# Errors`. 17 -> 15. |
| 135 | RFCT-153 | `mosd/apid/src/auth.rs` | 80 | 15 | Check-and-charge atomicity argument and the pessimistic-charge rule. 17 -> 15. |
| 136 | RFCT-153 | `mosd/apid/src/assets/serve.rs` | 192 | 15 | §4.2 condition 3 with its acceptance property and the stated `curl` cost. 19 -> 15. |

## Carry 1 -- the corrected threshold claim in RFCT-150

`docs/task/RFCT-150.md` claimed, in its Metric re-run section:

> Every one of the 44 now scores below the score-8 threshold; none appears in
> the metric's over-threshold list.

That is wrong, and this subtask reproduced the measurement independently at the
RFCT-150 merge commit `dcbb2bf` and its first parent `63c11cf`:

```
$ python3 m6metric.py dcbb2bf^1
rev=dcbb2bf^1 scanned=360 over_threshold=142 caps=773 banners=662 blocks15=381
$ python3 m6metric.py dcbb2bf
rev=dcbb2bf   scanned=360 over_threshold=115 caps=496 banners=421 blocks15=366
```

Restricted to the 44 files the merge changed: caps **277 -> 0** and banners
**241 -> 0**, both as claimed, but 15+-line blocks went **85 -> 70**, not to
zero. A surviving 15+-line block is worth 5, so a file keeping two of them
scores 10 with zero caps and zero banners. **17 of the 44 are still over the
threshold**, headed by `os/verify/src/checks-fixture.ts` (6 blocks, score 30);
seven more score 15 and nine score 10. Tree-wide the count moved **142 -> 115**.

The claim and its immediate sentence are corrected in place. Nothing else in
`RFCT-150.md` is touched.

**Reported, not edited:** the table immediately above that claim in
`RFCT-150.md` gives its base as 144 / 780 / 662 / 387 and its result as
117 / 503 / 421 / 372. Six of those eight numbers disagree with what the same
script reports at the same commits (142 / 773 / 662 / 381 and
115 / 496 / 421 / 366). The banner figures agree; the rest are off by 1-7. The
direction and the magnitude of the pass are unaffected. L1 scoped this subtask
to the claim sentence only, so the table is left as written.

## Carry 2 -- the shebang class, recorded in the method notes

**A comment stripper reads `#!` as a comment.** Any stripper that classifies a
line by `line.strip().startswith('#')` -- which is what the milestone's
`strip-comments-multi.py` does for shell -- removes the shebang along with the
comments. So a header rewrap that turns `#!/usr/bin/env bash` into
`# !/usr/bin/env bash` produces byte-identical stripped output, and the
comment-only proof passes without noticing that the file is no longer
executable. Demonstrated rather than asserted:

```
$ diff <(strip before.sh) <(strip after.sh) && echo IDENTICAL
IDENTICAL          # the proof sees no difference

$ python3 -c "import subprocess; subprocess.run(['./after.sh'])"
OSError: [Errno 8] Exec format error: './after.sh'
```

The failure is doubly quiet: invoked from an interactive shell, bash's own
ENOEXEC fallback re-runs the file as a shell script and it still prints the
right answer. Only a direct `execve` -- a `subprocess.run`, a systemd `ExecStart`,
a `RUN` in a Dockerfile -- surfaces it.

**Every script touched in this milestone was checked, and all read
`#!/usr/bin/env bash`.** All 16 `.sh` files in the 144-file diff conform, and a
tree-wide `grep -rln '^# !' --include='*.sh' .` returns nothing.

