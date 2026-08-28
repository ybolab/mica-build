# RFCT-230 PLAN-025 M1: the QEMU boot engine ported into the harness that is its only caller

- **status**: completed
- **priority**: P1
- **owner**: bkd/pmmokq6b
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M1)
- **design**: RFCT-206 section 5 (the four defects, now fixtures); PLAN-025's engineering-debt list

The x64 boot engine was 311 lines of bash under `os/tools/`, and
`test/apid-api/run.sh` was its only caller — which called it twice and, in six
separate comments, explained that it could not be changed because it "belongs to
the image line". That was true when it was written and stopped being true when
the last other caller went away. RFCT-206 then had to fix four defects in it
anyway, and could only record them in prose: the harness's own selftest could
not reach a shell file.

This milestone moves it: `test/apid-api/src/qemu.ts` is the port,
`test/apid-api/run.sh` drives it at both call sites, the shell file is deleted,
and RFCT-206 section 5's four defects are negative fixtures in
`test/apid-api/src/selftest.ts` — each measured red against the pre-fix
behaviour and green against the port, in section 4 below.

## Scope

| file | change |
| --- | --- |
| `test/apid-api/src/qemu.ts` | new — the port; three pure exports the selftest drives, one `main()` that runs |
| `test/apid-api/src/selftest.ts` | the four defects as fixtures, with positive controls; 37 → 47 checks |
| `test/apid-api/run.sh` | the `qemu_port` seam, the socket precondition, both call sites, and every mention of the deleted file |
| `test/apid-api/HARNESS.md` | the ownership sentence it opens with, and a new *Where the boot engine runs* |
| `os/tools/qemu-run.sh` | **deleted** |
| `os/tools/qemu-seed-state.sh` | comments and one refusal message: it keeps working, it just cannot name a file that is gone |
| `test/apid-api/src/phases/07-reboot.ts`, `Makefile`, `os/rootfs/stages/40-board.Dockerfile` | prose citations of the deleted file |
| `docs/task/RFCT-105.md`, `docs/task/RFCT-172.md`, `docs/task/RFCT-206.md` | three live citations re-anchored; section 6 says why these three and nothing else |

## 1. Where the port runs, and what was measured to decide it

The port drives `docker run` — the disk copy is grown on the host side, but
mtools, QEMU and OVMF all come out of containers — and it is TypeScript, so it
needs **bun and a docker client in one place**. The bun pinned as `IMAGE_BUN_1`
carries no client. That is the exact gap `os/verify/Dockerfile` exists for, and
it is followed rather than restated: two digest `FROM`s, one
`COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker`
(`os/verify/Dockerfile:42`), and a build-time
`RUN docker --version && bun --version` (`os/verify/Dockerfile:49`). `run.sh`
builds *that* Dockerfile rather than adding a second one; the tag carries both
input digests, so under the default pins it is byte for byte the image
`os/verify` builds and whichever of the two runs first pays for it.

Measured here, 2026-08-28, on this host:

| measurement | command | result |
| --- | --- | --- |
| the image builds | `docker build --build-arg MOS_BUN_IMAGE=... --build-arg MOS_DOCKER_CLI_IMAGE=... -f os/verify/Dockerfile os/verify` | `localhost/mos-verify-bun:7227e13aa0199cdd`, 14.9s cold |
| bun runs inside it | `docker run ... bun -e '...'` | ran |
| the docker client inside it reaches the host daemon and a sibling container sees the host's paths | a `docker run -v <repo>:/w debian:trixie-slim head -1 /w/test/apid-api/run.sh` issued **from inside** the image | `rc 0`, `#!/usr/bin/env bash` |
| the whole prepare path | `bun run src/qemu.ts --prepare-only` inside it, against a synthetic 66 MiB image carrying only an ESP at 1 MiB | copied, grew to 128 MiB, read `::/EFI/mos/grub.cfg` out at offset 1048576, rewrote it, wrote it back — section 4 |

**A correction to the premise this task was given.** The task stated that a
host-bun route is unavailable here because this host's bun cannot parse the
committed lockfile. That is not what this host does today: `bun --version`
reports **1.4.0**, `bun install --frozen-lockfile --dry-run` in
`test/apid-api/` resolves all five packages in 169ms, and
`bun run src/selftest.ts` runs green directly on the host. So a host route was
*possible*. It was not taken, and the reason is not the lockfile: `run.sh` has
no host-bun route for any of its other bun invocations — the suite and the
`/healthz` probe both run in the pinned image — so adding one only for the boot
engine would be a second route for one of three callers, and configurability
nobody asked for. One route, the pinned one.

### What the runner container may not mount

`RUN_DIR`. The competing-run guard and `find_guest` both identify the QEMU
container by a bind whose source *resolves* to `${RUN_DIR_REAL}`, and the port's
own container is up for the whole of a boot. It is given `${REPO_ROOT}` and
`${OUT_REAL}`, each at its own path, and neither resolves to the run directory,
so it can never be mistaken for the container running QEMU. The repository is
mounted at its own path and not at `/w` for the reason `os/verify/run.sh`
records for the same arrangement: every `docker run` the port makes hands the
daemon a path, that daemon is the host's, and its containers are siblings rather
than children — so a path has to mean the same thing on both sides, and mounted
at its own path there is no prefix to rewrite.

