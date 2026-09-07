# PLAN-087 Make the CX3576 BSP reproducible, and move its build logic into files

- **status**: completed
- **createdAt**: 2026-09-07 15:02
- **approvedAt**: (pending)
- **relatedTask**: RFCT-343, RFCT-345

## Context

This plan is the reconciliation of a draft another session wrote at 14:00 on
2026-09-07 (`cx3576-reproducible-bsp-20260907T1400Z.md`, issue `69d0bv7y`,
left untracked in the main checkout with no branch) with the measurements
RFCT-343 then made. The draft's structure is adopted; where a measurement
contradicts it, the measurement is recorded as the ruling and the draft's
reasoning is kept beside it, because a prediction that turned out wrong is worth
more on the page than deleted.

The draft is credited with the two things it got right before anyone had run the
experiment: it identified `tar -cf` as retaining build-time metadata and
filesystem enumeration order, and it named vendor-driver wall-clock timestamps
as a risk the dual-build check would have to discover. Both were causes.

### What was measured, 2026-09-07

Two `docker buildx build --no-cache` builds of the cx3576 kernel target, same
tree, back to back.

| Artifact | Result | Detail |
|---|---|---|
| `Image` | DIFFERS | 44,493,312 B both; **24 bytes** differ |
| `modules.tar` | DIFFERS | 5,529,600 B both; every member byte-identical, member order identical, every tar header carrying the build's mtime |
| `rk3576-src.dtb` | IDENTICAL | 290,023 B |

Every one of the 24 bytes is accounted for:

| Bytes | Cause |
|---:|---|
| 5 | `__DATE__` / `__TIME__` in the vendor Mali driver — `drivers/gpu/arm/mali400/mali/linux/mali_kernel_linux.c:404` and `:410-411` print `"Compiled: %s, time: %s"`. Two `__TIME__` sites; the two builds read `14:11:33` and `14:21:43`. |
| 19 | The GNU build-id ELF note (`namesz=4 descsz=20 type=3`, i.e. `NT_GNU_BUILD_ID`), a SHA1 **of** the linked image. 19 of its 20 bytes differ; it moved only because the five above did. |

`rk3576-src.dtb` came out byte-identical from the same toolchain in the same
containers, which is what places the variance inside the kernel build rather
than in the compiler or the image.

### Where the measurement rules against the draft

- **`CONFIG_DEBUG_INFO` is not a variance source here.** The draft treats debug
  information as a reason fixed internal build paths "remain necessary", and
  RFCT-343's own brief named it the biggest config-level suspect. The differing
  bytes are two date strings and a hash of them; nothing else in a 44 MB image
  moved. The symbol may still be worth removing for size, which is a different
  argument with a different measurement.
- **`-j"$(nproc)"` is not a variance source.** Also named as a suspect, on the
  ground that `nproc` reads the cgroup quota. Kernel builds are order-independent
  under `-j`, and no differing byte is attributable to parallelism.
- **The vendor timestamp needed no patch.** The draft proposed fixing a
  discovered wall-clock source "with a narrowly scoped patch rather than
  modifying the generated binary". None is needed: gcc honours
  `SOURCE_DATE_EPOCH` for `__DATE__` and `__TIME__`, so exporting it — which the
  draft also proposes — is the whole fix, and it leaves the vendor tree
  unpatched.
- **APT and toolchain drift were not causes.** The draft's first section freezes
  Ubuntu package sources to a snapshot. That is a real property and a different
  one: the back-to-back experiment holds the digest-pinned base image fixed, so
  it measures reproducibility at a point in time. Freezing the snapshot buys
  reproducibility ACROSS time. Both are worth having; only the first is
  established by any measurement taken so far.
- **`KBUILD_BUILD_VERSION=1`** is proposed so "invocation history cannot change
  the kernel build counter". Each `--no-cache` build starts from a fresh tree,
  so `.version` was 1 in both and the counter did not differ. Cheap insurance,
  no measured need.

## Proposal

### 1. Pin what was measured to vary — LANDED under RFCT-343

- `SOURCE_DATE_EPOCH=1577836800` in the kernel builder's environment, beside the
  three `KBUILD_BUILD_*` values RFCT-320 added. Kbuild reads none of it; its
  whole effect is on `__DATE__`/`__TIME__` in vendor drivers, which is the
  surface that was measured.
- `tar --sort=name --mtime=@1577836800 --owner=0 --group=0 --numeric-owner` for
  `modules.tar`. The line was character-for-character identical in
  `boards/x64/bsp/kernel/Dockerfile` and
  `boards/virt-arm64/bsp/kernel/Dockerfile`, so this is a shared defect and is
  pinned on all three boards rather than on the board that happened to be
  measured.

### 2. Ship the resolved kernel config where the contract reads it — LANDED under RFCT-343

Separate finding, same Dockerfile. cx3576 exported `Image modules.tar
rk3576-src.dtb` and no config, so `boards/common/mos-required.fragment`'s floor
was enforced there only by the post-`olddefconfig` grep loops — which run when
the KERNEL is built, and `bsp/out/kernel/` is an input to image assembly rather
than something assembling one rebuilds. Measured: that board's `Image` sat at its
2026-08-31 build until 2026-09-07 while the fragment gained dm-crypt, the
eBPF/firewall/bridge floor and `NF_CONNTRACK_MARK`/`NF_NAT_MASQUERADE`, and the
packed root of the 418/418 image verified that day carries an **entirely empty
`/boot`**.

