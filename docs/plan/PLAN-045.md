# PLAN-045 Add the unexpanded BusyBox emergency binary

- **status**: done
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: (pending)
- **relatedTask**: [RFCT-281](../task/RFCT-281.md)

## Context

The appliance rootfs deliberately contains a bounded normal command set. A
single BusyBox binary is useful for emergency service, but placing expanded
applets in PATH could silently change build/runtime behavior and make services
depend on a fallback that is not part of their tested contract.

## Proposal

- **SW:** install the normal dynamically linked Debian BusyBox binary only at
  `/usr/bin/busybox` in the base image for every supported architecture.
- **SW:** create no BusyBox applet symlinks in the image, make no PATH change,
  and do not add `/build/bin` or any normal-service dependency.
- **DOC:** document direct emergency use as `busybox APPLET`; if links help an
  interactive repair, create them transiently under `/run/mos-toolbox` and add
  that directory only to that repair shell.
- **SW:** add image tests proving existing GNU command resolution is unchanged,
  no applet links were generated, and BusyBox has no implicit initramfs/init
  role.
- **OPS/DOC:** include BusyBox in the SBOM, license inventory and corresponding
  source offer.

## Risks

- Operators may treat emergency applets as a stable application API. The guide
  must label them diagnostic-only.
- Dynamic linkage can make the tool unavailable in severely damaged systems;
  this plan does not promise a self-contained rescue environment.
- Package hooks could expand links unintentionally; image verification must
  inspect the final rootfs rather than only the package list.

## Scope

In scope: one base package/binary, final-image assertions and concise emergency
usage/licensing documentation. Out of scope: an applet farm, PATH fallback,
initramfs changes, a rescue partition or replacing GNU tools.

## Alternatives

1. Install applets under `/build/bin` at the end of PATH. Rejected because the
   production image should not expose a build path or silent fallback semantics.
2. Expand applets in `/usr/bin`. Rejected because they can shadow normal tools.
3. Use a static rescue BusyBox. Deferred to a separately designed recovery
   environment if PLAN-048 proves it necessary.

## Annotations

- 2026-08-31: The user chose `/usr/bin/busybox` with no expanded links and
  emergency link creation only when needed.
- 2026-09-01: Split from PLAN-037 as a small independent base-image change.

## Completion (2026-09-03)

Status **implementing → done**. Implemented as proposed; the record below is
what the proposal turned into and where it was sharper than written.

### The proposal, item by item

- **SW: the normal dynamically linked Debian binary, only at
  `/usr/bin/busybox`, for every supported architecture.** Done, by a new
  producer `rootfs/packages-src/busybox/` emitting `mos-busybox` for
  `amd64 arm64`. The binary is Debian's, byte for byte.
- **SW: no applet symlinks, no PATH change, no `/build/bin`, no
  normal-service dependency.** Done, and asserted at both ends — the producer
  refuses a staged payload that is not exactly the binary and its copyright,
  and `verify/src/checks-busybox.ts` walks the packed root.
- **DOC: `busybox APPLET`, and transient `/run/mos-toolbox` links only for an
  interactive repair.** Done: `docs/user/troubleshooting.md` §4 with a Chinese
  mirror, and `docs/design/recovery.md` §6.3.
- **SW: image tests for unchanged GNU resolution, no generated links, no
  implicit initramfs/init role.** Done; six checks and 31 negative tests.
- **OPS/DOC: SBOM, licence inventory and source offer.** Done, and verified
  against a real assembled release rather than assumed.

### Where the plan was sharper than it knew: `Depends: busybox` was a trap

The proposal says "install the normal dynamically linked Debian BusyBox
binary". The obvious reading — depend on Debian's `busybox` package — would
have violated two of this plan's own bullets by a route nobody would have read
in a diff. That package also ships
`/usr/share/initramfs-tools/hooks/zz-busybox`, which copies the binary into
the initramfs and then **hard-links every applet name beside it inside the
initrd**, plus the `conf-hooks.d` fragment that sets `BUSYBOXDIR` and turns the
hook on. On x64 the kernel package's postinst runs `update-initramfs` during
the compose, so the image would have shipped an initrd holding busybox and 271
applet links — the applet farm this plan rejects and the initramfs role it
forbids — as a side effect of a dependency line.

So the producer `apt-get download`s the archive and `dpkg-deb -x`s it, keeping
one file. That runs no maintainer script and installs no trigger. This is the
same shape `mos-ca-trust` already uses for a different reason: the payload is
wanted, the packaging around it is not.

Measured confirmation that the result is inert: with `/usr/bin/busybox` in the
root and no conf fragment, `mkinitramfs` leaves `BUSYBOXDIR` empty, the
klibc-utils hook takes its klibc branch, and the exported initrd is unchanged —
`pack-export-boot.sh` read 1320 entries and found no busybox.

### The risks, revisited

- **"Operators may treat emergency applets as a stable application API."**
  Answered in prose in both operator pages (diagnostic-only, nothing on the
  device may depend on them) and in a check: nothing in 390 unit, generator,
  preset or `/usr/lib/mos` paths names busybox, and a unit that execs it is
  driven red in the tests.
- **"Dynamic linkage can make the tool unavailable in severely damaged
  systems."** Stated as a cost in the control file, the troubleshooting page
  and §6.3 rather than hedged, and asserted in the producer: the harvested ELF
  must name an `ld-linux` interpreter, so silently shipping `busybox-static`
  one day fails the build instead of quietly changing what the package is.
  Alternative 3 stays deferred.
- **"Package hooks could expand links unintentionally; image verification must
  inspect the final rootfs rather than only the package list."** This is the
  risk that turned out to be the real one, and it is exactly the route
  `Depends: busybox` would have taken. Verification inspects the final rootfs
  and the exported initrd, never the package list.

### Scope

`common.pkgs`, not a feature set. Every other manifest family is declinable,
and a tool an operator reaches for when the userland is damaged is worth
nothing if the image in their hands is the build that declined it. It costs one
826 KB file, enables nothing, and nothing depends on it.

### Owed

The cx3576 half is proven to package, to install and to execute under
emulation, not to boot: no arm64 image was composed and nothing was flashed.
See RFCT-281's Completion for what needs bench hardware.
