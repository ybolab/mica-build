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
`bash build-env/deb/producers.sh` is the only authority on which packages
exist, and `resolve.sh` reads it at run time rather than carrying a copy.

## Families

The filename is what selects a manifest. The supported families are below; a file belonging to
none of them is refused rather than ignored — a manifest nothing reads is a
package set that never reaches an image and never fails a build either.

| File | Where | Read when |
| --- | --- | --- |
| `common.pkgs` | here | always |
| `profile-<profile>.pkgs` | here | `--profile <profile>`; exactly one |
| `radio-<radio>.pkgs` | here | `--radios` names `<radio>` and `--without` does **not** |
| `feature-<feature>.pkgs` | here | `--without` does **not** name `<feature>` |
| `board.pkgs` | the board bundle | always; the board package |
| `radio-<radio>.pkgs` | the board bundle | selected board and non-declined radio; adds the board's transport packages |
| `component-<component>.pkgs` | the board bundle | explicitly named in `--components`; default-off |

The board's manifests live in the board repository (`mica-boards:<board>/manifests/`)
and reach this tree inside the board bundle, under `_out/boards/<board>/manifests/`
after `make board-fetch BOARD=<board>`; `--board-dir` names that directory. A
`board-*.pkgs` or `component-*.pkgs` in this directory is refused: what a board
installs travels with the board.

The `--without` tokens are the `feature-*.pkgs` basenames plus the
`radio-*.pkgs` basenames: each radio is its own decline token, so
`MICA_ROOTFS_WITHOUT=bluetooth` keeps Wi-Fi and vice versa. There is no
umbrella `radios` token -- `--radios` is the board's statement of which radios
the hardware has, `--without <radio>` is the build's decision to leave one out
anyway, and the two compose per radio. A radio and a feature sharing one name
is refused as ambiguous.

`radio-wifi.pkgs` names both `mica-wifi` and `mica-wifi-ap` because the single
radio name `wifi` has always meant `wpasupplicant` **and** `hostapd`: a board
declares that it has the radio, not which of station and access-point mode it
will be asked to run.

## The resolver

```sh
bash rootfs/packages/resolve.sh \
    --board cx3576 --board-dir _out/boards/cx3576/manifests \
    --profile dev --radios "wifi bluetooth" --without ""
```

All five arguments are required; `--radios ""` and `--without ""` are how a
build says "none". Output is one package name per line, `LC_ALL=C` sorted and
deduplicated, so two runs over one set of inputs are byte-identical and a diff
of two resolutions is a diff of the images.

**Every input is an argument and none is re-derived.** `resolve.sh` does not
read `_out/boards/<board>/board.env`, or
`WITH_MOSD` / `WITH_CONTAINERS` / `MICA_ROOTFS_WITHOUT` / `MICA_PROFILE` from the
environment. `rootfs/build.sh` already owns every one of those decisions —
which board file is read, which environment variable beats which file, how the
historical `WITH_*` spellings fold into one decline list. A second copy of that
logic here is the second table this repository keeps deleting, and the two would
disagree about a build the day either changed. The driver owns the decisions;
this directory owns the manifest set.

### Refusals

Each has its own message, naming what was wrong and what the legal values are:

- an unknown feature in `--without`, an unknown `--profile` or `--radios`
  entry, a `--board-dir` with no `board.pkgs`;
- a manifest line naming a package no producer declares;
- a manifest line naming more than one package;
- a manifest whose filename belongs to no family;
- a resolution carrying both `mica-profile-dev` and `mica-profile-prod`, or
  neither;
- an empty resolution, or one with no board package.

`tests/rootfs-manifest-test.sh` (`make os-rootfs-manifest-test`) drives all of
them, proves each red by perturbing a **copy** of this directory under `tmp/`,
and asserts the reverse direction: every package every producer declares is
reachable by some legal resolution.

## Ruling: nothing should depend on the virtual `mica-profile` — yes, `micad` should

PLAN-036 open decision (g).

### Measured first

`mica-profile` is declared in `Provides` by `mica-profile-dev` and
`mica-profile-prod` (`mica-system:profile/control/`) and by nothing
else. Reading the `Depends` field of all ten control templates in the tree —
the board packages, `micad`, `mica-apid`, the two MQTT packages, `mica-podman`,
`mos-rauc`, `mica-system`, `mica-ca-trust` and the three radio packages — **no
dependency anywhere names `mica-profile`**. Every dependency is either
local-real (`mica-system`, `micad`, pinned to `(= @VERSION@)`) or external
(`systemd`, `passwd`, `bluez`, `${shlibs:Depends}`, …).

So `build-env/deb/package-gate.sh`'s local-virtual branch — the `PROVIDED_BY`
lookup that increments `VIRTUAL_RESOLVED_N` — would count **0** today, in both
architecture pools. Its `RESULT` line would print `0 local-virtual dependencies
resolved` and its note line an empty list. The branch has no material.

### The ruling: **yes** — `micad` should declare `Depends: mica-profile`

`micad` reads `/usr/lib/mica/profile.conf` (`DEFAULT_PROFILE_PATH`,
`micad:micad/src/provisioning.rs`) once on first boot, and that path is
the entire payload of the two profile packages and of nothing else. `micad`
**fails closed**: a missing file resolves to `Prod`, which is SSH off. So a
composition that installed `micad` and no profile package would produce an image
that behaves as production, with every existing check green — the exact failure
`rootfs/README.md` describes for a misspelt profile value, arrived at from a
different direction.

That is a real runtime relationship, and it would be worth declaring if the
gate's counter did not exist: it is what `mica-system:README.md`
already says the `Provides` pair is for — "`mica-profile` is what a package that
needs 'some profile is installed' depends on" — and today nothing does, so the
pair is a statement with no reader. `resolve.sh`'s "exactly one profile package"
refusal is a **build-time** check on the manifest set; the dependency is the
**install-time** one, and it is the half that survives a composer that bypasses
this resolver, an operator `apt-get install micad`, or a manifest edited on a
branch where this test does not run.

On `micad` specifically:

- not `mica-system`, which is in every image including ones that decline `micad`.
  Nothing reads `profile.conf` there, so the dependency would be false.
- not a new metapackage. A producer created to hold one dependency line is the
  manufactured shape this decision exists to avoid.
- `mica-apid`, `mica-mqttd` and `mica-mqtt-broker` already depend on `micad` at the
  exact version, so they inherit it; no other control template changes.

Unversioned, necessarily: an unversioned `Provides` cannot satisfy an
exact-version dependency, which is why the gate does not require a version pin
on this class.

**Not implemented in this L3**: `micad:deb/micad/control/micad.control`
belongs to a sibling producer's workstream. Whoever lands it should also confirm
what APT does when a `Depends: mica-profile` is unsatisfied and two mutually
conflicting packages provide it — the intent is that the transaction fails by
name rather than an arbitrary provider being chosen, and that needs built pools
to exercise.

## Optional board components

`MICA_ROOTFS_COMPONENTS="bm201-front-panel mqtt-reference" MICA_BOARD=s905x5m
bash rootfs/build.sh` selects those component packages. Leave the variable
unset to omit both. The resolver accepts the same space-separated list as
`--components`. An unknown component or one belonging to another board is
refused. `mqtt-reference` requires the dev profile and all MQTT packages;
combining it with `--without micad` is an error.
