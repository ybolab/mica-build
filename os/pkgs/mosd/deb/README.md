# Package producers for the mosd workspace

A **producer** is a subset of this Cargo workspace compiled and packaged on its
own. It has its own crate list, its own `CARGO_TARGET_DIR`, its own control
templates and its own archives, and it emits nothing outside that set:

| Producer | Compiles | Emits |
| --- | --- | --- |
| `mosd` | `mosd`, `apid` | `mosd`, `mos-apid` |

One driver runs them all:

```
bash os/pkgs/mosd/hack/build-deb.sh --producer <name> --arch <amd64|arm64>
  -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
```

`make os-deb-mosd` runs the `mosd` producer for both architectures.
`bash os/build-env/deb/repo.sh --arch <arch>` then indexes the pool.

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

A package that must NOT start on its own ships no such link -- the MQTT
packages are the case: `mosd` owns their lifecycle at runtime and turns them on
through settings, so shipping them enabled would start a broker nobody asked
for.
