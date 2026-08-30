# `mos-build-deb` -- the Debian package substrate

Three things live here, and together they are the contract every package
producer in this repository is written against:

| File | Runs | Produces |
| --- | --- | --- |
| `Dockerfile` | `make build-env` | `localhost/mos-build-deb:<arch>` |
| `pack.sh` | inside that image, at the **target** architecture | one `.deb` |
| `repo.sh` | on the host | `Packages`, `SHA256SUMS`, `manifest.txt` |

The image carries `dpkg-dev` and no compiler. What a package contains is
produced by the pinned language builders (`mos-build-c`, `mos-build-go`,
`mos-build-rust`); this image only wraps an already-staged tree. It records
what it resolved in `/etc/mos-build/deb.env`, which is how a producer answers
"what packaged this".

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
