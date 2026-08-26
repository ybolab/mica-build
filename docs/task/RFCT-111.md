# RFCT-111 PLAN-014 M5: the rootfs build split into one Dockerfile per stage, driven from TS

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 22:05
- **completedAt**: 2026-08-26 07:10
- **plan**: PLAN-014 (M5)

Split the 1,798-line `Dockerfile.v2` into the `rootfs/stages/` chain — one
Dockerfile per stage, chained via local image tags, sequenced by the TS
build driver (decision 2: the deliverable is an img, layer duplication is
acceptable, composition wins).

## Scope

- `stages/10-base` (system-essential floor), `20-install` (seed units,
  repart.d), `30-feature-*` (**containers, mqtt, radios** — one per
  switchable feature, replacing `WITH_*` args with stage selection),
  `40-board` (board overlay + firmware from `boards/<b>`), `90-pack`
  (squashfs+verity, determinism normalisation).

  AMENDED 2026-08-26, at M5 close, **by the user**. The list read
  "containers, mqtt, radios, ssh". **ssh is removed from it** — not because it
  is unimportant, but because it is not optional. The user's decision, in their
  own words: *"ssh belongs in base, it is core."* The reason it could not stay
  on this list is recorded under "ssh is a floor capability, not a feature"
  below, and it is a measurement rather than a preference: an ssh-less chain
  cannot be built at all, so a `30-feature-ssh` stage would have been a switch
  with nothing behind it. `mosd` and `rauc` are also feature stages in the
  shipped chain and were never on this list; they are left as they are, because
  this amendment carries out one decision and does not tidy around it.

  CLARIFIED 2026-08-26, **by the user**, alongside the amendment above. **The
  three are not a flat list.** For containers and mqtt, *"whether it is compiled
  into the image"* and *"whether it is enabled on the system"* are **two
  separate options**, and the system exposes runtime enablement independently of
  build-time inclusion. The model, stated so it cannot be collapsed by a later
  reader:

  | | build-time stage (`--without`) | runtime enable switch |
  | --- | --- | --- |
  | `containers` | yes | **yes** |
  | `mqtt` | yes | **yes** |
  | `radios` | yes | no (board-declared: `BOARD_RADIOS`) |

  **Build-time inclusion does not imply runtime enablement.** A feature stage
  being in the image means the software is *there*, not that it is *on*. That
  is not new with M5 — PLAN-012 built the container engine installed-and-INERT
  with the switch driven from apid/mosd, and RFCT-104 added the MQTT master
  switch with the broker shipping inert — but M5 is the change that could have
  severed a switch from its feature, so it is stated here explicitly and
  verified under "The two axes, verified" below.
- Inline shell blobs extracted to `rootfs/scripts/`.
- The `os/health/` byte-identical duplicates collapse into the overlay copy;
  their tests move to `os/tests/`.
- The TS driver sequences the chain and records the stage list per build.

## Acceptance

- Assembled image byte-identical to the single-file build where achievable;
  if apt-layer reordering makes that unattainable, the fallback gate is full
  verifier parity plus an explicitly anchored new-baseline commit — decided
  and recorded, not improvised.
- Negative test: omitting a feature stage turns that feature's verifier
  checks red.
- Both boards build and verify green through the chain.

## Dependencies

- After RFCT-108 (pinned bases) and RFCT-109 (driver foundation).

## What is discharged at close, and what is not

M5 closes **2026-08-26**, on the user's decision on the ssh clause. The three
acceptance clauses do not all close the same way, and a `completed` status that
implied they did would be the kind of green this campaign keeps finding.

**Clause 1 — byte-identity, or the fallback.** Discharged, in both halves.
Byte-identity is not achievable and the clause anticipates that, so the fallback
applies: **full verifier parity** — `RESULT: PASS (290/290 checks, 22 skipped)`,
0 FAIL, x64, on an image assembled from a chain-built rootfs — **plus the
anchored new-baseline commit**, which is "The M5 baseline" below. The clause was
not amended; it contains its own fallback branch, so this discharges it.

