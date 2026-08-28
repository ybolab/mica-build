# RFCT-101 PLAN-012 M2: the container engine in the image, installed and inert

- **status**: completed — implementation complete, image verify 375/375, `os/ui-location-test.sh` 51/51 cases; the engine is installed, every unit masked, and the Quadlet directory is STATE-backed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-23 12:20
- **claimedAt**: 2026-08-23 12:20

PLAN-012 M2, brought forward on the user's directive to produce a first image
with podman integrated. The settings key, the reconciler and the apid pane
(M3) are **not** in this task: what ships here is the engine, present and
incapable of starting.

## What shipped

`podman`, `crun`, `netavark`, `aardvark-dns` and `catatonit` from trixie,
which carries podman 5.4.2 — the first Debian release with Quadlet (4.4+).
rootfs 210 MB → **317 MB**, against a 400 MB budget.

**Every unit podman brings is masked to `/dev/null`, not disabled**, and the
list is explicit rather than globbed because the reason differs per unit.
`podman.socket` is the one that matters: it is **socket-activated**, so
`disable` is not enough — anything that connects starts the root-run engine
behind it. `podman-kube@.service` is masked for a different reason entirely:
PLAN-002 removed Kubernetes from this project as a one-way commitment, and
that unit reintroduces a corner of it.

The Dockerfile also fails the build if podman ever ships a unit the masking
list does not name, so the list cannot silently fall behind the package.

## The premise that was wrong, and how it was caught

PLAN-012 D4 said an operator installs a container by dropping a `.container`
file into `/usr/local/lib/systemd/system` — the STATE-backed unit directory
PLAN-011 D5 shipped — so that installing a container and installing an
extension would be the same act.

`quadlet --dryrun` against the shipped binary prints its search path verbatim:

```
No files parsed from [/run/containers/systemd /etc/containers/systemd
                      /usr/share/containers/systemd]
```

**Quadlet does not read the systemd unit path at all.** Of its three
directories `/run` is tmpfs and the other two are inside the read-only verity
squashfs, so as planned there would have been **nowhere on the device to
install a container**. The failure is silent in both directions: a write to
the verity root fails, and a write to `/run` succeeds and disappears at the
next boot.

`/etc/containers/systemd` is now a STATE-backed bind
(`etc-containers-systemd.mount`, `What=/mnt/state/quadlet`), seeded by
`mos-seed-state` and enabled into `local-fs.target.wants`, on exactly the
pattern D5 established. `/usr/share/containers/systemd` stays inside the
verity root: units we ship are immutable, units the operator installs are
theirs.

This is the second time in this line of work that a plausible claim about
*which directory* turned out to be wrong on measurement — PLAN-011's
`/etc/systemd/system` bind target was the first. Both were caught by running
the thing rather than reading about it.

## Verification

**Four image assertions** in `check_container_engine`, above the fixture
boundary: the engine's six binaries and the Quadlet generator are present;
every podman unit is masked; none carries an enablement symlink; and the
Quadlet directory is a STATE-backed, enabled bind at the path Quadlet
actually reads.

**Eight negative controls** in `os/ui-location-test.sh`, each observed failing
with its own message — a missing engine binary; **the missing Quadlet
generator, separately**, because its absence is the invisible one (podman
works, `podman run` works, and `.container` files are simply never turned into
services); `podman.socket` unmasked; a podman unit enabled; the Quadlet bind
present but not enabled; no bind at all; the bind pointed at
`/usr/local/lib/systemd/system`, which is the plan's original wrong answer;
and the bind backed by `/var` instead of STATE.

**The not-enabled case is not hypothetical.** The first build of this task
installed `etc-containers-systemd.mount` and forgot its
`local-fs.target.wants` symlink. The assertion caught it on its first run,
which is why case 8e reproduces exactly that state.

Image verify **375/375**, `os/ui-location-test.sh` **51/51 cases**, RAUC
bundle rebuilt and dev-signature verified.

## Not claimed

**The engine has never been started.** Every assertion here is about a file in
an image. That podman runs a container on the cx3576 — that the kernel's
cgroup and netns configuration is sufficient in practice, that netavark brings
up a bridge, that a Quadlet unit generates and starts — is the first flash.
The kernel *config* was checked (all twenty options `=y`, PLAN-012 Risks); a
config is not a running system.

**No switch yet.** `container.enabled`, the reconciler and the apid pane are
M3. Today the engine is masked and only a manual `systemctl unmask` reaches
it, which is deliberate for an image that exists to be flashed and looked at.

**Distro packages, not the self-built static set.** PLAN-012 D1/D2 specify
building the engine from upstream source into `podman/`, and that remains the
target: it is what makes the engine base-independent and the version ours to
pin. This image takes trixie's packages because trixie has Quadlet and because
a first integrated image was wanted now. The management surface M3 builds does
not depend on which of the two supplies the binaries.
