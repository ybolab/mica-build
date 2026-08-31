# Changelog

Campaign-level record, one entry per plan, newest first. Details live in the
plan file and the task records it names; this file holds the one-paragraph
history a reader can scan without opening either.

## The rootfs is composed from Debian packages (2026-08-31)

The nine-file rootfs stage chain is gone. A root is now one APT transaction
against a local package pool -- `_out/debs/<arch>/`, built and indexed by
`make os-debs` -- on a digest-pinned Debian base, followed by one finalizer
that closes and packs it. What used to be a floor stage, a read-only-root
wiring stage, four feature stages and a board stage is package metadata:
fifteen packages from ten producers discovered from the tree, with
configuration order coming from their own `Depends` rather than from a number
in a filename. Declining a feature is naming fewer packages, through a resolver
that refuses a set not naming exactly one profile package. Enablement is
package-owned symlink payload; nothing anywhere calls `systemctl enable`. The
RAUC keyring stays the one path that is not package payload, staged per build
from `ca/`, and it is a different seam from the TLS trust store `mos-ca-trust`
ships. The switch-over was accepted on a gate that built x64 through both paths
at one commit and judged every difference between the two roots -- 35
differences, 35 sanctioned, 0 unsanctioned -- whose reasoning is kept as a
closed record in `os/tests/dual-build-sanctions.md`.

## Built-in UI is a pure SPA over the management API (2026-08-31)

apid now embeds a React/Vite application at `/ui`; `/` serves a valid active
custom bundle and otherwise redirects to that built-in UI. All server-rendered
Maud pages and non-API form mutations, including `/containers/enable`, were
removed. Setup, login and logout have JSON session routes, API handlers accept
either a stored bearer token or a signed browser session, and session mutations
require a per-session CSRF header. Custom UI status/deactivation is likewise an
API resource. mosd now obtains an on-demand normalized network snapshot from
systemd-networkd, and the network API/SPA report the observed interface count,
configured intent and each link's operational, carrier, address-family and
address details. The committed frontend assets are rebuilt and byte-compared
in CI before Cargo embeds them.

## Settings writes are bounded, scoped and queued (2026-08-31)

apid-to-mosd and mosd-to-systemd waits now have five-second bounds, while
mosd keeps settings/live-state reads separate from its serialized apply lock
and reconciles only overlapping subtrees. Persisted settings writes enter one
bounded, coalescing queue whose task records are mirrored into apid by
`TaskChanged`; the settings and transient-password APIs return 202 plus a task
id, and bearer clients can read the bounded task collection or one record.
The zero-JavaScript SSH pane redirects to that task and meta-refreshes only
until success, failure, interruption, or confirmed history loss, and no
plaintext password can enter the queue.

## cx3576 builds on a host without binfmt (2026-08-30)

The rootfs stage driver links its chain one of two ways, decided by the
builder's driver: by tag in the daemon's image store on the `docker` driver,
as before, or by OCI layout on any other -- each stage exported
`type=oci,tar=false` under `_out/<board>/stages/` and handed to the next as a
named build context under the tag its `FROM` names. A `docker-container`
builder bundles its own emulator, so `os/rootfs/build-v2.sh` now selects
`mos-<arch>` when `default` cannot reach the platform, the way the RAUC and
podman builds already did, instead of refusing with the host binfmt command.
The smoke run that closes the build follows: when the daemon cannot execute
the root, every register entry runs inside that builder through one throwaway
build per artifact, with the same register and the same judging. With that,
every cx3576 step -- builder images, U-Boot, kernel, RAUC, podman, mosd, the
rootfs, the image, its verification and the bundle -- builds on an amd64 host
with docker and buildx and nothing registered on it.

## MQTT bridge hardened against its application peers (2026-08-30)

A review of the decoupled bridge found it still treating its D-Bus peers as
mosd. Every `GetItems` and `SetValue` into an application is now bounded by
five seconds, so a hung application is recorded as unreachable instead of
stopping the heartbeat and every other application. The rumqttc event-loop
task no longer waits on the runtime: requests that arrive while it is busy
are dropped, and a reconnect travels on its own channel, closing a deadlock
between the two bounded channels. An activation that fails while the
application still owns its name -- one that claims the name before it
registers `/` -- is retried by a bus sweep five seconds later.

The documented application policy now grants root `GetItems`: the stock
system bus has no root exemption, so a package that granted only the bridge
was published to MQTT and reported non-conforming by mosd's registry on every
boot. Image verification requires that grant for every enrollment. The MQTT
reconciler no longer lets an identity that fails validation block the off
path, and a read of a path no application publishes is ignored rather than
answered with a retained null under the client's chosen name.

## MQTT enrollment decoupled from service naming (2026-08-30)

