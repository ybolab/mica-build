# os/rootfs/stages — one Dockerfile per stage, chained by local image tags

`Dockerfile.v2` was 1,827 lines, then 1,152 once RFCT-111 M5a moved its shell
into `../scripts/`. It is now these nine files. Read this before any of them.

## The chain

Each file is built on its own, in numeric order, and each is written to a local
image tag the next one starts `FROM`:

```
10-base ──▶ 20-install ──▶ 30-feature-radios ──▶ 31-feature-containers ──▶
            32-feature-rauc ──▶ 33-feature-mosd ──▶ 34-feature-mqtt ──▶
            40-board ──▶ 90-pack ──┬─▶ artifact     ──▶ _out/<board>/
                                   └─▶ factory-root ──▶ _out/<board>/factory-root.oci
```

Every stage after the first declares `ARG MOS_STAGE_PREV` with **no default**
and opens with `FROM ${MOS_STAGE_PREV}`. The driver passes the previous stage's
tag and refuses to build a file that does not declare the argument, so a stage
cannot be built standalone against whatever `FROM` line happened to be typed.
Only `10-base` and `90-pack` name a base image of their own, and each names
only the one its own `FROM` consumes — trixie here, bookworm there.

The driver is `os/build/src/stages.ts` (the plan) and `stages-cli.ts` (the
run), reached as `bash os/build/run.sh --build-rootfs`; `os/rootfs/build-v2.sh`
still stages the build context and still is the whole build. See "Where the
driver lives" below.

**The stage list is the directory, not a list.** The driver reads
`*.Dockerfile` here and sorts by the numeric prefix. Adding a stage is adding a
file; removing one is removing a file. A list kept somewhere else is the second
table this repository keeps deleting — and a stage added without being added to
it would be a stage that silently never runs.

## The terminal stage has two export surfaces

`90-pack` is built twice, against one cache, for two different kinds of output:

| target | output | who reads it |
| --- | --- | --- |
| `artifact` | `--output type=local` into `_out/<board>/` | the image assembler: `rootfs-verity.img`, the verity env, the boot pair, the factory `/var` |
| `factory-root` | `--output type=oci` to `_out/<board>/factory-root.oci` | RFCT-113's smoke runner, which `docker load`s it and executes the self-built binaries inside |

**Two invocations and not two `--output` flags**, because buildkit exports one
target per build. The second is deliberately built **without** `--no-cache`
even when the chain was built with it: `--no-cache` exists for the determinism
gate, where the chain must not be a replay — and this invocation *must* be a
replay, of the run that finished seconds ago. Cold, it would rebuild all nine
stages and export a **different** root from the one the assembler was just
handed, with nothing in either artifact to say which of the two was
smoke-tested.

**`factory-root` is `pack`'s `/rootfs`, not `closed`.** `closed` is the same
root three edits earlier — it still has a populated `/var` and a real
`/etc/shadow`, because the tree surgery and the shadow relocation happen in
`pack`. Exporting `closed` would be cheaper (it is already an image, already on
the target platform) and would smoke-test binaries in a tree that never ships.
`/rootfs` at the point of the export is the byte-for-byte input to
`mksquashfs`.

**The factory `/var` this stage already exported is not this.**
`_out/<board>/factory-var` is 93 entries of `/usr/share/factory/var` — the seed
`mkfs.ext4 -d` writes into EPHEMERAL at assembly (RFCT-106). It is a *subtree
of* the factory root, at a path inside it, and about 0.08% of its size.

### What makes the OCI export reproduce — measured 2026-08-26, x64

Every number below is from the real 250,209,280-byte export of the x64 root,
not from a reduced case. Two of the three flags are load-bearing and **one is
not**; which is which is the whole reason to write them down.

| | what it pins | measured without it |
| --- | --- | --- |
| `SOURCE_DATE_EPOCH` (environment, not a flag) | the image config's `created` | two exports of ONE already-built root: `e4ac0c42…` and `2c98780c…` — **differ** |
| `rewrite-timestamp=true` on the output | every layer entry's mtime | two **cold** rebuilds of the pack stage: `044a7457…` and `f41e9a21…` — **differ** |
| `--provenance=false --sbom=false` | no attestation manifests | identical archive — **not load-bearing** for `type=oci` on buildx 0.32.2 |

With the epoch and `rewrite-timestamp`, four exports agreed byte-for-byte —
two from a warm cache and two from a cold rebuild of the whole pack stage, all
`6e036711ce306cd2e2689091aa41a64866aaab1254dc8cdba2197e0135495ba1`. Same input
root, same archive, whether or not the layer was rebuilt.

