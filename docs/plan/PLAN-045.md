# PLAN-045 Add the unexpanded BusyBox emergency binary

- **status**: draft
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
