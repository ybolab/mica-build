# 20260911-0110-b6-reproducibility-closure B6 reproducibility closure

- **status**: completed
- **priority**: P1
- **owner**: bkd/dmu2xs16
- **createdAt**: 2026-09-11 01:10

## Description

Audit the integrated rootfs packing path for the remaining PLAN-913 and RFCT-921
reproducibility obligations. Prove any residual deterministic-build defect with
a focused failing fixture before applying a minimal fix, or record truthful
evidence when the implementation is already sufficient. Define the minimum
independent equal-input cold-build comparison without starting expensive work.

Acceptance requires focused positive and negative aux-cache, loader-cache,
runtime-tool, initramfs, SquashFS, and file-metadata evidence; the required
bounded shell gates; an explicit separation between software evidence and the
pending cold-build or hardware proof; and a reviewed scoped commit.

## ActiveForm

Closing the remaining rootfs reproducibility evidence gap.

## Dependencies

- **blocked by**: 20260910-1013-b0-lifecycle-rootfs-audit, 20260910-2100-b4-runtime-selection, 20260910-2152-b5-scratch-provenance
- **blocks**: L2 B campaign integration and B7 milestone proof

## Notes

- The user approved this full-tier bounded proposal in the B6 dispatch on 2026-09-11.
- Expensive root, kernel, image, QEMU, and cold-build jobs remain outside this initial implementation pass.
- Startup verified the clean `bkd/dmu2xs16` worktree at
  `5d0dca577a782aa707d9530779c4b23f2a7eda31`, the exact local dependency
  `cda293970a0e012a7e1572334bbfb6258014b752` and tree
  `4c1129dbe28362345ebfab50261b3af2a188d3fe`, plus the required #313 and Git
  handoff ancestors. The authorized merge is
  `edad8251118d56f8cf44412bc4a77bdc81778c9c`, with that same tree.

## Implementation evidence

- The focused RED log `/tmp/mos-b6-red-valid.HizI3r.log` exited 1 with five
  independent failures: already-absent aux-cache, final aux-cache reinjection,
  empty main loader cache, missing runtime `ldconfig`, and the absent stages
  no-cache bridge.
- `pack-tree-surgery.sh` now makes the already-selected aux-cache omission
  idempotent. `pack-squashfs.sh` refuses a reintroduced aux-cache and refuses
  packing without nonempty `/etc/ld.so.cache` or executable
  `/usr/sbin/ldconfig`. The dynamic loader cache and its maintenance tool remain
  selected current runtime content; no historical factory-var path or build-v2
  design was restored.
- `rootfs/build.sh` validates `MOS_ROOTFS_NO_CACHE` as exactly `0` or `1`,
  defaults it off, and maps only `1` to the stages driver's existing
  `--no-cache`. The C.D2 public-metadata block and Git source-identity/Toolbox
  paths are untouched.
- `tests/rootfs-reproducibility-test.sh`, included by the existing offline
  runtime suite, covers present/already-absent aux-cache inputs, final packed
  root positive/refusal cases, malformed no-cache values, bridge removal, and
  sorted/fixed-time/reproducible initramfs controls with negative mutations.
  The runtime fixtures also prove main loader state/tool retention and detect an
  mtime mutation. The current initramfs assembly test builds twice after input
  mtime changes and requires identical cpio bytes, then requires a content
  change to alter the archive.
- Focused GREEN `/tmp/mos-b6-green-focused-final.Zx9Qpn.log`: `timeout 120 bash
  tests/rootfs-runtime-test.sh` exited 0, 80 tests, no skips, followed by
  `ROOTFS_REPRODUCIBILITY_PASS`. Initramfs fixture GREEN
  `/tmp/mos-b6-initramfs-green-final.yUuMzs.log`: both x64 and aa64 repeated
  archives and refusal cases passed in immutable fixture image
  `ai-agent/mos-boot-tools-exitrd@sha256:ccd0d6d0d246c8a689dfa3177cae29593b6e1cbbb68ffa53382f047c89616cb2`.
  This is software-fixture evidence, not a current production image or cold
  build.

## Minimum pending cold proof

Use `virt-arm64` only. Its ARM64 libc trigger matches the historical variance
class while avoiding a board write or hardware claim. The job must use the
final clean B6 commit and one already-produced, unchanged ARM64 package pool
whose `manifest.txt` stamp matches that commit; package production is not part
of this two-run comparison. Before either run, archive SHA-256 records for the
commit/tree, `build-env/images.env`, Debian source configuration, compose files,
packing scripts, the complete `_out/debs/arm64/{Packages,SHA256SUMS,manifest.txt}`
set and every selected archive. Also record resolved platform image digests,
Docker/Buildx/BuildKit identity, and the builder name.

