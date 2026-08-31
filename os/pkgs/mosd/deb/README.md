# Package producers for the mosd workspace

A **producer** is a subset of this Cargo workspace compiled and packaged on its
own. It has its own crate list, its own `CARGO_TARGET_DIR`, its own control
templates and its own archives, and it emits nothing outside that set:

| Producer | Compiles | Emits |
| --- | --- | --- |
| `mosd` | `mosd`, `apid` | `mosd`, `mos-apid` |
| `mqtt` | `mos-mqttd`, `mos-mqtt-broker` | `mos-mqttd`, `mos-mqtt-broker` |

One driver runs them all:

```
bash os/pkgs/mosd/hack/build-deb.sh --producer <name> --arch <amd64|arm64>
  -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
```

`make os-deb-mosd` and `make os-deb-mqtt` run one producer each for both
architectures. `bash os/build-env/deb/repo.sh --arch <arch>` then indexes the
pool, which is shared: a producer deletes only its own archives from it.

## Why the split

The workspace builds four binaries and the image wants them in four packages
with four different dependency stories. Building all four to package two makes
"this package's build produced that binary" a fact about the whole workspace
rather than about the package -- so a producer's independence is asserted and
not merely intended: after the compile, `build-deb.sh` fails by name if any
binary the producer does not own is present in its target directory. That is
also why the target directory is producer-private
(`os/pkgs/mosd/target-deb/<producer>/`, gitignored) rather than shared with
`os/pkgs/mosd/hack/build-target.sh`'s `target/`: a shared one would let a
four-binary build satisfy the assertion with binaries nobody asked for.

## Adding a producer

1. A case in `build-deb.sh`'s producer register naming the binaries it owns
   and the packages it emits. The set it must NOT produce is the complement of
   `ALL_BINARIES` and is computed, so it cannot fall behind.
2. `os/pkgs/mosd/deb/<producer>/Dockerfile` -- stage the payload, then one
   `pack.sh` run per package. It runs at the TARGET architecture; see the two
   routes below.
3. `os/pkgs/mosd/deb/<producer>/control/<package>.control` per package, against
   the field rules in `os/build-env/deb/README.md`.
4. A `make` target beside `os-deb-mosd`.

The unit files reach the Dockerfile through the `DIST_CONTEXTS` the register
names, because they are not all in one directory: `mosd.service` and
`apid.service` are in `dist/`, while `mos-mqttd.service` and
`mos-mqtt-broker.service` sit beside their own crates in `mqttd/dist/` and
`broker/dist/`. The `mqtt` producer therefore takes two contexts,
`mqttd-dist` and `broker-dist`, rather than one pointed at their only common
parent -- which is the workspace root, cargo target trees and all.

`copyright` is shared by every package of every producer here and is written
once, in this directory. It is installed per package as
`/usr/share/doc/<package>/copyright`, which is what keeps two packages from
owning one path.

## The two routes

The compile runs at **amd64 for both architectures**: `cargo` cross-compiles,
so it is a plain `docker run` against `localhost/mos-build-rust:amd64` with
`--target x86_64-unknown-linux-gnu` or `aarch64-unknown-linux-gnu`, and needs
no buildx and no emulation.

The packaging runs at the **target** architecture, because `dpkg-shlibdeps`
resolves an ELF's dependencies against the libraries of the container it runs
in; `os/build-env/deb/pack.sh` refuses the mismatch rather than recording
amd64's versions in an arm64 package. This host has no binfmt registration, so
`docker run --platform linux/arm64` is not a route -- it dies with `exec format
error`. `docker buildx build --platform linux/arm64` on the `mos-arm64`
docker-container builder is, because its buildkit image bundles the emulators.
That builder cannot resolve a `localhost/*` tag, so the base is handed over as
an OCI layout by `os/build-env/from.sh --contexts=`, exactly as
`os/pkgs/rauc/build.sh` does it.

`pack.sh` is not baked into `mos-build-deb`. Each producer Dockerfile takes it
through the `packer` named build context, which is what lets an edit to the
packer take effect without rebuilding the builder family.

## Version

```
<crate version>+git<commit>-1          e.g. 0.1.0+git9671c7cf2d4d-1
<crate version>+git<commit>.dirty-1    when the tree is not clean
```

`<crate version>` is read from the manifest of the producer's first binary --
never written in this tree twice -- and `<commit>` is `git rev-parse
--short=12 HEAD`. The `-1` is the Debian revision; these packages have no
upstream/downstream split, so it does not move.

## `SOURCE_DATE_EPOCH`

