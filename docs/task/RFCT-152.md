# RFCT-152 PLAN-015 M6: form compression in os/rootfs, build-env, podman, boards, tests, update, tools

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 18:05
- **claimedAt**: 2026-08-26 18:05
- **completedAt**: 2026-08-26 20:35
- **plan**: PLAN-015 (M6)

M6's four form rules applied to 34 files across `os/rootfs/`, `os/build-env/`,
`os/podman/`, `os/boards/`, `os/tests/`, `os/update/` and `os/tools/`. Multi-word
ALL-CAPS emphasis becomes sentence case, decorative banner separators go, and
contiguous comment blocks are rewritten as compact present-tense statements.
Every constraint, measured number, path, tool quirk and contract citation
survives. No executable line, string literal or code-line whitespace changed.

## Scope

The 34 files below, and `docs/task/RFCT-152.md` (this file). Nothing else.
`docs/task/index.md` is deliberately untouched: a later subtask in this
workstream writes every claim line at once.

Counts are the M6 metric (`score = 2*caps + banners + 5*blocks15`), measured at
the merge base `b55b9df` and again at HEAD.

| file | score | caps | banners | 15+ blocks | longest run |
| --- | ---: | ---: | ---: | ---: | ---: |
| `os/podman/Dockerfile` | 92 -> 0 | 16 -> 0 | 30 -> 0 | 6 -> 0 | 62 -> 10 |
| `os/rootfs/build-v2.sh` | 79 -> 0 | 13 -> 0 | 8 -> 0 | 9 -> 0 | 35 -> 14 |
| `os/rootfs/stages/90-pack.Dockerfile` | 78 -> 0 | 14 -> 0 | 10 -> 0 | 8 -> 0 | 74 -> 14 |
| `os/build-env/build.sh` | 73 -> 0 | 13 -> 0 | 22 -> 0 | 5 -> 0 | 27 -> 12 |
| `os/build-env/images.env` | 71 -> 0 | 12 -> 0 | 12 -> 0 | 7 -> 0 | 48 -> 11 |
| `os/rootfs/stages/40-board.Dockerfile` | 56 -> 0 | 18 -> 0 | 0 -> 0 | 4 -> 0 | 41 -> 10 |
| `os/boards/x64/board.env` | 54 -> 0 | 11 -> 0 | 7 -> 0 | 5 -> 0 | 38 -> 10 |
| `os/rootfs/stages/31-feature-containers.Dockerfile` | 48 -> 0 | 12 -> 0 | 4 -> 0 | 4 -> 0 | 50 -> 11 |
| `os/rootfs/stages/10-base.Dockerfile` | 48 -> 0 | 13 -> 0 | 2 -> 0 | 4 -> 0 | 50 -> 13 |
| `os/build-env/rust/Dockerfile` | 42 -> 0 | 9 -> 0 | 4 -> 0 | 4 -> 0 | 32 -> 13 |
| `os/build-env/go/Dockerfile` | 38 -> 0 | 7 -> 0 | 4 -> 0 | 4 -> 0 | 27 -> 12 |
| `os/boards/cx3576/board.env` | 38 -> 0 | 6 -> 0 | 1 -> 0 | 5 -> 0 | 37 -> 13 |
| `os/rootfs/stages/30-feature-radios.Dockerfile` | 33 -> 0 | 3 -> 0 | 12 -> 0 | 3 -> 0 | 30 -> 14 |
| `os/rootfs/stages/34-feature-mqtt.Dockerfile` | 31 -> 0 | 8 -> 0 | 0 -> 0 | 3 -> 0 | 31 -> 8 |
| `os/build-env/from.sh` | 25 -> 0 | 7 -> 0 | 1 -> 0 | 2 -> 0 | 49 -> 13 |
| `os/tests/repart-loader-test.sh` | 24 -> 0 | 3 -> 0 | 3 -> 0 | 3 -> 0 | 33 -> 12 |
| `os/build-env/c/Dockerfile` | 22 -> 0 | 6 -> 0 | 0 -> 0 | 2 -> 0 | 34 -> 12 |
| `os/update/rauc/system.conf.in` | 18 -> 0 | 1 -> 0 | 1 -> 0 | 3 -> 0 | 26 -> 13 |
| `os/tools/qemu-run.sh` | 18 -> 0 | 4 -> 0 | 0 -> 0 | 2 -> 0 | 17 -> 14 |
| `os/rootfs/stages/33-feature-mosd.Dockerfile` | 18 -> 0 | 4 -> 0 | 0 -> 0 | 2 -> 0 | 20 -> 9 |
| `os/rootfs/stages/20-install.Dockerfile` | 18 -> 0 | 4 -> 0 | 0 -> 0 | 2 -> 0 | 17 -> 10 |
| `os/update/rauc/Dockerfile` | 16 -> 0 | 4 -> 0 | 3 -> 0 | 1 -> 0 | 17 -> 12 |
| `os/tests/handshake-test/Dockerfile` | 16 -> 0 | 3 -> 0 | 0 -> 0 | 2 -> 0 | 29 -> 10 |
| `os/build-env/base/Dockerfile` | 16 -> 0 | 3 -> 0 | 0 -> 0 | 2 -> 0 | 31 -> 14 |
| `os/tests/handshake-test/harness.sh` | 14 -> 0 | 1 -> 0 | 2 -> 0 | 2 -> 0 | 41 -> 13 |
| `os/update/rauc/versions.env` | 13 -> 0 | 4 -> 0 | 0 -> 0 | 1 -> 0 | 26 -> 12 |
| `os/rootfs/stages/32-feature-rauc.Dockerfile` | 13 -> 0 | 4 -> 0 | 0 -> 0 | 1 -> 0 | 17 -> 7 |
| `os/update/rauc/render-config.sh` | 12 -> 0 | 2 -> 0 | 3 -> 0 | 1 -> 0 | 15 -> 10 |
| `os/update/rauc/build.sh` | 11 -> 0 | 3 -> 0 | 0 -> 0 | 1 -> 0 | 22 -> 11 |
| `os/podman/versions.env` | 11 -> 0 | 3 -> 0 | 0 -> 0 | 1 -> 0 | 23 -> 8 |
| `os/podman/build.sh` | 11 -> 0 | 3 -> 0 | 0 -> 0 | 1 -> 0 | 21 -> 14 |
| `os/boards/x64/overlay/etc/systemd/system/boot.mount.in` | 11 -> 0 | 3 -> 0 | 0 -> 0 | 1 -> 0 | 22 -> 8 |
| `os/tests/quadlet-doc-test.sh` | 10 -> 0 | 1 -> 0 | 3 -> 0 | 1 -> 0 | 17 -> 7 |
| `os/tests/health-test.sh` | 8 -> 0 | 1 -> 0 | 6 -> 0 | 0 -> 0 | 12 -> 13 |
| **total (34 files)** | **1086 -> 0** | **219 -> 0** | **138 -> 0** | **102 -> 0** | 74 -> 14 |

