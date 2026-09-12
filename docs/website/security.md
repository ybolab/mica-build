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

The kernel requires signed verity hashes for root and matching support data and
verifies blocks on demand. Native deployment metadata binds the exact board,
kernel and root association. UEFI Secure Boot or required FIT signatures protect
boot executables under the selected enforcing firmware and public anchors.

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `docs/design/release-signing.md`

Updates authenticate catalogs and component bytes, persist candidates before
selection, and retain a known authenticated fallback. Boot, content and metadata
keys are independent. Root/kernel updates leave loader firmware untouched; its
signed maintenance flow has separate recovery and readback.

> status: shipped — evidence: `pkgs/mos-deploy/src/deployments.rs`, `pkgs/mos-deploy/src/acquisition.rs`, `build/src/firmware-maintenance.ts`

HTTPS management authenticates administrator sessions and bearer tokens, protects
browser writes with CSRF checks, and keeps login backoff/audit state. SSH is off
by default. The verified userspace profile does not imply a shell-free image.

> status: shipped — evidence: `docs/design/access.md`, `rootfs/packages-src/profile`

### Evidence limits

Current acceptance uses explicit development keys and disposable UEFI enrollment.
QEMU proves the common runtime/update path; sandbox/FIT tests prove their named
software mechanisms. Physical cx3576 watchdog, eMMC power-loss and USB flash
qualification still need the local bench. No hardware-rooted or fused boot claim
is made. DATA is unencrypted; privileged workloads can modify allowed persistent
state. There is no old-layout compatibility or migration path.

> status: board-dependent — evidence: `docs/design/security-model.md`, `docs/boards/cx3576.md`

### Advisories and reporting

The security lifecycle is written: vulnerability intake, severity classes with
triage and patch targets, advisory publication, incident response and
end-of-life, each with one accountable owner role and each stating its own
maturity.

> status: shipped — evidence: `docs/design/security-lifecycle.md`

**The site must not present any of it as an operating channel.** There is no
published security contact or disclosure policy, no advisory feed and no
incident notification path; security reports go through the
[support](support.md) contact and are handled case by case. Printing a triage
target with no intake behind it would be exactly the overclaim the content
contract forbids.

> status: unsupported

When the advisory process ships, this page gains the advisory index,
rendered from the advisory records — never hand-copied, per the
[content contract](contract.md).
