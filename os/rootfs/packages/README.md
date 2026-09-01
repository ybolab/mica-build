# Rootfs package manifests

This directory decides **what** a rootfs contains. It does not build anything,
install anything or start anything: `resolve.sh` reads the manifests beside it
and prints the exact package set the composer hands to APT.

## Manifest format

Plain text, **one package name per line**. `#` starts a comment and runs to end
of line; blank lines are ignored. There is no logic, no conditional, no
include and no variable: a manifest is a list, and everything that decides
which lists are read is an argument to `resolve.sh`.

A line naming a package that no producer emits is refused by name.
`bash os/build-env/deb/producers.sh` is the only authority on which packages
exist, and `resolve.sh` reads it at run time rather than carrying a copy.

## Families

The filename is what selects a manifest. Five families, and a file belonging to
none of them is refused rather than ignored — a manifest nothing reads is a
package set that never reaches an image and never fails a build either.

| File | Read when |
| --- | --- |
| `common.pkgs` | always |
| `profile-<profile>.pkgs` | `--profile <profile>`; exactly one |
| `board-<board>.pkgs` | `--board <board>`; exactly one |
| `radio-<radio>.pkgs` | `--radios` names `<radio>`, unless `radios` is declined |
| `feature-<feature>.pkgs` | `--without` does **not** name `<feature>` |

The features are the `feature-*.pkgs` basenames plus **`radios`**, which has no
manifest of its own: the radio packages are per-radio and `--radios` selects
them, so `radios` is the switch deciding whether that family is consulted at
all. It is the same thing `MOS_ROOTFS_WITHOUT=radios` means to
`os/rootfs/build.sh`, which drops the radio packages whatever the board
declares.

`radio-wifi.pkgs` names both `mos-wifi` and `mos-wifi-ap` because the single
radio name `wifi` has always meant `wpasupplicant` **and** `hostapd`: a board
declares that it has the radio, not which of station and access-point mode it
will be asked to run.

## The resolver

```sh
bash os/rootfs/packages/resolve.sh \
    --board cx3576 --profile dev --radios "wifi bluetooth" --without ""
```

All four arguments are required; `--radios ""` and `--without ""` are how a
build says "none". Output is one package name per line, `LC_ALL=C` sorted and
deduplicated, so two runs over one set of inputs are byte-identical and a diff
of two resolutions is a diff of the images.

**Every input is an argument and none is re-derived.** `resolve.sh` does not
read `os/boards/<board>/board.env`, `os/boards/<board>/bsp/containers.env`, or
`WITH_MOSD` / `WITH_CONTAINERS` / `MOS_ROOTFS_WITHOUT` / `MOS_PROFILE` from the
environment. `os/rootfs/build.sh` already owns every one of those decisions —
which board file is read, which environment variable beats which file, how the
historical `WITH_*` spellings fold into one decline list. A second copy of that
logic here is the second table this repository keeps deleting, and the two would
disagree about a build the day either changed. The driver owns the decisions;
this directory owns the manifest set.

### Refusals

Each has its own message, naming what was wrong and what the legal values are:

- an unknown feature in `--without`, an unknown `--board`, `--profile` or
  `--radios` entry;
- a manifest line naming a package no producer declares;
- a manifest line naming more than one package;
- a manifest whose filename belongs to no family;
- a resolution carrying both `mos-profile-dev` and `mos-profile-prod`, or
  neither;
- an empty resolution, or one with no board package.

`os/tests/rootfs-manifest-test.sh` (`make os-rootfs-manifest-test`) drives all of
them, proves each red by perturbing a **copy** of this directory under `tmp/`,
and asserts the reverse direction: every package every producer declares is
reachable by some legal resolution.

## Ruling: nothing should depend on the virtual `mos-profile` — yes, `mosd` should

PLAN-036 open decision (g).

### Measured first

`mos-profile` is declared in `Provides` by `mos-profile-dev` and
`mos-profile-prod` (`os/rootfs/packages-src/profile/control/`) and by nothing
else. Reading the `Depends` field of all ten control templates in the tree —
the board packages, `mosd`, `mos-apid`, the two MQTT packages, `mos-podman`,
`mos-rauc`, `mos-system`, `mos-ca-trust` and the three radio packages — **no
dependency anywhere names `mos-profile`**. Every dependency is either
local-real (`mos-system`, `mosd`, pinned to `(= @VERSION@)`) or external
(`systemd`, `passwd`, `bluez`, `${shlibs:Depends}`, …).

So `os/tests/deb-package-gate.sh`'s local-virtual branch — the `PROVIDED_BY`
lookup that increments `VIRTUAL_RESOLVED_N` — would count **0** today, in both
architecture pools. Its `RESULT` line would print `0 local-virtual dependencies
resolved` and its note line an empty list. The branch has no material.

### The ruling: **yes** — `mosd` should declare `Depends: mos-profile`

`mosd` reads `/usr/lib/mos/profile.conf` (`DEFAULT_PROFILE_PATH`,
`os/pkgs/mosd/mosd/src/provisioning.rs`) once on first boot, and that path is
the entire payload of the two profile packages and of nothing else. `mosd`
**fails closed**: a missing file resolves to `Prod`, which is SSH off. So a
composition that installed `mosd` and no profile package would produce an image
that behaves as production, with every existing check green — the exact failure
`os/rootfs/README.md` describes for a misspelt profile value, arrived at from a
different direction.

That is a real runtime relationship, and it would be worth declaring if the
gate's counter did not exist: it is what `os/rootfs/packages-src/README.md`
already says the `Provides` pair is for — "`mos-profile` is what a package that
needs 'some profile is installed' depends on" — and today nothing does, so the
pair is a statement with no reader. `resolve.sh`'s "exactly one profile package"
refusal is a **build-time** check on the manifest set; the dependency is the
**install-time** one, and it is the half that survives a composer that bypasses
this resolver, an operator `apt-get install mosd`, or a manifest edited on a
branch where this test does not run.

On `mosd` specifically:

- not `mos-system`, which is in every image including ones that decline `mosd`.
  Nothing reads `profile.conf` there, so the dependency would be false.
- not a new metapackage. A producer created to hold one dependency line is the
  manufactured shape this decision exists to avoid.
- `mos-apid`, `mos-mqttd` and `mos-mqtt-broker` already depend on `mosd` at the
  exact version, so they inherit it; no other control template changes.

Unversioned, necessarily: an unversioned `Provides` cannot satisfy an
exact-version dependency, which is why the gate does not require a version pin
on this class.

**Not implemented in this L3**: `os/pkgs/mosd/deb/mosd/control/mosd.control`
belongs to a sibling producer's workstream. Whoever lands it should also confirm
what APT does when a `Depends: mos-profile` is unsatisfied and two mutually
conflicting packages provide it — the intent is that the transaction fails by
name rather than an arbitrary provider being chosen, and that needs built pools
to exercise.
