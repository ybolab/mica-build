# File deployment lifecycle

MOS installs independently signed kernel/support and root components. The
native backend is `mos-deploy`; `mosd` exposes its state and actions through
D-Bus, and `apid` preserves the existing authenticated API/CSRF boundary. Current
formats are strict; no prior slot, package, trust or settings schema is read.
RAUC is removed. No lode dependency participates in OS update acquisition,
installation, boot selection or health confirmation. Lode was referenced in
earlier configuration-model planning; it is not the deployment backend.

## State and identity

`GET /api/v1/update` reports the authenticated `boot`, reconciled `state`,
`deployments`, `rollback`, `install`, `last_action` and acquisition `lifecycle`.

| Field | Meaning |
|---|---|
| `boot.deploymentId`, `kernelId`, `rootfsId` | Authenticated running deployment and components |
| `boot.contentVerified`, `boot.bootVerified`, `boot.secureBoot` | Separate observations of content and platform boot verification |
| `state.current` | Confirmed deployment |
| `state.fallback` | Retained usable deployment |
| `state.candidate` | Activated deployment awaiting confirmation |
| `state.failed` | Failed deployment IDs enforced by the native backend |
| `state.highestGeneration` | Monotonic installation floor |
| `deployments` | Authenticated version/generation/component identities and remaining trials |
| `rollback` | Atomic backend verdict: permitted, target and refusal reason |

Acquisition proceeds through checking, downloading, ready and installing, with
explicit unavailable/failure states. Boot observations distinguish validation,
confirmation, a pending reboot and fallback. The API does not infer installed
content from untrusted root metadata or an editable version label.

## Acquisition and installation

The catalog source is an explicit `/v1/manifest.json` URL. Its signed
`mos/catalog/v1` envelope binds deployment associations and origin/digest object
URLs. The client enforces validity intervals, revisions and content consistency;
clock uncertainty can defer acquisition without blocking installed offline boot.

Files live under `/mos/updates/{staging,downloads,verified}` on physical DATA.
The workspace probe checks mount identity, writability, free space and bounded
contents. HTTP ranges resume partial objects; complete bytes and lengths must
match authenticated metadata. `MOSUPD01` offline imports carry the same signed
deployment and at most five unique objects, with no archive paths or links.

The installer authenticates the descriptor and current boot policy, computes
space for missing objects, and preserves current/fallback references. Object
publication uses temporary files, exact digest checks, file sync and directory
sync. The boot entry becomes visible last. The DATA state file is reconciled
against durable native entries after an interruption; confirmation cannot prune
an already activated candidate merely because a later state write failed.

Root-only updates reuse kernel/support objects. Kernel-only updates reuse the
root object. Combined updates publish both. Normal OS installation never writes
firmware loader ranges or enrolls keys.

## Confirmation, failure and rollback

UEFI uses signed shared UKIs and systemd-boot Type #1 entries with native trial
counts. The pinned loader patch refuses launch when decrement persistence fails
and excludes exhausted entries. cx3576 uses signed FITs and the redundant strict
record policy described in [the boot contract](uboot-ab-handshake.md).

Each candidate has three attempts. The boot health service confirms only the
authenticated running deployment after required services and policy checks pass.
Known confirmed metadata/health failures retire that record when a usable
fallback exists. Shared SYSTEM/DATA failures stop for explicit recovery. No path
refills exhausted counters or falls back to unsigned content.

`POST /api/v1/update/install` accepts a verified `deploymentId`.
`/confirm` and `/reject` also take a deployment ID. `/rollback` atomically checks
that running content is confirmed, no candidate is pending and a usable fallback
exists. It reports the target and the separate reboot action. Reasons are
`candidate_pending`, `running_not_confirmed` and `no_usable_fallback`.

Failed IDs and the generation floor enforce suppression across rollback and
source changes. A corrected release needs a newly signed higher generation;
there is no UI action that clears those installation constraints.

## Policy and reboot

Public `/mos/config/updates.json` settings overlay factory defaults for source,
channel, mode, allowed network, schedule and reboot policy. They cannot inject
metadata keys. Automatic checks/fetches use the same native acquisition path.
The reboot gate retains maintenance-window, health, active-install and override
checks; an override does not interrupt an installation.

Storage reports one DATA capacity and the state/meta/bulk/disposable accounting.
Garbage collection authenticates every retained descriptor before deleting
unreferenced objects or interrupted staging. Directory reset shares the native
transaction lock and preserves deployment records and identity.

## Acceptance

QEMU full systems exercise root-only, kernel-only and combined updates,
three failed health trials, retained fallback, acquisition, native services,
identity and complete shutdown. Deterministic native fault injection covers
install, confirmation and GC on both boot backends. Firmware signing and
maintenance have separate [trust evidence](release-signing.md).

The [delivery record](../task/20260908-2229-file-ab-delivery-x64-first.md)
identifies exact current runs and unresolved gates, including physical cx3576 watchdog/power-cut tests. Process interruption and
VM shutdown cannot establish physical eMMC power-loss durability.
