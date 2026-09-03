# RFCT-281 Add the unexpanded BusyBox emergency binary

- **status**: done
- **priority**: P2
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-045](../plan/PLAN-045.md)

## Description

Place one emergency BusyBox binary in the base image without changing command
resolution or creating a fallback dependency for normal services.

## Acceptance

- `/usr/bin/busybox` is present on supported architectures.
- The image contains no generated BusyBox applet links and makes no PATH or
  `/build/bin` change.
- Final-image tests prove existing GNU commands resolve as before and BusyBox is
  not an initramfs/init dependency.
- Emergency docs use `busybox APPLET` or transient `/run/mos-toolbox` links.
- SBOM, license and source-offer outputs include the shipped package.

## ActiveForm

Adding the unexpanded BusyBox emergency binary.

## Dependencies

- **blocked by**: explicit approval of PLAN-045
- **blocks**: (none)

## Notes

- This is not a rescue environment or supported application command API.

## Completion (2026-09-03)

Status **implementing → done**. Every acceptance clause is met and each is
verified by something that can fail; the evidence below is what was run, not
what was intended.

### Clause by clause

1. **`/usr/bin/busybox` present on supported architectures.** `mos-busybox`
   ships it and nothing else executable. Built for both: `make os-debs` packed
   `mos-busybox_0.1.0+gitf31b79c5b7bb-1_{amd64,arm64}.deb`, and
   `tests/install-closure-gate.sh` apt-installed it into clean roots on both
   architectures. On the composed x64 image, verify reports `mode 0755,
   826128 bytes`.
2. **No generated applet links, no PATH change, no `/build/bin`.**
   `packed-busybox-unexpanded` walks the whole packed root — 9301 paths on the
   composed x64 image — for symlinks resolving to the binary and for files
   sharing its inode, since Debian's own initramfs hook expands applets as HARD
   links and a symlink-only test cannot see that.
   `packed-busybox-no-path-change` reads the PATH sources and refuses `/build`.
   **The falsification the clause asks for is `checks-busybox.test.ts`**: one
   applet symlink, a seven-link farm, a relative link, a hard link, a profile
   drop-in, a `login.defs` PATH, and `/build/bin` each drive their check red
   from a fixture asserted green first. The producer makes the stronger,
   upstream statement — its staged payload must be exactly the binary and its
   copyright, with no link of any kind — so no applet link can reach an image
   without failing the build first.
3. **GNU commands resolve as before; BusyBox is not an initramfs or init
   dependency.** `packed-gnu-commands-unshadowed` follows the PATH order and
   the symlink chain for twenty commands (`sh=/usr/bin/dash` is why it is a
   resolution test and not an existence test) and requires none to end at
   busybox. For early boot the mechanism is asserted rather than the word:
   `packed-busybox-not-early-boot` refuses an initramfs file named for busybox,
   a `BUSYBOXDIR` assignment or `BUSYBOX=y`, and any of 390 unit, generator,
   preset and `/usr/lib/mos` paths naming it — a plain content grep would be
   RED on a correct image, because `initramfs.conf` documents `BUSYBOX` and
   initramfs-tools' own klibc-utils hook reads `BUSYBOXDIR`. The shipped
   artefact is checked too: `rootfs/scripts/pack-export-boot.sh` read 1320
   entries of the exported initrd and found no busybox.
4. **Docs use `busybox APPLET` or transient `/run/mos-toolbox`.**
   `docs/user/troubleshooting.md` §4 (mirrored to `docs/zh/user/troubleshooting.md`
   in the same commit, coverage row bumped) and `docs/design/recovery.md` §6.3.
   Both label the applets diagnostic-only, both refuse a persistent link farm,
   and both state the dynamic-linkage cost rather than implying a rescue
   environment.
5. **SBOM, licence and source-offer outputs include the package.** Verified,
   not assumed: a release directory was assembled from the composed image's own
   `/usr/share/mos/manifest.tsv`, and `sbom.cdx.json` carries
   `mos-busybox 0.1.0+gitf31b79c5b7bb-1 amd64` among 185 components,
   `licenses.json` among 185 packages, under the whole-inventory source offer.
   No generator was taught the name. `packed-busybox-in-manifest` is the
   durable half of this: it fails when the binary is in the root and the row is
   not, which is what a file arriving outside the package system looks like —
   a GPL-2 binary the release's own licence inventory does not mention.

### Gates, as run

- `make os-debs` (all 13 producers, both pools) — green.
- `bash tests/deb-package-gate.sh` — `PASS (264/264)`.
- `bash tests/install-closure-gate.sh` — `PASS (99/99)`.
- x64 composed, packed and smoke-tested (`PASS 12/12`), then
  `bash verify/run.sh --verify --board x64` — `PASS (307/307, 22 skipped)`.
- `bash verify/run.sh` — 1212 tests; `(cd build && bun test)` — 869 tests;
  `make docs-verify`; `bash tests/rootfs-manifest-test.sh`;
  `bash tests/shell-pipefail-lint.sh`. All green. No Rust was touched, so
  `pkgs/mosd/hack/check.sh` was not run.

### Owed, and not claimed

- **arm64 is proven to package and to install, not to boot.** The arm64
  `mos-busybox` was built and apt-installed into a clean root under emulation,
  and the binary was executed there (271 applets). No cx3576 image was composed
  and nothing was flashed: this worktree has no BSP artefacts, and the run
  borrowed the main checkout's prebuilt ones read-only through
  `BOARD_DIR=/srv/mos/boards/cx3576/bsp` to get `make os-debs` past its
  pre-flight. A cx3576 compose and an on-board check that `busybox sh` starts
  need bench hardware.
- **The initrd assertion is exercised on x64 only.** cx3576 builds no
  initramfs — its kernel comes from the BSP — so `pack-export-boot.sh` takes
  its no-kernel branch there. That is correct and it means the assertion has
  been run on one board.
- **One out-of-scope repair, disclosed.** `tests/deb-package-gate.sh` was
  already red on main: `ea2a03ff` gave `mos-system` a sixth
  multi-user.target.wants link without moving `ENABLEMENT` past 5. Commit
  `f31b79c5` corrects the declaration and re-measures the neighbouring counts
  off the built archive. No payload changed.
