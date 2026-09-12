# 20260911-2003-split-package-repositories Split the tree into an assembly repository and independently released package repositories

- **status**: in_progress
- **priority**: P1
- **owner**: claude/session-9a5be4df
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

Awaiting approval of the staged proposal.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier: the change crosses every top-level directory, CI, the packaging
  driver, the composer and the documentation catalog.
- The proposal is staged so that each phase ends with a green x64 image; the
  mechanism (provenance fields, lock, fetch, composer rule) lands and is proven
  inside this tree before the first repository is split out.
- Open decisions the plan puts to the user are listed under its *Annotations*.

## Findings

- [Proposal](../plan/20260911-2006-split-package-repositories.md) records the coupling
  inventory, the target repository set, the lock and fetch mechanism, the gate
  relocation table and the phase order.

## Verification

- Investigation only: file reads, git history counts and a grep of every
  reference between `pkgs/` and the rest of the tree. No build was run and no
  source was changed.
