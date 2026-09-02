# Design: storage — fixed tiers, media health and the data lifecycle

> What the device can tell an operator about its own storage, what it will
> never do to it, and which lifecycle operations are decided and which are
> deliberately not offered. Companion to ro-root.md, api.md and mosd.md.
> Implements PLAN-049 / RFCT-285.

## 1. The layout is fixed, and this document does not change that

Two things own the layout and this document owns neither.

**`boards/*/board.env`** is the single source of truth for the partition table:
sizes, GUIDs, type codes, GPT names and roles. The image assembler writes that
table, `systemd-repart` grows DATA once on first boot, and nothing afterwards
edits it.

**PLAN-063 / RFCT-292** own where those partitions surface.
`rootfs/overlay/etc/fstab.in` mounts the DATA PARTUUID at **`/mnt/data`** (the
only `x-systemd.growfs` row), and
`rootfs/overlay/etc/systemd/system/{mos,srv}.mount` bind `/mnt/data/mos` at
**`/mos`** (system-owned) and `/mnt/data/srv` at **`/srv`** (user-owned), both
ordered before `local-fs.target` and both requiring `mos-data-layout.service`,
the fail-closed initializer at `rootfs/overlay/usr/lib/mos/mos-data-layout`.
There are no compatibility symlinks, no `/srv/.mos` and no migration;
PLAN-061/RFCT-291 are the superseded historical record, read here only for the
readiness contract they still define. `docs/design/ro-root.md` section 4
carries the tier table this sits on, and `docs/design/access.md` section 9.2
the reflash it names.

Paths are named here, never re-derived. If this document and `fstab.in`
disagree, `fstab.in` is right and this document is the bug.

This capability adds **observation and policy**, not layout control:

- **No generic partition editor.** No format, repartition, resize, mount,
  unmount or erase route exists on the management API, and
  `normal_apid_exposes_no_format_or_repartition_action` in
  `pkgs/mosd/apid/src/tests.rs` fails the build if one appears — it scans the
  generated OpenAPI document (which another test pins to exactly what the
  handlers produce, so it *is* the route table) and probes the paths a client
  would guess.
- **No LVM, RAID or pooling.** Out of scope until a SKU needs them, per
  PLAN-049.
- **`mosd` writes one thing here, and it is a readiness probe.**
  `storage_status.rs` reads sysfs, `/proc/self/mountinfo`, `df` and systemd's
  recorded unit results; the single write is section 3's probe file, in the
  system-owned namespace only, removed whether or not it succeeded.

`pkgs/mosd/mosd/src/storage_status.rs` carries a `TIERS` table that mirrors
board.env's `<TIER>_LABEL` and `<TIER>_ROLE` values, and a `BINDS` table that
mirrors the two PLAN-063 mount units, each with a comment saying so. They exist
only because mosd runs on a device where neither source file is present;
board.env and the mount units stay the sources, and both tables are
transcriptions of them.

## 2. What StorageStatus reports

`GET /api/v1/storage/status` (authenticated, read-only) serves what mosd's
`GetStorageStatus` observed at request time. Observed rather than stored, for
the same reason `GetTimeStatus` is: space and wear move without any settings
write, so a cached copy would only ever be stale.

### Per tier

Every tier in the table is reported, **including the ones this board does not
have** — an x64 image has a separate `esp`, a cx3576 image does not, and the
absent one carries `"present": false` with the reason rather than being
omitted. An omission would leave the reader to guess whether the tier is
missing or the surface is broken.

| Member | Source |
|---|---|
| `role`, `partitionLabel`, `expectedMount` | the `TIERS` table (board.env) |
| `device` | `/dev/disk/by-partlabel/<label>`, resolved |
| `partitionBytes` | `/sys/block/<disk>/<part>/size` × 512 |
| `mounted`, `mount`, `filesystem`, `readOnly` | `/proc/self/mountinfo`, matched on the tier's OWN mountpoint |
| `space` (`totalBytes`, `usedBytes`, `freeBytes`, `reservedBytes`, `usedPercent`) | `df -P -B1 <mount>` |
| `pressure` | the threshold band in section 5, DATA and STATE only |
| `updateWorkspace` | the reservation in section 6, DATA only |
| `check` | the `systemd-fsck@….service` unit systemd recorded |

