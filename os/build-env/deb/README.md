# `mos-build-deb` -- the Debian package substrate

Five things live here, and together they are the contract every package
producer in this repository is written against:

| File | Runs | Produces |
| --- | --- | --- |
| `Dockerfile` | `make build-env` | `localhost/mos-build-deb:<arch>` |
| `pack.sh` | inside that image, at the **target** architecture | one `.deb` |
| `repo.sh` | on the host | `Packages`, `SHA256SUMS`, `manifest.txt` |
| `producers.sh` | on the host | the producer set, discovered from the tree |
| `version.sh` | on the host | the one version the whole pool carries |

The image carries `dpkg-dev` and no compiler. What a package contains is
produced by the pinned language builders (`mos-build-c`, `mos-build-go`,
`mos-build-rust`); this image only wraps an already-staged tree. It records
what it resolved in `/etc/mos-build/deb.env`, which is how a producer answers
"what packaged this".

## The producer convention

A **producer** is one directory. Everything that knows about producers --
`make os-debs`, `make os-deb-<producer>` and `os/tests/deb-package-gate.sh` --
discovers them from the tree, so adding one is adding files and editing nothing:

```
os/pkgs/<component>/deb/<producer>/
  Dockerfile                     stage the payload, then one pack.sh run per package
  control/<package>.control      one per package the producer emits
  enablement                     one `<package> <count>` line per package
os/pkgs/<component>/hack/build-deb.sh
                                 the driver, run as
                                 --producer <producer> --arch <amd64|arm64>
```

| Read off | By |
| --- | --- |
| `<component>`, `<producer>` | the path |
| the package names | the `Package:` field of each `control/*.control` |
| the driver | `os/pkgs/<component>/hack/build-deb.sh` |

Discovery is `os/pkgs/*/deb/*/`, and every directory it finds must hold at
least one `control/*.control` and have a driver. Both are refused **by name**:
a producer directory with no control template declares no package, so it would
build nothing, contribute nothing to the expected package set and be absent
from every check -- invisible rather than refused. That is also why discovery
enumerates producer *directories* and not `control/*.control` files directly.

Adding a producer therefore takes no edit to the `Makefile` and none to the
gate. `make os-deb-<producer>` is a pattern rule resolved against
`producers.sh`; `make os-debs` loops over it; the gate reads the same list.

### `enablement` -- what the archive cannot tell you

The gate checks that each package ships exactly the
`/etc/systemd/system/multi-user.target.wants` symlinks it is supposed to. That
expectation cannot come from the archive, because the symlink **is** the fact
under test -- deriving it from the payload would assert that whatever shipped is
what was meant. So each producer states it, beside its control templates:

```text
# os/pkgs/mosd/deb/mosd/enablement
mosd 1
mos-apid 1
```

One line per package the producer emits, `<package> <count>`; `#` starts a
comment. Every package needs a line, and a package that ships no link writes
`0` rather than being left out -- an omission and a deliberate zero look
identical, and only one of them is a decision. A producer with no `enablement`
file at all is a hard failure naming the producer, not a silently empty
expectation.

## `producers.sh`

```
bash os/build-env/deb/producers.sh
  mosd mosd os/pkgs/mosd/hack/build-deb.sh
  mosd mqtt os/pkgs/mosd/hack/build-deb.sh

bash os/build-env/deb/producers.sh --driver-for mqtt
  os/pkgs/mosd/hack/build-deb.sh
```

Three space-separated fields, sorted: `<component> <producer> <driver>`, the
driver repository-relative. `--driver-for` resolves one producer name, refusing
an unknown one and an ambiguous one -- two components may each hold a producer
of one name, and `make os-deb-<that name>` cannot say which was meant.

**This is the only place the layout is written down.** The Makefile and the gate
both read it and neither globs for itself: two implementations of the glob would
let `make os-debs` and the gate disagree about what exists, and the one that had
not been taught about a producer would report green over it.

An empty discovery is a **hard failure**, the way an empty pool is one for
`repo.sh`. `make os-debs` over no producers builds nothing and reports success;
the gate over no producers asserts nothing and reports success. Both green,
both having done nothing.

## `version.sh`

```
bash os/build-env/deb/version.sh
  0.1.0+git9671c7cf2d4d-1          a clean tree
  0.1.0+git9671c7cf2d4d.dirty-1    a tree with uncommitted changes
```

One version across the whole pool, in one implementation. The producers that
share that pool have nothing else in common -- the mosd ones are Rust and carry
crate manifests, others are neither and carry none -- so a rule each producer
implemented for itself would be a rule they agree on until one of them is
edited. `os/pkgs/mosd/hack/build-deb.sh` calls this script rather than composing
the string itself.

The number comes from the mosd workspace's crate manifests, which is where it
already lived: `0.1.0` is written in the crates and must not be written a second
time. They must all **agree**; a workspace declaring two versions has no single
answer to give a pool that carries one, and the script names both crates rather
than picking. `<commit>` is `git rev-parse --short=12 HEAD`, `.dirty` marks a
tree no commit reproduces, and the `-1` is the Debian revision, which does not
move because these packages have no upstream/downstream split.

`SOURCE_DATE_EPOCH` is **not** here; it stays with each driver, which resolves it
as that commit's timestamp on the host. See the section below for why `pack.sh`
has no default for it.

## `pack.sh`

```
pack.sh --root <staged-tree-dir> --control <control-template> \
        --version <version> --arch <amd64|arm64|all> --out <dir> \
        [--maintainer-scripts <dir>]
```

