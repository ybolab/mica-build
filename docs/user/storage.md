# Storage

mos manages a fixed, board-declared partition layout; it does not expose a
partition editor, and it answers "where does my data go?" with four tiers,
each defined by what happens if it is lost. Understanding the tiers is most of
what an operator or integrator needs from this page.

## 1. The four tiers

| Tier | Mounted at | Holds | Grows? | Lost when |
|---|---|---|---|---|
| **STATE** | `/mnt/state` (with binds into `/etc` and `/var/lib`) | configuration and identity: settings, credentials, SSH host keys, WiFi configs, pairings | no — small and fixed | reflash only |
| **DATA** | `/srv` (with `/home` and `/root` bound onto it) | application data, container storage, operator files | **yes** — fills the disk on first boot | reflash only |
| **META** | `/mnt/meta` | update and appliance metadata (RAUC slot status) | no | reflash only |
| **EPHEMERAL** | `/var` | disposable runtime residue: logs, caches | no — fixed size | reflash, **and** routine cleanup |

The root filesystem itself is a read-only, dm-verity-protected squashfs in a
fixed A/B slot; it is never written and never resized. An A/B update writes
only the rootfs and boot slots — every tier above survives it.

> status: shipped — evidence: `docs/design/ro-root.md`, `boards/cx3576/board.env`

## 2. The rules that follow

- **Put data on DATA.** Integrator files, scripts, application state and
  container volumes belong under `/srv` (or `/home` and `/root`, which live on
  DATA). They survive reboots and updates.
- **Never store anything you want to keep on `/var`.** It is deliberately
  small, aged by daily cleanup rules, and disposable by contract — the build
  fails if anything precious lands there. Storage that "works for months and
  then is gone" is the failure this rule prevents.
- **DATA is shared.** Container images and volumes, custom UI bundles and
  application data draw on one partition. An application that logs without
  rotation starves its neighbours; `podman system df` shows the container
  share.
- **Arbitrary `/etc` edits do not persist.** The supported persistence path is
  the settings tree ([configuration.md](configuration.md)); the deliberate
  STATE-backed exceptions are enumerated in the design record.
- **First-boot growth is one-way.** DATA grows to fill the disk on first
  boot; nothing shrinks it back. After a reflash, blocks beyond the image's
  extent are unreachable rather than erased — the disposal caveat in
  [recovery.md](recovery.md).

Periodic TRIM is enabled for the writable filesystems, and boot-time
filesystem checks cover them.

> status: shipped — evidence: `docs/design/ro-root.md`, `make os-repart-test`

## 3. What you can observe today

There is no storage-status API yet. On the device, the ordinary tools answer:
`df` for capacity per tier, `podman system df` for the container share of
DATA, and the journal for filesystem check results. Media health (eMMC wear,
SMART) is not surfaced at all.

> status: shipped — evidence: `docs/design/containers.md`

## 4. What is planned

The storage lifecycle plan adds the operator-facing subsystem this page
currently cannot describe: a `StorageStatus` model (identity, role, sizes,
used/free/reserved, mount and error state, last check/repair result),
normalized media-health signals by board and media type, low-space thresholds
with hysteresis and a protected update workspace, offline repair and
data-preserving replacement procedures, and versioned backup/export and
restore contracts — published before they are claimed. Encryption posture and
a removable-media contract are decisions inside that plan; until it lands,
neither exists.

> status: proposed — evidence: `docs/plan/PLAN-049.md`

TODO(PLAN-049): revisit after this plan merges
