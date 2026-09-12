# Package producers for the root filesystem's own content

A **producer** here is a directory holding a `Dockerfile` and a `producer.env`.
The Dockerfile stages a payload and runs `build-env/deb/pack.sh` once per
package; `producer.env` says what comes out and for which architectures. That
pair is the whole registration -- there is no case block in the driver naming
the producers it knows:

```
bash build-env/deb/build.sh --producer <name> --arch <amd64|arm64|all>
  -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
```

**There is ONE driver, and it is not here.** `build-env/deb/build.sh` builds
every producer in the repository wherever it lives, and
`build-env/deb/README.md` is the contract it implements. The producers in
this directory once had a driver of their own; it was retired into that one and
its refusals went with it. What follows is what is specific to THESE producers:
what a producer declares, and what each of the four emits.

The pool is **shared** with `pkgs/mosd`'s producers. A producer deletes only
its own archives from it (`rm -f <package>_*.deb`), never the whole directory.
`bash build-env/deb/repo.sh --arch <arch>` then indexes it.

## `producer.env`

Plain `KEY=value` lines only -- no logic, no command substitution, no
expansion, the same discipline `boards/<b>/board.env` keeps. The driver
checks that shape *before* it sources the file, because sourcing is what would
run a substitution hidden in it.

| Key | Required | Meaning |
| --- | --- | --- |
| `PACKAGES` | yes | space-separated package names. The export is asserted against this list. |
| `ARCHES` | yes | space-separated subset of `amd64 arm64 all`. An `--arch` outside it is refused by name. |
| `ENABLEMENT` | yes | `package=count ...`, one entry per package. Asserted against the built archive. |
| `BUILD_CONTEXTS` | no | `name=repository-relative-path ...`, passed as `--build-context`. |
| `FROM_IMAGES` | no | `<build-arg name>=<images.env key> ...` for further base images, resolved through `build-env/from.sh`. |
| `BUILD_ARGS` | no | `KEY=VALUE ...`, passed verbatim as `--build-arg`. |
| `PREPARE` | no | a script beside this file, run on the host before the build; what it stages becomes the `bin` context. |
| `PREFLIGHT` | no | `1` if that hook honours `MOS_DEB_PREFLIGHT=1` and can report its inputs without producing them. See below. |

`ARCHES` is required rather than defaulted because the wrong answer is silent.
An `Architecture: all` payload built as `amd64` is a well-formed archive in
every field except the one that decides which images may install it, and
nothing downstream would report it.

An entry in `FROM_IMAGES` is a **pair**: the build argument the producer's
Dockerfile declares, then the `images.env` key that pins it, exactly as
`build-env/from.sh`'s other call sites write it and handed to that script
unchanged.

```
FROM_IMAGES="MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE"
```

Both halves are written out rather than one being derived from the other by
stripping a prefix. A derivation would make the Dockerfile's `ARG` name a
consequence of arithmetic in the driver, so a reader of either half would have
to go there to learn what feeds the other -- which is the reason `from.sh`'s own
header gives for taking the pair at every one of its call sites. A bare name is
refused by name. Which keys are legal is `from.sh`'s decision and is not
restated here: it takes an `IMAGE_` or a `LOCAL_` key and names anything else.

## `ENABLEMENT`

How many symlinks under `/etc/systemd/system/multi-user.target.wants/` each
package's payload carries, one entry per package:

```
ENABLEMENT="mos-wifi=0 mos-wifi-ap=0 mos-bluetooth=1"
```

The counting rule is narrow, and both halves of it matter:

- **Symlinks only.** A regular file with the right name under that directory
  starts nothing, so it is not enablement.
- **That one directory.** A link under `local-fs.target.wants` or
  `timers.target.wants` is not counted. `mos-system` ships fifteen of the first
  and one of the second and declares `mos-system=6`; `mos-wifi`, `mos-wifi-ap`
  and `mos-board-x64` each ship one `local-fs` link and declare `0`. Those links
  are ordinary payload, and it is the byte-for-byte payload checks that speak
  about them.

**A zero is written, never omitted.** The field is required for every package a
producer emits, and a missing package is a hard failure by name. To a reader
"enables nothing" and "nobody counted" look the same in an absent field; to a
check they are opposites, because a package with no entry can acquire or lose a
wants-symlink with every gate green. That refusal is the whole value of the
field.

`build-env/deb/package-gate.sh` asserts the declared count against the archives,
per package and per producer, reading `dpkg-deb --contents` in the packer
container -- the host carries no dpkg, and the **host** architecture's image is
used because listing an archive parses it rather than executing it. A producer
whose declaration disagrees with its own output fails by name. That count lives
in the gate and NOT also in the driver: two implementations of one rule agree
until one of them is edited.