Comment lines across the 34 files: **4282 -> 3731 (-551, 12.9%)**, counted as
`^[[:space:]]*#`.

Repository-wide, the M6 metric moves from `over threshold 144 / caps 780 /
banners 662 / blocks 387` to `over threshold 110 / caps 561 / banners 524 /
blocks 285`. All 34 in-scope files are off the over-threshold list.

## The comment-only proof

Every hunk is a comment hunk. This is proved rather than asserted: strip all
comments and all blank lines from the merge base and from the working tree, per
file, and diff. The stripper is quote-aware, so a `#` inside a string literal is
not treated as a comment and any change to one would show up.

```bash
cat > "$SCRATCH/strip-comments-multi.py" <<'PY'
#!/usr/bin/env python3
"""Strip comments and blank lines. Usage: strip-comments-multi.py <path-for-syntax-detection> < src > stripped"""
... (the harness L2 validated over all 142 in-scope files at 63c11cf, verbatim)
PY

BASE=$(git merge-base HEAD main)
while read -r f; do
  diff -u <(git show "$BASE:$f" | python3 "$SCRATCH/strip-comments-multi.py" "$f") \
          <(python3 "$SCRATCH/strip-comments-multi.py" "$f" < "$f") >/dev/null \
    || echo "DIFFERS: $f"
done < "$SCRATCH/scope-files.txt"
```

