# PLAN-911 Close four runtime gaps found by exercising containers on hardware

- **status**: implementing
- **createdAt**: 2026-08-31
- **approvedAt**: 2026-08-31
- **completedAt**: -
- **relatedTask**: RFCT-914 (M1; later milestones create their own task on dispatch)

## Context

PLAN-910's MS milestone booted a mos image from SD on the s905x5m and recorded
`--verify` at 360/371 with the eleven failures attributed to the absent
production `boot.scr`. That result is accurate and is not revisited here.

What it did not cover is whether the shipped runtime works. Exercising podman on
that same board on 2026-08-31 found four defects, none of which any existing
check could have caught. All four are mos-level: two are contract gaps in what
mos declares its own features need, and two are rootfs configuration or build
gaps. None is specific to the s905x5m, and none is blocked by M3's owner gate.

The board used throughout was `192.168.27.55`, running the SD image
`s905x5m-mos-v2-sd-1788124881.img`.

## What is already settled

### Gap 1 — the device has no time source

`systemd-timesyncd`, `chrony`, `ntpd` and `ntpsec` appear nowhere in
`os/rootfs`, `os/pkgs` or `docs/design`, and `mosd-settings`'s model carries no
NTP or timezone key. The capability was never built, so this is a feature gap
rather than a regression.

On hardware, `timedatectl` reports `System clock synchronized: no` and
`NTP service: n/a`; `RTC time` reads `n/a` even though `/dev/rtc0` exists. Every
boot returns the clock to `2026-04-13 19:38 UTC`, so time moves backward by
roughly four months on each restart. This was observed directly: a container
heartbeat written before a reboot is dated `2026-08-31T03:19:17Z` and the one
written after it is dated `2026-04-13T19:38:18Z`.

The consequence is not cosmetic. A `podman pull` failed with
`x509: certificate has expired or is not yet valid: current time
2026-04-13T19:56:54Z is before 2026-08-25T00:00:00Z` and only succeeded after
the clock was set by hand. The same mechanism reaches the RAUC/TUF update path,
whose metadata carries expiry, and MQTT TLS.

Two facts constrain the fix and were checked rather than assumed. NTP egress
works: a 48-byte client request to `pool.ntp.org` and `time.cloudflare.com` is
answered, while `192.168.27.1` and `192.168.27.200` do not serve time, so a
public or self-hosted source is required. And `/var` is a persistent ext4
partition (`/dev/mmcblk1p11`), not tmpfs, so `systemd-timesyncd`'s
last-known-time file survives a reboot and can bump the clock forward at boot.

### Gap 2 — the shared kernel floor omits what container networking needs

`podman run` with the default bridge network fails. netavark reports
`nftables error: "nft" did not return successfully while applying ruleset` with
`internal:0:0-0: Error: Could not process rule: No such file or directory`.

Capturing the ruleset netavark submits and isolating each expression identified
one failing element. In the `inet` family, `fib daddr type local` fails with
that exact error; the identical rule in the `ip` family succeeds. netavark uses
`fib daddr type local` in its `PREROUTING` and `OUTPUT` chains to gate hostport
DNAT, and builds a single dual-stack `inet netavark` table.

The board's config has `CONFIG_NFT_FIB=y` and `CONFIG_NFT_FIB_IPV4=y` but
`# CONFIG_NFT_FIB_IPV6 is not set`, and `CONFIG_NFT_FIB_INET` is absent
entirely. `net/netfilter/Kconfig` on 6.12 explains why the symbol cannot appear:

```
config NFT_FIB_INET
	depends on NF_TABLES_INET
	depends on NFT_FIB_IPV4
	depends on NFT_FIB_IPV6
```

The inet variant delegates the lookup to the IPv4 or IPv6 backend depending on
the packet, so both are required. netavark submits its ruleset as a single
transaction, so this one element rolls the whole set back — the resulting
ruleset is empty and bridge networking is unavailable rather than degraded.

