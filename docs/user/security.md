# Security

This page states the security posture of a mos device as it ships: what is
protected, by which mechanism, against which attacker — and the gaps, named
with the same precision. The threat-model boundary to hold in mind throughout:
**physical possession of the boot medium implies full control.** Whoever holds
the hardware can reflash it; the protections below are about everyone else.

## 1. Runtime integrity: the read-only verity root

The root filesystem is a squashfs with a dm-verity hash tree, verified
per block at runtime; the root hash rides on the kernel command line. The
device cannot be modified into running altered system code short of replacing
the whole slot, and every service, including the management plane, runs from
that sealed root. Writes go only to the declared data tiers
([storage.md](storage.md)).

What this does **not** claim: end-to-end secure boot. On cx3576 nothing in
the build signs SPL or U-Boot, so the chain below the kernel is not
authenticated; many customer-selected boards use opaque boot stages, and
rootfs integrity must not be misrepresented as boot-chain integrity. Recorded
as a gap, not assumed away.

> status: shipped — evidence: `docs/design/ro-root.md`, `docs/design/uboot-ab-handshake.md`

## 2. Update authenticity

An update is signed twice, by two unrelated hierarchies: the RAUC bundle's
CMS signature, verified on the device against its keyring, and host-side TUF
metadata (four ed25519 roles, offline root) pinning the bundle's digest,
length and verity root hash. The key ceremonies, custody and rotation
procedures are written as an executable runbook,
[../design/release-signing.md](../design/release-signing.md).

The named gaps:

- **No production keys are provisioned anywhere yet.** A build without
  provided material generates a development-grade trust root and marks it;
  the image verifier fails a dev-keyring image unless explicitly waived as a
  bench image. No image with a development keyring should leave a desk.
- **No keyring rotation channel on deployed devices** — replacing the trust
  anchor on a fielded device currently means an image signed by the very key
  being replaced.
- **The device-side TUF verifier ships, and its trust anchor does not.**
  `rauc-verify` and `rauc-update` are in the image and walk release metadata
  from a pinned root, but no image provisions that root, so the walk has
  nothing to start from until an operator supplies one
  ([update-rollback.md](update-rollback.md)).

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 3. Access and credentials

- **Per-device credentials, minted on the device.** Nothing secret is baked
  into an image — an image is byte-identical fleet-wide, so a baked credential
  would be a fleet-wide secret. The build *fails* if the factory shadow file
  carries a usable password hash, on both profiles.
- **The management API is the gate.** HTTPS only; password login with signed
  sessions and CSRF protection for browsers, bearer tokens for automation;
  persistent login-backoff counters and a bounded, fsynced audit trail of
  logins, setup, power actions and transient-password events.
- **SSH is off by default on both profiles.** Persistent access is by public
  key only, and every authorized key is a root key — stated in the UI in as
  many words. The transient root password (set by an authenticated
  administrator, cleared automatically at the next boot) covers the
  operator-at-the-bench case without creating a long-lived password.
- **Lockout is real.** Losing the administrator credential and all keys
  leaves no software path in ([recovery.md](recovery.md)) — a deliberate
  trade, since credentials surviving updates means updates are not a back
  door.

The audit trail does not yet record session lifecycle events and nothing
uploads it; there is no hard lockout threshold (deliberately, until a
physical-presence release path exists).

> status: shipped — evidence: `docs/design/access.md`, `docs/design/provisioning.md`

## 4. Applications

Containers run rootful (rootless mode is not built) and container image
signatures are not verified by the shipped policy — registry TLS and digest
pinning are the protections, and the trusted-integrator threat model is the
context. The management/application boundary is structural: the MQTT bridge
can only reach exactly-enrolled application services and can never address the
management daemon. See [applications.md](applications.md).

> status: shipped — evidence: `docs/design/containers.md`, `docs/design/bus.md`

## 5. Network exposure

The inbound surface of a stock device is apid on 443 (and the redirect on 80)
— nothing else listens for management, nothing dials out, and no fleet or
cloud channel exists. Static UI assets are public; every appliance datum and
operation sits behind the API credential boundary.

> status: shipped — evidence: `docs/design/remote-management.md`

## 6. Security lifecycle

The lifecycle is now written down: every credential in the product with its
owning role and rotation procedure, the release channel and signing
procedures, severity classes with triage and patch targets, advisory
publication, incident response, and support windows and end of life. Each
section states its own maturity rather than implying it is enforced. Boards
carry a boot-assurance claim in a committed evidence file, and the release
gate reads that file rather than letting a release name its own level.

> status: shipped — evidence: `docs/design/security-lifecycle.md`, `boards/cx3576/evidence.json`

**None of the response channels exists yet, and an auditor should be told
so.** There is no published security contact and no disclosure policy at the
repository root, no advisory feed, no end-of-life announcement mechanism, and
no tooling that enforces a support window or a patch target — reports today
reach the maintainers privately and are handled case by case. Factory identity
injection, factory records and debug/fuse policy are likewise designed and
unbuilt ([manufacturing.md](manufacturing.md)). The advisories brief for the
official site is [../website/security.md](../website/security.md); this page
is the honest inventory.

> status: unsupported
