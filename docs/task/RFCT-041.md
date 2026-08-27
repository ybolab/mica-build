# RFCT-041 Venus OS access and firmware-update UX study

- **status**: completed — research complete, reference document, no code
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 10:20
- **completedAt**: 2026-08-19 11:35

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/487cif52`, merged by L2 into `bkd/sqexk7je`.

## Description

The companion half of RFCT-040. Where that task studied what Venus OS *shows*,
this one studies what Venus OS *lets an operator do to the box underneath* —
shell access, vendor remote support, the shipped security defaults, and the
firmware update and rollback experience.

Venus is the right comparison for this specifically because it shares the
structural properties mos has: a read-only rootfs, a dual-rootfs updater, a
locked-down default network posture, and a vendor support channel — all driven
from a settings tree rather than from `/etc`
(`docs/research/venus-os-access.md:17-20`).

Like its companion, this is **description, not proposal**.

## Deliverable

`docs/research/venus-os-access.md` (782 lines).

**Covered**: SSH and root access, the local serial console, the vendor
remote-support tunnel and the VRM remote-console path, the access-affecting
shipped defaults, and the online/offline firmware update and rollback UX.

**Deliberately not covered**, because the companion owns it: the web UI's
technology and information architecture; VRM portal server-side behaviour.

## Companion document

`docs/research/venus-os-ui.md` (RFCT-040). The two were originally specified to
be folded into one file — the header blockquote of this document still records
that intent, which is why the companion line added by RFCT-045 says explicitly
that the fold was measured and dropped. See RFCT-045 for the evidence.

## Licence fence

Identical to RFCT-040 and equally binding: gui-v2 and the Venus userland are
**study references only**. Nothing from Venus may be copied into mos.

## Sourcing discipline

Every claim about Venus carries a URL or a `repo/path/file.ext` reference to a
public repository actually read. Documented behaviour, behaviour read out of
source, and inference are distinguished in the text itself rather than flattened
into a single voice; unverifiable items are under an explicit gaps heading.

## Consumers

`docs/design/dashboard.md` cites this file 11 times. That count is load-bearing
— it is half the evidence RFCT-045 used to drop the fold.