This is a mos contract gap, not a board defect.
`os/boards/common/mos-required.fragment` holds nineteen entries and already
declares `CONFIG_OVERLAY_FS=y` for podman storage and `CONFIG_BRIDGE=y` for
container networking, so mos has already accepted that declaring the kernel
surface its features need is its own responsibility. It declared the bridge and
stopped short of what makes the bridge usable. `CONFIG_VETH` is likewise
undeclared; the s905x5m has it by chance, not by contract.

cx3576's config baseline
(`os/boards/cx3576/bsp/kernel/config/kernel-cx3576z.config`) carries
`# CONFIG_NFT_FIB_IPV4 is not set` and `# CONFIG_NFT_FIB_IPV6 is not set`,
which suggests the same gap there. **That is a baseline config file, not a
built `.config`, and was not checked on cx3576 hardware — treat it as
unverified until M2 measures it.** PLAN-910's M1 established why this
distinction matters: four of five reported kernel gaps were false alarms
because a baseline was compared instead of the built configuration.

### Gap 3 — SSH logins are absent from logind session tracking

Over SSH, `loginctl list-sessions` reports zero sessions and the session's
cgroup is `0::/system.slice/ssh.service`, rather than a `session-*.scope`.
This is a real session-management defect: it removes SSH users from logind's
session tracking and management, and does not establish their user slices.

It was not the cause of the historical rootful podman error
`OCI runtime error: crun: systemd not supported: Operation not supported`.
At 2026-08-31 08:29 UTC on slot A,

```
systemd-run --quiet --wait --pipe --collect \
  podman run --rm --network=none docker.io/library/alpine:3.22 echo NO-SESSION-OK
```

returned `NO-SESSION-OK`. That scope lives in `system.slice` and belongs to no
user login session, proving that rootful podman does not require an SSH session
scope. The podman error had one cause: crun was built with
`./configure --disable-systemd`, which removed its systemd cgroup capability.
`--cgroup-manager=cgroupfs` avoids that disabled crun path; it does not diagnose
or repair SSH session registration. Quadlet's existing success is compatible
with this account because systemd already owns its unit cgroup.

### What did work, and is not in scope to change

Quadlet is sound. A `.container` and `.volume` pair written to
`/etc/containers/systemd` generated both units, started, wrote to a named
volume, was registered by the generator into `multi-user.target.wants`,
restarted automatically after a reboot, and found its image, volume, unit files
and mounted script intact. The read-only root with writable state is layered
correctly: `/` is squashfs on `dm-0`, quadlet files are on `p10`, container
storage and `/srv` on `p12`, `/var` on `p11`.

### Why no existing check caught any of this

The kernel assertions compare the built `.config` against
`mos-required.fragment`. Symbols absent from the fragment cannot fail an
assertion, so a floor that omits a requirement is self-consistently green. The
371 `--verify` checks cover geometry, filesystems, kernel and DTB, verity
metadata and payloads; none starts a container or reads the clock. The suite
verifies that what is declared is satisfied, and cannot verify that what should
be declared is declared.

The repository has already paid for this lesson once. The comment beside
`systemd-repart` in `os/rootfs/stages/10-base.Dockerfile` records that on trixie
it is a separate package, that without it the unit is simply absent along with
its `sysinit.target.wants` symlink, and that DATA then never grows past 64 MiB —
"a failure that announces nothing: the device boots, and the partition is just
small". It was named explicitly rather than left to a recommends, and
`os/verify` asserts the enablement symlink. A missing time source has the same
shape: the device boots, and the clock is just wrong.

## Milestones

### M1 — Ship a time source — **completed**

Add `systemd-timesyncd` to the install list in
`os/rootfs/stages/10-base.Dockerfile`, beside `systemd-resolved` and
`systemd-repart`, which are separate Debian packages named explicitly for the
same reason.

Add an NTP settings key to `mosd-settings`'s model and a mosd reconciler that
renders a `timesyncd.conf.d` drop-in from it. This follows the pattern
`docs/design/access.md` describes for sshd, where mosd renders the only file
that configures the service. The key is a schema change and carries the usual
migration obligation.

Order the units that depend on TLS after `time-sync.target`, and enable
`systemd-time-wait-sync.service` so the barrier exists. RAUC, apid and the MQTT
bridge are the consumers that matter, because each either validates a
certificate or a TUF expiry.