Two consequences of that table are worth stating out loud:

- **`partitionBytes` is present for an unmounted tier.** The inactive A/B
  rootfs slot has no filesystem to measure, and its partition size is the only
  capacity number it has. Reporting nothing there would make an operator think
  the slot does not exist.
- **The booted rootfs slot reports as mounted at `/`, read-only.** `/` is a
  dm-verity device, so the mount table names `/dev/dm-N`; the observer
  resolves that to the single backing partition through
  `/sys/block/dm-N/slaves`. Without that step the slot actually holding the
  running system would report unmounted, which is both false and alarming.
- **The DATA tier reports `/mnt/data`, not `/mos` or `/srv`.** Under PLAN-063
  the DATA partition appears three times in the mount table — once at
  `/mnt/data` and once per bind — so the tier lookup matches on the tier's own
  declared mountpoint and only falls back to a device match for the A/B rootfs
  slots, which declare none. Matching on the device alone would report
  whichever mount the kernel listed first as "the DATA tier's mount".
- **`reservedBytes` is the filesystem's own reserved-blocks pool**
  (`total - used - free`), which only root can write into. It is a separate
  number from `freeBytes` because conflating them reports free space no
  application can have, and `usedPercent` is taken over `total` for the same
  reason: a DATA filesystem an application cannot write to is full.

### Check and repair evidence

`check` is the `systemd-fsck@<escaped device>.service` unit systemd runs for
each `/etc/fstab` entry with a non-zero pass number, read back over the system
bus: its `ActiveState`, its `Result` and the checker's `ExecMainStatus`. fsck's
exit status is surfaced as the number it is, because its encoding carries the
repair fact — **0 is clean, 1 means errors were CORRECTED**, 4 means errors
were left uncorrected — and folding that into a boolean would lose the one
outcome an operator needs to see.

**There is no check history.** systemd keeps the last invocation's result and
nothing else, so neither does this surface. A tier with no fsck unit reports
`{"recorded": false}` rather than reading as clean: RFCT-285 asks for the
evidence the system actually records, and inventing a green result for a
filesystem nobody has checked is exactly the fabrication PLAN-049 warns about.

## 3. `/mos` and `/srv`: two namespaces, one filesystem

PLAN-063 binds two namespaces out of the single DATA filesystem. They are
reported under `namespaces`, and they are deliberately **not** a second tier
list:

- **`/mos`** — system-owned, bound from `/mnt/data/mos`. Holds `ui/`,
  `updates/{downloads,verified,staging}`, `apps/`, `containers/`, `home/` and
  `root/`, each created by `mos-data-layout` with an explicit mode.
- **`/srv`** — user-owned, bound from `/mnt/data/srv`. The product gives this
  namespace to the operator.

**One capacity pool, reported once.** Both binds are views of the same
filesystem, so every byte belongs to the `data` tier and neither bind carries a
`space` object. The status body says so in a `sharedCapacityTier` member and a
sentence, and a test asserts no bind ever grows a capacity field — because the
failure this prevents is a reader adding `/mnt/data`, `/mos` and `/srv`
together and reporting three times the disk. PLAN-063's own risk list names
this: "`/mos` and `/srv` share one filesystem and capacity pool even though
their namespaces are separate."

### Readiness, per the PLAN-061 contract

PLAN-061 states that readiness "is more than `access(W_OK)`", and that contract
survives PLAN-063 unchanged. Each bind reports:

| Member | What it answers |
|---|---|
| `mounted` | is anything mounted at `/mos` / `/srv` at all |
| `device` + `sourceOnData` | does the mount resolve to the **DATA partition** |
| `sourceIsDirectory` | is the source under `/mnt/data` a real directory, not a symlink |
| `readOnly` | filesystem read-only state |
| `probe` | the write probe, below |
| `readiness` | `ready` / `degraded` / `unavailable` / `unknown` |