`com.mos.ext.*` is no longer a privileged application namespace. All services
use the uniform `com.mos.<class>[.<suffix>]` grammar, while MQTT eligibility is
an independent package-owned contract: an exact regular-file enrollment under
`/usr/lib/mos/mqtt-applications.d` must be paired with exact D-Bus name
ownership and `mos-mqttd` Item1 grants. Global prefix ownership and the central
mqttd policy were removed; wildcard, prefix, unenrolled, and unpaired grants
fail image verification.

`mos-mqttd` now has zero D-Bus access to `com.mos.mosd`. `GetDeviceId` and the
bridge identity proxy were removed; mosd instead renders the already-validated
topic identity into `/run/mos/mqttd-device.env` before starting the bridge.
mosd retains its explicit local `com.mos.mosd1` management API because APID and
mosd are separate processes, but exports no Item1 façade and no settings,
state, signal, or action to MQTT. This entry supersedes the extension-namespace
and single-`GetDeviceId` exception described in the immediately following
entry.

## MQTT restricted to application data (2026-08-30)

`mos-mqttd` no longer mirrors the `com.mos.mosd` management tree. It now
discovers only class-bearing `com.mos.ext.*` application services, validates
their identities and item paths at the trust boundary, coordinates one
device-wide heartbeat/full-publish lifecycle, and fails closed when two
applications claim the same class and instance. System settings and state —
including SSH, networking, credentials, containers and MQTT configuration —
and power or update actions have no MQTT read, publication or write path.

The bridge's sole system-management permission is the new read-only
`com.mos.mosd1.GetDeviceId` method used to form topic addresses. APID now calls
the dedicated `Reboot` and `PowerOff` management methods directly, and mosd's
obsolete system `com.mos.Item1` façade and action-item implementation are gone.
D-Bus policy and image verification pin the exact grant across all policy
files. Application disappearance, watcher failure, invalid item paths and
address collisions withdraw retained values rather than leaving stale state.

## Mosd workspace tests consolidated and repository prose audited (2026-08-30)

The repository-root `test/apid-api/` harness now lives at
`os/pkgs/mosd/tests/apid-api/`, beside the D-Bus policy harness moved out of
`os/pkgs/mosd/hack/`. Repository-root discovery, container workdirs, fixtures,
Make targets, verification inputs, executable modes, and current documentation
all follow the new ownership boundary. Cargo unit and integration tests remain
crate-local, while `os/tests/` remains the home for OS-wide tests.

The accompanying audit removed a committed conflict marker, unstable source
line citations, stale references to deleted build and verification scripts,
incorrect current paths, and incomplete prose in design documents and code
comments. It also corrected a stale build-test expectation that still named the
deleted bundle script. Validation passed the 48-case documentation index, the
31-file shell pipefail scan, 689 build tests, 1,096 image-verification tests,
47 APID self-checks, 38 API specification pins, 45 D-Bus policy checks, and the
Rust workspace tests and clippy gates. The full QEMU APID run was not available
because this checkout has no `_out/x64` image; dry-run resolution reached the
new paths and stopped only at that missing prerequisite.

## Scratch root renamed to `tmp/` (2026-08-29)

`runtime/` collided with a real runtime path twice over. A genuine `runtime/`
directory in this repository would have been silently gitignored, and
`build-harness.md` quotes `/srv/bkd/runtime/bun` two sections above the one
that defined the scratch root, so a reader had to work out which `runtime` was
meant. It is `tmp/` now — unambiguous, and the convention PMA already states
for throwaway files. Nothing in the tree read the old name: it was a rule in
`.gitignore` and a section of `build-harness.md`, not a path any script builds.

Renaming it exposed a gap in the citation sweep. That sweep matched
`name.ext`, so it could not see a filename with no extension (`Dockerfile:41`)
or one whose dot comes first (`.gitignore:33`) — and the doc it was about to
rewrite cited `.gitignore:33`, a line number the rename itself was about to
invalidate. Twenty-three such citations survived and are now gone, across
`build-harness.md`, `uboot-ab-handshake.md`, `boards.md`,
`mos-required.fragment`, `podman/Dockerfile` and three `os/verify` sources.

Still there, and measured rather than fixed: about a hundred bare continuation
references in `os/verify/src/` and `os/build/src/` — `:1750`, `:2096` and the
like — pointing into `os/verify-image-v2.sh`, the shell verifier that was
deleted. They are archaeology in comments, not links anything resolves, and
clearing them is a separate pass over roughly a hundred sites.

## The docs gate narrowed to what ships (2026-08-29)

`docs/plan/` and `docs/task/` are PMA process tracking. They are not part of
the product, and a record is deleted when it closes, so the sets an index gate
asserted over them were down to two task records and zero plans — a check that
reports green without having checked anything. Both sections are removed.

