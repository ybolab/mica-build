# `mos-build-deb` -- the Debian package substrate

Six things live here, and together they are the contract every package producer
in this repository is written against:

| File | Runs | Produces |
| --- | --- | --- |
| `Dockerfile` | `make build-env` | `localhost/mos-build-deb:<arch>` |
| `pack.sh` | inside that image, at the **target** architecture | one `.deb` |
| `repo.sh` | on the host | `Packages`, `SHA256SUMS`, `manifest.txt` |
| `producers.sh` | on the host | the producer set, discovered from the tree |
| `build.sh` | on the host | one producer's archives, for one architecture |
| `version.sh` | on the host | the one version the whole pool carries |

The image carries `dpkg-dev` and no compiler. What a package contains is
produced by the pinned language builders (`mos-build-c`, `mos-build-go`,
`mos-build-rust`); this image only wraps an already-staged tree. It records
what it resolved in `/etc/mos-build/deb.env`, which is how a producer answers
"what packaged this".

## The producer convention

A **producer** is one directory. The marker is the PAIR `Dockerfile` +
`producer.env`, and it is looked for **anywhere in the tree** -- producers live
under `pkgs/*/deb/*/`, `rootfs/packages-src/*/` and
`boards/<board>/deb/*/`, and a search rooted at any one of those silently
omits the others. A `Dockerfile` alone is not the marker: this tree holds a
dozen of those and none of the others is a package producer. `producer.env` is
what declares intent.

```
<anywhere>/<producer>/
  producer.env                   what this producer emits and how it is built
  Dockerfile                     stage the payload, then one pack.sh run per package
  control/<package>.control      one per package in PACKAGES
  <prepare hook>                 optional; see PREPARE
```

The producer's NAME is its directory's basename, and that is what
`make os-deb-<producer>` selects on, so two producers cannot share one. The
directory is also the build context: everything the `Dockerfile` needs from
elsewhere arrives through `BUILD_CONTEXTS`.

### `producer.env`

Plain `KEY=value`, the `boards/*/board.env` discipline: no logic, no command
substitution, safe to source and to parse.

| Key | Required | Meaning |
| --- | --- | --- |
| `PACKAGES` | yes | the Debian packages this producer emits, space separated |
| `ARCHES` | yes | `amd64`, `arm64`, or `all` -- see below |
| `ENABLEMENT` | yes | `<package>=<count>` per package; see below |
| `BUILD_CONTEXTS` | no | `<name>=<repo-relative path>`, passed as `--build-context` |
| `FROM_IMAGES` | no | `<build-arg name>=<images.env key>`, resolved by `build-env/from.sh`. The packer image is always supplied; `FROM_IMAGES` declares additional bases only |
| `BUILD_ARGS` | no | extra `<name>=<value>` build arguments |
| `PREPARE` | no | a script in the producer directory, run on the host before the build |
| `PREFLIGHT` | no | `1` if that hook honours `MOS_DEB_PREFLIGHT=1`; see below |
| `VERSION_FROM` | no | `<repo-relative env file>:<KEY>` naming the upstream version this producer repacks; see below |

`VERSION_FROM` is for producers that repack **upstream software** (podman,
RAUC). The named key's value -- a leading `v` is stripped -- replaces the
workspace prefix in the version, so the archive is
`<upstream>+git<commit><dirty>-1` instead of `0.1.0+git<commit><dirty>-1`. The
prefix says *what* is packaged and the stamp says *which commit* packaged it:
`tests/deb-package-gate.sh` asserts one stamp across the pool while
prefixes differ per package, and `rootfs/build.sh` matches the stamp
against the tree it composes from. Producer-scoped -- it applies to every
package in `PACKAGES` -- so a producer must not mix an upstream repack with a
first-party package. First-party producers do not declare it.

An upstream-versioned package that pins a first-party one uses
`@SYSTEM_VERSION@` in its control template (mos-podman: `Depends: mos-system
(= @SYSTEM_VERSION@)`) and passes `--system-version
"${MOS_DEB_SYSTEM_VERSION}"` to `pack.sh` -- `@VERSION@` is that package's
OWN version, which since the split is not the one mos-system carries.
`pack.sh` refuses the token without the flag and the flag without the token.

