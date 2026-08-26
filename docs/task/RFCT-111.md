# RFCT-111 PLAN-014 M5: the rootfs build split into one Dockerfile per stage, driven from TS

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 22:05
- **plan**: PLAN-014 (M5)

Split the 1,798-line `Dockerfile.v2` into the `rootfs/stages/` chain — one
Dockerfile per stage, chained via local image tags, sequenced by the TS
build driver (decision 2: the deliverable is an img, layer duplication is
acceptable, composition wins).

## Scope

- `stages/10-base` (system-essential floor), `20-install` (seed units,
  repart.d), `30-feature-*` (containers, mqtt, radios, ssh — one per
  switchable feature, replacing `WITH_*` args with stage selection),
  `40-board` (board overlay + firmware from `boards/<b>`), `90-pack`
  (squashfs+verity, determinism normalisation).
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