The verdict's order is meaning, and two states are deliberately **not**
softened to `degraded`:

- **Not mounted** is `unavailable`. Nothing is mounted there, so nothing may
  be written there.
- **Mounted from something that is not the DATA partition, or a source that is
  not a real directory,** is `unavailable`. PLAN-061 refuses symlink
  substitution by name and `mos-data-layout` dies on a symlink at those paths;
  calling a substituted namespace "degraded" would invite exactly the fallback
  the contract forbids. **No daemon falls back to another filesystem** — that
  is the whole point of naming this state.
- Read-only, a failed probe, or a `critical` DATA pool are `degraded`: the
  namespace is the right one, it just cannot be written now.
- No DATA tier to compare against is `unknown`, never `ready`. Claiming
  readiness would rest on a comparison nobody made.

### The write probe

`/mos` gets PLAN-061's probe in full: create a private `0600` file under
`/mos/updates/staging` with `O_EXCL`, fsync it, remove it, fsync the directory.
The whole sequence, not just the create — a create that never reached the
medium proves nothing about a filesystem that will be asked to hold an update
bundle across a reboot. It is removed whether or not it succeeded, so a
readiness check never leaks onto the filesystem it is vouching for, and a test
asserts the directory is empty afterwards.

Two cases produce no probe, and each says why rather than passing silently:

- **`/srv` is never probed.** It is the user-owned namespace; mosd writing a
  private file into it would put a daemon's litter in the space the product
  gives to the operator. `mos-data-layout`'s ownership table gives mosd no
  subtree of `/srv` to own, so the probe is `notAttempted` with that reason.
- **`/mos/updates/staging` absent** means `mos-data-layout` has not run. Also
  `notAttempted`, with that reason.

`notAttempted` never serializes a `passed` member at all. That is this
document's absence rule at the one place where getting it wrong would tell an
operator their update storage is fine when nobody has checked.

## 4. Media health: normalized where the device answers, `unsupported` where it does not

PLAN-049 risk #1 is that normalized health fabricates precision. Two rules
follow, and they are enforced by the shape of the JSON rather than by
convention:

**eMMC** — the mmc driver exports the JEDEC wear registers at
`/sys/block/<dev>/device/life_time` and `pre_eol_info`. `life_time` holds one
byte per estimate type (A and B), and each byte is a **10% bucket**: `0x01`
means 0–10% of rated life used, `0x0A` means 90–100%, `0x0B` means the rated
lifetime is exceeded, and `0x00` means the device does not define that
estimate at all. The surface therefore reports
`{"usedPercentMin": 20, "usedPercentMax": 30}`, **never a single "27% worn"**,
because the device does not know that number and neither does anything
downstream of it. `pre_eol_info` normalizes to `normal` / `warning` / `urgent`
/ `undefined`, where `undefined` is `0x00` — the device declining to answer,
which is not the same as healthy. The raw register strings travel beside the
normalization under `health.raw`, so support reads what the device said rather
than what this module made of it.

**NVMe and SATA** — wear lives behind SMART, and **this image ships no reader
for it**: no `smartctl`, no `nvme-cli` (see `rootfs/packages-src/system/`), and
mosd links no SMART library. So the surface answers
`{"supported": false, "reason": "SMART is not readable: this image ships no
smartctl or nvme-cli, by design"}`. That is a build decision with a name, and
naming it is the point: an empty health object reads as "fine", and a device
whose wear nobody can see must not look healthy. Shipping a reader is a
separate decision with its own image-size and attack-surface cost; when it is
taken, this field is where it becomes visible.

## 5. Low-space policy: thresholds with hysteresis

