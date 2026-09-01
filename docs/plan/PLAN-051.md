# PLAN-051 Document native and container application delivery

- **status**: draft
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: (pending)
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