What remains is the pairing a reader depends on: `docs/design/*.md` against
`docs/README.md`, both directions, plus the once-each assertion that catches a
document listed twice. A design document that no index lists is not broken,
does not fail a build, and is simply never found again; nothing else in the
tree can catch that.

The gate goes from 352 lines to 118 and the negative suite from 398 to 202 —
750 to 320 against 16 documents, where it had been 750 against 18 rows.

One gap closed on the way out. The forward direction for `design/` — a
document that exists with no row — had no negative case of its own: the task
half of that pair had been carrying it, and removing the task section would
have left the gate's primary assertion untested. It has a case now, and the
suite is 4/4.

`docs/research/` is not gated because it does not exist; it went with the
Venus OS evaluation. `check_readme_dir` still takes its directory as an
argument, so if a second shipped tree appears, one call adds it.

## Talos removed from the tree, and the settled records pruned (2026-08-29)

Talos is gone. The three references that were not history went with it: the
`.gitignore` entry for a `talos/` directory that does not exist, the base name
in the Makefile's retired-`os` message (the target keeps its recipe — a retired
build path that exits 0 is the failure mode every check here exists to
prevent), and the `apid` name-collision note in `remote-management.md`, which
disambiguated a daemon no reader can now encounter.

`README.md` keeps one mention, deliberately: the design-lineage sentence.
Talos really is where the immutable-root idea came from, and crediting an
influence is not the same as naming a dependency.

The rest of the Talos residue was inside settled records, so applying this
campaign's own rule cleared it. PLAN-029 M3 established that a record is
deleted when it closes; the closures in the previous commit left seven behind,
which contradicted it. Every settled record is now pruned — thirteen in all,
including this campaign's own PLAN-029 and RFCT-262/263/264. `docs/plan/` holds
no plan records, and `docs/task/` holds RFCT-253 and RFCT-260, the two that are
genuinely open.

An empty plan set turned out to break `docs/verify-index.sh`: an unmatched glob
expands to the pattern itself, and the forward loop reported `PLAN-*.md` as a
record with no row. It failed closed rather than passing green, which is the
right direction, but it was still a defect. Both forward loops now skip a path
that does not exist. The negative suite stays at 17/17 — it mints its own
`PLAN-900` fixture rather than borrowing a real record, which is what keeps the
plan assertions armed against an empty tree.

## Backlog cleanup (2026-08-29)

The open set was four plans and five tasks; most of it was bookkeeping rather
than work. Verified against the tree, then closed:

- **RFCT-005 and PLAN-007 — the Talos rebase, abandoned.** Both proposed
  rebasing the fork onto upstream Talos v1.14.0-rc.1. The project took the
  other fork, PLAN-010's systemd base. There is no fork left to rebase. The
  last three references outside the records — a `.gitignore` entry for a
  directory that does not exist, the base name in the Makefile's own "retired"
  message, and the `apid` name-collision note in `remote-management.md` — went
  with them. What stays is the design-lineage sentence in `README.md`, which
  credits an influence rather than naming a dependency.
- **RFCT-008 and PLAN-010 M1 — superseded.** The systemd rootfs prototype was
  replaced by the v2 chain (`os/rootfs/build-v2.sh` over nine stage
  Dockerfiles, squashfs+dm-verity, A/B layout) that M2-M5 build on and that
  ships. M1 was the only milestone still open under a plan whose other four
  were implementation-complete. Its remaining done criterion — hardware boot
  to sshd — was never recorded, and closing it does not claim it.
- **PLAN-006 — completed by supersession**, executed on the systemd base as
  PLAN-010 M4. **PLAN-008 — completed by supersession**: the connectivity
  concern ships as two mosd reconcilers, and no `connd` process exists,
  deliberately.
- **RFCT-007 — completed.** Item 1 had shipped. Item 3, the flashing matrix,
  is delivered in `os/boards/cx3576/bsp/README.md`: five paths, which board
  state each applies to, and why `ums` is reachable only from U-Boot and never
  from Maskrom. **Item 2, the `update.img` pipeline, is closed as superseded
  and will not be built** — three flash paths already write a whole-disk image
  through `rkdeveloptool wl 0`, and the RK packaging format would require
  vendoring `afptool` and `rkImageMaker`, closed-source SDK binaries, for no
  capability the tree lacks.