| Flag | Meaning |
| --- | --- |
| `--root` | the staged filesystem tree, exactly as it is to be installed. Must not contain a `DEBIAN` directory -- the packer owns that one. |
| `--control` | the control template. Rendered, never copied verbatim. |
| `--version` | the Debian version; replaces `@VERSION@`. |
| `--arch` | `amd64`, `arm64` or `all`; replaces `@ARCH@`. |
| `--out` | where the archive is written, as `<package>_<version>_<arch>.deb`. Created if absent. |
| `--maintainer-scripts` | a directory holding any of `preinst`, `postinst`, `prerm`, `postrm`. Any other filename is refused by name. Installed into `DEBIAN/` mode 0755. |

It runs **inside the target architecture's image**, invoked from a producer
Dockerfile's `RUN`, never from the host. `dpkg-shlibdeps` resolves an ELF's
dependencies against the libraries installed next to it, so an `arm64` payload
packed in an `amd64` container would silently record `amd64`'s versions;
`pack.sh` compares `--arch` against `dpkg --print-architecture` and refuses.
`--arch all` is exempt, having no ELF to resolve.

Producers get the script through a named build context rather than from the
image, so an edit here takes effect without rebuilding the builder family:

```dockerfile
COPY --from=packer pack.sh /usr/local/bin/pack.sh
```

```
docker buildx build --build-context packer=os/build-env/deb ...
```

### `SOURCE_DATE_EPOCH`

Required in the environment; `pack.sh` fails by name if it is unset. There is
no "now" default, because one would make every archive irreproducible while
every build stayed green.

It is a **clamp**, not an assignment: a payload file newer than the epoch is
moved back to it, one older keeps its own mtime. Ownership is normalised to
`root:root` and the archive is built with `dpkg-deb --build --root-owner-group`.

### The control template

| Field | Required | Notes |
| --- | --- | --- |
| `Package` | yes | lowercase name; the archive is named after it |
| `Version` | yes | must contain `@VERSION@` |
| `Architecture` | yes | must contain `@ARCH@` |
| `Maintainer` | yes | |
| `Section` | yes | |
| `Priority` | yes | |
| `Depends` | no | omit it for a package with no dependencies |
| `Description` | yes | synopsis plus indented continuation lines |
| `Installed-Size` | **must be absent** | computed by the packer |

Two substitutions happen:

- `@VERSION@` and `@ARCH@`, everywhere in the template;
- `${shlibs:Depends}`, wherever it appears in `Depends:`, with the output of
  `dpkg-shlibdeps` over every ELF executable and shared object found under
  `--root`. The payloads are found with `file`, not from a list, so a binary
  added to the staged tree cannot escape the scan. A template that asks for
  `${shlibs:Depends}` and stages no ELF -- or whose ELFs resolve to nothing --
  is an error, not an empty expansion.

Dependencies that ELF metadata cannot show -- a program `exec`ed by name, a
library opened with `dlopen`, a `systemd` or `nftables` relationship -- stay
written out in the template. `dpkg-shlibdeps` cannot see them.

`Installed-Size` is computed over the payload by the rule `dpkg-gencontrol`
applies: a file or symlink costs `ceil(bytes / 1024)` KiB, every other object
costs one, and `DEBIAN/` is excluded because it is not installed.

`DEBIAN/md5sums` is generated over every regular file in the payload, with
relative paths and no leading `./`.

### What it asserts about the archive it just wrote

`pack.sh` reads the finished `.deb` back with `dpkg-deb` and fails unless:

- `Package`, `Version`, `Architecture` and `Installed-Size` are the values it
  was asked for and computed;
- `Depends` carries no unexpanded `${...}`;
- every path in the payload is owned `root/root`;
- the payload's path set equals the staged tree's path set.

It then prints one line: the archive, its size and its `Depends`.

### A worked template

```text
Package: mos-mqttd
Version: @VERSION@
Architecture: @ARCH@
Maintainer: mos build <mos@example.invalid>
Section: admin
Priority: optional
Depends: mosd (= @VERSION@), ${shlibs:Depends}
Description: mos D-Bus to MQTT application bridge
 Bridges mosd's D-Bus surface onto the local MQTT broker.
```

## `repo.sh`

```
bash os/build-env/deb/repo.sh --arch <amd64|arm64>
```

Reads `_out/debs/<arch>/pool/*.deb` and writes, beside the pool:

```
_out/debs/<arch>/
  pool/<package>_<version>_<arch>.deb
  Packages       dpkg-scanpackages over the pool, pool-relative Filename:
  SHA256SUMS     sha256sum over the pool archives, pool-relative paths
  manifest.txt   package, version, architecture, installed-size, sha256, file
```

`manifest.txt` is tab-separated with a leading `#` comment header, the shape
`os/pkgs/mosd/hack/build-target.sh` writes for `_out/mosd-build.txt`. Every
column of it is read out of an archive with `dpkg-deb --field` or `sha256sum`;
nothing here is maintained by hand.

An empty pool is a hard failure naming the directory. A repository generated
from nothing reports success and installs nothing.

The output is deterministic: `dpkg-scanpackages` sorts by package name and
version, `SHA256SUMS` and `manifest.txt` are sorted by filename, and no
timestamp is written beyond what the archives already carry.

The host has no `dpkg`, so the work happens in a container. `repo.sh` runs the
**host** architecture's `mos-build-deb`, not `--arch`'s: reading control fields
and hashing bytes is architecture-neutral, and a host with no binfmt
registration cannot execute a foreign-architecture image at all -- which would
leave the `arm64` pool unindexable on the machine that just produced it.
`--arch` selects the pool, and each archive's declared `Architecture` is
checked against the pool it sits in.
