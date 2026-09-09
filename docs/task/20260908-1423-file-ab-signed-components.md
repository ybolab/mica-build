# 20260908-1423-file-ab-signed-components Design and implement file-based A/B with independently signed components

- **status**: in_progress
- **priority**: P1
- **owner**: l1/6rjx4wrt
- **createdAt**: 2026-09-08 14:23
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

Prepare a complete proposal for a smaller partition layout, independently updatable boot firmware, kernel packages and rootfs images, and kernel verification of signed dm-verity root hashes. The user approved implementation after the proposal and prohibits backward compatibility during development.

The proposal is approved and implementation is authorized. The plan covers
trust, component ownership, layout, native boot/update transactions, key lifecycle
and acceptance. Current implementation results and remaining physical evidence
are tracked in the linked delivery task.

## ActiveForm

P3-P9 software acceptance passes; P10 cleanup and cx3576 physical qualification are tracked in the delivery task.

## Dependencies

- **blocked by**: (none; implementation approved and P1 completed)
- **blocks**: (none)

## Notes

- 2026-09-09: x64 and virt-arm64 signed startup, component updates, panic/
  watchdog fallback, interrupted reset and latest API acceptance pass. cx3576
  image/FIT/firmware packaging, offline verification and DATA growth pass;
  physical bench evidence remains open. The [delivery task](20260908-2229-file-ab-delivery-x64-first.md)
  owns exact artifacts, current gate results and the authorized documentation
  and dead-code cleanup. RAUC is removed; lode is not an OS update dependency.
- 2026-09-08: the user resumed work after reviewing P1 and reconfirmed that
  development requires no backward compatibility. Local P2 work is tracked in
  [20260908-2115-p2-descriptor-contracts-x64](20260908-2115-p2-descriptor-contracts-x64.md).
  The historical execution service remains stopped; the current work proceeds
  sequentially in this checkout. Older pending-approval notes below describe
  the proposal's history, not its current authorization.
- 2026-09-08 21:50: P2 completed locally. Strict Rust/Bun component contracts,
  shared Ed25519 envelopes, PKCS#7 signing, public-only distributed build
  inputs and x64 certificate lifecycle evidence are accepted in
  `20260908-2115-p2-descriptor-contracts-x64`. Gates: build 1,028; focused
  contracts/signing 42; Rust 68; server 36; docs and shell/trust lints passed.
  P3 opens. The P1 report's automatic key-generation and unmeasured-expiry
  notes below are superseded by P2; other hardware and later-phase gaps remain.

- Coordinate at implementation time with the active runtime composition and trust-provisioning work. This task does not change their records or implementation.
- Investigation and the complete draft proposal are delivered. The original five-partition draft has been revised to three partitions following the user's writable-DATA consolidation request. It covers independent component updates, signed root/support images, key lifecycle, trial/rollback transactions, RAUC replacement, UEFI bootloader selection, ten implementation phases, and a fault-acceptance matrix.
- Only planning records and their indexes changed. The user authorized a local commit of these records; implementation remains pending approval. No boot experiment, device write, key provisioning, or push is included.
- Validation passed: `make docs-verify`, `git diff --check`, and explicit plan/task structure, local-link and index/state checks. The implementation task is pending; the related plan is a completed draft awaiting approval.

- unclaim: Investigation and proposal are complete. Release the implementation claim while the draft awaits explicit approval.

- Plan amendment: move state/meta/var into DATA directories; use bind mounts for system paths, add project-quota and writer-ordering requirements, and replace partition-based cleanup assumptions with explicit directory scopes. Runtime implementation remains unapproved and unchanged.

- Plan correction: keep the var parent skeleton read-only and expose only required writable leaves. Remove the whole-var DATA bind/seeding/budget, record known persistent writers and existing volatile/container storage, and add remaining-writer audit, narrow cleanup and negative-write acceptance criteria. Only the proposal changed.

- unclaim: Unified DATA plan amendment is complete; implementation remains pending approval.

