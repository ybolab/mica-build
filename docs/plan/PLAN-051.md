# PLAN-051 Document native and container application delivery

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-03
- **relatedTask**: [RFCT-287](../task/RFCT-287.md)

## Context

The rootfs build composes architecture-specific Debian packages and then removes
on-device package-management state. Persistent third-party systemd units and
rootful Podman/Quadlet are available, but there is no concise supported guide
for publishing native code, starting applications, exposing hardware, limiting
resources, handling container credentials or rolling back an application. The
default customer is a trusted product integrator, not an untrusted marketplace.

## Proposal

- **DOC/INT:** define two supported choices. Native programs are packaged as
  build-time `.deb` inputs, run as hardened systemd services in the immutable
  image and update/rollback with the signed RAUC system. Independently released
  applications use pinned OCI images and persistent Quadlet definitions.
- **DOC/INT:** provide tested native and Quadlet examples for lifecycle,
  dedicated users, writable STATE/DATA paths, logs/health, dependencies,
  capability reduction, named device-node access and CPU/memory/PID/I/O limits.
- **DOC:** document fully qualified image digests, TLS registry use,
  integrator-owned registry credentials, offline image verification, previous-
  digest manual rollback and data/schema migration warnings.
- **DOC:** state current security truth: rootful Quadlet authors can deliberately
  grant broad privilege; mos does not yet enforce image signatures, protected
  admission, mandatory ceilings, an application secret store or automatic
  application rollback.
- **COND:** if mos later promises managed/untrusted applications, create a new
  plan for independent native-bundle signing/activation, protected container
  trust/key policy, non-bypassable hardware/resource admission, secret storage,
  audit and health-gated atomic rollback.
- **SW:** test all published examples and fail documentation gates when their
  units, paths, controllers or commands no longer match the image.

## Risks

- Persistent native units can outlive an incompatible A/B rollback; supported
  native code therefore belongs in the image, not a separately installed path.
- Examples can reduce mistakes but cannot constrain a trusted root-capable
  integrator; language must not imply protected enforcement.
- Container data migration may make digest rollback unsafe even when the image
  itself is available; the integrator owns compatibility unless a managed
  platform is separately approved.

## Scope

In scope: delivery-model decision, publishing/startup/update/rollback guides,
tested systemd/Quadlet examples, hardware/resource/secret guidance and explicit
limits. Out of scope: on-device APT, `systemd-sysext`, an app marketplace or the
conditional managed/untrusted enforcement platform.

## Alternatives

1. Build an independent signed native package manager now. Rejected for the
   trusted-integrator baseline; RAUC already supplies atomic native lifecycle.
2. Treat containers as automatically secure. Rejected because current rootful
   definitions and permissive policy do not provide that boundary.
3. Provide prose without executable examples. Rejected because paths, systemd
   directives and kernel controllers need regression tests.

## Annotations

- 2026-08-31: The user requested package release, custom startup and custom
  containers, and asked which safety features need documentation versus code.
- 2026-09-01: Split from PLAN-037 as the trusted-integrator application guide.
- 2026-09-03: Approved and moved to implementing as RFCT-287.

## Completion (2026-09-03)

Delivered as RFCT-287. Documentation only: the change touches `docs/` and
`tests/quadlet-doc-test.sh` and nothing else, so no image, package or Rust
gate applies to it.

- **The decision guide** is `docs/user/applications.md` section 1, on the page
  the documentation contract makes the owner of application delivery. It
  routes on one question — may this code be a release behind the OS? — and
  the eight rows under it are device facts rather than preferences: what signs
  each path, whether an OS rollback takes the code back, whether the code's
  failure rolls the OS back, where the bytes sit, and whether the artifact can
  be changed on a running device. The two integrator guides it routes into are
  `docs/design/native-applications.md` (new) and `docs/design/containers.md`.
- **Tested examples** are three new Quadlet files in `docs/design/containers.md`
  sections 7, 8 and 9, extracted and fed to the shipped aarch64 generator by
  `tests/quadlet-doc-test.sh` along with the six that were already there. They
  cover a dedicated in-container user, a named device node with a
  `ConditionPathExists=` guard, `CPUQuota`/`MemoryHigh`/`MemoryMax`/`TasksMax`
  and the `IO*BandwidthMax` pair, a health check with `Notify=healthy` and
  `HealthOnFailure=`, an explicit `LogDriver=`, and a digest-pinned private
  image with `Pull=never`. Startup, state and data were already covered by the
  existing six. Twenty new assertions check what the generator actually
  produced, including that `--cgroups=split` is what makes the ceilings bind
  the container and that the credential path lands in the podman process's
  environment rather than the container's. The example floor rose from five to
  nine, because six examples is still more than five and losing three would
  have gone unnoticed.
- **Container guidance** is `docs/design/containers.md` section 9: digests and
  `Pull=never`, `podman login --authfile` onto STATE and why podman's own
  default is not durable, digest-flip rollback and the fact that it works only
  while the previous image is still on the device, and the migration hazard
  that makes a code rollback not a data rollback. One correction to what the
  document said before: tightening `policy.json` is a build-time act, because
  that file is inside the verity root and only `/etc/containers/systemd` is
  writable on a running device.
- **The limits are stated** in `docs/user/applications.md` section 6 with the
  contract's vocabulary: signature admission, mandatory ceilings, a secret
  store and automatic application rollback are one grouped `unsupported`. The
  native qualification is a separate `shipped` claim rather than a softening
  of it — native code inherits the whole-slot A/B rollback because a failed
  unit fails the health gate, which is a real automatic rollback and is not
  per-application, and moves no data on either path.
- **The conditional plan** is `docs/plan/PLAN-069.md`, with a trigger section
  so that it stays a draft until one of three conditions holds. Both
  `docs/user/applications.md` and `docs/design/native-applications.md` point
  at it instead of designing managed controls.
- `docs/zh/user/applications.md` moved in the same commit, carrying the same
  twelve status lines in the same order.

**Not closed, and named rather than rounded up:**

- **The native examples are not executed.** The container half of this plan's
  SW item is closed — every example runs through the generator the image
  ships. The native half is closed only against renames: the guide links its
  citations into the source tree, and `docs/verify-links.sh` fails when one
  of those files stops existing, but nothing checks that the directives it
  describes still appear inside them. A harness for that is new mechanism and
  outside a documentation task.
- **Nothing ran on a device.** Every generated-unit claim comes from the
  shipped aarch64 Quadlet binary under emulation; the health-gate and rollback
  claims are read from `rootfs/overlay/usr/lib/mos/mos-health` and the mount
  units, not observed on hardware.
- **`docs/zh/design/` was not updated.** The Chinese mirror of
  `containers.md` predates sections 7 to 9, and there is no Chinese
  `native-applications.md`. The coverage gate governs `user/`, `website/` and
  `bsp/` only, so this is drift the gate cannot see.
- **Index rows are owed.** `docs/plan/index.md` and `docs/task/index.md` were
  off limits to this task, so PLAN-051 and RFCT-287 still show `[ ]` and
  PLAN-069 has no row at all. PLAN-069 also has no paired task record, which
  is correct while it is conditional.