### 3. Move the BSP outputs under `_out/` — user request, 2026-09-07

`boards/<board>/bsp/out/` becomes `_out/boards/<board>/`. `_out/` is already the
one place every other artefact lives and the one place a clean clears, and a BSP
output hiding outside it is how the stale kernel above went unnoticed for a week.
All three boards, because two conventions in one tree is worse than either.

### 4. Extract the inline scripts, configuration and patches into files -- LANDED under RFCT-345

The draft's file list is adopted for the kernel and U-Boot components: each
component gets its own `build.sh`, the shared dependency-install / source-fetch /
patch-apply steps are shared, and the two source edits performed by shell
redirection inside the Dockerfiles become ordinary patches under an explicit
`patches/series`.

Verification is byte identity against the pre-extraction artefacts, not merely a
green build: an extraction that changes what is compiled is not an extraction.

Landed as `bsp/scripts/{apt-install,fetch-source,apply-patches}.sh`,
`bsp/kernel/{configure,build}.sh`, `bsp/uboot/{build,build-mos}.sh` and a
`series` in each patch directory; the U-Boot `printf >>` device-tree append is
`uboot/patches/0007`. The Dockerfiles went from 253 and 255 lines to 127 and 97.
All eleven artefacts came back byte-identical under `--no-cache`. Two parts of
the draft's file list were NOT adopted and RFCT-345 says why: the `scripts/config`
runs did not become kconfig fragments, because that changes the route by which
the resolved `.config` -- itself one of the eleven controlled artefacts -- is
produced, and the two patch appliers were not unified, because `patch`'s default
fuzz and `git apply`'s strictness are not the same tool.

### 5. Deferred, with reasons

- **Ubuntu snapshot sources and pinned package inventories** (the draft's
  section 1). Real, unmeasured here, and a large change with its own failure
  mode: an APT that cannot fall back is a build that stops working when a
  snapshot moves. Wants its own task and its own across-time experiment.
- **Restructuring the U-Boot stages** so the debug and MOS variants are siblings
  off one fetched/patched source stage. Correct, and independent of everything
  measured.
- **`KBUILD_BUILD_VERSION`, `TZ`, `LC_ALL`, umask.** No measured need; would be
  adopted with the snapshot work.

## Risks

- An extraction that moves a `sed` or a `printf >>` into a patch can silently
  change what is compiled. Byte comparison against the pre-extraction artefacts
  is the control, and it is not optional.
- Moving `bsp/out` is read by three boards' producers, two build-script paths,
  two test files and six documents. A reader left spelling the old path fails
  late; the producers refuse a missing kernel BY NAME today and that property has
  to survive the move.
- Identical hashes establish reproducible builds, not board-boot acceptance. No
  device flashing is part of this work.

## Scope

The three boards' BSP kernel Dockerfiles, the cx3576 U-Boot Dockerfile, their
Makefiles and producer paths, the resolved-config export chain through
`render.sh` and `boards/cx3576/deb/board-cx3576/Dockerfile`,
`verify/src/checks-kernel.ts` and its fixture and tests,
`tests/netavark-kernel-config-test.sh`'s header, and the documents that state
the old paths or the old reproducibility status.

Out: the Alpine demo Dockerfiles, image partitioning, boot policy, runtime
package composition, and source-version upgrades.

## Alternatives

- **Pin only `SOURCE_DATE_EPOCH` and stop.** Sufficient for the `Image`, and it
  leaves `modules.tar` varying — they are two defects with two causes.
- **Patch the Mali driver to drop `__DATE__`/`__TIME__`.** Works, and carries a
  vendor-tree patch forever for something an environment variable already fixes.
- **Leave `bsp/out` where it is and add a staleness stamp.** Addresses the same
  hole from the other side. Considered under RFCT-343 and scoped out: a stamp
  over the build's inputs refuses on changes with no effect on the output, and
  the shipped-config assertion catches the consequence that matters.

## References

- [Linux reproducible-build requirements](https://docs.kernel.org/kbuild/reproducible-builds.html)
- [gcc: `SOURCE_DATE_EPOCH` and `__DATE__`/`__TIME__`](https://gcc.gnu.org/onlinedocs/cpp/Environment-Variables.html)
- [U-Boot SOURCE_DATE_EPOCH behavior](https://docs.u-boot.org/en/latest/build/reproducible.html)
- [Ubuntu Snapshot Service configuration and retention](https://snapshot.ubuntu.com/)

## Annotations

- User: backward compatibility is not required during development unless
  explicitly requested.
- User: the kernel and U-Boot need fixed, reproducible builds, and the inline
  scripts and patches must move into files with no file editing in Dockerfiles.
- User: `boards/cx3576/bsp` build output should go to `_out/boards/cx3576` so
  artefacts are managed in one place.
- Sections 1, 2 and 3 landed under RFCT-343; section 4 under RFCT-345. Section 5
  is not approved and not started, and stays that way: this plan is complete for
  the scope that was approved, and section 5's three deferrals keep their reasons
  in this record's history.