## 2. What the port preserves

Behaviour, not a redesign. The board layout read, the disk copy under
`_out/x64/.qemu`, the growth guard (`MOS_QEMU_DISK_MIB` must exceed the image or
`systemd-repart` has nothing to extend into), the ESP `grub.cfg` rewrite, the
graceful ACPI power-button shutdown with its 90s backstop, `-no-reboot`
(`test/apid-api/src/qemu.ts:251`), and the two-doors `hostfwd`+publish rule with
`MOS_QEMU_NETWORK` as the third door. Every environment knob keeps its name and
its default: `MOS_QEMU_IMAGE`, `MOS_QEMU_TIMEOUT`, `MOS_QEMU_MEM`,
`MOS_QEMU_REUSE_DISK`, `MOS_QEMU_DISK_MIB`, `MOS_QEMU_APPEND`,
`MOS_QEMU_RUN_SECONDS`, `MOS_QEMU_FORWARD`, `MOS_QEMU_HTTPS_PORT`,
`MOS_QEMU_HTTP_PORT`, `MOS_QEMU_SSH_PORT`, `MOS_QEMU_NETWORK`. Every load-bearing
comment came across, because each states a measurement or a decision that is not
recoverable from the code.

Four differences, each deliberate:

1. **No attached-console mode.** The shell tool booted with the console attached
   when given no argument. Nothing called it that way, and a console attached to
   a process that is itself inside a container is not a capability to keep on the
   strength of a usage line. Both modes the harness uses are ports.
2. **Two mtools container starts on the prepare, one on a reuse boot.** The shell
   did the extract, the `grep`/`sed` and the write-back inside one container. The
   rewrite is TypeScript now — which is what makes it testable at all — so mcopy
   reads the file out, the rewrite happens in-process, and mcopy writes it back.
   A boot that reuses a disk the prepare already appended to pays the first start
   only, because the second is skipped when there is nothing to write.
3. **`/dev/kvm` is passed through.** The shell tested `/dev/kvm` in its own
   filesystem namespace; the port would otherwise test the runner image's. So
   `run.sh` passes `--device /dev/kvm` when it can see one, and the port's test
   answers what this shell would have answered.
4. **A stale comment was not carried.** The shell said the image was bound
   read-only and that QEMU got "a copy-on-write overlay instead"; the code made a
   full copy and bound *that*. The decision behind it is real and is carried —
   the artefact under test is never mutated and every run starts from the same
   state — but the mechanism is stated as what it is.

## 3. `run.sh` drives it

One seam, `qemu_port`, and both call sites go through it, so the mounts, the
socket and the environment cannot differ between the prepare —
*"qemu_port --prepare-only"* (`test/apid-api/run.sh:526`) — and the boots —
*"qemu_port --reuse --capture"* (`test/apid-api/run.sh:639`). That is the one
way a disk gets prepared with one set of kernel arguments and booted with
another. Two preconditions were added beside the existing ones, and
`--dry-run` exercises both: the daemon socket has to be a unix socket, because
it is *mounted*, and `IMAGE_DOCKER_CLI_28` has to resolve. The engine image is
resolved in the preconditions and built at first use, so `--dry-run` stays what
the Makefile promises — preconditions and discovery, in seconds.

## 4. The four defects, as fixtures

RFCT-206 section 5 found four defects in the `MOS_QEMU_APPEND` block and could
only write them down. They are assertions now, in `selftest-qemu`, and they need
no docker, no QEMU and no image — the offset is arithmetic over a board layout
and the rewrite is text, which is why both are factored out of the run path.

Each was measured **red against the pre-fix behaviour**: the port was mutated
back to what the shell did, one defect at a time, in a copy of `src/` outside the
repository, and the selftest re-run. Nothing below is a prediction.

| RFCT-206 | the pre-fix behaviour, restored | what the selftest said |
| --- | --- | --- |
| 5.2 the wrong partition | `espOffsetBytes` reads `BOOT_A_START_MIB` | `RESULT: FAIL (44/47 checks)`, 3 named FAIL lines |
| 5.3 the indentation | the linux pattern as `/^ {4}linux .*$/gm` | `RESULT: FAIL (42/47 checks)`, 5 named FAIL lines |
| 5.4 the unreachable guard | zero matches returns quietly instead of refusing | `RESULT: FAIL (46/47 checks)` |
| 5.5 the append applied twice | the already-there test removed | `RESULT: FAIL (46/47 checks)` |
| 5.5 …compared as a pattern | `new RegExp(append).test(text)` for the already-there test | `RESULT: FAIL (45/47 checks)`, both literal cases red |