`ARCHES=all` means the package is architecture-independent. `all` may not be
mixed with a specific architecture: an `all` package is already a member of
every pool, so the pair would say both that the producer is
architecture-independent and that it is not.

Everything that is **not packaging** -- cross-compiling a binary, generating a
payload, asserting whatever the producer is willing to claim about what it just
produced -- happens in the `PREPARE` hook, on the host, before the build. The
hook is handed `MOS_DEB_ARCH`, `MOS_DEB_STAGE`, `MOS_DEB_PRODUCER`,
`MOS_DEB_PRODUCER_DIR`, `MOS_DEB_REPO_ROOT`, `MOS_DEB_VERSION` and
`SOURCE_DATE_EPOCH`, and what it leaves in `MOS_DEB_STAGE` arrives in the build
as the `bin` context. A hook that reports success and stages nothing is refused
by name. This is where a producer keeps the parts of itself no key above could
express, which is what lets one generic driver build all of them.

`build.sh` always passes `packer` (this directory) as a build context, because
`pack.sh` is the packaging contract and an edit to it must take effect without
rebuilding the builder family.

### `preflight.sh` -- every missing input at once

`make os-debs` builds the discovered producers in sequence and each checks its
own inputs when its turn comes, so a missing input surfaced **after** the
producers ahead of it had been packed, named one file, and the next one was
learned on the next attempt. `build-env/deb/preflight.sh` runs first -- it is
a prerequisite of `os-debs` and the target `make os-deb-preflight` -- and
reports all of them together: every `BUILD_CONTEXTS` path, every `PREPARE` hook
file, every base image `FROM_IMAGES` and the packer resolve to, and whatever a
producer's own hook checks. It prints what it examined and refuses to report
success over a count of zero. It builds nothing and starts no container.

A hook whose inputs no key can describe opts in with `PREFLIGHT="1"` and is then
also run with `MOS_DEB_PREFLIGHT=1`, `MOS_DEB_ARCH` and the producer/repo
variables, and **no** `MOS_DEB_STAGE`: there is nothing to stage into yet. Two
producers do:

- `board-cx3576` picks its BSP artefacts through `BSP_OUT` and its committed
  firmware through `BOARD_DIR`, both of which are chosen at
  run time and so cannot be a fixed path in `producer.env`.
- `podman` reuses `pkgs/podman/out-<arch>`, and reports whether it exists, is
  complete and carries a stamp matching `versions.env` -- see
  `pkgs/podman/versions-stamp.sh`. An absent engine **warns**, because this
  producer builds one; a complete engine compiled from a superseded
  `versions.env` is **missing**, because the producer refuses it. Without the
  warning, that three quarters of an hour arrived only when this producer's
  turn came, started from inside a packaging hook.

In that mode a hook prints **three** counts, on **both** paths --
`preflight-examined:`, `preflight-missing:` and `preflight-warned:` -- and exits
non-zero when the missing one is not zero.

**Missing and warned are decided by what the RUN would do, not by how serious it
looks.** Missing means nothing in the run produces it, so `make os-debs` gets no
further than the producer that needs it and the pre-flight refuses. Warned means
the producer makes it itself, at a cost: the run would succeed, it would just
spend three quarters of an hour somewhere the operator did not expect. That is a
visibility problem, and it is answered by saying so -- the warning names the cost
and the command that pays it separately -- not by refusing. Refusing it would
change what `os-debs` means, since a producer whose hook compiles its own input
is how a pool comes to exist on a fresh host, and three of the five hooks here
compile.

All three counts are required and a zero is written rather than omitted: a hook
that reports success without saying what it looked at is indistinguishable from
one that looked at nothing; a failing hook with no missing count would have a
report naming four files counted as one; and a hook with no warned count would
make "this producer has nothing it can make for itself" and "this hook has not
been taught the category" the same run. Only `examined` refuses a zero.

The aggregate prints the warned total on its **own line**, never folded into the
verdict: two numbers in one sentence is how a category that does not fail a run
stops being visible.

Opt-in per producer, not automatic: a hook that has not been taught the variable
would do its full work instead. A pre-flight that compiles is not a pre-flight --
and PLAN-036 section 4 already says composition does not compile a component.