**Clause 2 — the omit-a-stage negative test.** Discharged, and recorded in
`os/rootfs/stages/README.md`, "The omit-a-stage negative test, run": declining
`containers` and declining `mqtt` each turn that feature's assertions red
through the shipping path, compared as an identity diff of the verifier's
PASS/FAIL/SKIP lines rather than as a count. **Two limits stated rather than
absorbed.** The `radios` case is not exercisable on x64 — the board declares no
radio, so the stage contributes nothing and omitting it turns nothing red; that
branch is cx3576's. And the evidence was taken through
`os/verify-image-v2.sh`, which **M4e has since deleted** at full parity with the
TypeScript port, so that table is now a citation into git history and is
annotated as such where it lives.

**Clause 3 — "both boards build and verify green through the chain."** Not
discharged for cx3576, and this is the honest statement of it rather than an
amendment. x64 builds and verifies green through the chain, repeatedly and at
the tree that ships. **cx3576 has never been built through the chain on any host
available to this campaign.** `binfmt_misc` is not mounted here and no builder
advertises `linux/arm64`, and since M5b the chain cannot use the QEMU-bundled
`docker-container` builder that used to close that gap — the cost the user
accepted, recorded under PLAN-014's risks. Driven at close:
`make os-verify-cx3576-v2` exits 1 before running a single check, with
*"`_out/cx3576/cx3576-mos-v2-latest.img` is not there … A verifier that carried
on would report on nothing."*

What that leaves unverified for cx3576, carried forward from the M5e gate rather
than quietly dropped:

- that an image built through the new path carries the five firmware files and
  the six hwinit units — the `COPY`, the install and the assertions in
  `40-board` are unexercised on the only board where they do anything;
- `kernel-and-initramfs.sh`'s `modules.tar` arm;
- `30-feature-radios` whole, and with it clause 2's `radios` case.

What **was** driven for cx3576 is the staging, which is where M5d's
parameterisation lives: pointed at the in-repo BSP, `build-v2.sh` selects the
five files `BOARD_FIRMWARE_FILES` declares out of the drop's 32, stages the
thirteen `os/boards/cx3576/hwinit` files and the six confs, and then stops at
the builder check. That is a real measurement of the part that can be measured
here, and it is not a substitute for the part that cannot.

**The task closes with clause 3 outstanding for cx3576 because the blocker is a
runner, not the work.** Nothing in the chain is known to be wrong on cx3576; it
is unobserved. M7 runs on hardware and is where that is answered.

### The disposition of clause 3

**Decided 2026-08-26 by the user, on L2's recommendation.** Both actors are
named because both acted: L2 escalated the question and made the
recommendation; the user took the decision. RFCT-111 closes **over an
undischarged board-build clause**, on the **physical-runner constraint** — not
on any judgement that cx3576 is fine.