The board layout the offset fixture asserts against is the real one's shape:
`ESP_START_MIB=1` (`os/boards/x64/board.env:63`) and `BOOT_A_START_MIB=65`
(`os/boards/x64/board.env:81`) are different partitions, and only the first
holds a `grub.cfg`. The indentation fixture asserts that eight spaces are
matched — the template's own, *"        linux (${slot_a_root})/vmlinuz"*
(`os/boards/x64/grub.cfg:98`) and its B slot
*"        linux (${slot_b_root})/vmlinuz"* (`os/boards/x64/grub.cfg:116`) — and
that a four-space pattern matches nothing in that same text, which is the whole
of 5.3 in one line. 5.4's is the semantic and not the mechanism: the shell's
`set -e` + `grep -c` trap does not exist in TypeScript, so what is asserted is
that zero matches yields a refusal naming `::/EFI/mos/grub.cfg` and saying the
append would have added nothing. Every negative has a positive control beside
it, and the phase's own header says so.

### One measurement of the prepare, end to end

No x64 image exists on this host, so no boot was made — the acceptance run is
the merge's, not this task's. The *prepare* is provable without one, and was
proved: a synthetic 66 MiB image carrying nothing but a FAT32 ESP at 1 MiB with
`EFI/mos/grub.cfg` in it (the real `os/boards/x64/grub.cfg`), then

    bun run src/qemu.ts --prepare-only    (in the runner image, MOS_QEMU_APPEND set)

which reported `note: virtual disk is 128 MiB for a 66 MiB image`, then
`note: appended to the disk copy's kernel command line, on 2 linux line(s)`.
Reading `::/EFI/mos/grub.cfg` back out of the prepared disk with `mtype` shows
the append on **both** linux lines, at lines 98 and 116 — the two RFCT-206
section 5.3 names — exactly once each. Running the same command again with
`MOS_QEMU_REUSE_DISK=1` reported
`note: the append is already on the linux line; not adding it a second time`
and the file was unchanged: 5.5's last bullet, measured on a disk rather than on
a string.

## 5. `os/tools/qemu-seed-state.sh` keeps working

It writes into `_out/x64/.qemu/disk.img` — the same fixed path, made by the same
prepare step — and nothing about it changed except that it can no longer name a
file that does not exist. Its header now spells the order with the port's
command, and its "run the prepare first" refusal names `run.sh` and the port.
The run directory is still guarded rather than moved, precisely because this
script names it too.

## 6. Three citations re-anchored, and the rule that decided it

`docs/verify-citations.sh` treats a record as dated — and exempts its citations
— only when the record carries the `<!-- dated-record: ... -->` marker. Three
live citations named the deleted file or a line this task moved:

| document | was | now | why it is live |
| --- | --- | --- | --- |
| RFCT-105, line 355 | the deleted file, line 217 | the port's line 251 | `-no-reboot` is still passed; the file moved |
| RFCT-172, line 91 | that same row's *now* column | the port's line 251 | the column is headed *now*, and RFCT-172 set it the last time this file moved |
| RFCT-206, line 286 | HARNESS.md line 59 | HARNESS.md line 83 | same quote, same file, moved down by this task's edits |

Each is a line number and nothing else: no claim, no quote and no conclusion was
touched, and each still resolves to the same sentence it always did. The
alternative was two resolution failures and one content failure in
`docs/verify-citations.sh`, measured before the repair as
`2 FAILED (2 resolution, 0 content, 0 census, 0 ratchet), 1377 citations passed`.
This is the repair RFCT-172 made for the same file the last time it moved, and
its row records it the same way. **No dated record was edited**: every document
carrying the marker was left alone, and `docs/plan/` was not touched.

## 7. Verification

| gate | result |
| --- | --- |
| `bun run src/selftest.ts` in `IMAGE_BUN_1` | `RESULT: PASS (47/47 checks)` — 37 before this task |
| `bash test/apid-api/run.sh --dry-run` | `RESULT: PASS (6/6 checks)`, exit 0 |
| `make os-shell-pipefail-lint` | `RESULT: PASS (30/30 files clean, 30 scanned)` — 31 before, one file fewer |
| `bash docs/verify-citations.sh` | `1388/1388 PASS` — `1379/1379` before this record was added, and 0 unquoted citations in it |
| `bash docs/verify-index.sh` | `752/752 PASS` — `748/748` before |
| `make os-apid-api-test` | **not run here** — no x64 image exists on this host, and the acceptance boot is the merge's. The prepare half is measured in section 4 |

`--dry-run` needs an `_out/x64/<image>` to get past its first precondition, and
this checkout has none, so the run above was taken with an empty placeholder file
at that path — `--dry-run` boots nothing and never reads the image's contents.
Without the placeholder it exits 1 on the missing-image refusal, which is what it
does at `a86ab46` too and is the harness working as documented.

## 8. Out of scope, and untouched

`os/pkgs/`, `os/build-env/build.sh` and `docs/design/` were not touched. The
harness-facts page is PLAN-025 M4 and is not written here. No `.zh.md` file was
touched — those are parked. No plan file was edited. The two-boot acceptance run
belongs to the merge that takes this branch.