`$SCRATCH` is a private `mktemp -d /tmp/m6-cugv32th-XXXX` directory; nothing in
it is committed. Four subtasks of this workstream share `/tmp`, so the bare
paths in the dispatch prompt were not used.

### The harness, shown to be able to fail

Run at HEAD, in three passes. A deliberate whitespace change on a code line
(`set -euo pipefail` -> `set  -euo pipefail`, `os/podman/build.sh:13`) is planted
between the first and the second and reverted before the third:

```
=== A. clean tree, expect empty ===
=== (end A) ===
set  -euo pipefail
=== B. sentinel planted, expect DIFFERS ===
DIFFERS: os/podman/build.sh
=== (end B) ===
=== C. reverted, expect empty ===
=== (end C) ===
worktree clean above
```

Pass A and pass C are empty over all 34 files; pass B names the one file whose
code line moved. An empty result is therefore evidence and not a silent pass.
The same three-pass validation was run before the first edit, with the same
output.

## MUST-KEEP items reworded

Every MUST-KEEP class with an instance in these files is listed. Items marked
*byte-identical* were not touched at all.

| # | MUST-KEEP item | file | state |
| --- | --- | --- | --- |
| 1 | single-processor mksquashfs, and why no `-all-root` | `os/rootfs/stages/90-pack.Dockerfile:266-282` | reworded, quoted below |
| 2 | `FILE_MTIME`/`@epoch` and the shared `SOURCE_DATE_EPOCH` | `os/rootfs/build-v2.sh:160-167` | reworded, quoted below |
| 3 | verity UUID/salt pinning | `os/rootfs/stages/90-pack.Dockerfile:295-301` | **byte-identical** |
| 4 | sgdisk silently relocates a non-2048-aligned start | `os/boards/cx3576/board.env:68-71` | reworded, quoted below |
| 5 | mkimage falls back to the wall clock without `SOURCE_DATE_EPOCH` | `os/tests/handshake-test/harness.sh:94-100` | reworded, quoted below |
| 6 | pipefail/SIGPIPE inversion under an early-exiting `grep -q` | `os/podman/build.sh:64-70` | reworded, quoted below |
| 7 | "a hash inside a signed rootfs is a fleet-wide shared secret" | `os/rootfs/build-v2.sh:7-14` | reworded, quoted below |
| 8 | the shadow chain's two distinct failure messages | `os/rootfs/stages/90-pack.Dockerfile:227-236` | reworded, quoted below |
| 9 | `/etc/shadow` relocated onto STATE, `/etc/passwd` stays read-only | `os/rootfs/stages/90-pack.Dockerfile:201-216` | reworded (caps only) |
| 10 | `dm-mod.waitfor=` is mandatory, not an optimisation | `os/rootfs/build-v2.sh:746-750` | reworded (caps only) |
| 11 | RAUC refuses `boot-attempts` with `bootloader=grub` | `os/update/rauc/system.conf.in:37-42`, `os/boards/x64/board.env:204-208` | reworded (caps only) |
| 12 | the U-Boot radix trap (`setexpr` hex vs `test -gt` decimal) | `os/update/rauc/system.conf.in:50-60` | reworded (rewrap only) |
| 13 | systemd-repart TRIMs every unpartitioned region | `os/boards/cx3576/board.env:44-52`, `os/tests/repart-loader-test.sh:4-10` | reworded (caps only) |
| 14 | `libc::close_range` is defined for gnu and NOT for musl | `os/podman/Dockerfile:17-22`, `os/podman/versions.env:40-43` | reworded (caps only) |
| 15 | conmon's journald path is decided at compile time, silently | `os/podman/Dockerfile:169-182` | reworded (caps only) |
| 16 | broker-before-bridge: both MQTT units ship disabled | `os/rootfs/stages/33-feature-mosd.Dockerfile:34-45` | reworded (caps only) |
| 17 | sshd ships disabled on both profiles | `os/rootfs/stages/20-install.Dockerfile:31-37` | reworded (caps only) |
| 18 | PLAN-014/design-doc contract citations (`access.md` 4.1, `ro-root.md`, `uboot-ab-handshake.md` 4.1, `containers.md`) | `os/rootfs/build-v2.sh`, `os/update/rauc/system.conf.in`, `os/tests/quadlet-doc-test.sh` | **present, unchanged** |
| 19 | test-harness safety: every external command faked into `$TMPDIR` `PATH`, no host state read or written | `os/tests/health-test.sh:2-6` | **byte-identical** |
| 20 | cx3576 geometry/determinism (`ext4` knobs, `E2FSPROGS_FAKE_TIME`, `VERITY_SALT`, GUID case rule, slot-sizing modes) | `os/boards/cx3576/board.env` | **byte-identical** except the one caps run at the `pinned` row |

