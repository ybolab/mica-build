# PLAN-048 Deliver recovery and credential access recovery

- **status**: implementing
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-284](../task/RFCT-284.md)

## Context

Boot-credit exhaustion can return to the previous slot, and whole-disk reflash
is the physical last resort. mos lacks a supported manual rollback, both-slots-
failed flow, non-destructive repair tier, administrator credential recovery,
factory reset, secure wipe and board/storage replacement procedure. A reflash
can make grown DATA blocks unreachable without erasing their contents.

## Proposal

- **SW/DOC:** expose authenticated current/alternate slot state and a guarded
  manual rollback/reboot action that cannot mark an unverified slot good.
- **INT/DOC:** define a physical-presence recovery entry and per-board recovery
  runbook for bootloader, image reflash and collection of a minimal failure
  record when normal apid is unavailable.
- **SW/OPS:** design credential recovery with physical-presence or factory
  authority, credential rotation, audit and no disclosure of the previous
  secret.
- **SW:** implement explicit reset modes only after their tier semantics are
  agreed: configuration reset, application-data reset, full factory reset and
  secure wipe must each name effects on identity, calibration, STATE, DATA,
  META and both system slots.
- **SW/INT:** make interrupted recovery/reset replayable; validate corrupted
  slot, corrupted writable filesystem, lost credentials, no network and power
  loss scenarios on qualified boards.
- **DOC:** publish a decision tree that starts with data-preserving actions and
  makes irreversible operations and recovery limitations unambiguous.

## Risks

- A recovery channel can become an authentication bypass; physical presence,
  factory authority and audit need an explicit threat model.
- Resetting identity or calibration can permanently decommission a device;
  tier ownership must be resolved with manufacturing before implementation.
- Binary-only bootloaders may limit rescue features; the board dossier must
  report the available recovery level honestly.

## Scope

In scope: manual slot rollback, physical recovery contract, access recovery,
reset/wipe semantics, fault tests and operator guides. Out of scope: a general
interactive Linux rescue distribution and application backup contents, which
PLAN-049 defines.

## Alternatives

1. Document full-disk reflash as the only recovery. Rejected because it loses
   serviceability and has unclear data destruction semantics.
2. Enable permanent SSH/root shell for recovery. Rejected because it broadens
   the normal attack surface.
3. Implement reset before defining tier ownership. Rejected because safe data
   loss and identity behavior cannot be inferred later.

## Annotations

- 2026-08-31: Embedded parity review identified recovery, reset, credential
  access and storage replacement as product gaps rather than doc-only gaps.
- 2026-09-01: Split from PLAN-037 as one recovery acceptance boundary.
