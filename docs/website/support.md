# Page brief: Support

- **Purpose**: tell a visitor what support exists, who owns what across the
  device's life, and where to go with a problem — before they have the
  problem.
- **Audience**: integrators pricing a product lifetime; operators and field
  engineers with a failing device; procurement checking lifecycle commitments.
- **Navigation position**: page 7. Links to
  [../user/support.md](../user/support.md) for the case-filing procedure,
  [supported hardware](hardware.md) for per-board ownership, and
  [../user/troubleshooting.md](../user/troubleshooting.md) as the first stop.

## Content outline

1. Self-service first: the documentation routes.
2. Ownership: who supports what, aligned with the board taxonomy.
3. Lifecycle: release support windows and end-of-life.
4. Filing a case: what identity a case must cite.

## Draft copy

### Start with the documentation

Most field problems are covered by the
[troubleshooting guide](../user/troubleshooting.md) and the
[recovery guide](../user/recovery.md), and both are written decision-tree
first: data-preserving actions before irreversible ones. The
[support guide](../user/support.md) describes how to escalate beyond them.

### Who owns what

Support ownership follows the board support taxonomy on the
[supported hardware](hardware.md) page:

- For **mos-qualified** boards, the mos project is the named lifecycle owner
  of the OS on that board: the BSP, the update path and the recovery
  procedures its dossier claims.
- For **integrator-qualified / bring-up** boards, the integrator owns the
  board's qualification and lifecycle; mos supplies the board contract,
  guidance and the shared OS core. Support cases about board-specific
  behaviour route to the board's owner named in its evidence dossier.
- For **unsupported** hardware, no support claim exists.

The taxonomy and its ownership split are defined; which tier a board holds is
a separate question its dossier answers. No board holds the mos-qualified tier
today — the one dossier on file carries every qualification row as
`not tested` — so the first bullet describes the ownership that tier would
carry, not a board the site can point at.

> status: shipped — evidence: `docs/bsp/support-tiers.md`
> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`

### Lifecycle and support windows

A release's support window, its channel, and end-of-life dates are release
facts: the site renders them from the machine-readable release manifest and
support policy once those are published, and this page must not promise a
window that no policy backs yet.

> status: proposed — evidence: `docs/plan/PLAN-043.md`

TODO(PLAN-043): revisit after this plan merges

The security end-of-life procedure — when a release stops receiving advisory
coverage — is part of the planned security lifecycle and appears here when it
ships.

> status: proposed — evidence: `docs/plan/PLAN-053.md`

### Filing a case

A support case cites the device's release identity — version, board, profile
and active slot — so the responder reproduces against the exact image. Today
that identity is assembled from existing seams (the shipped package manifest,
the machine id, the active RAUC slot); a single system-information surface
that answers it in one read, plus a bounded redacted diagnostic snapshot to
attach to a case, are planned.

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`
> status: proposed — evidence: `docs/plan/PLAN-052.md`

TODO(PLAN-052): revisit after this plan merges
