# P1-B writable-path audit harness

The observation harness behind
`docs/task/20260908-1712-p1-writable-path-audit.md`.
It **observes** writers; it changes no layout, unit, tmpfiles rule or overlay,
and nothing here is installed into an image — `tests/` is in no producer's
`BUILD_CONTEXTS` and in no `rootfs/compose` Dockerfile context.

## Why it exists

The plan's §5 requires each remaining writer's persistence, write/rename
behaviour, initialization, dependency, capacity limit and reset treatment to be
*recorded*, and a directory's presence in the factory image is explicitly not
evidence that it needs to be writable. Answering that from unit files alone
gives the declared half. This gives the observed half: what a real boot writes,
and what breaks when the paths it wrote to stop being writable.

## The scripts

| Script | What it does |
|---|---|
| `extract-root.sh <board>` | unpack `_out/<board>/factory-root.oci` into the work dir |
| `audit-root.sh <board>` | the static sweep over an extracted root: enabled units, exec directories, `PrivateTmp=`, tmpfiles rules, the factory `/var` tree, which bind targets exist, `libwtmpdb` consumers |
| `boot.sh <label> <mode>` | one x64 QEMU boot with a way in, then `probe.sh` over SSH |
| `probe.sh [mode]` | runs **inside the guest**; `observe`, `candidate` or `verify` |
| `seed-data.sh <file> <path>` | write into the DATA partition of the prepared disk (`tools/qemu-seed-state.sh`'s technique, pointed at DATA) |

## How writers are enumerated without strace

The image ships no `strace`. It does not need one: every file in the factory
`/var` tree carries the build's `SOURCE_DATE_EPOCH` (`2020-01-01`) and the
assembler fills EPHEMERAL from that tree with `mkfs.ext4 -d`, so anything under
`/var` with a later timestamp was written at runtime. `probe.sh` runs

```sh
find /var -xdev \( -newermt 2021-01-01 -o -newerct 2021-01-01 \) -printf '%y %M %u:%g %s %p\n'
```

which is a complete enumeration of that boot's writers rather than a sample.
The negative direction is measured too: `candidate` mode remounts `/var`
read-only and restarts the services, so "this path needs no writable backing" is
tested rather than asserted.

## The way in, and why it is not a seeded unit

A unit dropped into `/mnt/state/systemd-units` **never runs**. systemd
enumerates `multi-user.target.wants` when it builds the initial transaction,
which is before `usr-local-lib-systemd-system.mount` has bound STATE over
`/usr/local/lib/systemd/system`; the entry does not exist yet, and nothing
issues a `daemon-reload` afterwards. Measured on the first boot of this audit:
the mount succeeds and the unit is still never loaded.

`boot.sh` therefore uses the shipped `systemd-ssh-generator`, driven entirely
from the kernel command line so the image is untouched:

- `systemd.ssh_listen=22` makes the generator publish `sshd-extra.socket`;
- `systemd.set_credential_binary=tmpfiles.extra:<base64>` hands
  `systemd-tmpfiles-setup.service` a snippet that writes the harness public key
  to `/root/.ssh/authorized_keys`. That service runs at `sysinit.target`, after
  `local-fs.target`, so `/root` and `/etc/ssh` are bound by then.

Three earlier routes were tried and rejected, each with the same
`Permission denied (publickey)`; they are recorded in `boot.sh`'s header so
they are not retried.

## Running it

```sh
# static half, per board
bash tests/p1-writable-path-audit/extract-root.sh x64-dev
bash tests/p1-writable-path-audit/audit-root.sh  x64-dev

# runtime half: prepare the disk once, then boot it three times
MICA_PRODUCT=x64-dev bash tests/apid-api/run.sh --dry-run   # the product names the board, image and signer
MICA_PRODUCT=x64-dev bash tests/p1-writable-path-audit/boot.sh observe   observe
MICA_PRODUCT=x64-dev bash tests/p1-writable-path-audit/boot.sh candidate candidate
bash tests/p1-writable-path-audit/boot.sh verify    verify
```

The three boots share one disk on purpose: `candidate` installs the candidate
layout and is powered down cleanly so the real `ExecStop=save` runs against a
read-only `/var`, and `verify` is the same device after that power cycle.

Outputs land in `$P1_WORK` (default `.tmp/p1-writable-path-audit/`): a console
capture and a `probe-<label>.txt` per boot. Probe lines are prefixed
`P1AUDIT|`.
