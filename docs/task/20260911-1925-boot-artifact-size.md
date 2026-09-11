# 20260911-1925-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure

- **status**: in_progress
- **priority**: P1
- **owner**: boot-size/vhqwow6o
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

Implementing the explicitly approved five-phase plan on bkd/vhqwow6o.

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

## Implementation evidence

- Dispatch hashes matched: plan 8b72a5f8e740b1125199c3c0bda1470dfacfe3cedacaeebb9c795548d2cfc393;
  task 64db4e752f1986599b5a659858046ad13fa6f8ca3b77b12a48bd7f9b31472c3d.
- Initial a3595587194a17c290272975e5a2e40be6ea15c2 worktree was clean.
  Merged exact reviewed fb6c4597 as ef5e27c7; both fb6c4597 and 36866b47 are
  ancestors. Only tracking/design conflicts needed resolution; both indexes
  and the startup plan remain. No uncommitted main state was read or copied.
- Current startup helper set is B2 BusyBox + blkid + veritysetup + dmsetup.
  Retained exitrd is B3 static mos-shutdown; historical closure numbers above
  require replacement with newly measured artifacts, kept separate by purpose.

- Phase 1 implementation bounds both expanded cpio and compressed bytes at
  67108864; FIT component/kernel limits remain 134217728 and FDT stays raw.
  FIT/UKI use the compressed ramdisk and compare the extracted signed bytes.
- Compression RED: missing compression.sh; subsequent negative test exposed
  `unexpected compression acceptance: validate_payload .../truncated.zst ...`.
  Bash conditional calls suppress errexit; explicit failure returns fixed it.
  GREEN includes deterministic output, malformed/truncated frame, changed
  source, oversized input/output and compressed expanded-limit refusal.
- Private source evidence: `_out/boot-size/logs/source-{first,second,third,fourth,fifth}.log`.
  Original compilation failure: `error[E0502]: cannot borrow *b as immutable
  because it is also borrowed as mutable` in the GPT test checksum writer.
  Fixed the temporary checksum borrow. Clippy then caught
  `chunks_exact_to_as_chunks` and `cloned_ref_to_slice_refs`; both corrected.
  Workspace tests, added native tests, final clippy and cargo-deny pass.
  No kernel or guest result is inferred from those fixtures.
- B granted one serial source/UAPI/packing container, 2 CPU on cpuset 4-5,
  4 GiB RAM and equal swap limit, timeout 1200 seconds/kill-after 30.
  Check image sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1;
  rustc 1.98.0 (88d9e12ae), cargo 1.98.0 (797e8a9bc), x86_64-unknown-linux-gnu.
  tmux vhqwow6o-38f603, pane %110. Private source/diff/file manifests, logs,
  limits and terminal exits live under `_out/boot-size/metadata/`.
- B has no confirmed CX bench. Missing physical evidence inputs: actual local
  CX3576 board identity, serial console/device or management endpoint, the new
  signed zstd FIT plus matching ZSTD-enabled U-Boot image/flash target, and a
  confirmed cold-power control path. Cold boot/reboot/poweroff/watchdog remain
  pending; no production or unrelated device is touched.
