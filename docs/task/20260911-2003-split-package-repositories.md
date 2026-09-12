# 20260911-2003-split-package-repositories Split the tree into an assembly repository and independently released package repositories

- **status**: in_progress
- **priority**: P1
- **owner**: worker/split-20260912-2100
- **createdAt**: 2026-09-11 20:03

## Description

Move the software packages (mosd, mos-deploy, podman) out of this tree into
repositories of their own, keep the system assembly (boards, rootfs, build,
verify, tests, docs) here, and make the assembly import the packages as
published, already-gated Debian archives pinned by a lock file. A package is
compiled and verified once, in its own repository; the assembly fetches bytes
it can check and never rebuilds them.

No compatibility path is required: the tree is in its development phase and
the user waived migration and old-layout support on 2026-09-11.

Acceptance:

- An x64 image composes from a pool whose mosd, mos-deploy and podman archives
  were fetched from the package registry and verified against the lock, with
  no cargo or Go build running in this repository.
- The composer refuses an archive the lock does not name, an archive whose
  digest differs from the lock, and a pool index that has come apart from the
  archives; each refusal names the package.
- Every mos archive records its source repository and commit in its control
  file, and the composition record reads those fields out of the archive.
- The shared build substrate is one submodule, not a copy per repository.
- Each extracted repository carries its history, its own gates and a PMA
  injection, and publishes to the registry from its own CI.

## ActiveForm

Implementing Phase 1 (the mechanism inside this tree); approved 2026-09-12.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier: the change crosses every top-level directory, CI, the packaging
  driver, the composer and the documentation catalog.
- The proposal is staged so that each phase ends with a green x64 image; the
  mechanism (provenance fields, lock, fetch, composer rule, retirement of the
  fixed producer join) lands and is proven inside this tree before the first
  repository is split out.
- Decided 2026-09-12: one repository per package, named for Mica OS
  (`mica-build`, `mica-build-env`, `micad`, `mica-deploy`, `mica-podman`);
  Debian archives kept as the package format. In-tree package and binary
  names stay `mos*`. Approved 2026-09-12 21:00.
- Phase 0 closed 2026-09-12: registry round trip done, no Actions runner is
  registered anywhere (publishing is from the developer machine for now),
  decisions 3 and 4 recorded in the plan.
- Phase 1 (2026-09-12 evening): provenance fields in every archive, `VERSION`
  + `version.sh`, `registry.env`, `fetch.sh`/`lock.sh`/`publish.sh`/`source.sh`,
  `rootfs/packages/lock.tsv`, the composer's two-class rule in
  `source-lineage.py` with `MOS_POOL_UNLOCKED`, the fixed producer join
  retired from the lineage script and the release gate, the package gate
  lock-aware, `os-pool` / `os-lock-bump`, `mosd-build.txt` from the archive's
  field. The x64 proof (publish `mos-podman`, lock it, compose from the
  fetched copy) is the remaining Phase 1 step.

## Findings

- [Proposal](../plan/20260911-2006-split-package-repositories.md) records the six
  bindings, the coupling inventory, the probed forge facts, the repository
  set, the lock and join retirement, the gate relocation table and the phase
  order.

## Verification

- Planning: file reads, git history counts, a grep of every reference
  between `pkgs/` and the rest of the tree, and read-only Gitea API probes.
- Phase 0: throwaway archive uploaded, downloaded byte-identical, listed with
  its `Mos-Source-*` fields in the component index, deleted (201/200/204).
- Phase 1, offline: `tests/rootfs-runtime/source_lineage_test.py` (13, the
  two-class negatives by name), `tests/rootfs-runtime-test.sh` (139 +
  reproducibility), `build/src/release-manifest.test.ts` (71, lock and
  unlocked-channel cases), `bun run typecheck` in `build/` and `verify/`,
  `tests/deb-preflight-test.sh` (19), `tests/pool-lock-test.sh` (16, the
  fetch and bump negatives against a stub registry), `make os-host-toolchain-lint`,
  `make docs-verify`. `tests/shell-pipefail-lint.sh` reports two
  pre-existing findings outside this change (`pkgs/mos-boot/init-keys.sh`,
  `pkgs/mosd/apid/ui/verify-ui-policy.sh`).
