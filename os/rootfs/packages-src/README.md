# Package producers for the root filesystem's own content

A **producer** here is a directory holding a `Dockerfile` and a `producer.env`.
The Dockerfile stages a payload and runs `os/build-env/deb/pack.sh` once per
package; `producer.env` says what comes out and for which architectures. That
pair is the whole registration -- there is no case block in the driver naming
the producers it knows:

```
bash os/rootfs/packages-src/build-deb.sh --producer-dir <dir> --arch <amd64|arm64|all>
  -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
```

`os/pkgs/mosd/hack/build-deb.sh` does keep such a register, and the difference
is not stylistic: each of its producers owns a subset of one Cargo workspace,
which is a fact about crates that only the driver can hold. The packages here
carry content the stage chain already writes into the image, so what a producer
needs to declare is its own payload -- and a file beside the Dockerfile can say
that without anything else being edited.

The pool is **shared** with `os/pkgs/mosd`'s producers. A producer deletes only
its own archives from it (`rm -f <package>_*.deb`), never the whole directory.
`bash os/build-env/deb/repo.sh --arch <arch>` then indexes it.

## `producer.env`

Plain `KEY=value` lines only -- no logic, no command substitution, no
expansion, the same discipline `os/boards/<b>/board.env` keeps. The driver
checks that shape *before* it sources the file, because sourcing is what would
run a substitution hidden in it.

| Key | Required | Meaning |
| --- | --- | --- |
| `PACKAGES` | yes | space-separated package names. The export is asserted against this list. |
| `ARCHES` | yes | space-separated subset of `amd64 arm64 all`. An `--arch` outside it is refused by name. |
| `BUILD_CONTEXTS` | no | `name=repository-relative-path ...`, passed as `--build-context`. |
| `FROM_IMAGES` | no | build-argument names for further base images, resolved through `os/build-env/from.sh`. |
| `BUILD_ARGS` | no | `KEY=VALUE ...`, passed verbatim as `--build-arg`. |

`ARCHES` is required rather than defaulted because the wrong answer is silent.
An `Architecture: all` payload built as `amd64` is a well-formed archive in
every field except the one that decides which images may install it, and
nothing downstream would report it.

An entry in `FROM_IMAGES` is the build argument the producer's Dockerfile
declares, and the `images.env` key is that name without its `MOS_` prefix --
the pairing `os/build-env/from.sh`'s other call sites write out in full
(`MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404`). Only `IMAGE_` keys: a `LOCAL_`
base is one this repository builds, and the only one a producer here stands on
is the packer, which the driver passes itself.

Every build also gets `--build-context packer=os/build-env/deb` and the
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

`0.1.0` is `MOS_ROOTFS_PKG_VERSION` at the top of `build-deb.sh`, written
**once**. The mosd producers read their number out of the crate manifest that
built the binary; nothing here is built from a manifest and there is no
upstream release to read, so the constant lives in the driver -- and in one
place only, because a second copy is a number that stops matching the first
time one of them moves.

`SOURCE_DATE_EPOCH` is `git log -1 --format=%ct`, resolved on the host and
passed in as a build argument. `pack.sh` requires it and has no "now" default:
one would make every archive irreproducible while every build stayed green. A
dirty tree keeps the commit's timestamp -- the version already says `.dirty`,
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
| `radios` | `mos-wifi`, `mos-wifi-ap`, `mos-bluetooth` | `all` |
| `board-cx3576` -- lives at `os/boards/cx3576/deb`, run through its own `render.sh` | `mos-board-cx3576` | `arm64` |

### `profile`

Each package's entire payload is `/usr/lib/mos/profile.conf` mode 0444, holding
`MOS_PROFILE=dev` or `MOS_PROFILE=prod`, plus its own
`/usr/share/doc/<package>/copyright`. The path, the mode and the bytes are the
ones `os/rootfs/scripts/profile-write.sh` writes today from
`os/rootfs/stages/10-base.Dockerfile`, trailing newline included: mosd's
comparison is case-sensitive and fails closed to `prod`, so a payload differing
by a byte would disable SSH on a dev image with every gate green.

The two `Conflicts:` each other by name and both `Provides: mos-profile`. They
are alternative renderings of one immutable file, so they are mutually
exclusive by construction and an image carries exactly one; `mos-profile` is
what a package that needs "some profile is installed" depends on. Neither
declares `Depends` -- there is no runtime relationship to declare, and there is
no ELF for a `${shlibs:Depends}` to resolve, which `os/build-env/deb/README.md`
makes an error rather than an empty expansion.

No units, no enablement symlinks, no maintainer scripts: both control archives
hold `control` and `md5sums` and nothing else.

## `copyright`

One file, shared by every producer in this directory and installed per package
as `/usr/share/doc/<package>/copyright` -- which is what keeps two packages from
owning one path. It carries the repository's own `LICENSE` text rather than
referencing Debian's `common-licenses`, because the mos image does not ship that
directory and the reference would dangle on the device.

A producer packaging Debian-sourced or vendor content does not use this file. It
records that content's own licence honestly instead.