### 1 - single-processor mksquashfs and no `-all-root`

Before:

```
# Step 1 -- squash. Every knob that would otherwise vary between builds is
# pinned:
#   -processors 1         multi-threaded mksquashfs is NOT byte-reproducible
...
# There is deliberately NO -all-root, and no -force-uid/-force-gid either. They
# rewrite ownership but NOT mode bits, so every setgid binary whose group was
# not root would ship setgid-ROOT: ssh-agent (_ssh), chage / expiry /
# unix_chkpwd (shadow), dbus-daemon-launch-helper (messagebus).
...
# Ownership does not need forcing to be deterministic: it comes from a pinned
# base image and a pinned package set. Step 2 is what keeps it honest.
```

After (`:266-282`): the four pinned knobs are byte-identical; `NO -all-root`
becomes `no -all-root`, `setgid-ROOT` becomes `setgid-root`, and the closing
paragraph folds into the same block:

```
# There is deliberately no -all-root, and no -force-uid/-force-gid either. They
# rewrite ownership but NOT mode bits, so every setgid binary whose group was
# not root would ship setgid-root: ssh-agent (_ssh), chage / expiry /
# unix_chkpwd (shadow), dbus-daemon-launch-helper (messagebus). That widens a
# privilege boundary inside the one part of the system that is supposed to be
# the trustworthy part. It also breaks unix_chkpwd in the other direction: it
# needs egid shadow to read /etc/shadow, and egid root does not grant that, so
# non-root PAM password verification stops working. Ownership does not need
# forcing to be deterministic -- it comes from a pinned base image and a pinned
# package set, and step 2 is what keeps it honest.
```

### 2 - `FILE_MTIME`/`@epoch`, one instant and two consumers

Before:

```
# ONE INSTANT, TWO CONSUMERS. This value is also what the driver is given as
# --source-date-epoch, which buildkit stamps into the OCI export of the packed
# root. They are deliberately the same number and not two pinned constants: the
# squashfs and the OCI image are two encodings of ONE tree, and a second epoch
# would be a second answer to "when was this root made" that nothing would ever
# reconcile. The assembler already spells it this way for mkimage's
# SOURCE_DATE_EPOCH, for the same reason.
```

After (`:160-167`):

```
# One instant, two consumers: this value is also what the driver is given as
# --source-date-epoch, which buildkit stamps into the OCI export of the packed
# root. Deliberately the same number and not two pinned constants -- the
# squashfs and the OCI image are two encodings of one tree, and a second epoch
# would be a second answer to "when was this root made" that nothing would
# reconcile. The assembler spells it this way for mkimage's SOURCE_DATE_EPOCH.
```

The `FILE_MTIME is the touch(1) form (@epoch); mksquashfs wants bare seconds.`
line above it is byte-identical.

### 4 - sgdisk silent relocation

Before:

