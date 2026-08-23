# RFCT-102 Make the container engine actually usable: storage off the wipeable partition, a board switch, and a build that runs it

- **status**: implementation complete — image verify 376/376, `os/ui-location-test.sh` 54/54 cases, `check.sh` 506/506
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-23 14:20
- **claimedAt**: 2026-08-23 14:20

RFCT-101 put the engine in the image and proved, by assertion, that every file
was where it should be. This task asks the next question: **does it work, and
can a board decline it?**

## The engine is EXERCISED at build time, not merely installed

A `RUN` in the rootfs stage executes the shipped aarch64 binaries under the
builder's emulation — the only place before a real flash where the engine can
be made to do its job. It reports `podman version 5.4.2`, feeds Quadlet a real
`.container` file, and asserts three separate things about the result: that a
unit was generated at all, that its `ExecStart` invokes podman, and that it
names the image the file asked for. Three, because "the generator produced
something" and "the generator produced something useful" are different claims.

Everything RFCT-101 asserted was about a file. This is the first evidence the
engine runs.

## Image storage was pointed at a partition that is wiped by design

podman ships no `storage.conf` and falls back to
`/var/lib/containers/storage`. On this appliance `/var` is EPHEMERAL: 512 MiB,
and destroyed on purpose. Every pulled image would be both size-capped and
scheduled for deletion — **and nothing would report it**. Containers work,
then one day the partition resets and the images are gone.

`os/rootfs/overlay-v2/etc/containers/storage.conf` puts the graph root on
`/srv/containers/storage`, DATA being the only growable partition and the one
that survives an A/B update. `runroot` stays on tmpfs deliberately: it holds
per-boot state, and putting it on flash would write to eMMC on every container
start and leave stale state after an unclean shutdown.

An assertion holds it, and it discriminates: `/srv/*` passes, `/var/*` fails
with the EPHEMERAL reasoning, and anything else fails as unrecognised rather
than being waved through.

## `WITH_CONTAINERS`, a board-level switch that was proven to switch

`board/<name>/containers.env` decides whether the engine is in the image at
all; absent means on, which is the cx3576 default the user asked for. An
explicit `WITH_CONTAINERS` in the environment beats the board file.

**Measured in both directions**, because a switch nobody has seen in its other
position is not a switch:

| | rootfs installed |
|---|---|
| `WITH_CONTAINERS=1` (cx3576) | **317 MB** |
| `WITH_CONTAINERS=0` | **210 MB** |

This is the BUILD-time switch — is the engine present. The RUN-time switch,
`container.enabled` driven from apid, is PLAN-012 M3 and is a different
question: whether an engine that IS present may be used.

**The verifier declares an engine-less image by identity** rather than letting
the engine assertions pass vacuously. An image with no engine and an image
whose engine failed to install look identical to every one of those
assertions; case 8k drives exactly that and requires the declaration.

## Verification

Three new image assertions (storage location, and the engine-absent
declaration) on top of RFCT-101's four. **Eleven negative controls** in
`os/ui-location-test.sh`, each observed failing with its own message —
including the two added here: no `storage.conf` at all, and a graph root
pointed at `/var`.

Two registry collisions surfaced while wiring them: several assertions shared
pass/fail substrings and one message matched two identities. Each was given a
token unique to its own slot, since a message matching two names makes the
identity diff meaningless — which is the property the whole harness rests on.

Image verify **376/376**, `os/ui-location-test.sh` **54/54 cases**, `check.sh`
**506/506**, `docs-verify` **336/336**.

## Not claimed

**No container has been started.** The build-time probe proves podman runs and
Quadlet generates; it does not prove a container starts, which needs cgroups
and namespaces the build sandbox does not have. That is the first flash's job.

**The engine is still masked.** All seven podman units remain masked to
`/dev/null` from RFCT-101. Reaching the engine today needs a manual
`systemctl unmask`; the settings-tree switch is M3.

**Still trixie's packages, not the self-built engine.** `os/podman/` — the
from-source build that makes the engine's VERSION a decision in this
repository rather than a consequence of the base — is a separate, unfinished
piece of work and is deliberately not in this commit.