Two watched tiers, DATA and STATE — the two precious writable tiers. Watching
the DATA *tier* is what covers `/mos` and `/srv` both: they are one filesystem,
so one threshold pair governs the pool, and a second set per namespace would be
two policies over the same blocks. Four
constants in `storage_status.rs`, base policy rather than user settings,
because a device whose operator can raise its own critical threshold to 99%
has no low-space policy at all:

| | enter | clear |
|---|---|---|
| `warning` | ≥ 80% used | < 75% |
| `critical` | ≥ 90% used | < 85% |

The gap between enter and clear is the whole point. A tier sitting at 80% with
a single threshold flaps between two states on every poll and trains the
operator to ignore the signal; with the band, a tier that has entered
`warning` holds it until it falls below 75%. The previous state lives in RAM
for the life of the daemon: it exists to damp flapping between polls, not to be
a history, and a restarted daemon reaches the same steady state within one
poll.

`EPHEMERAL`/`/var` is deliberately **not** watched here. It already has its own
reporter — `mos-health` reads `df /var` on every boot against
`var-threshold-pct` in `/etc/mos/health.conf` and reports `health.var` to mosd
as `ok` or `degraded`, never fatally, because `/var` is disposable. Adding a
second threshold for the same filesystem would put two numbers in the product
that disagree about the same question.

## 6. The reserved update workspace, and why it is not a quota

`UPDATE_WORKSPACE_RESERVED_BYTES` is **256 MiB** of the DATA filesystem — the
one pool `/mos` and `/srv` share — held for update work.
It is sized against `BOARD_SIZE_BUDGET_MB` in board.env (400 on cx3576, 520 on
x64, for an image carrying one compressed rootfs slot), rounded up to the next
power of two.

**Where the artifacts live.** PLAN-061's taxonomy, which PLAN-063 keeps, puts
them under `/mos/updates`: `downloads/` for resumable partial acquisition,
`verified/` for complete authenticated artifacts awaiting RAUC, `staging/` for
bounded transaction-local work. `mos-data-layout` creates all three.

**Where it is enforced.** mos consumes DATA space for exactly one update
purpose: the bundle under `/mos/updates` that `InstallUpdate` then names. That
call is therefore the seam, and `MosdService::request_install` refuses there —
before the in-flight flag is taken, before anything is recorded, before RAUC is
touched — when the workspace is gone. Refusing early is cheaper than failing
halfway through writing a slot.

**The test is the path `/mos/updates`, not "is the bundle on DATA".** Under
PLAN-063 the whole of `/mos`, `/srv` and `/home` is one filesystem, so "on
DATA" would be true of an image an operator dropped in their home directory,
and those bytes are not the update workspace. A test drives `/srv/...`,
`/home/mos/...` and `/mos/ui/...` specifically, so this check cannot decay back
into the weaker question.

**A bundle already under `/mos/updates` counts back towards the floor.** That
is not a loophole; it is the reservation being used for the purpose it exists
for. Without it the reservation would refuse every update it was created to
make possible, because the bundle occupying the workspace would look like the
workspace being gone.

**Absent evidence never refuses.** A daemon whose storage observer sees
nothing — a dry-run daemon, a container, a board whose DATA tier could not be
resolved — has no basis on which to block an operator's update, and inventing
one would turn "absence is data" into a silent denial. This is the one place
where the surface's usual rule (absence is never silently healthy) is
deliberately inverted, because the cost of a wrong answer runs the other way.

**It is not a quota, and there is no quota system behind it.** Nothing prevents
an application from filling DATA after the check passes; nothing here counts
per-application or per-container usage; there is no enforcement in the write
path. PLAN-049 puts quotas behind "only where a product profile needs
enforcement", and no profile does yet. What exists is an admission check plus
a status surface that says how much of the reservation is intact
(`tiers[data].updateWorkspace.available`), which is the P0 half of PLAN-049's
"reservation and alerting are P0 even if quotas are phased".

## 7. Lifecycle decisions: all explicit, all currently unsupported