```
# START ALIGNMENT: sector 64 is not 2048-aligned, so the assemblers must pass
# `-a 1` to sgdisk. Without it sgdisk silently moves the requested start up to
# sector 2048 and the loader ends up OUTSIDE its own partition again — the exact
# failure this entry exists to prevent, reintroduced without a warning.
```

After (`:68-71`):

```
# Start alignment: sector 64 is not 2048-aligned, so the assemblers must pass
# `-a 1` to sgdisk. Without it sgdisk silently moves the requested start up to
# sector 2048 and the loader ends up outside its own partition again -- the
# exact failure this entry exists to prevent, reintroduced without a warning.
```

The back-reference further down (`# sgdisk alignment multiple the assemblers
must use. See START ALIGNMENT above.`) follows it to `See start alignment
above.`.

### 5 - mkimage's wall-clock fallback

Before:

```
# One residual, recorded rather than fixed. `makeBootScript` sets AND VALIDATES
# SOURCE_DATE_EPOCH -- mkimage silently falls back to the wall clock without it,
# so an unvalidated value is a boot script that rebuilds differently every time
# -- and this harness sets it nowhere. The two therefore produce DIFFERENT
# BYTES, and "same invocation" must not be read here as "same output". It does
# not weaken what this harness tests: the U-Boot sandbox executes the script's
# CONTENT, and the header timestamp it differs in is not part of that. Fixing it
# would mean threading the board's FILE_MTIME in, a change to what this harness
# builds rather than to a citation.
```

After (`:94-100`):

```
# One residual, recorded rather than fixed: `makeBootScript` sets and validates
# SOURCE_DATE_EPOCH -- mkimage silently falls back to the wall clock without
# it, so an unvalidated value is a boot script that rebuilds differently every
# time -- and this harness sets it nowhere. The two therefore produce different
# bytes, and "same invocation" must not be read here as "same output". It does
# not weaken what this harness tests: the U-Boot sandbox executes the script's
# content, and the header timestamp it differs in is not part of that.
```

The dropped last sentence is a counterfactual about a fix nobody is making; the
quirk, the consequence and the "not the same output" warning all survive.

### 6 - the pipefail/SIGPIPE inversion

Before:

```
# The whole output is captured BEFORE anything reads it, rather than piped into
# a grep. An early-exiting `grep -q` on the right of a pipe closes it the moment
# it matches; under `set -o pipefail` the producer then dies of SIGPIPE and the
# PIPELINE reports failure exactly when the pattern IS found -- so the refusal
# below would fire on the hosts that can build, intermittently, depending on
# whether the output fit the pipe buffer first. os/tests/shell-pipefail-lint.sh
# exists for this one mistake and caught this line.
```

After (`:64-70`): identical but for `BEFORE` -> `before` and `PIPELINE` ->
`pipeline`. `IS found` is single-word emphasis and stays, as rule 1 allows.
`os/rootfs/build-v2.sh`'s copy of the same quirk (`grep -c ... >/dev/null`, not
`grep -q`) is byte-identical.

### 7 - no `ROOT_PASSWORD`, and why

Before:

```
# There is deliberately NO ROOT_PASSWORD here. A v2 rootfs is a signed,
# byte-identical squashfs, and the pack stage FAILS any
# build whose factory shadow carries a usable hash — so a baked v2 root
# password is unbuildable by design, not merely discouraged.
```

After (`:7-14`):

```
# There is deliberately no ROOT_PASSWORD here. A v2 rootfs is a signed,
# byte-identical squashfs and the pack stage fails any build whose factory
# shadow carries a usable hash, so a baked v2 root password is unbuildable by
# design, not merely discouraged.
```

The transient-password half (`SetTransientRootPassword`, cleared on the next
boot by `mos-shadow-reconcile`, serial console locked until it is set,
`docs/design/access.md section 4.1`) is unchanged. The longer statement of the
same rule in `os/rootfs/stages/10-base.Dockerfile:239-248` was not touched.

### 8 - the shadow chain's two messages

Before:

