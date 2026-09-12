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

- For **mos-qualified** boards, the Mica OS project is the named lifecycle owner
  of the OS on that board: the BSP, the update path and the recovery
  procedures its dossier claims.
- For **integrator-qualified / bring-up** boards, the integrator owns the
  board's qualification and lifecycle; Mica OS supplies the board contract,
  guidance and the shared OS core. Support cases about board-specific
  behaviour route to the board's owner named in its evidence dossier.
- For **unsupported** hardware, no support claim exists.

The taxonomy and its ownership split are defined; which tier a board holds is
a separate question its dossier answers. No board holds the mos-qualified tier
today — no board has a dated physical qualification row — so the first bullet describes the ownership that tier would
carry, not a board the site can point at.

> status: shipped — evidence: `docs/boards/support-tiers.md`
> status: board-dependent — evidence: `docs/boards/cx3576.md`

### Lifecycle and support windows

A release's channel is a release fact the site may render: the machine-readable
manifest binds it beside the version, board, profile and source commit, and the
publication gate refuses a release whose manifest does not agree with what was
built. The support-window and end-of-life policy is written — a stable release
supported until superseded plus an overlap stated in its own release notes,
per-board support bounded by the board's qualification, EOL announced with a
notice period — and lives in the security lifecycle record.

> status: shipped — evidence: `docs/design/release-artifacts.md`, `docs/design/security-lifecycle.md`

**The site may not print a window, a date or an advisory-coverage promise.**
No tooling binds a window to a release, no release is published for one to
attach to, and no advisory or EOL announcement channel exists. A policy
sentence is not a commitment the site can render.

> status: unsupported

### Filing a case

A support case cites the device's release identity — version, board, profile
and booted deployment — so the responder reproduces against the exact image. One
authenticated read answers it: the system-information surface returns the
machine id, board, kernel, image version and build date, the installed package
set and the booted deployment. A bounded, redacted diagnostic snapshot can be
collected and downloaded to attach to the case; the device never uploads it
anywhere.

> status: shipped — evidence: `docs/design/diagnostics.md`, `pkgs/mosd/apid/openapi.json`