**This is a disposition, and it is none of the other three things this campaign
does to a clause.** It is not an AMENDMENT: clause 3's text is unchanged and
says exactly what it always said. It is not a SATISFACTION: the clause is not
made true, and no measurement here makes it true. It is not a gate's call: a
gate states what it measured, and the decision to close over a live clause was
taken above it. The campaign's ledger now reads six amendments, one satisfaction
(RFCT-110's clause 3, closed by the verify image pin) and this one disposition,
and those are three different things that should not be read as one.

**Precedent: RFCT-108, M2 close.** The same physical constraint — no
`binfmt_misc`, no builder advertising `linux/arm64` — took an applied default
there rather than blocking the milestone, and for the same stated reason: "the
reason is a host capability, not an implementation shortfall." This is the
campaign's **second** use of that rule, not a one-off, which is why it is cited
rather than re-argued.

**REVERTIBLE, and here is the trigger.** The first arm64-capable host to build
and verify cx3576 through the chain settles clause 3 one way or the other. **A
failure there REOPENS RFCT-111.** That sentence is what makes "revertible" mean
something: without a named trigger it is only a softer way of saying closed. The
set to drive on that host is the unverified list above — the firmware and
hwinit install, `kernel-and-initramfs.sh`'s `modules.tar` arm, and
`30-feature-radios` whole, which is also clause 2's missing case.

## The two axes, verified

Added **after the close**, because the clarification arrived after it. The
result is clean, so nothing here reopens anything; had it not been, this would
have gone back as a reopening of RFCT-111 rather than into this file.

**Why this was M5's to check and not an aside.** The property predates the
campaign — PLAN-012 shipped the container engine installed-and-inert with the
switch driven from apid/mosd; RFCT-104 added the MQTT master switch with the
broker shipping inert — but **M5 split the rootfs into per-stage Dockerfiles,
which is precisely the change that could sever a switch from its feature.**

### Axis (a), build-time: confirmed, not re-driven

Gated by M5c and recorded in `os/rootfs/stages/README.md`, "The omit-a-stage
negative test, run". Confirmed still recorded and still describing the shipped
mechanism; deliberately not rebuilt.

### Axis (b), runtime: measured on the real chain-built x64 image at this tree

**Included** — the stages are in the chain and the software is there:

| | bytes |
| --- | --- |
| `/usr/bin/podman` | 64,709,552 |
| `/usr/bin/mos-mqtt-broker` | 7,616,112 |
| `/usr/bin/mos-mqttd` | 6,454,280 |
| `/usr/lib/systemd/system/mos-mqtt-broker.service` | 5,540 |
| `/usr/lib/systemd/system/mos-mqttd.service` | 3,747 |

**Not enabled** — in the same image:

- no `.wants/podman*` anywhere under the enablement trees;
- `/etc/systemd/system/multi-user.target.wants/mos-mqttd.service` — absent;
- `/etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service` — absent;
- no podman systemd unit of any name (only `podman-system-generator`, which is
  required and excluded by name).

**And the register still asserts it.** All four inertness checks **ran and
passed** on that image — `RESULT: PASS (290/290 checks, 22 skipped)`, and none
of the four is among the skips:

    PASS  container-engine-no-units      the image contains no podman systemd unit of any name
    PASS  container-engine-not-enabled   no podman unit carries an enablement symlink
    PASS  mqttd-not-enabled              mqttd: the bridge is NOT enabled in the image
    PASS  mqtt-broker-not-enabled        mqtt-broker: the broker is NOT enabled in the image

The register states the model itself, in the one place it declines to require
enablement: *"the enabled-at-boot assertion for mos-mqtt-broker.service
mos-mqttd.service: these are started by mosd from the settings tree, not by the
image, and their own checks assert the image does NOT enable them."*

### Can those four actually fail? Three answers, because parity gives none

M4g reached 0 unclaimed on both boards, so no conclusion the old oracle reached
was dropped in the port. That does **not** say the oracle's own check could
fail, and this campaign has found vacuous passes in code green for months. So:

1. **Each is driven from the failing side by the register's own suite.**
   `checks-engine.test.ts` and `checks-mqtt.test.ts`: **66 pass, 0 fail, 395
   `expect()` calls.** A `podman.socket` written under `/usr/lib/systemd/system`
   turns `container-engine-no-units` red and the message names it; the same for
   `/usr/local/lib/systemd`, which is STATE-backed and writable on the device
   and would otherwise be exempt; a `.wants` symlink turns
   `container-engine-not-enabled` red.
2. **The search spaces are real, not empty.** A "this set is empty" check over a
   directory tree that does not exist is the classic vacuous pass. Measured on
   the shipped root: the unit trees hold **202** `.service` files, and the
   enablement trees hold **89** symlinks across **19** `.wants` directories. The
   four checks pass because nothing among those is podman's or mqtt's — not
   because there was nothing to look at.
3. **Both known vacuity shapes are already defended, in code, with the reason.**
   `container-engine-no-units` excludes `podman-system-generator` by name, and
   that file **is** in the shipped image, so the exclusion is exercised on every
   run and a positive control pins it. `mqttd-not-enabled` uses `lstat` and not
   `-e` deliberately: a `.wants` symlink points at an absolute path that
   resolves to nothing when ROOT is an unpacked tree, so `-e` "would call a
   present-but-dangling symlink absent — passing this check on exactly the
   image that failed it."

### The boundary, stated rather than left to be inferred

What is verified here is that **the IMAGE ships the feature inert** and that
**the REGISTER asserts that inertness and can fail if it stops being true**.

**Not verified: that flipping the switch on a booted device turns the feature
on.** That is device-side runtime behaviour, which PLAN-014:220-223 excludes,
and establishing it needs a boot test. The evidence above is the weaker claim
and must not be read as the stronger one: nothing here shows mosd's
`containers.enabled` or `mqtt.enabled` actually starting anything on hardware.

## ssh is a floor capability, not a feature

Decided **2026-08-26 by the user**, on the M5c finding that M5d did not reopen
and M5e re-confirmed. A gate does not amend its own acceptance clauses on its
own judgement; it carries out a decision made above it, and this section is
that. What follows is the evidence as re-measured at this commit — after M4e
deleted `os/verify-image-v2.sh`, so nothing here cites a file that no longer
exists.

**ssh is installed by the floor, not by a feature.**

| what | where |
| --- | --- |
| the `openssh-server` package | `os/rootfs/stages/10-base.Dockerfile:133` |
| the host-key removal (`rm -f /etc/ssh/ssh_host_*`) | `os/rootfs/stages/10-base.Dockerfile:207` |
| the units (`network-and-ssh-units.sh`) | `os/rootfs/stages/20-install.Dockerfile:41` |

**The purge is itself a contract that ssh survives.**
`os/rootfs/scripts/package-manager-purge.sh:48` keeps, by name:

```
for kept in bash sh ls cp mv rm sed awk grep find systemctl sshd ssh scp curl ip; do
```

`sshd`, `ssh` and `scp` are in that list. The purge runs in `90-pack`, at the
end of every chain, on every board — so a chain that had not installed ssh
would not merely ship without it, it would fail the purge's own keep-list. **An
ssh-less chain cannot be built.** That is what makes ssh unlike containers,
mqtt and radios: each of those three can be declined and the image still packs.

**The image contract depends on ssh being present.**
`os/verify/src/checks-shadow.ts:119` lists `ssh.service` in `BEFORE_PAIRS` —
"the units the reconciler must be ordered before, **each with the file that must
exist**" — so the verifier requires `/usr/lib/systemd/system/ssh.service` in
every image. `os/verify/src/checks-system.ts:69` names the same unit, and its
`profile-ssh-not-enabled` check (`:880`) asserts that the image ships it
**not enabled**, on either profile. The two assertions need each other: the
enablement check has nothing to judge if the unit is absent, and it is
`checks-shadow.ts` that makes absence a failure.

**And the setting would have had nothing behind it.** `access.ssh.enabled`
is seeded false by both image profiles (`docs/design/access.md:357`) and
toggled at runtime by mosd — `docs/design/api.md:178`,
`SetSettings("access.ssh.enabled", …)`. A setting that enables a daemon the
image may not carry is a switch wired to nothing, and the failure mode is
silent: the operator ticks the box and no sshd starts.

**What the amendment protects.** Had `30-feature-ssh` been built to make the
clause pass, "every mos image carries sshd" would have stopped being a contract
and become an accident of which stages a given build happened to include. The
three-feature list says the opposite, and says it where the driver enforces it
rather than only here. Driven at this commit:

```
$ bash os/build/run.sh --build-rootfs --board x64 --without ssh ...
error: os/rootfs/stages is not a chain that can be built:
    was asked to leave out the feature 'ssh' and no stage here is named
    <number>-feature-ssh. The features are: containers, mosd, mqtt, radios,
    rauc. A name that matched nothing would build the FULL image and exit 0,
    so it is refused instead
```

rc=1, and nothing was built. ssh is absent from the driver's list because there
is no `30-feature-ssh` for it to name — which is this amendment, stated by the
mechanism instead of by a document.

## The M5 baseline

Anchored **2026-08-26** by the M5e gate, from four cold x64 builds: base
`84c12f4` (the parent of the cut commit `66bb0b8`, the last tree with no
`os/rootfs/stages/` in it), that same tree a second time as the control, and the
nine-stage chain at `1f9bc8c` and again at `fda9ebe`. The full measurement is in
`os/rootfs/README.md`, section "RFCT-111 M5e".

**Acceptance clause 1 is NOT amended, and did not need to be.** Unlike
RFCT-107's byte-identity clause — which carried no fallback, so M1 could only
close once the user amended it — this clause carries its own: byte-identical
*"where achievable"*, and otherwise "full verifier parity plus an explicitly
anchored new-baseline commit". Byte-identity is not achievable, for exactly the
reason the clause anticipates; the parity is `RESULT: PASS (290/290 checks, 22
skipped)`, 0 FAIL; and this section is the second half, which the M5e gate owed
and had not delivered. Nothing here changes what the clause asks for — it
discharges it.

Read the four subsections as four different kinds of claim: the first is a
durable contract, the second is the measurement that makes the first checkable,
the third is what a later gate is to do with it, and the fourth is dated
evidence that is **deliberately not** recorded as an expectation.

### What is anchored: the enumerated delta

Against `84c12f4`, an x64 image built through the chain differs in **8 entries
beyond the control**, and they are these — all of them the account database:

| entry | kind | differing lines |
| --- | --- | --- |
| `/etc/passwd` | live | 2 |
| `/etc/group` | live | 2 |
| `/etc/gshadow` | live | 2 |
| `/usr/share/factory/etc/shadow` | live | 2 |
| `/etc/passwd-` | `useradd` backup | 2 |
| `/etc/group-` | `useradd` backup | 2 |
| `/etc/gshadow-` | `useradd` backup | 2 |
| `/etc/shadow-` | `useradd` backup | 4 |

In all eight the difference is **one account at a different line position, and
nothing else**. `account-mos.sh` moved into `stages/10-base` when the chain was
cut, while the two MQTT service accounts stayed with the feature material in
`stages/34-feature-mqtt` — so the `mos` operator (uid/gid 1000) is now created
*before* `mos-mqttd` (970) and `mos-mqtt-broker` (969), and used to be created
after. In the pre-M5 `Dockerfile.v2` the three ran at lines 662 / 695 / 785; in
the chain they run at `10-base:259`, `34-feature-mqtt:73` and
`34-feature-mqtt:106`. `/etc/passwd` line 25 → 23; `/etc/group` line 51 → 49.

**Why this is not a regression.** The four LIVE files are identical **as sets** —
same accounts, same uid, same gid, same shell, same home, same GECOS, same count
— and nothing that reads `/etc/passwd` is order-sensitive. The four `-` files are
`useradd`'s pre-write snapshots, so they differ by exactly the one entry that had
not yet been added when the snapshot was taken; `/etc/shadow-` differs by four
lines rather than two because it also swaps which account still carries the
un-normalised `chage` day (18262 against 20691) at snapshot time. `/etc/shadow`
itself does not appear at all, because it is a symlink to `/run/mos/shadow` on
both sides.

**The allowance is exactly this wide and no wider.** A difference in any file
outside this table, or a difference *within* one of these eight that is not a
line position — a changed uid, gid, shell, home directory, GECOS field, group
membership, or an account present on one side and absent on the other — is a
regression and is not covered here.

### The measurement that makes "only a line position moved" a fact

Not a hash. Both packed roots were unsquashed and compared twice over, against a
control of two cold builds of the unmodified base tree:

- **9,241 entries on every side.** No additions, no removals, no type changes.
- **Content:** control **6** differing entries, subject **14**, so 8 beyond. The
  same 14, in the same list, at `1f9bc8c` and at `fda9ebe`.
- **Metadata:** `unsquashfs -lln` over all 9,241 entries gives **0 differing rows
  on both pairings** when compared on mode, uid/gid and path. `diff -r` cannot
  see a mode, and a `COPY` that changed what it stages moves a mode or a path
  before it moves a byte, so this is the half that makes the content number mean
  anything. It was driven from the failing side before it was believed: a single
  mode bit, a single gid and a single renamed path each register.
- **Ordering:** `dpkg.log` with its timestamps stripped is **byte-identical over
  all 694 operations** on both pairings — the direct check that the cut is a
  regrouping and not a re-install.
- **Every other differing line accounted for:** `apt/history.log` 16 lines (all
  `Start-Date`/`End-Date`), `alternatives.log` 4 (one `mt` operation's
  timestamp), `apt/term.log` 22 (16 timestamps and 6 host-key fingerprints,
  which appear in the CONTROL pairing too), `apt/eipp.log.xz` byte-identical,
  `aux-cache` binary and mtime-keyed, `initrd.img` gzip and moving in the control
  as well.
- **A second, independent control:** the two M5 trees against each other, cold
  and comment-only apart, differ on **6** — the control set exactly. So the eight
  are the pre-M5 tree against an M5 tree, and nothing else about the session.

### What a future gate must compare against

- **Not `84c12f4`.** From M5 onward, that comparison carries the permanent,
  enumerated 8-entry delta above. A gate that compares against the pre-M5 tree
  and reports 8 has found nothing; one that reports 9 has found something.
- **An M5-or-later tree**, built cold on the same day through the same builder.
  M6 and M7 gates measure against the tree they inherit, not against this one.
- **The number to beat is the control, measured on the day — never a constant.**
  It was 6 for M5a–M5c, **7** for M5d (`apt/eipp.log.xz`, because Debian's index
  gained four records mid-session) and **6** again for M5e. Two cold builds of
  the unmodified subject tree, every time, in the same session as the subject.
- **The account family is where to look first.** The invariant now anchored is
  that `mos` is created in `10-base` and the two MQTT accounts in
  `34-feature-mqtt`. Any further movement of an account-creating `RUN` across
  another one re-appears in exactly these eight entries — which is what makes
  them worth enumerating rather than waving at.
- **The recipe, not the numbers.** `_out/gate/` of the M5e worktree: `cold.sh`
  (one tree, one cold build, through that tree's own unmodified driver),
  `bin/docker` (the shim that injects `--no-cache` at exactly the rootfs
  Dockerfile shapes, so no argument set is transcribed), `extract.sh`,
  `compare.sh` and `lines.sh`.

### Dated evidence, deliberately NOT an expectation

The four image hashes of 2026-08-26, recorded so a later reader can tell what was
built, and **not** so that anything can be compared to them:

| build | tree | `sha256(rootfs-verity.img)` |
| --- | --- | --- |
| base | `84c12f4` | `2a6c0a5c1775846cc7ecb2e101ee30be…` |
| control | `84c12f4` again | `342401d055924c0c78d7d7640ea05bbd…` |
| subject | `1f9bc8c` | `c9db95a15944e1ea37d9323851bbc71e…` |
| subject | `fda9ebe` | `261fcaea3d290075f1aeecf1c565c933…` |

**The first two are the same tree, and they do not match.** A cold x64 build does
not reproduce itself — `os/rootfs/README.md` records seven cold builds of one
unmodified file giving seven hashes — so a hash written down as a baseline is a
check that looks like coverage and is not. That is why what is anchored above is
an enumerated delta and a recipe instead. It is the same reasoning M1 recorded at
RFCT-107 close, for the same reason.