Enablement is always **files this package owns**: the exact wants-symlinks the
image creates today, shipped in the payload. There is no preset mechanism and no
`postinst systemctl enable` -- the root is sealed read-only before the device
ever boots.

## `PREPARE`

The one step a producer may run on the **host**, before the build. It exists for
inputs that a build context cannot name: `BUILD_CONTEXTS` entries are fixed
repository-relative paths, because `producer.env` never expands a variable, so a
producer whose inputs are selected at run time or produced by a script that must
run where the repository is has nowhere to put them.

The value is a file name beside the `producer.env` that declares it -- a path is
refused, since a producer reaching out of its own directory would be running a
script it does not own. The driver runs it with seven variables exported:

| Variable | Value |
| --- | --- |
| `MOS_DEB_REPO_ROOT` | the repository root |
| `MOS_DEB_PRODUCER` | the producer's name, which is its directory's basename |
| `MOS_DEB_PRODUCER_DIR` | that directory, absolute |
| `MOS_DEB_ARCH` | the `--arch` this build was asked for |
| `MOS_DEB_STAGE` | the directory to stage into, created empty |
| `MOS_DEB_VERSION` | the version the archive will carry |
| `SOURCE_DATE_EPOCH` | the commit timestamp every payload mtime is set to |

**What the hook leaves in `${MOS_DEB_STAGE}` arrives in the build as the `bin`
context.** The driver creates that directory empty on every run -- so a file the
hook stops staging cannot be covered by the previous run's copy of it -- and
**refuses by name a hook that leaves it empty**: an empty `bin` would reach the
first `COPY --from=bin` against nothing and either fail there or, worse, pack a
payload with the hook's material silently missing.

It runs above the builder selection, which is the last point at which nothing
has started: `docker buildx create`/`inspect` bootstraps a buildkit container
and `from.sh --contexts` writes OCI layouts. That ordering is what lets a hook
whose job is to refuse a missing input say "nothing was staged and no container
was started" and have it be true.

`board-cx3576` is the only producer here that uses it, and needs all three
properties: its BSP artifacts are selected by `BOARD_DIR`, it invokes
`pkgs/rauc/render-config.sh` rather than reimplementing it, and it refuses a
missing BSP input before anything is built.

## `PREFLIGHT`

A hook's inputs are the ones no key above can name, so they are also the ones
`build-env/deb/preflight.sh` cannot check for itself. `PREFLIGHT="1"` says
the hook can be **asked** instead: run with `MOS_DEB_PREFLIGHT=1` it reports
what is missing and produces nothing, so a missing input is listed beside every
other producer's before `make os-debs` starts a container.

It is opt-in per producer rather than automatic, because a hook that has not
been taught the variable would do its full work: the podman hook compiles a
container engine, three quarters of an hour of it under emulation for arm64. A
pre-flight that compiles is not a pre-flight.

In that mode the hook gets `MOS_DEB_REPO_ROOT`, `MOS_DEB_PRODUCER`,
`MOS_DEB_PRODUCER_DIR`, `MOS_DEB_ARCH` and `MOS_DEB_PREFLIGHT=1`, and **no
`MOS_DEB_STAGE`** -- there is nothing to stage into, and a hook that wrote
anywhere in this mode would be writing before the operator had been told what is
missing.

It must print three counts on **both** paths, and exit non-zero when
`preflight-missing` is not zero:

| Line | Meaning |
| --- | --- |
| `preflight-examined: <n>` | what this hook looked at. Must be above zero. |
| `preflight-missing: <n>` | of those, what **nothing in the run produces**. The run is refused. |
| `preflight-warned: <n>` | of those, what **this producer makes itself**, at a cost the report names. The run continues. |

The line between the two categories is what the run would DO about it, not how
serious it looks. An absent container engine warns, because the podman hook
builds one; an engine compiled from a superseded `versions.env` is missing,
because the hook refuses it. Refusing the first would mean `make os-debs` could
no longer build a pool on a fresh host, which is how a pool comes to exist.

All three are required and a zero is written rather than omitted, for the same
reason `ENABLEMENT` writes its zeros: an omission and a deliberate zero read the
same to a person and opposite to a check. `preflight.sh` refuses a hook that
breaks any of the three, and `tests/deb-preflight-test.sh` drives each
refusal by mutating the hook until the run goes red.

Every build also gets `--build-context packer=build-env/deb` and the
`MOS_DEB_VERSION`, `MOS_DEB_ARCH` and `SOURCE_DATE_EPOCH` build arguments,
without any producer asking. `pack.sh` is not baked into `mos-build-deb`; it
arrives as that named context, which is what lets an edit to the packer take
effect without rebuilding the builder family.