Assert the enablement symlink in `os/verify` exactly as `systemd-repart`'s is
asserted, and assert `NTPSynchronized` on hardware.

**Not in scope**: authenticated time. `systemd-timesyncd` is SNTP and cannot
detect a lying server, which matters because TUF expiry validation depends on
the clock. NTS would need chrony. That is a decision about the update trust
model, and belongs with it rather than with the repair of a broken clock; the
configuration-rendering layer is the same either way, so a later move is not
blocked by this milestone.

### M2 — Declare the kernel surface container networking needs

Add to `os/boards/common/mos-required.fragment`:

```
CONFIG_NFT_FIB_IPV4=y
CONFIG_NFT_FIB_IPV6=y
CONFIG_NFT_FIB_INET=y
CONFIG_VETH=y
```

This is an addition to the shared floor, not a weakening of it, and every board
must satisfy it. Before proposing the final set, derive the full list from the
ruleset netavark actually submits rather than from this failure alone: the
capture is in the task record, and the other expressions it uses — masquerade,
`ct state`, `ct mark`, `meta mark` mangling, and jumps between chains — happen
to be satisfied on the s905x5m but are equally undeclared today.

Then measure cx3576's **built** `.config`, not its baseline file, and state
whether it satisfies the new floor. If it does not, its kernel configuration
changes with this milestone; the symbols appear in its Kconfig as
`# ... is not set`, so they are reachable and this is expected to be feasible.

**Acceptance is a container on hardware, not a configuration grep.** A grep is
what missed this. Start a container on the default bridge network on the
s905x5m and confirm it has an address and can reach the network.

### M3 — Register SSH logins with logind

**Corrected 2026-08-31 after measuring the board.** The first draft of this
milestone said to add `pam_systemd` to sshd's PAM stack. That is wrong:
`pam_systemd.so` does not exist on the device at all. `find /lib /usr/lib -name
'pam_systemd*.so'` returns nothing, `/etc/pam.d/sshd` is stock Debian, and
`common-session` has no `pam_systemd` line to restore. Editing PAM files fixes
nothing while the module is absent.

Install `libpam-systemd` instead. Debian's `libpam-runtime` adds the
`pam_systemd` line to `common-session` through `pam-auth-update` when the
package is installed, so no PAM file is hand-edited.

Then confirm `loginctl list-sessions` is non-zero and that an SSH session's
cgroup is a session scope rather than `/system.slice/ssh.service`. M5 separately
accepts the interactive podman runtime path; its result is not proof of this
login-registration repair.

This changes a login path, so it needs its own check that key-based and
transient-password authentication both still work — `docs/design/access.md`
records that sshd's `PasswordAuthentication` drop-in evaluates
`passwordAuthentication AND a transient password active`, and adding a session
module to the stack is close enough to that logic to warrant re-testing it
rather than assuming.

### M3a — Audit what `--no-install-recommends` dropped

M1 and M3 turned out to have one root cause, which is worth fixing as a class
rather than twice as instances. `os/rootfs/stages/10-base.Dockerfile` installs
with `--no-install-recommends`, and Debian trixie's package metadata shows what
that silently discarded:

```
systemd          Recommends: ..., linux-sysctl-defaults,
                             systemd-timesyncd | time-daemon, systemd-cryptsetup
systemd-sysv     Recommends: libpam-systemd, libnss-systemd
systemd-resolved Recommends: libnss-myhostname, libnss-resolve, libidn2-0
openssh-server   Recommends: default-logind | logind | libpam-systemd,
                             ncurses-term, xauth
```

`systemd-timesyncd` is gap 1. `libpam-systemd` is gap 3, and it was recommended
twice over — by `systemd-sysv` and by `openssh-server` — and dropped anyway.
`systemd-repart` was the same class through a different mechanism: it moved out
of the `systemd` package on trixie, and the comment beside it in the Dockerfile
already records the lesson.

