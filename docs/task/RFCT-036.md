# RFCT-036 Image and verifier integration: profile default flip, static-enable removal, seven assertions

- **status**: implementation complete — `bash mosd/hack/check.sh`,
  `make os-shadow-test`, both image builds with both profiles and both
  verifiers, `make os-health-test` and `make os-repart-test` all green; no
  on-device sshd behaviour is claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 13:05

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/1laqmea7`, merged by
L2 into `bkd/hiu25adw`.

## Description

Last seam of the SSH access campaign. RFCT-032 added
`access.ssh.authorizedKeys`; RFCT-033 made the operator-set root password
transient; RFCT-034 made the sshd reconciler render the keys and gate
`PasswordAuthentication`; RFCT-038 made the shadow append newline-safe.

Every one of those is invisible from the image. This task closes that: the
profile default flips, the image stops shipping a statically enabled sshd, and
the campaign's claims become assertions the verifiers actually make.

## The profile flip

`Profile::ssh_enabled_default()` returned `true` for `Dev` and `false` for
`Prod`. It now returns `false` for both.

**The two profiles now seed identical trees.** SSH was the only value that had
ever differed between them, so after this change `Profile` selects nothing at
all. That is stated plainly on the enum rather than left as a distinction the
doc still claims and the code no longer makes.

`Profile` is deliberately NOT deleted, and the recommendation is that it stay:

- `read_profile`'s fail-closed parsing is load-bearing on its own. A missing,
  unreadable, mis-keyed or unrecognised profile file must resolve to the
  conservative variant rather than propagate as an error, and
  `profile_matrix_fails_closed` covers every way of being malformed. That logic
  needs a type to resolve *to*.
- A per-profile default is exactly the kind of thing that gets re-introduced.

`ssh_enabled_default` is written as an exhaustive `match` returning `false` from
one arm rather than a bare `false`, so re-introducing a per-profile answer is a
one-arm edit the compiler checks, and a new variant cannot silently inherit the
current answer.

The `tracing::warn!` text is unchanged, as required. `read_profile`'s doc no
longer justifies fail-closed by "guessing dev would open SSH on a production
device" — nothing opens SSH now — but records that the rule is kept because it
is the safe direction to be wrong in and the rationale returns the moment any
value becomes profile-dependent again.

**Tests.** `dev_profile_seeds_ssh_on_and_prod_seeds_it_off` became
`neither_profile_seeds_ssh_on`, asserting `false` for both. The prod-side
assertion is unchanged and deliberately retained — dropping it would leave the
fail-closed direction untested. `fresh_state_is_seeded_and_persisted` already
asserted "prod profile must not open SSH" and still does.

## The static-enable removal, and the window it closes

Both Dockerfiles enabled `ssh.service` in the image when `MOS_PROFILE=dev`.
With `access.ssh.enabled` now false in both profiles, that image would come up
with sshd **listening from early boot until mosd's first reconcile stopped it**.

That window is the whole reason the setting exists. An operator's first boot is
exactly when they have no keys installed and no transient password set, so a
listening sshd during that window is a device answering on port 22 with no
configured way in and no configured way to be sure nobody else gets in. mosd
stopping it a moment later does not un-listen it.

So `ssh.service` is now left DISABLED in the image for both profiles, and the
surrounding comments in both Dockerfiles explain that rule instead of the old
one. `os/rootfs/build.sh` and `os/rootfs/build-v2.sh` carried header comments
saying the profile seeds `access.ssh.enabled`; both now say that it no longer
selects that seed and that neither image ships `ssh.service` enabled.

`ROOT_PASSWORD` is untouched and still works. A dev debug image still bakes the
credential; it simply no longer answers on port 22 until something enables it.

## The seven assertions

Applicability differs between the two layouts. v1's root is a writable ext4 with
no A/B update, no verity and no STATE binds, so it ships no sshd drop-in, no
`etc-ssh.mount`, no `/usr/share/factory/etc/shadow` and no
`mos-shadow-reconcile`. Where an assertion is v2-only, `os/verify-image.sh` says
so in a comment at the point it would otherwise appear, rather than skipping
silently.

| # | assertion | v1 | v2 | what it protects |
| --- | --- | --- | --- | --- |
| 1 | `ssh.service` NOT enabled in the image, both profiles | yes | yes | the early-boot listening window |
| 2 | factory shadow root is `!`/`*`-locked, EMPTY fails loudly | yes (`/etc/shadow`) | yes (`/usr/share/factory/etc/shadow`) | a fleet-wide shared root login |
| 3 | the static `AuthorizedKeysFile` drop-in, and only it | — | yes | keys surviving an A/B update |
| 4 | `mos-shadow-reconcile.service` present AND enabled AND its script clears the marker | — | yes | "transient" actually being transient |
| 5 | no `MOS_SHADOW_PASSWD` / `MOS_SHADOW_FACTORY` override in the unit or its drop-in dirs | — | yes | root credentials reconciled against the wrong files |
| 6 | every external binary the `/usr/lib/mos` boot scripts invoke exists | yes | yes | a silently slimmed base image |
| 7 | `ssh.service` sets `KillMode=process` | yes | yes | an operator disconnecting themselves |

### 1 — profile flip, both directions

The old assertion pointed the other way (dev implies enabled). It is replaced,
not weakened: the profile value is still read out of the packed image, so the
check reports which profile it judged, and any enablement symlink under any
`*.wants` directory fails it. v1 previously looked only at
`multi-user.target.wants`; it now scans every `*.wants` directory and both
`ssh.service` and `sshd.service` (the unit's `Alias=`), so an enablement that
came back through a different target is still caught.

### 2 — factory shadow root is locked

This assertion already existed in both verifiers and is unchanged. It is listed
and negative-tested here because the campaign now depends on it much more
directly: with root having no password by default, an EMPTY hash field is not a
cosmetic defect but passwordless root. Both verifiers already distinguish empty
from locked and fail on empty with an explicit message saying why.

### 3 — the drop-in ships and says the right thing (v2 only)

Four properties, not one:

- `/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf` is a regular file;
- it sets exactly `AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u`;
- that path is inside the directory `etc-ssh.mount` binds, and that mount's
  `What=` is under `/mnt/state` — which is what makes installed keys survive an
  A/B update. `Where=` and `What=` are READ from the unit rather than restated,
  so retargeting the mount cannot leave this passing against a stale path;
- no OTHER shipped sshd config emits `AuthorizedKeysFile`. sshd keeps the FIRST
  value it reads for this keyword and reads `sshd_config.d` in lexical order, so
  a second emitter would make the effective path depend on filenames.

### 4 — the unit runs, and the script does the thing

`sq_regular` and `sq_enabled` on `mos-shadow-reconcile.service` already existed;
"the unit exists" is not "the unit runs", and the enablement half was already
covered. What is added is the other half: the script the unit runs actually
carries the transient-marker clearing. A reconciler stripped back to the
account-sync path would leave a "transient" password permanent while the unit,
its ordering and its enablement all still looked healthy.

### 5 — the test-harness overrides stay inert

`MOS_SHADOW_PASSWD` and `MOS_SHADOW_FACTORY` exist so
`os/shadow-reconcile-test.sh` can drive the real script against fixtures. They
are safe only while nothing in the image sets them. Checked in the shipped unit
AND in both drop-in directories (`/etc/systemd/system/...service.d/` and
`/usr/lib/systemd/system/...service.d/`), because a drop-in overrides the unit
invisibly and would silently redirect where root's credentials are reconciled.

### 6 — the boot scripts' binary inventory

Newly load-bearing: RFCT-038's newline-safety fix introduced a dependency on
`od`, and neither Dockerfile installs `coreutils` explicitly — it is inherited
from the base image and would vanish without a word if the base were slimmed.
These scripts run at boot, as root, outside any package's dependency graph, so
nothing in the image declares what they need.

Command names are extracted from the scripts **in the packed image**, not from
the repo copy, and each is resolved through the image's own bin directories with
symlinks chased WITHIN the image — so a dangling `/etc/alternatives` entry fails
rather than passes. A vacuity guard fails the check if the extractor stops
seeing commands, since an empty set would otherwise pass while proving nothing.

The extractor is deliberately conservative — command position only. It finds 31
commands on v2 and 12 on v1. See "What is NOT proven" for what it misses and why
that is the right call.

### 7 — `KillMode`, and how it turned out

**The finding is positive: Debian's `openssh-server` does ship
`KillMode=process`, and both images carry it.** It is asserted now rather than
assumed.

It matters because this campaign made the sshd drop-in re-render when a
transient password appears, and a changed drop-in restarts `ssh.service`. Under
the systemd default `KillMode=control-group` a restart kills every process in
the unit's cgroup — including the forked session carrying the operator's own SSH
connection — so an operator setting a transient root password while logged in
over SSH would disconnect themselves. `KillMode=process` kills only the listener.

This is an inherited property of a packaged unit the image does not author, and
it had never been asserted. Now it is, in both verifiers, in both directions.

## Verifier check counts

| image | profile | before | after |
| --- | --- | --- | --- |
| v1 | dev | 125 | 127 |
| v1 | prod | 125 | 127 |
| v2 | dev | 291 | 299 |
| v2 | prod | 291 | 299 |

No check was removed. v1 gains 2 (binary inventory, `KillMode`); v2 gains 8
(binary inventory, `KillMode`, marker clearing, override ban, and four
drop-in properties). The `ssh.service` enablement check was replaced 1:1 — same
check, opposite expected value — so it does not move the count.

**The "before" figures are not the pristine tree.** See the next section.

## A pre-existing verifier break, repaired here

Both verifiers failed on the campaign baseline, before any change of mine:

```
FAIL: sshd.rs pins 0 distinct crypt(3) prefixes ()
FAIL: cannot check the crypt(3) format against the image's libcrypt: prefix count 0
```

Cause: predecessor commit `63833db` (RFCT-033) moved the code that writes the
root hash out of `reconciler/sshd.rs` into `transient.rs`, and the
`starts_with("$2b$12$")` assertion the verifiers read the crypt prefix from moved
with it. Both verifiers still pointed `SSHD_SRC` at `sshd.rs`, found nothing,
and failed. Pristine v1 dev was `RESULT: FAIL (123/125)`.

Repaired by retargeting the pointer to `mosd/mosd/src/transient.rs` in both
verifiers (both are in this task's scope; `transient.rs` itself is not touched).
The extracted prefix is `$2b$` and the packed arm64 libcrypt implements it, so
the assertion is meaningful again rather than merely quiet.

The before/after counts above are both measured WITH this repair applied, since
that is the only baseline against which the deltas mean anything. Without it the
"before" numbers are 123/125 and 289/291, failing.

## Assertions proven to fail when broken

Every one of the seven was exercised by temporarily breaking the property in a
scratch copy of the verifier — the breakage is injected into the extracted image
tree immediately after unpacking (v2) or written into the extracted ext4 with
`debugfs -w` (v1) — confirming the specific check FAILs, then restoring the file
byte-for-byte. Both verifiers were confirmed clean afterwards.

| # | breakage | verifier | result |
| --- | --- | --- | --- |
| 1 | create `multi-user.target.wants/ssh.service` | v2 | FAIL, 298/299 |
| 1 | same, via `debugfs -w symlink` | v1 | FAIL, 126/127 |
| 2 | root hash field emptied | v2 | FAIL, "EMPTY hash field" |
| 2 | root hash replaced with a usable bcrypt hash | v2 | FAIL, "usable root password hash" |
| 2 | root hash field emptied | v1 | FAIL, "EMPTY hash field" |
| 3 | `AuthorizedKeysFile` retargeted to `/root/.ssh/authorized_keys` | v2 | FAIL x2, 297/299 |
| 3 | `etc-ssh.mount` `What=` moved off `/mnt/state` | v2 | FAIL, "not under /mnt/state" |
| 3 | second drop-in `99-rogue.conf` emitting `AuthorizedKeysFile` | v2 | FAIL, "2 shipped sshd config files" |
| 4 | enablement symlink removed | v2 | FAIL, "enablement symlink missing" |
| 4 | `rm -f "$MARKER"` neutered | v2 | FAIL, "never removes it" |
| 5 | `Environment=MOS_SHADOW_FACTORY=` appended to the unit | v2 | FAIL, names the unit |
| 5 | `EnvironmentFile=` naming `MOS_SHADOW_PASSWD` in a drop-in dir | v2 | FAIL, names the drop-in |
| 6 | `/usr/bin/od` deleted | v2 | FAIL, "NOT in the packed rootfs: od" |
| 6 | `/etc/alternatives/awk` deleted (dangling symlink) | v2 | FAIL, "NOT in the packed rootfs: awk" |
| 6 | `/usr/sbin/modprobe` deleted | v1 | FAIL, "NOT in the packed rootfs: modprobe" |
| 6 | shebangs stripped so the extractor sees nothing | v2 | FAIL, "would pass vacuously" |
| 7 | `KillMode=process` -> `KillMode=control-group` | v2 | FAIL, reports the found value |
| 7 | `KillMode=` line deleted entirely | v2 | FAIL, reports empty |
| 7 | `KillMode=process` -> `KillMode=control-group` | v1 | FAIL, reports the found value |
| 7 | `ssh.service` unit removed | v1 | FAIL, "no claim can be made about KillMode" |

## Files changed

| file | change |
| --- | --- |
| `mosd/mosd/src/provisioning.rs` | `ssh_enabled_default()` false for both; enum, method and `read_profile` docs; test renamed and flipped |
| `os/rootfs/Dockerfile` | `ssh.service` left disabled unconditionally; comment rewritten |
| `os/rootfs/Dockerfile.v2` | same |
| `os/rootfs/build.sh` | header comment corrected |
| `os/rootfs/build-v2.sh` | header comment corrected |
| `os/verify-image.sh` | assertions 1, 6, 7; v2-only note; crypt-prefix repair |
| `os/verify-image-v2.sh` | assertions 1, 3, 4, 5, 6, 7; crypt-prefix repair |

`os/rootfs/overlay-v2/**`, `mosd/mosd/src/reconciler/**`, `mosd/mosd/src/transient.rs`,
`mosd/mosd-settings/**`, `mosd/webd/**`, `os/shadow-reconcile-test.sh` and
`docs/task/index.md` are untouched. No `/home` mountpoint assertion was added —
RFCT-039 owns that.

## Verification (2026-08-19)

All run from the repo root with `BOARD_DIR=/srv/ai/mos/board/cx3576` and
`TMPDIR=$PWD/_out/tmp`.

| command | result |
| --- | --- |
| `bash mosd/hack/check.sh` | ALL CHECKS PASSED, 276 tests |
| `make os-shadow-test` | 220 passed, 0 failed |
| `make os-image-cx3576` + `bash os/verify-image.sh`, `MOS_PROFILE=dev` | PASS 127/127 |
| `make os-image-cx3576` + `bash os/verify-image.sh`, `MOS_PROFILE=prod` | PASS 127/127 |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh`, `MOS_PROFILE=dev` | PASS 299/299 |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh`, `MOS_PROFILE=prod` | PASS 299/299 |
| `make os-health-test` | PASS 54/54 |
| `make os-repart-test` | PASS 18/18 |

## What is NOT proven

**No hardware claim is made. Nothing here proves sshd behaves on a device.**
Every assertion in this task is a statement about bytes in a packed image or
about mosd's seeding logic on the test host. That an image ships `ssh.service`
disabled is not proof that a booted device has no listener; that
`AuthorizedKeysFile` names a STATE-backed path is not proof that a key placed
there authenticates; that `KillMode=process` is set is not proof that an
established session survives a restart on real hardware. All of that is only
observable on a real boot and none of it was performed.

**The binary inventory is conservative by construction.** It takes command names
at command position only, so commands the scripts invoke through their own
`run`/`have` wrappers — `busctl`, `rauc`, `systemctl`, `curl`, `wget` — are NOT
in the set. That is deliberate and not a gap to close: `mos-health` uses
`have X ||` precisely to mark `curl` and `wget` OPTIONAL, and asserting those
exist would assert something the scripts explicitly do not require. `rauc` and
`busctl` are separately asserted present by other checks. The extractor also
strips quoted spans and `case` patterns heuristically; a command constructed
through a variable would be missed entirely.

**The v1 side of assertion 2 is weaker than it looks.** v1 has no factory shadow,
so the check reads `/etc/shadow` directly — which is the file that ships, but on
v1 that file is also the one the device writes to. It proves nothing about what
the device ends up with.

**Assertion 4 proves the clearing code is present, not that it runs correctly.**
That the script names a marker and removes it is a text property.
`make os-shadow-test` (RFCT-033's harness, 220 checks) is what exercises the
behaviour, and it is unchanged by this task.

**The profiles seeding identically is asserted only in mosd's unit tests.** No
verifier compares the two built images to each other; the profile-dependent
verifier checks read the profile out of the image and assert the same expected
value for both, which is a weaker statement than "the images agree".

## ActiveForm

Image and verifier integration for the SSH access campaign: profile default
flipped to off in both profiles, static sshd enablement removed from both
images, seven assertions added or replaced across both verifiers, each proven to
fail when its property is broken.

## Dependencies

- RFCT-032 (settings v4 `authorizedKeys`) — merged
- RFCT-033 (transient root password, marker, shadow reconcile) — merged
- RFCT-034 (sshd reconciler, `AuthorizedKeysFile` drop-in) — merged
- RFCT-038 (newline-safe shadow append; introduced the `od` dependency) — merged
- RFCT-039 (`/home` mountpoint) — sibling, owns its own assertion