- unclaim: Selective writable-path plan correction is complete; implementation remains pending approval.

- 2026-09-08 17:14: P1 dispatched as two L3 tasks with disjoint files. P1-A
  (boot/trust primitives: signed verity on x64 and cx3576 kernels, cx3576
  signed FIT, UEFI shared-UKI Type #1 entries) is BKD `ew42ee3o`, record
  `20260908-1712-p1-signed-verity-boot`. P1-B (writable-path writer audit,
  random-seed resolution, container-network destination) is BKD `iku9ubdw`,
  record `20260908-1712-p1-writable-path-audit`. Both branch from
  `a1bcd5bd` (cx3576 contract 454). P2+ wait on P1's evidence.

- 2026-09-08 17:19: user direction — parallel confirmed, x64 first under
  QEMU, then the same layout on cx3576 and the other boards. Both P1 tasks
  re-prioritised by follow-up; P1-A reports its x64 stage on its own so P2
  for x64 can open before the cx3576/virt-arm64 stage finishes.

- 2026-09-08 19:31: P1-A (`ew42ee3o`) reported all five proofs feasible as drafted on
  x64, virt-arm64 and the cx3576 kernel under QEMU; nothing weakened. L1
  acceptance by content passed (raw logs match the report; contracts 455/325,
  unit suite, docs gates re-run by L1; a byte flipped in the valid signature
  is refused with -EKEYREJECTED). Merge waits on the proof harness being
  committed to the branch and on the x64 image contract. P1-B (`iku9ubdw`)
  stalled with its turn ended during a three-boot QEMU run whose second boot
  failed on SSH; resumed by follow-up with the measured outcome.

- 2026-09-08 20:22: P1-B (`iku9ubdw`) merged. Deliverables: the 14-row writer contract
  and 25-row negative list for x64 (each row observed/declared/inferred), the
  random-seed resolution as a file bind (start, shutdown save and reboot
  survival measured; systemd-random-seed writes through the inode), the
  container-network destination `/mos/containers/networks` with the reset
  tiers read off `reset.rs`, `/var/tmp`/`PrivateTmp=` guidance, the P5 change
  list and board differences. L1 re-ran the static half and one candidate
  boot: the bind, save/load and the seed's change on DATA after power-down
  all reproduce. Four findings outside the contract became three pending
  tasks (`state-units-never-load`, `ssh-generator-vs-image-policy`,
  `wtmp-unbounded-append`). Harness: `tests/p1-writable-path-audit/`.

- 2026-09-08 21:04: P1-A (`ew42ee3o`) merged. All five boot/trust proofs feasible as
  drafted, nothing weakened: signed dm-verity accepted/refused with one errno
  set on x64, virt-arm64 and the cx3576 vendor kernel; one kernel boots two
  signed roots (switch_root on all three); cx3576 FIT enforcement in the
  U-Boot sandbox and the board's control FDT taking a required key; systemd-boot
  shared-UKI Type #1 entries with boot counting and `LoaderEntrySelected` on
  x64 and virt-arm64. Tree: verity symbols in the shared kernel floor, the
  `verity` dev-key domain, the `kernel-verity-trust-anchor` contract check
  (cx3576 455, virt-arm64 325, x64 326), and the lab under
  `tests/signed-boot-lab/`. L1 re-ran the contracts, refused a byte-flipped
  signature, and required the lab on the branch and a reproducible x64 verdict
  before merging. P1 is complete; P2 opens on x64. Carried into P2: the anchor
  as a distributed build input, and kernel certificate expiry/revocation.
  The shipped cx3576 path still boots an unsigned legacy `boot.scr` (P6).

- 2026-09-08 21:06: P2 for x64 dispatched as BKD `ofu05clu`, record `20260908-2105-p2-descriptor-contracts-x64`, branching
  from `72c3d1e3` (P1-A and P1-B merged). Scope: frozen descriptor schema and
  content identities, kernel-support ownership, the PKCS#7 root-hash signing
  tool and Ed25519 descriptor envelope reuse, cross-language golden fixtures
  with the plan's negatives, plus the two items P1-A handed over (anchor as a
  distributed build input; kernel certificate expiry/revocation measured).