`--no-install-recommends` is the right default for a signed appliance image and
is not what should change. What is missing is the deliberate re-adding of the
few recommends that carry function, and an assertion that each is present.
Enumerate the dropped set for every package in the install list, decide each one
explicitly, and record the decision beside the install line the way
`systemd-repart` already is. `libnss-systemd`, `libnss-resolve` and
`linux-sysctl-defaults` are the candidates this survey has already surfaced;
none has been shown to be broken today, so each needs a reason rather than a
reflex.

This milestone is bounded: decide and record, do not add packages that nothing
needs. Growing a verity-signed rootfs has a cost, and "Debian recommends it" is
not by itself a reason.

### M4 — A hardware smoke check that would have caught all four — **completed**

Add a check that runs on a booted board and asserts what the image-level suite
cannot: that the clock is synchronized, and that a container starts on the
default bridge network and has connectivity.

The check is a direct-host SSH probe, not another `os/verify` image mode: the
image verifier's container fallback neither carries the operator's SSH key nor
has a reason to be able to reach a private board LAN. It uses
`timedatectl show --property=NTPSynchronized --value`, which reads the
`org.freedesktop.timedate1` D-Bus property but supplies one stable,
locale-independent scalar instead of parsing the human status display or a
typed `busctl` response.

It also asserts that the SSH session is registered with logind: the session
list is non-empty and the probe's own cgroup is a `session-*.scope`. This is
included because it is cheap, gives M3 a direct diagnosis, and remains useful
when an image-cache or network problem masks the later container result. The
streamed assertion deliberately uses `ssh -T`: ordinary key-authenticated SSH
must still receive a logind session scope, and its stdin is carrying the probe
source rather than terminal input. The Podman invocation has an allocated TTY
and omits both `--network` and
`--cgroup-manager=cgroupfs`; its default manager must report `systemd`, then a
foreground `--rm --interactive --tty` start proves that default cgroup path.
That short-lived command is a separate direct `ssh -tt` exec rather than part
of the streamed remote shell: this gives it the SSH-allocated TTY without
letting an interactive container consume the remaining probe source.
A separate default-bridge transient must report bridge mode, an address and a
default route, then make an HTTP request from the container.

Its failing direction is demonstrated offline by a fake SSH endpoint that
executes the same remote probe body. Fixtures make each condition false:
`NTPSynchronized=no`, zero sessions or an `ssh.service` cgroup, netavark's
bridge-setup failure, a host/none network mode or absent address/connectivity,
and crun's `systemd not supported` failure. The live board proves the green
direction only; no deliberately broken image is deployed to it.

**Result, 2026-08-31 08:43 UTC.** `make os-hardware-smoke
HOST=192.168.27.55` passed on booted `rootfs.0 (A)`: `NTPSynchronized=yes`, a
logind `session-29.scope`, `CgroupManager=systemd`, a default bridge container
at `10.88.0.10` with a default route and HTTP connectivity to `1.1.1.1`, and a
default `--interactive --tty` start without either override. The offline
failing-side suite passed 40/40 assertions, and the post-run board inspection
found no named smoke container. No image or storage write was needed.

M1 through M3 each repair an independent defect; M5 repairs the separately
identified crun build defect. This milestone repairs the reason all four reached
hardware unnoticed, and is the only one of the four that changes whether the
next gap of this kind is found by a check or by an operator.

## Acceptance criteria

1. A booted board reports `System clock synchronized: yes`, and the clock is
   correct after a reboot rather than returning to the build-time date.
2. `podman run` on the default bridge network succeeds on the s905x5m, and the
   container has an address and connectivity.
3. cx3576's built `.config` is measured against the new floor and the result is
   stated either way.
4. An interactive `podman run` over SSH starts a container; independently,
   key-based and transient-password SSH authentication are re-confirmed with a
   logind session scope.
5. The smoke check fails on an image that reproduces any of the four defects.

## Scope

In scope: `os/rootfs/stages/10-base.Dockerfile`, the mosd settings model and a
time reconciler, `os/boards/common/mos-required.fragment`, the package-managed
PAM integration, `os/verify`, and any board kernel configuration that the new
floor obliges to change.

