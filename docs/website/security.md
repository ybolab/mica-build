# Page brief: Security

- **Purpose**: state the security posture exactly as it is — what the trust
  chain verifies today, which gaps are recorded, and how advisories will work
  — so a security reviewer finds honesty rather than a badge wall.
- **Audience**: security reviewers auditing before adoption; operators
  checking what an update signature actually proves; researchers looking for
  the disclosure contact.
- **Navigation position**: page 6. Links to [downloads](downloads.md) for
  verification procedure, [support](support.md) for contact, and
  [../user/security.md](../user/security.md) for the operator-facing model.

## Content outline

1. The trust chain, layer by layer, each with its status.
2. Recorded gaps — stated on the same page, same prominence.
3. Access model summary.
4. Advisories and vulnerability reporting.

## Draft copy

### What is verified today

**Runtime root integrity.** The root filesystem is a squashfs under a
dm-verity hash tree; the root hash rides the kernel command line and every
block is verified at read time. A modified root does not run.

> status: shipped — evidence: `rootfs/build.sh`, `docs/design/ro-root.md`

**Update authenticity, two chains.** A release is signed twice by two
unrelated hierarchies: TUF metadata (four ed25519 roles, root key offline)
pins the bundle's digest, length and verity root hash, and the RAUC bundle
carries a CMS signature verified against the device keyring at install time.
Compromise of either chain alone is contained by the other. The signing and
verification tooling and the production key ceremony runbook exist today.

> status: shipped — evidence: `pkgs/rauc-sign/`, `docs/design/release-signing.md`

**Management access.** The HTTPS API authenticates with an argon2id password
hash, keeps persistent login-backoff counters and an audit ring. SSH ships
off by default; persistent access is by public key. Production images are
build-time sealed: the `prod` profile lives inside the verity root and cannot
be edited into a `dev` one.

> status: shipped — evidence: `docs/design/access.md`, `rootfs/packages-src/profile`

### Recorded gaps

The design record keeps its gaps on the same page as its mechanisms, and this
site does the same:

- **No verified boot below the kernel.** Nothing in the build signs SPL or
  U-Boot; the chain starts at the verity root hash, not at the boot ROM.

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`

- **No production keyring ships in the image.** The device-side RAUC trust
  anchor and the TUF root anchor reach production devices through a
  provisioning channel that is designed but not fielded; a build without
  production material generates a loudly-marked development root that the
  image verifier refuses to pass silently.

> status: shipped — evidence: `pkgs/rauc/system.conf.in`, `docs/design/release-signing.md`

- **No device-side update client yet.** Devices can install a bundle already
  present locally; discovery, authenticated download and resume are planned.

> status: proposed — evidence: `docs/plan/PLAN-047.md`

TODO(PLAN-047): revisit after this plan merges

- **Data at rest is not encrypted**, and rootful container integrators can
  grant themselves broad privilege; neither is currently constrained.

> status: unsupported

### Advisories and reporting

A formal security lifecycle — vulnerability intake, severity and patch
targets, advisory publication, incident response and end-of-life — is planned
work and is presented here as such; until it ships, security reports go
through the [support](support.md) contact and are handled case by case.

> status: proposed — evidence: `docs/plan/PLAN-053.md`

TODO(PLAN-053): revisit after this plan merges

When the advisory process ships, this page gains the advisory index,
rendered from the advisory records — never hand-copied, per the
[content contract](contract.md).