Left open, and genuinely open: **RFCT-253** (whether `access.ssh` may stay
bus-writable, a decision on evidence already gathered) and **RFCT-260** (the AP
reconciler's third copy of the WPA byte rule, and a refusal that names the
secret's length). Standing and untracked: the arm64/cx3576 verifications owed
to a host with binfmt.

## PLAN-029 — Documentation system rebuild (2026-08-29)

The documentation tree went from 276 files and 77,319 lines to 42 files and
17,306, and stopped being coupled to code positions. Delivered as one record,
RFCT-262, because record proliferation was one of the things being removed.

- **Decoupled from code.** 3,843 `path:line` citations are gone from the
  documents, along with the gate that kept them resolvable
  (`docs/verify-citations.sh`, its test and three baselines — 1,821 lines, two
  `Makefile` targets and a CI step). Documents now name a module or a contract.
  The HTTP surface defers to `os/pkgs/mosd/apid/openapi.json`, which CI already
  holds equal to what the shipped binary prints and diffs for breaking changes —
  moving the API surface off an ungated prose transcription and onto a gated
  artifact. api.md's transcribed route table and operation inventory collapsed
  accordingly; its design reasoning stayed.
- **Settled records pruned.** 205 completed `RFCT-*` and 24 closed `PLAN-*`
  deleted, both indexes rewritten to the survivors. RFCT-257 and RFCT-261 were
  closed rather than kept: both were work scoped against the citation gate this
  campaign removed, so leaving them open would have left the tree with a task to
  build on machinery that no longer exists.
- **Re-anchored on the current version.** `docs/research/` deleted with the
  Venus OS comparison it existed for; the eight `*.zh.md` siblings replaced by
  `docs/zh/`, written against the tree rather than translated from a moving
  target. mosd.md was a M2 brief under five dated amendments claiming schema v4
  in one heading and v7 in another while the code is at v8, and five reconcilers
  where seven are registered; the amendments are collapsed into one statement of
  where the design stands.
- **Tests.** Measurement did not support a broad prune — `os/verify` runs a
  0.84 test-to-source ratio and `os/build` 1.06, close to one test file per
  module — so only what lost its subject went: the citation gate's negative
  suite, and `os-layout-lint-test`, a filename filter over a suite
  `os-verify-test` runs whole and which nothing invoked. `test/apid-api` is
  recorded as the manual harness it already was. The index gate's negative suite
  stayed green at 17/17; its plan cases now mint their own completed plan rather
  than borrowing a real one the pruning rule would delete.

Left open deliberately: 97 references to deleted records remain in 24 non-docs
files, mid-sentence in doc comments and in the generated `openapi.json`. They
resolve in the history, and clearing them costs a 24-file prose edit plus a
regeneration.

**Amendment 1 (same day).** Two things the milestones left short. Code no
longer cites task or plan records at all — 390 references across 125 files,
including the doc comments `utoipa` publishes into `openapi.json`, so an API
client was being shown `docs/task/RFCT-210.md`. The document was regenerated
from the corrected source, never hand-edited. Doing that surfaced two classes
M1's own dangling check had missed by requiring a `.md` suffix: 179 record
references in the living design documents and 94 pointers at the deleted
`docs/research/`. Both are now zero. `docs/zh/design/` also grew from six
documents to all sixteen.

## PLAN-021 — The defect and debt batch (2026-08-28)

Fifteen of the sixteen filed tasks closed: RFCT-094, RFCT-096, RFCT-129
through RFCT-134, and RFCT-136 through RFCT-142; the sixteenth, RFCT-135,
grew into PLAN-022 rather than closing here. Alongside the filed batch,
RFCT-180 delivered the M1 quick-fix batch (test timeouts, the audit-trail
flake, dead instructions and dead code), and RFCT-190/191 ran the M3 ghost
sweeps — stale provenance references across os/** re-measured and repointed
or dated, plus the docs-side re-measures, owner sweep, and gate repairs.

The five defect clusters, by outcome:

- **Credential and auth**: the admin password is changeable after setup
  (RFCT-134), /healthz states what it actually checks (RFCT-131), and one
  outage no longer reports as both 502 and 503 (RFCT-140).
- **API/bus plumbing**: uptime comes from mosd instead of apid's own
  /proc read (RFCT-129), the three settings failures reach the API as
  distinct errors (RFCT-130), per-request GetSettings round trips are
  cached (RFCT-132), and apid receives mosd's SettingsChanged (RFCT-133).
- **Hardening**: apid's unit sandboxes the filesystem it serves
  (RFCT-137), cargo-deny enforces the no-C posture it previously only
  named (RFCT-138), the unreachable bundle store's fate is decided and
  recorded (RFCT-136), and the traversal guards gained over-the-wire
  coverage with a bundle-carrying fixture (RFCT-141).
- **Device**: the U-Boot boot-credit read is ordered against writers
  (RFCT-142), and the production keyring provisioning path is documented
  and testable while staying fail-closed (RFCT-139).
- **Test honesty**: dotted keys' missing item objects are certain rather
  than theoretical (RFCT-094), and "0 skipped" no longer hides skips
  (RFCT-096).