Out of scope: authenticated time (NTS/chrony), serving time to other devices,
the eleven `boot.scr`/RAUC `--verify` failures recorded in RFCT-913, and every
part of PLAN-910 behind the M3 owner gate. This plan does not touch the eMMC.

## Alternatives

**chrony instead of systemd-timesyncd.** Rejected for now. timesyncd is one
more package in a list that already names `systemd-resolved` and
`systemd-repart` for the same reason, its configuration is a single file that
fits the existing mosd rendering pattern, `systemd-time-wait-sync.service`
supplies the ordering barrier without custom work, and `timedatectl` and
`NTPSynchronized` give `os/verify` an assertion point with no new tooling. The
one argument that genuinely favours chrony is NTS, and it is deferred with the
update trust model rather than settled here.

**Enabling the netfilter symbols per board instead of in the shared floor.**
Rejected. `container.enabled` is a tree-wide feature and the floor already
declares `OVERLAY_FS` and `BRIDGE` for it. Leaving the rest per board
reproduces exactly the condition that let this reach hardware: no board is
obliged to satisfy a requirement nobody wrote down.

**Documenting `--cgroup-manager=cgroupfs` instead of fixing the crun runtime
defect.** Rejected as the primary fix. It is a usable workaround and worth
recording, but the default path failing for an operator at a shell is a defect,
not a documentation problem.

## Risks

**The new floor obliges other boards to rebuild.** cx3576's kernel
configuration may change, and its build must be re-run and re-verified. This is
the cost of the floor meaning anything, but it is real work outside this
board's scope and should be sized before M2 is dispatched.

**The settings key is a schema change.** It carries a migration, and
`docs/design/mosd.md` records that `access.webAdmin` is kept byte-identical
through upgrades; the same care applies here.

**A PAM change touches authentication.** M3 modifies the login path on a system
whose SSH access model is deliberately narrow. The re-test named in that
milestone is not optional.

**The clock moves backward today.** Until M1 lands, any measurement taken on
this board carries timestamps four months in the past, and anything that
validates a certificate or an expiry will behave inconsistently across a
reboot. Work on M2 and M3 should set the clock by hand first, and say so in the
record.

### M5 — Rebuild crun with systemd support

Owner decision, 2026-08-31: rebuild it.

`os/pkgs/podman/Dockerfile` configures crun with `./configure --disable-systemd`.
That is a compile-time capability removal — upstream publishes separate
`-disable-systemd` artifacts — and it withholds the path where crun asks systemd
to create a transient scope for a container. It is the sole cause of
`crun: systemd not supported: Operation not supported`; M5's `a0ddb9f` repairs
that capability. The slot-A `systemd-run` probe at 08:29 UTC started rootful
podman from `system.slice` without a login session, proving that M3's
`libpam-systemd` repair is independent session management rather than a podman
precondition. Both changes are real fixes, but neither is a half of the same
defect.

The build dependency is already present: `libsystemd-dev` is installed in the
`c-build` stage, where crun is compiled, because conmon's journald support needs
it. So the edit is to drop the flag, not to add a dependency to that stage.

What must follow the flag, and is the actual work:

- The comment that justifies `--disable-systemd` has to be replaced by one that
  says why systemd support is now wanted, in the register the rest of that file
  uses.
- A systemd-enabled crun links `libsystemd`, which is a new `NEEDED` entry. This
  repository derives runtime dependencies from the built binaries' `NEEDED`
  entries rather than predicting them, so re-derive them and add whatever the
  assembled root is missing. `libsystemd0` is expected to be present already
  because systemd is installed, but expected is not measured.
- The four builder stages exist so that one dependency edit does not recompile
  five components. Check that this change does not invalidate more than the C
  stage; the file records that adding `libsystemd-dev` once invalidated `go-build`
  and nothing else, and a merged list would have cost about 42 minutes under
  emulation.

Acceptance is on hardware and with default arguments: an interactive
`podman run` over SSH starts a container without `--cgroup-manager=cgroupfs`.
Quadlet must keep working — it does today precisely because systemd owns the
unit's cgroup and crun never has to create a scope, so a regression there would
mean the change did something other than what it claims.