**`rewrite-timestamp` is the one a convenient experiment gets wrong.** From a
warm cache the layer's mtimes come out of the cache, so both runs agree with or
without it — it changes the bytes but not the agreement. It only becomes
load-bearing when the layer is genuinely rebuilt, which is exactly the case two
independent builds are, and exactly the case a quick check does not exercise.
It also cannot be combined with `--load`: buildkit refuses it alongside
`unpack`, so the export cannot both reproduce and land straight in the image
store. It reproduces, and `docker load -i` is the reader's step.

**`--provenance=false --sbom=false` is kept although it changed nothing.** The
attestation manifest was real — it was observed on a `--load`, which is where
this was first looked at — and buildx has moved its provenance default between
versions before. Two flags is a cheap way not to depend on an exporter default
that is not ours to set. It is recorded as *not* currently load-bearing so that
nobody later cites it as the thing that fixed the reproducibility.

`SOURCE_DATE_EPOCH` is read from the **environment**, so a missing or malformed
value is not an error — it is the wall clock, silently.
`os/build/src/stages-cli.ts` refuses a `--source-date-epoch` that is not a
count of seconds for that reason, including the `@1577836800` spelling
`board.env` uses for `touch`.

### The export is the same tree as the image that ships — measured

`90-pack` packs `pack`'s `/rootfs` into the squashfs and exports the same
`/rootfs` as the OCI image. That they are one tree is the whole basis for a
smoke run in one saying anything about the other, so it was compared rather
than assumed — the squashfs unpacked and the OCI layer unpacked, four ways:

