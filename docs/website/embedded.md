# Page brief: Embedded differences

- **Purpose**: explain why mos is not a generic server/cloud CoreOS, for a
  visitor who knows Fedora CoreOS or similar and is pattern-matching mos onto
  it. The navigation patterns are comparable; the operating assumptions are
  not.
- **Audience**: integrators and engineers who already run image-based Linux in
  a datacenter and need the embedded deltas spelled out.
- **Navigation position**: page 2, directly after [product](product.md). Links
  forward to [supported hardware](hardware.md) and
  [documentation](documentation.md).

## Content outline

1. Framing paragraph: same image-based family, different lifecycle.
2. Five deltas, one section each: boards, factory/offline setup, bounded
   flash, field recovery, long-lived BSP maintenance.

## Draft copy

### Same family, different lifecycle

Cloud image-based systems assume elastic hardware, a network at first boot,
disks measured in terabytes, and machines that are replaced rather than
repaired. An embedded appliance gets none of that. mos borrows what works from
that family — immutable root, atomic A/B updates — and rebuilds the lifecycle
around the device on a bench and in the field.

### Boards, not instances

A mos release is built per board. Each board contributes its own partition
geometry, kernel, device tree and bootloader through a declared BSP contract,
and the OS build consumes those artifacts without reaching into their build.
Kernel configurations must satisfy a shared assertion set, so every board
carries the features the OS depends on.

> status: shipped — evidence: `boards/cx3576/board.env`, `boards/common/mos-required.fragment`, `docs/design/boards.md`

### Factory and offline setup

A device must become configurable before it has a network, an account or a
cloud to phone. mos designs provisioning as configuration without a network —
seeded device identity and settings on the writable STATE partition — and the
complete customer onboarding journey (artifact selection, flashing, first
boot, claim, repeatable initial configuration) is planned work, not yet a
shipped end-to-end path.

> status: shipped — evidence: `docs/design/provisioning.md`, `rootfs/overlay/usr/lib/mos/mos-seed-state`
> status: proposed — evidence: `docs/plan/PLAN-046.md`

TODO(PLAN-046): revisit after this plan merges

### Bounded flash

Embedded storage is fixed at manufacture and often small. The disk layout is
one GPT declared per board — two system slots, update metadata, configuration,
application data and a disposable tier — so every byte has an owner and a
loss-consequence, and the OS never assumes it can grow.

> status: shipped — evidence: `boards/cx3576/board.env`, `docs/design/ro-root.md`

### Field recovery

A fielded device that fails must recover without a technician reinstalling an
OS. Today, a slot that fails to boot burns its boot credits and the bootloader
returns to the previous slot automatically; below the OS, boards with a
maskROM USB loader path can be reflashed whole when nothing else answers.

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`
> status: board-dependent — evidence: `docs/design/access.md`

The complete recovery ladder — guarded manual rollback, both-slots-failed
runbooks, credential recovery, factory reset tiers — is planned and not yet
delivered.

> status: proposed — evidence: `docs/plan/PLAN-048.md`

TODO(PLAN-048): revisit after this plan merges

### Long-lived BSP maintenance

An appliance lives for years on a kernel and bootloader its vendor may stop
maintaining. mos records BSP provenance per board — source repository, synced
commit, deviation register — and the board contract's next layer is published:
the staged porting manual, the vendor intake rubric and the field-reliability
qualification process, with [../bsp/porting.md](../bsp/porting.md) as the
integrator's entry point. The evidence those procedures collect is a board
fact and is not in yet: the one dossier on file has every qualification row at
`not tested`, and long-term CVE response is assigned as a lifecycle duty by
the tier definitions rather than written up as a procedure.

> status: shipped — evidence: `docs/design/bsp-cx3576-sync.md`
> status: shipped — evidence: `docs/bsp/porting.md`, `docs/bsp/intake.md`, `docs/bsp/qualification.md`, `docs/bsp/support-tiers.md`
> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`