`tests/deb-preflight-test.sh` drives all of it: the aggregate over a
baseline, `BOARD_DIR` and `BSP_OUT` in both directions, and each half of the count contract
mutated until the run goes red.

### Adding one

Create the directory. Nothing else: `make os-deb-<producer>` is a pattern rule
resolved against `producers.sh`, `make os-debs` loops over the same list, and
`tests/deb-package-gate.sh` reads it too. There is no driver to register a
case in and no `Makefile` target to add.

### `ENABLEMENT` -- what the archive cannot tell you

The gate checks that each package ships exactly the
`/etc/systemd/system/multi-user.target.wants` symlinks it is supposed to. That
expectation cannot come from the archive, because the symlink **is** the fact
under test -- deriving it from the payload would assert that whatever shipped is
what was meant.

It is declared **per package, never as a universal count**. Some packages own
the unit that starts them; others own no unit at all, and both are correct:

```sh
# pkgs/mosd/deb/mosd/producer.env
ENABLEMENT="mosd=1 mos-apid=1"
# pkgs/mosd/deb/mqtt/producer.env
ENABLEMENT="mos-mqttd=0 mos-mqtt-broker=0"
```

Every package in `PACKAGES` needs a row, and a package that ships no link writes
`0` rather than being left out -- an omission and a deliberate zero look
identical, and only one of them is a decision. A producer with no `ENABLEMENT`
at all, and a package with no row, are each a hard failure naming it.

### `Provides`, `Conflicts` and virtual names

`pack.sh` passes both fields through from the control template, and they are
used: `mos-profile-dev` and `mos-profile-prod` conflict with each other and both
`Provides: mos-profile`. So the gate classifies a dependency three ways:

- **local-real** -- some producer emits a package of that name. It must be
  pinned to the exact version the pool was built at and be in the pool.
- **local-virtual** -- no producer emits it, but an archive in the pool declares
  it in `Provides`. It is satisfied by that `Provides` and is **not**
  version-pinned: an unversioned `Provides` cannot satisfy an exact-version
  dependency at all, so requiring one would be requiring something unsatisfiable.
- **external** -- neither. Reported, not judged; `mos-system` and `passwd` are
  external and expected.

`Replaces` stays refused outright. It is the one field that would let two
packages own one path, which is the overlap the ownership check exists to
refuse; `Provides` and `Conflicts` do nothing of the kind.

## `producers.sh`

```
bash build-env/deb/producers.sh
  mosd pkgs/mosd/deb/mosd amd64,arm64 mosd,mos-apid mosd=1,mos-apid=1
  mqtt pkgs/mosd/deb/mqtt amd64,arm64 mos-mqttd,mos-mqtt-broker mos-mqttd=0,mos-mqtt-broker=0

bash build-env/deb/producers.sh --dir-for mqtt
  pkgs/mosd/deb/mqtt
```

Five space-separated fields, sorted by producer name: `<producer> <dir>
<arches> <packages> <enablement>`, the last three comma separated and
`<enablement>` `-` when the producer declares none.

**This is the only place the layout is written down.** The Makefile, `build.sh`
and the gate all read it and none searches for itself: two implementations of
the search would let `make os-debs` and the gate disagree about what exists, and
the one that had not been taught about a producer would report green over it.

An empty discovery is a **hard failure**, the way an empty pool is one for
`repo.sh`. `make os-debs` over no producers builds nothing and reports success;
the gate over no producers asserts nothing and reports success. Both green, both
having done nothing.

It refuses, by name: a `producer.env` with no `Dockerfile` beside it, an empty
or malformed `PACKAGES` or `ARCHES`, and two producer directories sharing a
basename. It does **not** refuse a missing `ENABLEMENT` -- that means nothing to
a build, and the gate is what enforces it.

## `build.sh`

```
bash build-env/deb/build.sh --producer <name> --arch <amd64|arm64|all>
```

The one driver. It resolves the producer through `producers.sh`, reads its
`producer.env`, runs the `PREPARE` hook, selects a buildx builder, resolves
`FROM_IMAGES` through `build-env/from.sh`, clears this producer's own
archives out of every pool it writes, runs the build and then checks what
actually landed on disk.