Run these serially in the granted persistent tmux job, archiving the complete
output after each command into disjoint
`_out/repro/virt-arm64/<source>/<UTC>-run{1,2}` directories before starting the
next run:

```bash
MOS_BOARD=virt-arm64 MOS_ROOTFS_NO_CACHE=1 BUILDX_BUILDER=mos-arm64 bash rootfs/build.sh
MOS_BOARD=virt-arm64 MOS_ROOTFS_NO_CACHE=1 BUILDX_BUILDER=mos-arm64 bash rootfs/build.sh
```

For each run preserve `rootfs-verity.img`, `rootfs-verity.env`,
`rootfs-report.runtime.json`, `rootfs-report.txt`, `rootfs-packages.txt`,
`factory-root.oci`, `build-inputs/`, `pkg-logs/`, `boot/`, and `debug/`. Extract
exactly `SQUASHFS_BYTES` from the start of `rootfs-verity.img` into
`rootfs.squashfs`; record SHA-256 for that complete byte range and the complete
verity image plus `VERITY_ROOT_HASH`. Unsquash both byte ranges and verify each
tree against its own runtime report. Then require byte-identical reports,
package/build-input records, SquashFS images, verity images and root hashes.
The report/verifier comparison covers every selected path's content, type,
mode, uid/gid, normalized mtime, symlink target, xattrs/capabilities and
hardlink group with zero sanctions.

Rehash the frozen input bundle after both runs. Input or inventory differences
are upstream drift and invalidate an equal-input claim; equal inputs with any
artifact difference are a new variance and must name every differing path and
the first differing generation stage. A second run is indispensable because a
single cold build proves validity, not repeatability. The first run may be
batched with B7 only when L2 schedules it; the second remains an independent
`--no-cache` run. Estimated serial budget is 60-90 minutes per ARM64 root run,
up to 8 vCPU, 16 GiB RAM and 30 GiB free workspace including both archives. No
kernel, disk image, QEMU, cache pruning, full `_out` deletion, remote host
assumption or physical evidence is included.

## Final software verification

Implementation commit `6132f256a9958007dfcab8c07628ec0606e79baa`
(tree `2b59f8aaa4c0c72e1fd5ae7b7d1f6047cbdcc633`) was checked in persistent tmux
session `dmu2xs16-c75690`. Exact UTC command, log SHA-256 and exit-code records
are `/tmp/mos-b6-gates.9LK2mw/metadata.tsv`, SHA-256
`898824268e72bdaa35ade4218e505060b4197abcc9303c3179ee4b5f8a7fdf19`.

- `timeout 120 bash tests/rootfs-runtime-test.sh`: exit 0; 80 tests, no skips,
  and `ROOTFS_REPRODUCIBILITY_PASS`.
- `timeout 120 bash build/run.sh src/stages.test.ts`: exit 0; 104 tests and 236
  assertions.
- `timeout 120 make os-debian-test`: exit 0; 54 base checks plus minimal/additive
  selection on both architectures.
- `timeout 120 make os-host-toolchain-lint`: exit 0; 418/418 files clean.
- `timeout 120 make docs-verify`: exit 0; 195/195 index, 510/510 links,
  724/724 status, 249/249 translation coverage and 131/131 board checks.
- `timeout 30 git diff --check cda293970a0e012a7e1572334bbfb6258014b752
  HEAD`: exit 0.
- `timeout 120 make os-shell-pipefail-lint`: exit 2 only for the pre-existing,
  out-of-scope line: `FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an
  early-exiting grep on the right of a pipe, in a file that sets pipefail: the
  pipeline reports failure when the pattern IS found. Use 'grep -c ...
  >/dev/null'`. The file is byte-identical to the approved source on both sides
  (SHA-256
  `fb1f28c3b7a60d53f8d203b2203198c54617e9f34f3766b5fe096da913e5ddff`)
  and was not changed by B6.

PMA local diff review covered the complete shell/Python/test/tracking change and
its direct call chain. Verdict: PASS, zero critical/high/medium/low findings.
No Rust, verifier, Bun product, UI, C-owned, kernel, image, QEMU, hardware or
cold-build work ran. Software closure and the bounded cold-proof design are
complete; artifact equality remains pending the exact L2-scheduled heavy job
above and must not be promoted from these fixtures.

- complete: B6 software closure and cold-proof design verified; artifact comparison remains an explicitly scheduled heavy gate.