```
# The two failure modes get two messages on purpose. They are different
# defects: an EMPTY field means the account accepts any password, while a
# USABLE HASH means a credential that every device in the fleet shares. A
# single message would let one be diagnosed as the other.
```

After (`:233-236`), folded into the end of the preceding block:

```
# instance. The two failure modes get two messages on purpose: an empty field
# means the account accepts any password, while a usable hash means a
# credential that every device in the fleet shares.
```

The "runs over every account in /etc/passwd, not just root" rule and the
`ROOT_PASSWORD build arg` sentence above it are unchanged in substance.

## Surviving 15+-line comment blocks

**None.** Across the 34 files the longest contiguous comment run is 14 lines,
and the metric reports `blocks15=0` for every file. The 14-line survivors are
reference tables rather than essays:

| file | lines | what it is |
| --- | ---: | --- |
| `os/rootfs/build-v2.sh` | 14 | the `_out/<board>/` output list (one entry per artifact) |
| `os/rootfs/stages/90-pack.Dockerfile` | 14 | the four-stages-in-one-file list |
| `os/rootfs/stages/30-feature-radios.Dockerfile` | 14 | the two non-templated connd units and what each does |
| `os/tools/qemu-run.sh` | 14 | `MOS_QEMU_APPEND` and the volatile-journal reason |
| `os/build-env/base/Dockerfile` | 14 | the floor package set and why the split is measured |
| `os/podman/build.sh` | 14 | the `default`-builder refusal |

## Banner survivors (rule 2)

Banner lines are 0 by the metric. What survives is the short labelled marker the
sibling scripts already use -- `# --- <label>` with no padding rule -- kept
because it is the section vocabulary of these harnesses, not decoration:

- `os/tests/health-test.sh`: 7 markers (`# --- health gate: no-op paths`,
  `: success`, `: systemd states`, ``: `starting`, which is the state this gate
  ALWAYS sees``, `: mosd and apid`, `: /var pressure is reported, never fatal`,
  `# --- machine id`)
- `os/tests/quadlet-doc-test.sh`: 3 (`# --- extract`,
  `# --- run the real generator`, `# --- assert`)
- `os/tests/handshake-test/harness.sh`: 3 (`# --- fixtures (synthetic)`,
  `# --- environment seeding`, `# --- process invocations`)
- `os/tests/repart-loader-test.sh`: 4 (`# --- positive: ...` /
  `# --- negative: ...`, twice each)
- `os/boards/x64/board.env`: 2 (`# --- the boot chain: ...` was replaced by a
  plain header; `# --- meta / state / ephemeral / data, ...` and
  `# --- reproducibility, shared with cx3576 ...` remain)

In every case the trailing dash padding was deleted and the label kept. The
decorative full-width rules (`# ------...`, `# ====...`, the box around
`THE SMOKE RUN`) are gone.

## Gate results

Run from the worktree root at `73df46b`, the last content commit before this
record.

| gate | command | result |
| --- | --- | --- |
| verify suite | `MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh` | `RESULT: PASS (1066/1066 tests)`, 31 files, 4836 `expect()` calls, **rc=0** |
| build suite | `MOS_BUILD_CONTAINER=1 bash os/build/run.sh` | `RESULT: PASS (689/689 tests)`, 25 files, 3892 `expect()` calls, **rc=0** |
| shell lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, **rc=0** |
| `bash -n` | each of the 11 `.sh` files touched | **rc=0 each** |
| shellcheck | container, same 11 files, HEAD vs `main` | 21 findings, **identical set**, rc=1 both sides |
| comment-only proof | 34 files vs `git merge-base HEAD main` | empty, with the sentinel shown to fire |

Both bun suites are the numbers PLAN-015 M6 expects and neither test count moved
-- which is what a comment-only pass should produce.