## Version

```
0.1.0+git<commit>-1          e.g. 0.1.0+git9671c7cf2d4d-1
0.1.0+git<commit>.dirty-1    when the tree is not clean
```

`<commit>` is `git rev-parse --short=12 HEAD`, and the `-1` is the Debian
revision: these packages have no upstream/downstream split, so it does not
move.

`0.1.0` comes from `build-env/deb/version.sh`, which reads it out of the
mosd workspace's crate manifests and is the ONE version the whole shared pool
carries. Nothing here is built from a manifest and there is no upstream release
to read, so these packages take the pool's number rather than declaring one --
and it is written in exactly one place, because a second copy is a number that
stops matching the first time one of them moves.

`SOURCE_DATE_EPOCH` is `git log -1 --format=%ct`, resolved on the host and
passed in as a build argument. `pack.sh` requires it and has no "now" default:
one would make every archive irreproducible while every build stayed green, and
every payload mtime is **set** to it rather than clamped to it -- the ruling is
at the decision site in `pack.sh`. A dirty tree keeps the commit's timestamp -- the version already says `.dirty`,
and taking `now` would additionally make two dirty builds of one tree differ
from each other.

## `--arch all` packs natively and lands in both pools

`all` has no ELF, so `pack.sh` exempts it from the `dpkg --print-architecture`
match. The build therefore runs at the **host** architecture: packing it under
emulation would spend minutes of qemu to produce identical bytes, and on a host
with no binfmt registration it would need a `mos-<arch>` docker-container
builder created for nothing. The driver selects no emulated builder for `all`.

There is no architecture-neutral pool. `repo.sh` accepts an archive in a pool
when its declared `Architecture` matches that pool **or** is `all`, so one
`all` build is exported into `_out/debs/amd64/pool` *and*
`_out/debs/arm64/pool` -- one build, two `-o type=local` exports of the same
stage. Each pool is then complete for the composer that reads it, which is the
property that matters: a composer resolving the amd64 package set must not have
to know that one of its packages was filed under arm64.

## Producers

| Producer | Emits | Architecture |
| --- | --- | --- |
| `profile` | `mos-profile-dev`, `mos-profile-prod` | `all` |
| `system` | `mos-system` | `all` |
| `wifi` | `mos-wifi`, `mos-wifi-ap` | `all` |
| `bluetooth` | `mos-bluetooth` | `all` |
| `ca-trust` | `mos-ca-trust` | `all` |
| `busybox` | `mos-busybox` | `amd64 arm64` |
| `board-x64` (`boards/x64/deb/board-x64`) | `mos-board-x64` | `amd64` |
| `board-cx3576` (`boards/cx3576/deb/board-cx3576`) -- stages its BSP inputs through `PREPARE` | `mos-board-cx3576` | `arm64` |

### `profile`

Each package's entire payload is `/usr/lib/mos/profile.conf` mode 0444, holding
`MOS_PROFILE=dev` or `MOS_PROFILE=prod`, plus its own
`/usr/share/doc/<package>/copyright`. The path, the mode and the bytes are the
ones the retired stage chain wrote, trailing newline included: mosd's
comparison is case-sensitive and fails closed to `prod`, so a payload differing
by a byte would disable SSH on a dev image with every gate green.

The two `Conflicts:` each other by name and both `Provides: mos-profile`. They
are alternative renderings of one immutable file, so they are mutually
exclusive by construction and an image carries exactly one; `mos-profile` is
what a package that needs "some profile is installed" depends on. Neither
declares `Depends` -- there is no runtime relationship to declare, and there is
no ELF for a `${shlibs:Depends}` to resolve, which `build-env/deb/README.md`
makes an error rather than an empty expansion.

No units, no enablement symlinks, no maintainer scripts: both control archives
hold `control` and `md5sums` and nothing else.

### `ca-trust`

The TLS trust store as data: `/etc/ssl/certs/ca-certificates.crt`, the ~150
individual anchors under `/usr/share/ca-certificates`, the ~300 hash symlinks
that index them and `/etc/ca-certificates.conf` -- the three paths the retired
stage chain copied out of its own `certs` stage.

This is the one producer here whose payload is **generated rather than
written**, so its Dockerfile has two stages. The first is `FROM` the pinned
Debian trixie base -- named in `FROM_IMAGES` and resolved through
`build-env/from.sh`, never a floating tag, because that tag would decide
which certificate authorities the fleet believes -- and runs
`rootfs/scripts/ca-certificates-generate.sh` itself, arriving as the
`scripts` build context. Running the repository's own script rather than
restating its five lines is what keeps "what is generated today" from having
two definitions. The second stage copies the result into the staged root and
packs it.