- 2026-09-08 21:09: **Stopped by the user for review.** P2 (`ofu05clu`) cancelled after
  about five minutes (it had read the plan and surveyed code; no commits; its
  worktree is kept; the issue is in `review`). The watchdog cron is deleted. No
  build, agent or cron of L1's is running. Nothing further is dispatched until
  the user arranges it.

## P1 merge report (main `a1bcd5bd` → `fc479673`)

Eleven first-parent commits, 62 files, +3732/−31. Two L3 branches merged
(`457c2244` P1-A, `b7924742` P1-B) plus L1 record and gate commits.

### What landed, by area

| Area | Change | Files |
|---|---|---|
| Kernel floor | `boards/common/mos-required.fragment`: `BLK_DEV_LOOP=y`, `DM_VERITY_VERIFY_ROOTHASH_SIG=y`, `SYSTEM_TRUSTED_KEYRING=y`, `SYSTEM_TRUSTED_KEYS="certs/mos-verity-anchor.pem"` (two lines new per board; the other two were already `=y`). The certificate enters each kernel build through a `mos-trust` build context and is asserted by name (`x64`/`virt-arm64` kernel Dockerfiles, `cx3576` `configure.sh`). | 11 under `boards/` |
| Keys | `pkgs/rauc/gen-dev-keys.sh --domain verity` mints `meta/verity/signer.key.pem` + `signer.cert.pem` (RSA-2048, CA:FALSE, digitalSignature); each board BSP Makefile runs it `--if-absent` before the kernel build; `MOS_KEY_ALG_VERITY=rsa-2048` in `key-algorithms.env`; `tests/trust-domain-hygiene-test.sh` probes the new key (9 assertions). | 3 |
| U-Boot (cx3576) | `build-mos.sh` asserts `FIT`, `FIT_SIGNATURE`, `FIT_FULL_CHECK`, `IMAGE_SIGN_INFO`, `RSA`, `RSA_VERIFY`, `SPL_FIT_SIGNATURE`, `LEGACY_IMAGE_FORMAT` by name. **No control-FDT key is installed**; the shipped path still boots the unsigned legacy `boot.scr` via `booti` (P6). | 1 |
| Image contract | `verify/src/checks-kernel.ts`: the three symbols join `REQUIRED`; new check `kernel-verity-trust-anchor` reads `CONFIG_SYSTEM_TRUSTED_KEYS` back from the shipped `/boot/config-*`. Counts: cx3576 454 → **455**, virt-arm64 **325**, x64 **326** (+1 each, the anchor check). | 3 |
| Tests | `tests/signed-boot-lab/` (24 files; entry scripts `verity-matrix.sh`, `second-root.sh`, `fit-sandbox.sh`, `cx3576-control-fdt.sh`, `uefi-uki.sh`, `image-boot.sh`; images built by name from four Dockerfiles). `tests/p1-writable-path-audit/` (7 files: `extract-root.sh`, `audit-root.sh`, `boot.sh`, `probe.sh`, `seed-data.sh`, `read-data.sh`). | 31 |
| Docs gate | `docs/verify-status.sh` accepts any record under `docs/plan/` (index excluded) for a `proposed` line, both namings; the test carries both shapes; the user-doc contract (en, zh) states the rule. | 4 |
| Records | Task records for P1-A, P1-B, the gate fix and three findings; plan annotations (approval, x64-first order, P1 complete); changelog. | 10 |

### What was proven (P1-A), and where

