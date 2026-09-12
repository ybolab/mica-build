# Page brief: Embedded differences

- **Purpose**: explain why Mica OS is not a generic server/cloud CoreOS, for a
  visitor who knows Fedora CoreOS or similar and is pattern-matching Mica OS onto
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
repaired. An embedded appliance gets none of that. Mica OS borrows what works from
that family — immutable root, atomic A/B updates — and rebuilds the lifecycle
around the device on a bench and in the field.

### Boards, not instances

A Mica OS release is built per board. Each board contributes its own partition
geometry, kernel, device tree and bootloader through a declared BSP contract,
and the OS build consumes those artifacts without reaching into their build.
Kernel configurations must satisfy a shared assertion set, so every board
carries the features the OS depends on.

> status: shipped — evidence: `boards/cx3576/board.env`, `boards/common/mos-required.fragment`, `docs/boards/contract.md`

### Factory and offline setup

A device must become configurable before it has a network, an account or a
cloud to phone. Mica OS provisions itself: the first boot seeds a device identity
and its settings under DATA/state, and a validated
provisioning document placed on the boot partition or a removable medium can
carry a first configuration — network, credential, hostname — onto a unit that
has never seen a network. The whole journey, from choosing an artifact through
flashing, first boot, claim and repeatable initial configuration, is documented
end to end.

> status: shipped — evidence: `docs/design/provisioning.md`, `rootfs/overlay/usr/lib/mos/mos-seed-state`

**The site may not call that journey proven.** No step of it has been executed
on physical hardware from this tree — the flash, the first boot and both
offline transports are unrun — and Mica OS ships no factory tooling: no versioned
input pools, no verification at injection, no per-device record.

> status: unsupported

### Bounded flash

Embedded storage is fixed at manufacture and often small. Every factory disk
has exactly three GPT partitions declared per board — ESP or FIRMWARE, SYSTEM
and DATA. SYSTEM holds at most two signed deployments and their shared
component objects; DATA holds state, configuration, applications and a bounded
variable-data tier. Only DATA grows to fill the medium, and the OS never
assumes it can grow SYSTEM or firmware.

> status: shipped — evidence: `boards/x64/board.env`, `boards/cx3576/board.env`, `docs/design/storage.md`

### Field recovery

A fielded device that fails must recover without a technician reinstalling an
OS. Today, a new deployment boots on a bounded number of trial attempts and
becomes current only when the health check confirms it; if the trials run out
or the check fails, the boot records return to the retained confirmed
deployment automatically. Below the OS, boards with a maskROM USB loader path
can be reflashed whole when nothing else answers.

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`
> status: board-dependent — evidence: `docs/design/access.md`

The recovery ladder above that is designed and ordered least-destructive first:
read-only diagnosis, a guarded manual rollback that refuses any switch it
cannot prove goes backward, a configuration reset, an application-data reset,
credential recovery, a full factory reset, and the reflash. Every tier names
what it costs before it is offered. **Five of those seven rungs are operations
an operator can perform; the two named below are not.**

> status: shipped — evidence: `docs/design/recovery.md`, `pkgs/mosd/mosd/src/reset.rs`

**Two rungs of that ladder cannot be climbed on any board that exists.**
Credential recovery and the full factory reset are gated on a physical-presence
assertion. The OS side that produces one from a board-declared physical action
ships; **no board declares such an action** — not cx3576, not x64, not
virt-arm64 — so a fielded device refuses both, and an operator who has lost the
administrator credential still pays the device's identity for a reflash. Secure
wipe is not implemented at all, and no reset or reflash sanitizes the medium:
disposal under an unrecoverability requirement means destroying it. There is
also no rescue environment and no repair operation — a device that cannot be
restored by its own boot-time checks and ordinary updates goes to a service host
or gets reflashed.

> status: unsupported

### Long-lived BSP maintenance

An appliance lives for years on a kernel and bootloader its vendor may stop
maintaining. Mica OS records BSP provenance per board — source repository, synced
commit, deviation register — and the board contract's next layer is published:
the staged porting manual, the vendor intake rubric and the field-reliability
qualification process, with [../boards/porting.md](../boards/porting.md) as the
integrator's entry point. The evidence those procedures collect is a board
fact and is not in yet: no board has a dated physical qualification row, and long-term CVE response is assigned as a lifecycle duty by
the tier definitions rather than written up as a procedure.

> status: shipped — evidence: `docs/boards/cx3576-bsp-sync.md`
> status: shipped — evidence: `docs/boards/porting.md`, `docs/boards/intake.md`, `docs/boards/qualification.md`, `docs/boards/support-tiers.md`
> status: board-dependent — evidence: `docs/boards/cx3576.md`