`ca-certificates` is *not* what the image installs, and that is the point. It
`Depends` on `openssl` -- 2.5 MB of CLI nothing on the device uses, since
apid's TLS is rustls -- and it ships `/usr/bin/c_rehash`, a Perl script the
package-manager purge's dangling-interpreter check rejects once perl is gone.
The store is wanted; the package that builds it is not. The producer asserts
that neither, nor `update-ca-certificates`, is anywhere in the payload.

`COPY` does not dereference, so the hash farm arrives **as symlinks**. They are
the lookup mechanism, and a dereferenced copy would both double the payload and
leave `dpkg-deb --contents` describing something other than what is installed.
The producer resolves every link against the staged root before packing, which
is the assertion the retired chain's `ca-certificates-verify.sh` made about the
tree its `certs` stage handed over.

`.mos-cert-count` is read and dropped. It is a build-time token, written so the
receiving stage can detect a `COPY` that truncated the bundle; it is read and
`rm -f`ed in the same breath -- it
has never been in a shipped root, and `verify`'s `ca-bundle-generated` check
counts `BEGIN CERTIFICATE` lines directly rather than reading it. Here it is
spent on the one copy it can still speak about and then deleted;
`DEBIAN/md5sums` is a stronger statement about arrival than a count.

`/etc/ca-certificates.conf` is ordinary payload and not a conffile, for the
reason no package here declares one: the root is an immutable dm-verity
squashfs, and a `conffiles` entry would promise dpkg a merge that cannot
happen. No `Depends`, no maintainer scripts, no enablement links.

### `busybox`

One file: `/usr/bin/busybox`, Debian's own binary for the target architecture,
plus its `copyright`. `amd64 arm64` and not `all` because that binary is an
ELF -- the only producer in this directory with one -- so `dpkg-shlibdeps`
resolves its libc against the architecture it will run on and the harvest stage
runs at the target platform.

The archive is `apt-get download`ed and `dpkg-deb -x`ed, never installed, and
that is the producer's whole reason to exist rather than a `Depends: busybox`.
Debian's package also ships `/usr/share/initramfs-tools/hooks/zz-busybox`, which
copies the binary into the initramfs and hard-links every applet name beside it,
and the `conf-hooks.d` fragment that turns the hook on. On x64 the kernel
package's postinst runs `update-initramfs` during the compose, so a dependency
would have produced an initrd holding busybox and 270-odd applet links -- the two
things RFCT-281 exists to prevent -- as a side effect nobody would have read.
Unpacking runs no maintainer script and installs no trigger, so what lands is
exactly what the Dockerfile names.

The build asserts what it took: the archive ships no link of its own, the binary
names an `ld-linux` interpreter and RUNS (it is executed at the target
architecture and asked for its applet list), and the staged tree is exactly two
files with no symlink and no hard link. `verify`'s busybox family makes the
image-side half of the same statement, and `rootfs/scripts/pack-export-boot.sh`
makes it about the initrd that ships.

The copyright is composed and does not use the shared file below: the payload is
GPL-2 and mos wrote none of it. busybox's own `copyright` is reproduced verbatim,
the `/usr/share/common-licenses/GPL-2` it points at is appended after it -- the
image does not ship that directory, and the ruling `ca-trust` records applies:
a licence's text is not rewritten to make a pointer resolve -- and the header
names the exact upstream version the binary was taken from, because the package
version carries the pool's git stamp and a source request needs to know which
busybox.

## `copyright`

One file, shared by every producer in this directory and installed per package
as `/usr/share/doc/<package>/copyright` -- which is what keeps two packages from
owning one path. It carries the repository's own `LICENSE` text rather than
referencing Debian's `common-licenses`, because the mos image does not ship that
directory and the reference would dangle on the device.

A producer packaging Debian-sourced or vendor content does not use this file. It
records that content's own licence honestly instead. `ca-trust` is the case
where both are true at once: the anchors are Debian's and the doc directory is
this repository's, so it lifts the `License: Apache-2.0` stanza out of this
file, scopes it to `/usr/share/doc/mos-ca-trust/*`, and appends
`/usr/share/doc/ca-certificates/copyright` verbatim, harvested in the
generation stage from the package that shipped the certificates. ~150 anchors
under GPL-2+ and MPL-2.0 are not something this repository can restate
correctly, and a hand-written summary of them would be wrong in a way nobody
would notice until it mattered.