Derived on the host as `git log -1 --format=%ct` and passed into the packaging
stage as a build argument. `pack.sh` requires it, clamps every payload mtime to
it and hands it to `dpkg-deb`; it has no "now" default, because one would make
every archive irreproducible while every build stayed green.

A **dirty tree keeps the same commit timestamp**. The version already says
`.dirty`, so the archive is marked as one no commit reproduces; taking `now`
instead would additionally make two dirty builds of one tree differ from each
other, and that is the property worth keeping.

## Enablement is package-owned

A package that ships a unit ships the `multi-user.target.wants` symlink that
starts it, as a **file in its payload**. `mosd` owns
`/etc/systemd/system/multi-user.target.wants/mosd.service` and `mos-apid` owns
`apid.service`, matching link for link what
`os/rootfs/scripts/mosd-install.sh` creates in the image the stage chain
builds. Installing the package is what makes the daemon run.

No maintainer script is involved and nothing calls `systemctl enable` --
both control archives hold `control` and `md5sums` and nothing else. A unit
enabled by a script is enabled by something you have to run to see; a symlink
in the archive is visible to `dpkg-deb --contents` and to every gate that reads
one.

The links are **not** conffiles. They sit under `/etc`, where dpkg would
normally expect configuration a user edits and wants preserved across upgrades,
but this root filesystem is an immutable dm-verity squashfs and nothing in it is
edited. A `DEBIAN/conffiles` entry would promise a merge that cannot happen.

A package that must NOT start on its own ships no such link, and the `mqtt`
producer is that case: `mosd` renders `/run/mos/mqtt-broker.toml` and
`/run/mos/mqttd-device.env` from the settings tree and starts both units from
`mqtt.enabled`, so a symlink in either payload would start a broker nobody
asked for, before mosd has rendered anything for it to read. Both units keep
their `[Install]` section so `systemctl enable` stays meaningful on a writable
root; neither postinst calls it.

## Maintainer scripts

`mos-mqttd` and `mos-mqtt-broker` each carry a `postinst` that creates their
pinned service account (uid/gid 970 and 969), moved out of
`os/rootfs/scripts/account-mos-mqtt*.sh` into the package that owns the
account. `postinst` and not `preinst`, because no path in either payload is
owned by those accounts: they are needed when the unit starts, not when the
files are unpacked.

The rootfs scripts hard-fail when the uid already exists, which is right for a
once-per-build script and wrong for a maintainer script -- a postinst runs
again on every upgrade and reinstall. The packaged form accepts an existing
account that is exactly the pin and still fails, by name, on one held by
anybody else. `useradd`, `groupadd` and `chage` come from `passwd`, which both
packages declare in `Depends`: `dpkg-shlibdeps` cannot see a program `exec`ed
by name.

## `mosd` depends on `mos-system`

`mosd.service` declares `RequiresMountsFor=/var/lib/mos`, and that path is the
STATE bind-mount target: `var-lib-mos.mount` and the `/var/lib/mos` mountpoint
directory are two halves of one mechanism, so one package owns both. That
package is `mos-system`, built by the rootfs-composition workstream, and `mosd`
names it in `Depends` rather than shipping the directory itself.

The dependency is UNVERSIONED -- `mos-system` is not built from this
workspace's commit and pins nothing to it -- and it is declared once. `mos-apid`
inherits it through its exact-version dependency on `mosd`, and so do both MQTT
packages; no other control template mentions it.

`mos-system` is not in this pool and will not be until that workstream lands.
That is expected: it is an EXTERNAL name to these producers, the same as
`passwd`, and the gate below classifies it as one. Installing these four
packages into a clean root is therefore the composer's check and not this
directory's.

## The package gate

```
make os-debs              # every producer, both architectures, then both indexes
make os-deb-package-gate  # bash os/tests/deb-package-gate.sh
```

The gate reads the built pools and asserts, out of the archives themselves:
unique non-directory file ownership across the four packages with no `Replaces`
escape; the fields and the `Depends` closure, with every local dependency
pinned to the exact version the pool was built at; a non-empty
`/usr/share/doc/<package>/copyright` in each; the enablement asymmetry
described above -- one `multi-user.target.wants` symlink in each mosd-family
payload, none in either MQTT payload; no `DEBIAN/conffiles`; and `sh -n` over
every maintainer script, which the pipefail lint does not cover because these
are `#!/bin/sh` and never enable it.

It also rebuilds one producer per architecture and requires byte-identical
archives. That rebuild runs on a buildx builder the gate CREATES, whose cache is
empty by construction: a second build on the normal builder replays the cached
packing layer and re-exports the same bytes, which would prove the export is
deterministic and nothing at all about `pack.sh`.