| comparison | x64, 2026-08-26 |
| --- | --- |
| entries | **9,240 on both** (9,241 counting the root directory, which is how `unsquashfs -lln` counts and where M5's figure comes from) |
| mode, uid, gid, path over every entry | **identical** |
| content, `diff -r --no-dereference` | **identical** |
| file capabilities | identical — and **0 entries on both sides** |
| hardlinks (`%n` per multiply-linked file) | **6 on both**, identical |

`--no-dereference` because `/etc/shadow` is a dangling symlink to
`/run/mos/shadow` by design; followed, it would compare nothing on both sides
and report agreement.

**All five were driven from the failing side**, because four of them had only
ever been seen agreeing and the capability line had *nothing at all* behind it.
Applied to the OCI side alone and then reverted: a single mode bit
(`0755→0700`), a single gid (`0→42`), a renamed path, a single byte at offset
64, `cap_net_raw+ep` added to one binary, and one hardlink
(`usr/lib/klibc/bin/gunzip` ↔ `gzip`) broken into two files. Each turned its
comparison red and each went silent again on revert. Without the capability
mutation that row was an empty file compared with an empty file.

#### The recipe, so the numbers can be re-taken rather than trusted

Neither side of the comparison is readable on this host — there is no
`unsquashfs` and no `getcap` worth relying on — so both run in the pinned
`IMAGE_ALPINE_3_21` with `os/verify/src/tools.ts`'s package list, which is what
makes a difference a difference in the trees rather than in two versions of
`squashfs-tools`.

```sh
# 1. the two trees, from one build's output
head -c "$(sed -n 's/^SQUASHFS_BYTES=//p' _out/x64/rootfs-verity.env)" \
    _out/x64/rootfs-verity.img > sq.squashfs          # drop the verity tail and the MiB padding
unsquashfs -n -xattrs -d sq sq.squashfs
tar -xf _out/x64/factory-root.oci -C blobs            # the one blob that is a tar is the layer
tar -xpf blobs/blobs/sha256/<layer> -C ocix --numeric-owner --xattrs --xattrs-include='*'

# 2. the four comparisons, both sides walked the SAME way
#    (two tools' listing formats differ, and a normalisation is somewhere for a
#     difference to be lost)
find . -mindepth 1 -printf '%M %U %G %P\n' | LC_ALL=C sort      # metadata
diff -r --no-dereference sq ocix                                # content
getcap -r . | LC_ALL=C sort                                      # capabilities
find . -type f -links +1 -printf '%n %P\n' | LC_ALL=C sort      # hardlinks

# 3. and then break each one, on the OCI side only, and put it back
chmod 0700 ocix/usr/bin/rauc      # …chown :42, mv, dd one byte, setcap, rm+cp a hardlink
```

The entry count differs by one from `unsquashfs -lln`'s, and that is the whole
of the difference between 9,240 and M5's 9,241: `-mindepth 1` excludes the root
directory and `unsquashfs` lists `squashfs-root` itself.

### Adding the export changed nothing that ships — measured

Built `--target artifact` from the pre-M7 `90-pack` and from this one against
the same cache: `rootfs-verity.img` came out
`9a8484f9c19c4001ee35b818970d8e89fa99184fc8fd675d3b22859b068c4ed0` from both,
and from the shipped build. A third build with one extra file staged into
`/rootfs` before the squash gave `6a65e311…`, so the comparison can see a change
to the artifact DAG and did not see this one. `factory-root` is a leaf nothing
starts `FROM`, and the header comments it adds are comments.

**`rewrite-timestamp` cannot be combined with loading.** buildkit refuses it
alongside `unpack`, which is what `--load` does. So the export cannot both
reproduce and land straight in the image store; it reproduces, and
`docker load -i _out/<board>/factory-root.oci` is the reader's step.

### arm64: the export needs no emulation; building the root still does

RFCT-113 says the export happens "arm64 via the same binfmt/qemu-user path the
rootfs build already uses". Measured, the export needs **no** such path, and
that is worth separating from the part that does.

`factory-root` is `FROM scratch` on TARGETPLATFORM fed by a `COPY` from a
BUILDPLATFORM stage. Nothing in it executes anything from the root, so nothing
in it needs an emulator. On this amd64 host — `/proc/sys/fs/binfmt_misc` not
mounted, `Platforms: linux/amd64, /v2, /v3, /v4` and nothing else —
`--platform linux/arm64` through that same two-stage shape, over a real arm64
Debian tree as a **named fabricated stand-in** for the packed root, produced an
`{"architecture":"arm64","os":"linux"}` OCI image carrying
`ELF 64-bit LSB pie executable, ARM aarch64` binaries, twice, cold, with the
same digest `70578a85abc5cbc4cc285fb8c02dce0b5444d4f4fd62ea00e09e11bb7686c0b3`.

**What that does not show.** The cx3576 root itself was not built here and
therefore was not exported: `MOS_BOARD=cx3576 bash os/update/rauc/build.sh`
stops at *"the 'default' buildx builder does not offer linux/arm64 on this
host"* before the chain is reached at all, and the BSP `modules.tar` is absent
too. Nothing above says anything about cx3576's content, its size, or whether
anything in it runs — `docker run` on the fabricated arm64 image gives
`exec /bin/sh: exec format error` on this host, which is the same wall the smoke
run itself will meet. What is established is that the export **mechanism** and
the driver arm are board-independent; the cx3576 numbers are owed by a host with
arm64 emulation.

## Why these numbers

PLAN-014 M5's vocabulary is `10-base`, `20-install`, `30-feature-*`,
`40-board`, `90-pack`, and all of it is here. `30-40-unsplit` — the temporary
file M5b held the middle of the chain in — was cut by M5c and is gone.

| stage | what it is | scripts |
|---|---|---|
| `10-base` | the system-essential floor: package allowlist, TLS trust anchors, image profile, operator account, journald storage | 4 |
| `20-install` | read-only-root wiring: the rendered overlay (fstab, `repart.d`, STATE/DATA binds, seed oneshots) and the image's network defaults | 2 |
| `30-feature-radios` | the radio userland, the packaged units mosd must be the only one driving, and the radio state mounts | 3 |
| `31-feature-containers` | the container engine: runtime packages, seven self-built binaries, three assertions about the assembled root, the runtime exercise, the config-layer assertion | 4 + 1 inline |
| `32-feature-rauc` | the update client and the assertion that it links no second TLS stack | 2 |
| `33-feature-mosd` | mosd, apid, the MQTT bridge and broker: binaries, units, D-Bus policies | 1 |
| `34-feature-mqtt` | the two pinned MQTT service accounts | 2 |
| `40-board` | the kernel and its initramfs, grub-editenv, the firmware the board declares, the board's own hwinit units | 4 |
| `90-pack` | close the root (inventory, purge, report), then squashfs-zstd + dm-verity, then the export surface | 12 |

**`3x-feature-*`, not five files numbered 30.** RFCT-111 writes the family as
`30-feature-*`, and one number per feature is what the driver requires: files
sharing a number are refused by name (`auditChain`), because which of them runs
first would then be whatever order the directory was read in. The numbers are
consecutive from 30 and their order is the order the RUNs had.

**`rauc` is a feature stage with no caller-facing switch**, and that is written
down rather than left to be noticed: no board declines the update client, so
nothing passes `--without rauc`. The mechanism can, and its file says so.

## Declining a feature: the stage IS the switch

RFCT-111's actual deliverable, and it replaced two build arguments:

```
bash os/build/run.sh --build-rootfs --board x64 --dest _out/x64 --without containers
```

`WITH_CONTAINERS` reached the build as a build argument that **five** separate
RUNs and scripts each tested, and `WITH_MOSD` as one that a sixth tested four
times. Every copy was an independent chance to disagree with the others, and a
build where one did would have installed the engine and skipped its assertions,
or run the assertions against a root with no engine in it. The old comment asked
readers to keep them in step: *"everything downstream keys off the same arg, so
a board without the engine is not a board with half of one."* It is now a
property of the chain — one decision, made once, before docker starts.

Three things make it a mechanism rather than a flag:

- **A name that matches no feature stage is refused**, with the list of the ones
  that exist. `--without contaners` that matched nothing would build the FULL
  image and exit 0, which is the shape of green this campaign keeps finding.
- **A non-feature stage cannot be declined.** `--without base` is a request for
  an image with no operator account and no trust anchors; the caller who typed
  it did not mean that, and the refusal names the file.
- **The arguments follow the stage.** `PODMAN_DIR` is declared only by
  `31-feature-containers`, so a build that declines the feature and still passes
  the argument is refused by `unusedArgs` — docker would merely warn, and a
  warning scrolls past in a build this size.
- **Two stages cannot name the same feature.** Their numbers would differ, so
  the shared-number fault cannot see it, and the consequence is worse than an
  ordering question: `--without <that feature>` would drop one of them, leave
  the other in the image, and exit 0 reporting the feature declined.

`WITH_CONTAINERS=0` / `WITH_MOSD=0` and `board/<name>/containers.env` are
unchanged; `../build-v2.sh` translates them. What was replaced is the build
*argument*, which is the copy that had to be threaded through six files.

`_out/<board>/rootfs-stages.txt` records the declined set, and prints
`# declined: (none ...)` when there is nothing to decline: an image built
without a feature stage and an image whose feature stage did nothing are
indistinguishable afterwards, so it is written down at the time.

### The omit-a-stage negative test, run

RFCT-111: *"omitting a feature stage turns that feature's verifier checks red"*.
A build that merely succeeds without the stage proves nothing — it is the same
shape as a check observed only passing. So each case below goes through the
**shipping path** (`../build-v2.sh`, not the driver by hand), then
`os/mkimage-x64.sh`, then the real `os/verify-image-v2.sh`, and the comparison
is an **identity diff** of the verifier's 312 PASS/FAIL/SKIP lines against the
full build's — never a count.

`os/verify-image-v2.sh` and not `os/verify`'s TypeScript port, because every
check that goes red here is board- or feature-conditional, and `checks-root.ts`
deliberately holds only checks whose conclusion text is identical on both
boards. The container, MQTT and radio families are M4d's.

Baseline, x64: `RESULT: PASS (290/290 checks, 22 skipped)`, zero FAIL lines.

| declined | verifier | assertions that flip PASS → FAIL |
|---|---|---|
| `containers` | `FAIL (288/290, 22 skipped)` | `the container engine is incomplete: … missing`; `nft is not in the image` |
| `mqtt` | `FAIL (288/290, 22 skipped)` | `mqttd: the unit runs as 'mos-mqttd' and no such account is in …/etc/passwd`; `mqtt-broker: the unit runs as 'mos-mqtt-broker' and no account of that name is in …/etc/passwd` |
| `radios` | not a case on x64 | the board declares none, so all three scripts take their printed early exit and the stage contributes nothing to an x64 image. Omitting it turns nothing red because nothing was there. That branch is cx3576's and is unexercised on an amd64 host |
| `mosd` | the build REFUSES, in `90-pack` | see below |

Nothing else in the 312 moved in either case, but for the image filename, the
root hash, and — for `containers` — the copyright count (163 → 158, the
engine's own). The `mqtt` account census moves by exactly the two accounts:
`all 25 accounts in …/etc/shadow have a LOCKED password field` → `all 23`.

**Eight container assertions still PASS on an image with no engine**, and that
is worth naming rather than leaving for someone to discover: the storage
graphroot, the `helper_binaries_dir` pin, the STATE-backed
`/etc/containers/systemd` bind, the four-config-file check and the
no-second-layer check all read files the **overlay** ships, which
`20-install` installs whether or not the engine is there; `libsystemd.so.0` is
the base image's; and the two "no podman unit exists" checks are vacuously true
when there is no podman. Only the engine-binary set and `nft` are statements
about the feature.

**`check_container_engine`'s "no engine at all" arm did NOT fire**, and cannot
fire for any real build. It requires `/usr/bin/podman` *and*
`/etc/containers/storage.conf` to be absent; `storage.conf` arrives with the
overlay on every board. Measured: the declined-`containers` run contains zero
occurrences of `carries no container engine at all`. Its only reachable driver
was `os/tests/ui-location-test.sh` case 8k, which deleted `storage.conf` too.
That was fortunate — the early exit did not rescue the negative test. Both that
suite and the oracle are deleted (RFCT-110 M4e); the early return's
inexpressibility survives in `os/verify/src/checks-engine.ts` and is recorded
under "The oracle is deleted" in `os/verify/HARNESS.md`, rather than repaired in the
change that found it.

**`--without mosd` is a build refusal, on this tree and the one before it.**
`90-pack`'s `pack-assert-var-disposable.sh` demands `/var/lib/mos`, because
`var-lib-mos.mount` ships in the overlay on every board — and that directory is
created by exactly one line, `mosd-install.sh`'s `mkdir -p /var/lib/mos`, which
on the old tree sat inside `if [ "$WITH_MOSD" = "1" ]`. Driven on both sides:
the pre-M5c tree built with `WITH_MOSD=0` stops at the same assertion with the
same sentence. `WITH_MOSD=0` has been an unbuildable configuration and nothing
noticed, because nobody built it. Not repaired here: which of the two should
give — the overlay's unconditional mount unit, or the directory's owner — is an
image content decision.

## Declining a board: there is nothing to decline

RFCT-111 also asks that `40-board` be *"parameterised by `boards/<board>`"*, and
M5d is that. It is the sibling of the section above and it came out the other
way round: a feature is chosen by which STAGE FILE is built, a board by what
that one stage file is HANDED.

Until M5d the file named a board twice, and both were content decisions taken in
a file every board builds:

```
COPY board/cx3576/rootfs/firmware/<five files>  /tmp/fw/
COPY os/boards/cx3576/hwinit/                   /tmp/hwinit/
```

Both ran on **every** board. x64 staged 2 MB of AIC8800D80 firmware and six
hardware-init oneshots into a QEMU image and discarded them at runtime —
`firmware-install.sh` on `MOS_ARCH = amd64`, `hwinit-install.sh` by finding no
board fact any of the units could read. The image came out right. What was wrong
is where the decision lived.

### The shape: a staged directory, not a `40-board` per board

**A `COPY` cannot be gated on an `ARG`.** That is why the literals were there,
and it is also what decides between the two available shapes: a board's content
reaches a shared instruction as a *directory* whose contents the board chose,
and an empty directory is how a board says "none of that here".

**The pattern is not new here, which is why it was extended rather than
invented.** `MODULES_TAR` has always been an empty-but-valid tar on amd64 for
exactly this reason, and `BOARD_INIT_DIR` has always been documented as one that
"may be an empty dir (boards without hw-init facts)". `BOARD_FIRMWARE_DIR` and
`BOARD_HWINIT_DIR` are the same mechanism applied to the two `COPY`s that had
not had it. `../build-v2.sh` fills all four in one block, from the board's own
trees:

| argument | filled from | empty when |
|---|---|---|
| `MODULES_TAR` | `$BOARD_DIR/out/kernel/modules.tar` | `MOS_ARCH=amd64` (an empty tar) |
| `BOARD_FIRMWARE_DIR` | `$BOARD_DIR/rootfs/firmware`, filtered to `BOARD_FIRMWARE_FILES` | the board declares no firmware |
| `BOARD_HWINIT_DIR` | `os/boards/<board>/hwinit` | the board has no such directory |
| `BOARD_INIT_DIR` | `$BOARD_DIR/init` | the board declares no hardware facts |

**The firmware is filtered, and by the board's own list.**
`board/<b>/rootfs/firmware` is the vendor BSP drop — 32 files for cx3576, most
of them other AIC parts (8800dc, 8800dw) and other silicon revisions — and only
the confirmed runtime set may enter a signed root. That set is
`BOARD_FIRMWARE_FILES` in `os/boards/<b>/board.env`, where it already was:
`os/verify-image-v2.sh` has asserted the image against it since the x64 board
arrived. The build reads the list the verifier reads, so the two cannot disagree
about what the board carries, and a declared file the BSP does not contain is a
build error naming both rather than a device whose driver finds no firmware.

**The scripts stopped naming a board too.** `firmware-install.sh` lost its
`MOS_ARCH = amd64` early exit — the board stages what it carries, so the
question is what is here rather than which board it is on — and its hardcoded
`test -f /usr/lib/firmware/fmacfw_8800d80_u02.bin` became the same assertion
over `BOARD_FIRMWARE_FILES`. `hwinit-install.sh` gained `MOS_BOARD` and
**branches on none of it**: it names `os/boards/<board>/hwinit` in its two
diagnostics, which used to send every reader to `cx3576`'s directory whatever
board they were building.

### Why not a `40-board` per board

It was the other shape available and it is worse in four ways:

- **The stage list is the directory.** Two files numbered 40 are refused for
  sharing a number; numbered 40 and 41 they both *build*, so every board would
  run every other board's stage. Making the driver skip by board is a second
  selection mechanism beside `--without`, keyed on something the driver is not
  told today — it takes `--board` for the image *tags* only.
- **It duplicates the reasoning, not just the instructions.**
  `grub-editenv-install` is gated on the BOOTLOADER and not on the board, and
  says so at length; the hwinit rationale is about a mechanism that is
  board-agnostic. Both would exist once per board and drift — which is exactly
  how the hardcoded hwinit list drifted behind the (since deleted) v1
  Dockerfile, leaving `mos-mac` and `mos-gadget` installed but disabled, at the
  cost of the image's stable MAC and its USB debug console, with no error
  anywhere.
- **It scales by copying.** Board three is a 170-line file again.
- **It is one more Dockerfile per board** in `os/build-env`'s frontend-pin
  check, which counts the files rather than a list.

### What asserts it, and what it is worth

`os/build/src/stages.test.ts` walks every stage file, strips the comments, and
requires that **no instruction contains a board name** — with the board names
read from `os/boards/` rather than listed, for the same reason the stage list is
the directory. Comments are excluded deliberately: several stages explain
themselves by naming the board a thing was found on, and prose that names a
board is how the reasoning stays legible; what must not name one is an
instruction, because that is where a board name decides what the image carries.
The check is driven from the failing side beside it, with the exact `COPY` M5d
removed, so its green is not the green of a subject that never occurs.

**The change is one whose effect is visible only on the board this host cannot
build.** x64 is the board that DISCARDED both of these, so on x64 the
parameterisation is worth exactly one thing — that the image is unchanged — and
that is what was measured (`../README.md`, RFCT-111 M5d): **7** differing
entries of 9,241 against the control's first build and **6** against its second,
with the control itself re-measured at **7** and the seventh identified as
`apt/eipp.log.xz`'s `APT-ID` numbering. Nothing beyond the control, in either
pairing.

What x64 does show is the mechanism in the state the change is about:
`firmware: this board declares none` and `hwinit: 0 board fact(s) declared,
0 unit(s) installed and enabled`, from three staged directories that are empty.

**The cx3576 half was not built and is not claimed.** `binfmt_misc` is not
mounted on this host and no builder advertises `linux/arm64`. What WAS driven
for cx3576 is the staging, which is where the parameterisation lives: pointed at
the in-repo BSP, `build-v2.sh` selected exactly the five files
`BOARD_FIRMWARE_FILES` declares out of the drop's 32, staged the thirteen
`os/boards/cx3576/hwinit` files and the six confs, and then stopped at the arm64
builder. The guards were driven from the failing side too, on x64 and by hand: a
declared firmware file the BSP lacks, a declared path outside `/usr/lib/firmware`,
a staged set smaller than the declared one, and a staged file whose name is not
the declared one — four refusals, each naming both sides, against a positive
control that installs the one declared file and nothing else.

## The reorderings, and why each was necessary

### M5b's, when the chain was cut out of the single file

The four files it produced held **exactly** the instructions `Dockerfile.v2`
held — no `RUN` was merged, split, added or dropped, and the only new lines in
the whole cut were the three `ARG MOS_STAGE_PREV`/`FROM ${MOS_STAGE_PREV}` chain
links and `COPY --from=rootfs` becoming `COPY --from=closed`.

Six of them moved **earlier**, and nothing moved later:

| moved | from | to |
|---|---|---|
| `profile-write.sh` | after `podman-exercise` | `10-base` |
| `RUN rm -f /etc/ssh/ssh_host_*` | after `firmware-install` | `10-base` |
| the journald `Storage=volatile` drop-in | after `hwinit-install` | `10-base` |
| `account-mos.sh` | after the journald drop-in | `10-base` |
| `network-and-ssh-units.sh` | after `firmware-install` | `20-install` |
| `overlay-install.sh` | after the ssh-host-key removal | `20-install` |

Every other instruction keeps its relative order exactly.

**This is not tidying.** RFCT-111 asks for one stage per *switchable* feature,
"replacing `WITH_*` args with stage selection" — a feature has to be a stage the
driver can leave out. In the single file the radio feature straddled the
overlay: `radios-packages` and `radios-mask-units` ran before it,
`radios-mounts` after, and `radios-mounts` **must** be after it (the comment on
that `RUN` records the x64 build that failed when it was not). The container
feature straddled it the same way, through `podman-assert-config`. A feature
split across the overlay cannot be one omittable stage. Putting the overlay
before every feature is what makes the rest of M5 possible.

### M5c's, when `30-40-unsplit` became the feature stages and `40-board`

`30-40-unsplit`'s header said its order was `Dockerfile.v2`'s and that this was
"NOT a claim that features must precede board work", and handed the decision to
whoever cut it. M5c decided it: **the board work moved behind every feature.**

Its seventeen RUNs, in the order that file had them, regrouped:

| RUN, in `30-40-unsplit` order | now in |
|---|---|
| 1 `radios-packages` | `30-feature-radios` |
| 2 the container runtime packages | `31-feature-containers` |
| 3 `radios-mask-units` | `30-feature-radios` |
| 4 `rauc-install`, 5 `rauc-assert-no-tls-stack` | `32-feature-rauc` |
| 6 `podman-install`, 7 `podman-assert`, 8 `podman-exercise` | `31-feature-containers` |
| 9 `grub-editenv-install`, 10 `kernel-and-initramfs`, 11 `firmware-install` | `40-board` |
| 12 `radios-mounts` | `30-feature-radios` |
| 13 `podman-assert-config` | `31-feature-containers` |
| 14 `mosd-install` | `33-feature-mosd` |
| 15 `account-mos-mqttd`, 16 `account-mos-mqtt-broker` | `34-feature-mqtt` |
| 17 `hwinit-install` | `40-board` |

Two RUNs moved **earlier** — 12 and 13, which sat behind the board work only
because they need the overlay, and the overlay is now ahead of every feature.
Five moved **later**: 4 and 5 behind the container work, 9–11 behind all of it.
RUN 2 slipped from second to fourth because the radio group closed up in front
of it. Every other instruction, and the relative order inside every group, is
unchanged.

**What decided it.** Both arrangements were available: pull 12 and 13 forward,
or push 9–11 back. The numbers have to read in the order they run — PLAN-014
fixed `30-feature-*` before `40-board` — so a `40-board` that ran first would be
a file whose number lied about when it happened.

**What it was checked against.** Nothing in the four board RUNs reads anything a
feature stage writes: the kernel work reads `/usr/lib/modules` and the
initramfs hooks, the firmware install moves files into `/usr/lib/firmware`,
`grub-editenv-install` names its own `libdevmapper` dependency rather than
depending on the `cryptsetup-bin` that arrives later (its own comment says why),
and `hwinit-install` reads the staged board facts.

**And the constraint that fixed the feature order.** The `apt` transactions
still run in the order they ran before — radios, containers, `grub-editenv`,
kernel — because `30-feature-radios` is deliberately ahead of
`31-feature-containers`. That order decides the order entries land in dpkg's
database and in the logs the pack stage carries into
`/usr/share/factory/var/log`, so keeping it is what makes this cut a regrouping
rather than a re-install.

**It was measured, not argued.** A reordering can change the image, and the
instrument is in `../README.md` under "Determinism, and what still deviates":
extract both packed roots, `diff -r --no-dereference` the trees, and compare the
differing set against a control of two cold builds of the unmodified file. It is
a content diff and **not** a sha256, because a cold x64 build does not reproduce
itself — four cold builds of the untouched `Dockerfile.v2` on this host gave
four different hashes. A gate that compared hashes would fail on a correct
change and pass on luck.

What it found: control **6** of 9,241 entries, subject **14**, so **8** beyond
the control — every one of them in the account family, and every one the price
of `account-mos.sh` moving into `10-base` while the two MQTT service accounts
stay with the feature material. `../README.md` proves they are inert (the live
files are identical as sets; the four `-` backups differ by exactly one entry
because `useradd` snapshots before each change) and records the anchor RFCT-111
asks for in that case: full verifier parity, `RESULT: PASS (290/290 checks, 22
skipped)` on an image assembled from a chain-built rootfs.

## What did not move, and why it could not

`90-pack`'s `closed` stage holds the package inventory, the package-manager
purge and the build report. They read as `10-base` material — they are neither
a feature nor a board fact — and they cannot go there: `dpkg-query` has to see
every package a feature or board stage installed, and the purge has to be the
last step in the chain that still needs dpkg. A floor stage cannot hold a step
that must run after everything.

They are in `90-pack` rather than in a fifth stage file of their own because
closing the root and packing it are one operation with one output, and nothing
can ever be inserted between them. A stage boundary nothing can be inserted at
costs a reader a hop and buys nothing.

## The builder must resolve local tags — measured

The chain resolves `FROM ${MOS_STAGE_PREV}` against the **local docker image
store**, so it must be built by a builder whose driver can read that store. The
default `docker` driver can. A `docker-container` builder **cannot**, and does
not say so usefully; driven on this host it reported

```
ERROR: failed to solve: mos-probe:a: failed to resolve source metadata for
docker.io/library/mos-probe:a: pull access denied, repository does not exist
```

— a message about a registry, for an image that is right there. The driver
therefore checks the builder's driver up front and refuses by name, because
that error arriving forty minutes into a build, pointing at Docker Hub, is a
diagnosis nobody makes quickly.

This matters for **cross-architecture builds and no other case**.
`build-v2.sh` falls back to a `docker-container` builder exactly when the
current builder cannot reach the target platform — an amd64 host building
cx3576's arm64 without host `binfmt_misc`. On such a host the chain needs
`binfmt` installed (so the `docker` driver can reach arm64 itself) or a local
registry to hold the stage tags. A host that can build the target natively,
or that has binfmt, is unaffected.

## The shell, the arguments, and the bind mount

Unchanged by this cut, and recorded once here instead of four times:

Every `RUN` body longer than one command lives in `../scripts/` and is reached

```dockerfile
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

A **bind mount and not a `COPY`**, because a `COPY` would put the script in the
image; the mount exists only for its own `RUN` and leaves neither the files nor
`/mos-scripts` behind. `sh <path>` and not the shebang, so the interpreter is
the caller's decision rather than a mode bit a checkout could lose.

The **arguments still arrive**: docker puts every `ARG` that has a value into
the `RUN`'s environment, so the script — and any child of it — reads them from
there. An `ARG` declared with no value is *unset* rather than empty, so a
`set -u` on it fails inside the script exactly as it did inline. Each script
names the arguments it reads in its header. Note that `ARG` is **per stage**,
and now also per *file*: an argument a stage's `RUN`s read must be declared in
that stage's file. `BOARD_RADIOS` is declared in `30-feature-radios` and again
in `90-pack` for that reason.

These scripts are POSIX `sh` under dash. **Do not add `set -o pipefail`**: dash
has no such option, and several use `producer | grep -q`, a form that is correct
without it and inverts its own answer with it. `os-shell-pipefail-lint` scans
only files that enable the option, so these are outside its scope by
construction rather than by exemption.

## Where the driver lives

`os/build/src/stages.ts` + `stages-cli.ts` + `stages.test.ts`, reached through
`bash os/build/run.sh --build-rootfs`. That is where RFCT-112 (M6) puts build
orchestration, and this is orchestration.

It spent one afternoon in `os/verify` instead, because `os/build` did not exist
in this branch until M6a merged and a driver nobody can typecheck or test is not
a deliverable. The move cost three `git mv`s and no import edits at all: both
packages' `paths.ts` export `OS_DIR` under the same name.

It **duplicates nothing** of what M6a built. The board model stays the single
copy in `os/verify/src/board.ts`; the chain needs no `Bun.$` wrapper and no
`Toolbox`, because the only external program it runs is `docker` and only
`stages-cli.ts` runs it — through `MOS_BUILD_DOCKER`, the same variable
`src/toolbox.ts` reads, for the same reason. `stages.ts` is pure — `node:fs`,
`node:path`, and this package's `paths.ts`.

**The pinned-bun container route cannot carry this mode**, and not for the
reason `os/verify --parity` cannot: *that* image has no docker client at all,
while this package mounts the client and the daemon socket so its toolbox can
start sibling containers. What it does not mount is `docker buildx`, which is a
CLI **plugin** rather than a subcommand — on this host it lives in
`/usr/lib/docker/cli-plugins`. Driven with the client and socket mounted and
`MOS_BUILD_DOCKER` set, the container answers `docker: unknown command: docker
buildx`. `run.sh` refuses the combination up front and says so. Mounting the
plugin directory would close it, and that is a decision rather than a line: it
puts a second unrecorded host binary inside a pinned image.