PLAN-049 requires each of these to be *explicitly* supported or *explicitly*
unsupported — "Unselected features remain unsupported". Every current answer
is `unsupported`, and each is served in the status body under `lifecycle` so a
client learns the answer from the device rather than inferring it from a
missing route. Promoting one is then a visible change to that list, not a
quiet new endpoint.

| Decision | Answer | Why not yet |
|---|---|---|
| `backupRestore` | unsupported | PLAN-049: a backup/export contract must be **versioned and published before it is claimed**. An unversioned dump that a later image cannot restore is worse than no backup, because the operator believed they had one. |
| `offlineRepair` | unsupported | The boot-time `systemd-fsck` pass is automatic repair; a deliberate offline repair needs a recovery environment the image does not ship, and running `fsck` on a mounted tier from a management API is a way to corrupt it. |
| `dataPreservingReplacement` | unsupported | Moving DATA to new media needs a published on-disk contract (the layout, the UID pinning in `mos-system`'s postinst, the STATE identity) and a validated procedure. Neither exists. |
| `factoryReset` | unsupported | ro-root.md §4 already records this: wiping DATA + STATE + `/var` would return the device to first boot, and **nothing implements it**. The nearest real operation is a whole-disk reflash. |
| `secureErase` | unsupported | An erase promise without device-level evidence (eMMC sanitize, NVMe format-NVM) is a promise about flash translation nobody has verified on these boards. PLAN-049 gates it behind physical-media evidence. |
| `encryption` | unsupported | DATA/STATE encryption needs a board key lifecycle — device-bound keys, escrow, recovery — and PLAN-049 makes that a gated product decision, not an implementation detail. A key that cannot be recovered turns a full disk into a dead device. |
| `removableMedia` | unsupported | USB/SD trust, mount and eject behaviour is a security decision (what does the device do when someone plugs a disk into it?) before it is a feature. Nothing auto-mounts today, and that is the safe default. |

None of these is implemented, partially or behind a flag. The list is the
contract; `every_lifecycle_decision_is_explicit_and_currently_unsupported` in
`storage_status.rs` asserts both its membership and that every answer is
still `unsupported`, so adding a storage capability without deciding its
lifecycle answer fails the build.

## 8. Testability

`storage_status.rs` follows `network_state.rs` and `time_status.rs`: a
`StorageStatusSource` trait whose default (`UnavailableStorageStatus`) inspects
nothing, so a dry-run daemon or a test never reads its host, and a production
`HostStorage` only `main.rs` attaches.

`HostStorage` takes a **path root** rather than hard-coding `/`, and its space
reader is injected. The assembly — partition label to device to mount to
medium, including the verity-slave resolution — is therefore exercised over a
fixture sysfs tree on the build host, which is where this module's bugs would
otherwise hide. `HostStorage::at(root)` has **no** space reader by default, so
a fixture tree cannot make a test shell out to `df` against the machine
running it.

`classify_readiness` is likewise pure over literal evidence, and the fixture
tree covers both the initialized layout (DATA at `/mnt/data` with both binds on
top, the probe passing and cleaning up) and the uninitialized one (no bind
sources, no probe subtree, both namespaces `unavailable`).

Everything else is a pure function over literal evidence: the mountinfo parse
(with the kernel's octal escapes), the `df` parse, the systemd unit-name
unescape (`\x2d` before `-`, or a partuuid path decodes to a device that does
not exist), the JEDEC register decode, the hysteresis band, the install
admission check and the JSON rendering.

## 9. What this does not cover

- Per-application or per-container quotas (§5).
- Any of the lifecycle operations in §6.
- SMART on NVMe/SATA, until the image ships a reader (§3).
- Trend or history of any kind: wear, space and check results are all reported
  as the instant they were observed, because that is all the device records.
- **Per-board physical-media validation.** The eMMC path is exercised against
  fixture sysfs trees, not against a real eMMC's registers on a bench board;
  the NVMe/SATA path reports `unsupported` and has no device to validate
  against at all. That validation is hardware-dependent and is escalated
  rather than claimed here.
