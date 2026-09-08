# 20260908-2115-p2-descriptor-contracts-x64 P2: freeze signed component and deployment contracts for x64

- **status**: completed
- **priority**: P1
- **owner**: worker/p2-20260908
- **createdAt**: 2026-09-08 21:15
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

Continue P2 of the approved file-based A/B plan after the merged P1 proofs.
Freeze strict component/deployment schemas, content identities, support-image
ownership, Ed25519 envelope verification and PKCS#7 root-hash signing inputs.
Resolve distributed public trust inputs and measure kernel certificate expiry
and revocation. Start with x64; no historical format or layout compatibility.

Acceptance: shared Rust/Bun golden fixtures and negative cases for malformed
geometry, wrong board/architecture, substitution, unsafe paths and signatures;
public-only build outputs; measured x64 trust-lifecycle evidence; relevant
existing quality gates pass. P3 producer changes follow this contract gate.

## ActiveForm

Completed P2 acceptance; P3 producer separation is ready to begin.

## Dependencies

- **blocked by**: (none; P1 completed and merged)
- **blocks**: P3 through P10 of 20260908-1428-file-ab-signed-components

## Notes

- The parent plan was approved at 2026-09-08 17:11. The user now requests
  continued work after P1 and reconfirms that development needs no backward
  compatibility. This resumes local sequential implementation; the cancelled
  P2 dispatch had no worktree changes or task record to recover.
- Use this task for the current claim; preserve the historical parent owner.
  Track locally in repository records; no execution service is restarted.
- Strict Rust/Bun deployment readers share 31 malformed-descriptor fixtures,
  a canonical payload and an Ed25519 envelope produced by the existing server
  signer. The signer now lives in `shared/update-envelope.ts`, keeping build
  tooling independent of server configuration and dependencies.
- A review regression proves that a signed descriptor could substitute the
  support root hash while retaining its claimed image digest. Both readers
  now bind the complete `supportId` to the authenticated boot identity.
- `pkgs/rauc/verity-tool.sh` signs exact 64-byte hashes through the pinned
  OpenSSL image and stages public-only, digest-named trust contexts. x64,
  virt-arm64 and cx3576 BSPs accept `VERITY_TRUST_CERT`; automatic kernel-build
  key generation is removed. The explicit development-key command remains
  available when intentionally creating a new trust domain.
- x64 lifecycle evidence: `_out/p2-lifecycle.htbFXo/`, produced by
  `tests/signed-boot-lab/key-lifecycle.sh` with P1's x64 kernel/initramfs and
  public certificate. The certificate is valid from 2026-09-08 to 2036-09-05;
  valid signed mappings still succeed at guest dates 2020-01-01 and 2045-01-01.
  Root's `KEYCTL_REVOKE` against the built-in content key returns `EACCES`
  (`errno=13`) at both dates. Missing signatures and unrelated keys remain
  refused. This kernel has no enabled system blacklist keyring. Dynamic
  revocation and expiry enforcement are not capabilities of this build;
  replacement-kernel rotation/removal remains P9 work.
- The new signing tool reproduces P1's booted signature byte for byte:
  SHA-256 `7963bee1a781f7728afeb4072977448a62493a71edabcd152d55300caf262cb9`.
  No private key is in the signature, public context or tracked fixtures.
- Final acceptance passed: build harness 1,028 tests; focused Bun contracts
  and real signing 42 tests; Rust workspace 68 nextest cases plus fmt,
  clippy, doctests and cargo-deny; server lint/typecheck, 36 tests and compiled
  binary build; documentation, host-toolchain, pipefail and trust-domain gates.
  The build suite was rerun to completion after an initial interrupted run;
  no assertion was disabled. The contract and shared signer modules report
  100% line coverage in the focused Bun run. Local review passed after the
  support-identity regression fix.
- P2 is complete as a local source change. P3 is the next phase: split kernel,
  support, rootfs and firmware producers around these contracts. Current
  shipped boot paths and image layout remain at their pre-P3 state. This
  completion does not qualify P3-P10 or physical-board key lifecycle behavior.

- complete: P2 contracts, signing, public trust inputs and x64 lifecycle evidence passed acceptance.
