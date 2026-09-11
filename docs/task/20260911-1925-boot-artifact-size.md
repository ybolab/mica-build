# 20260911-1925-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-09-11 19:25

## Description

Reduce the size of the signed kernel component. The uncompressed initramfs is
50.3% of the s905x5m FIT and 42.7% of the cx3576 FIT, and 86% of its startup
half is shared libraries rather than programs. Two independent levers apply:
compressing the FIT payloads, and collapsing the early-userspace ELF closure.

This is flash per deployment, bytes per update download, and bytes hashed at
boot — not boot-peak RAM. The startup half is released at `switch_root`, so RAM
is not the goal here; that is the separate exitrd record.

No compatibility or migration paths are required.

## ActiveForm

Awaiting approval of the staged proposal.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier proposal: it crosses FIT/UKI packaging, the authenticated init, the
  Rust dependency licence policy, and boot/shutdown acceptance.
- Distinct from [20260910-0338-minimal-boot-shutdown](20260910-0338-minimal-boot-shutdown.md),
  which owns the **resident** exitrd. That record's scope excludes the startup
  half on the ground that it is not resident; this record takes the startup half
  on the different ground that it is permanent artifact cost. The two do not
  overlap and can proceed independently.
- Route settled 2026-09-11: replace `veritysetup`/`dmsetup` with Rust directly,
  remove cryptsetup from the early userspace, and add `CONFIG_ZSTD` to cx3576's
  U-Boot so the kernel node compresses too. The declined cryptsetup-backend
  option stays recorded under the plan's *Alternatives*.
- The plan's Phase 2 moves a signature-enforcement boundary into this
  repository. Its acceptance is differential against the tool it replaces, plus
  negative and mutation cases; see the plan's *Verification*.
- Keep the concurrent CX3576 board and console repairs unchanged.

## Findings

- [Proposal](../plan/20260911-1927-boot-artifact-size.md) records the measured
  closures, compression ratios, decompressor support per board and the licence
  decision the device-mapper crate requires.

## Verification

- Measurements were read off already-built artifacts under `_out/`; no build was
  run and no source was changed as part of this assessment.