An **`ARCHES=all` producer is built once and exported twice**: one
`docker buildx build` with two `-o type=local` outputs, one per pool. Two builds
would be two chances to produce two different archives for one package name, and
the composer resolves each pool independently. The driver asserts the two
exports are byte-identical, and the gate asserts it again over the built pools.
Such a build runs at the **host** architecture and needs no emulation -- there is
no ELF in the payload for `dpkg-shlibdeps` to resolve -- and it requires a
`docker-container` builder, because the `docker` driver accepts only one output
per build.

**A complete pool has a prerequisite that is not in the tree: the cx3576 board
producer's BSP inputs.** `board-cx3576` stages a kernel, a device tree, the
kernel modules and U-Boot out of `_out/boards/cx3576/`, which is
gitignored, so a fresh worktree does not have them and its `PREPARE` hook
refuses by name -- naming `make -C boards/cx3576/bsp <target>`, or pointing
`BSP_OUT` at a tree that already carries them. The part worth knowing
before you meet it is the consequence for the aggregate rather than for that one
producer: `make os-debs` walks the producers in the order `producers.sh` prints
them and stops at the first that fails, and `board-cx3576` sorts first. So
without those inputs the aggregate builds **nothing at all** -- the pool comes
out empty rather than short one package, and no other producer is reached.

## `version.sh`

```
bash build-env/deb/version.sh
  0.1.0+git9671c7cf2d4d-1          a clean tree
  0.1.0+git9671c7cf2d4d.dirty-1    a tree with uncommitted changes
```

One **stamp** across the whole pool, in one implementation. The producers that
share that pool have nothing else in common -- the mosd ones are Rust and carry
crate manifests, others are neither and carry none -- so a rule each producer
implemented for itself would be a rule they agree on until one of them is
edited. `build.sh` calls this script for every producer, and
`pkgs/mosd/hack/build-deb.sh` calls it rather than composing the string
itself. A producer that declares `VERSION_FROM` keeps the `+git…-1` stamp this
script prints and replaces only the prefix in front of it, so the pool-wide
invariant is the stamp, not the whole string.

The number comes from the mosd workspace's crate manifests, which is where it
already lived: `0.1.0` is written in the crates and must not be written a second
time. They must all **agree**; a workspace declaring two versions has no single
answer to give a pool that carries one, and the script names both crates rather
than picking. `<commit>` is `git rev-parse --short=12 HEAD`, `.dirty` marks a
tree no commit reproduces, and the `-1` is the Debian revision, which does not
move because these packages have no upstream/downstream split.

**`make os-debs` is not safe against a tree that changes while it runs.** The
version is read per producer -- `build.sh` calls this script once for each --
and it is read from `git status --porcelain` as well as from HEAD, so a merge, a
commit and an ordinary uncommitted edit all move it equally. Change the tree
mid-run and the producers built before the change carry one version while those
built after carry another, each correct at the moment it was written. What fails
is the gate's one-version rule, and it fails naming the PACKAGES -- so the
symptom points at the pool while the cause is that the tree moved underneath it.

`SOURCE_DATE_EPOCH` is **not** here; it stays with `build.sh`, which resolves it
as HEAD's timestamp on the host. See below for why `pack.sh` has no default for
it.

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
docker buildx build --build-context packer=build-env/deb ...
```

### `SOURCE_DATE_EPOCH`

Required in the environment; `pack.sh` fails by name if it is unset. There is
no "now" default, because one would make every archive irreproducible while
every build stayed green.

Every payload mtime is **set** to it, not clamped to it. A clamp -- the
Reproducible Builds convention, and what `dpkg-deb` does on its own -- would
leave a file older than the epoch carrying its own mtime, and in this repository
that mtime is a *checkout* time: buildkit's `COPY` preserves the source file's
mtime exactly, so a payload copied out of the working tree carries the moment
that clone was made rather than anything about the commit. The ruling, what the
alternative would have cost and which constraint forced it are written at the
decision site in `pack.sh`. Ownership is normalised to `root:root` and the
archive is built with `dpkg-deb --build --root-owner-group`.

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
bash build-env/deb/repo.sh --arch <amd64|arm64>
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
`pkgs/mosd/hack/build-deb.sh` writes for `_out/mosd-build-<arch>.txt`. Every
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