| Proof | x64 6.12 | virt-arm64 6.12 | cx3576 6.1 vendor |
|---|---|---|---|
| Signed verity: valid accepted; absent / unrelated key `-ENOKEY`; modified `-EKEYREJECTED`; truncated `-EBADMSG`; signature over another hash `-EKEYREJECTED`; modified block → that block `EIO` only | QEMU, own root | QEMU | the real kernel under QEMU (PL011 console and one DRM initcall blacklisted, test-only) |
| `require_signatures=0` accepts an unsigned mapping (policy is the parameter, not the symbol) | yes | yes | yes |
| One kernel, two signed roots, `switch_root` onto each | yes (own two roots) | yes | yes |
| `veritysetup open --root-hash-signature`, explicit geometry, read-only loop | yes | yes | yes |
| Required-signature FIT: unsigned, untrusted key, modified kernel/DTB/initramfs all refused | — | — | U-Boot **sandbox** at the board's commit; the board's control FDT accepts the key; **not run on silicon** |
| systemd-boot + signed UKI under Secure Boot: two Type #1 entries → one UKI; counters `+3 → +2-1 → +1-2 → +0-3 →` next entry; `LoaderEntrySelected` in early init; entry `options` never reach the cmdline; a flipped UKI refused | OVMF | AAVMF | — |
| Assembled image still boots the current path (OVMF → GRUB → `dm-mod.create=` → login) | yes | — | — |

### What was recorded (P1-B, x64 under QEMU)

A 14-leaf writer contract and a 25-path negative list, each row observed / declared / inferred; the random seed served by a **file** bind (systemd-random-seed writes through the inode; start, shutdown save and reboot survival measured); container networks to move to `/mos/containers/networks`, reset tiers read off `reset.rs`; `/var/lib/systemd/linger` and `/var/lib/systemd/timers` are writers the plan's table lacked; an absent `StateDirectory` under a read-only `/var` is fatal (`systemd-rfkill` exit 238). P5 change list and board differences recorded. Four findings became three pending tasks: `state-units-never-load`, `ssh-generator-vs-image-policy`, `wtmp-unbounded-append`.

### L1 acceptance performed before each merge

Raw logs checked against every quoted verdict; contracts re-run by L1 (cx3576 455/455, virt-arm64 325/325, x64 326/326 on each branch's current artefacts); one byte flipped in the valid signature refused with `-EKEYREJECTED`; the static audit and one candidate boot re-run (the seed on DATA changed after power-down); the harness required on the branch before merge; docs gates from a `git archive` outside the repository; unit suite 1479; hygiene, netavark, pipefail and host-toolchain lints. One miss by L1: the P1-B merge left two shell lints red on main until `1286a64b`.

### What did NOT change

No shipped boot path (cx3576 `boot.scr` + `booti`; UEFI GRUB with an unauthenticated `dm-mod.create=` root hash); no `dm_verity.require_signatures=1` on any command line; no `rootfs/overlay`, fstab, repart, tmpfiles or `/var` layout; no partition layout; no RAUC or GRUB removal; no production keys; no device enrollment; no image copied into `/srv/mos/_out` (the delivered cx3576 image is still `cx3576-mos-1788887133.img`, contract 454, pre-P1).

### Consequences for the next build on main

- Every board kernel now embeds `meta/verity/signer.cert.pem`. `/srv/mos/meta/verity/` does not exist yet; the BSP Makefiles create it (`gen-dev-keys.sh --if-absent --domain verity`) on the next kernel build, so the next cx3576 kernel differs from the delivered one by the two config lines and the anchor, and its image reads 455.
- The kernel image depends on the anchor's bytes: trees with different `meta/verity/` produce different kernels from identical source (RFCT-343's byte-identical property holds per anchor, not across machines). Whether the anchor becomes a distributed build input is P2's first decision.

### Open, handed forward

Kernel certificate expiry and revocation unmeasured (P2); ECDSA content signatures unmeasured (RSA-2048 is what every proof used); cx3576 bench: a signed FIT booted by the installed U-Boot, the watchdog rows, the `rfkill` and `ConfigurationDirectoryMode` rows; `/var/tmp` on a cold first boot; the P1-B harness's third-boot SSH refusal is an open question, not a diagnosis.