```
$ MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh
...
 0 fail
 4836 expect() calls
Ran 1066 tests across 31 files. [16.54s]
RESULT: PASS (1066/1066 tests)
rc=0

$ MOS_BUILD_CONTAINER=1 bash os/build/run.sh
...
 0 fail
 3892 expect() calls
Ran 689 tests across 25 files. [283.48s]
RESULT: PASS (689/689 tests)
rc=0

$ bash os/tests/shell-pipefail-lint.sh
...
RESULT: PASS (29/29 files clean, 29 scanned)
rc=0
```

### shellcheck, compared against `main`

`shellcheck` is not on this host. It was run in `koalaman/shellcheck:stable`
against a bind mount, once over this tree and once over a
`git worktree add --detach ... main` on the same filesystem, with the same file
list. Line numbers move (comment lines shifted), so the sets are compared by
file and code:

```
HEAD findings: 21  main findings: 21
identical set: True
   os/podman/build.sh SC2043 (warning)
   os/rootfs/build-v2.sh SC1091 (info)
   os/rootfs/build-v2.sh SC2018 (info)
   os/rootfs/build-v2.sh SC2018 (info)
   os/rootfs/build-v2.sh SC2019 (info)
   os/rootfs/build-v2.sh SC2019 (info)
   os/rootfs/build-v2.sh SC2097 (warning)
   os/rootfs/build-v2.sh SC2098 (warning)
   os/tests/handshake-test/harness.sh SC1091 (info)
   os/tests/handshake-test/harness.sh SC2016 (info)
   os/tests/quadlet-doc-test.sh SC2086 (info)
   os/tests/repart-loader-test.sh SC1091 (info)
   os/tests/repart-loader-test.sh SC2066 (error)
   os/tools/qemu-run.sh SC1091 (info)
   os/update/rauc/render-config.sh SC1091 (info)
   os/update/rauc/render-config.sh SC2018 (info)
   os/update/rauc/render-config.sh SC2019 (info)
   os/update/rauc/render-config.sh SC2153 (info)
   os/update/rauc/render-config.sh SC2154 (warning)
   os/update/rauc/render-config.sh SC2154 (warning)
   os/update/rauc/render-config.sh SC2154 (warning)
```

rc=1 on both sides. None introduced, none removed. The SC2066 error in
`os/tests/repart-loader-test.sh` is pre-existing and out of scope.

## Findings - reported, not edited

1. **Two provenance stamps were deleted, per PLAN-015's triage rule.**
   `os/tests/handshake-test/Dockerfile:2` opened `RFCT-087 — U-Boot sandbox
   build ...` and `:10-11` carried `RFCT-108 M2c; what stood here was the bare
   tag ubuntu:24.04`. Both are "who typed it" records, which the triage rule
   assigns to git; both sat inside blocks this pass rewrote for caps and length.
   No constraint moved with them: the source pin, the same-builder requirement
   and the no-default rule are all still stated.

2. **Comments inside `RUN` continuations are outside the proof's reach.**
   `os/tests/handshake-test/Dockerfile:84-89` are shell comments in a
   `RUN ... && \` body. The stripper drops any line whose first non-space
   character is `#`, on both sides, so an edit there is invisible to the
   comment-only diff. One such block was edited (the `ENVL_*` priority list, for
   a caps run) and was re-read line by line afterwards; the surrounding
   `sed -i`/`grep -qF` pair is untouched, and the build suite covers the file.

3. **`os/rootfs/stages/10-base.Dockerfile` carried the same comment twice**
   (`# The TRUST ANCHORS, copied in from the certs stage.` at `:142` and
   `:143`). The duplicate is gone as repetition under rule 3.

4. **`os/tests/repart-loader-test.sh:154-156` describes `run_repart`** but
   sits above the `REPART_BASE` assignment rather than above the function it is
   about. Pre-existing; left where it is, because moving a comment is not a form
   change.

5. **Heredoc bodies were not touched.** `os/update/rauc/render-config.sh` emits
   `# adaptive=block-hash-index — DEFERRED, ...` from inside a `cat <<SLOTS`
   heredoc. Those `#` lines are rendered output, not comments, and the stripper
   cannot tell the difference -- so they were left exactly as they are.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
