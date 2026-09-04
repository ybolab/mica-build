# RFCT-308 Design short-lived signer certificates under the existing CA

- **status**: completed
- **priority**: P1
- **owner**: short-lived-signer/bkd-44xybep3
- **createdAt**: 2026-09-04 20:45
- **relatedPlan**: [PLAN-078](../plan/PLAN-078.md)

## Description

`docs/design/security-lifecycle.md` §1.2 records that "a compromised signer is
reissued and **out-waited**; there is no CRL path to devices", and
`docs/design/release-signing.md` §2.2 says the same from the runbook side: "any
bundle the attacker signed verifies until the CA itself is replaced". The
production ceremony mints the signer with `-days 730`, so the attacker's window
after stealing the signer key is two years.

The user asked for the alternative — short-lived signer certificates under the
**existing** CA, so that expiry is something the device enforces on its own,
with no revocation list to deliver and no anchor to change. A CRL has to reach
the device, and the device this discussion is about is the one that cannot
reach a server; a stale CRL forces a choice between failing closed (no updates
at all) and failing open (revocation does not work for exactly the population it
was for). Short validity replaces "did a revocation reach me" with "what time is
it".

**DESIGN ONLY.** No implementation.

## ActiveForm

Measuring RAUC's certificate-validity semantics against the real `rauc` this
tree pins, then designing the signer validity window, the reissue authority and
the clock dependency around what was measured.

## Dependencies

- **blocked by**: (none)
- **relates to**: [PLAN-077](../plan/PLAN-077.md) §6 (the second-anchor question
  this narrows), [PLAN-070](../plan/PLAN-070.md) §6.3 (the immutability property
  this does not trade), [PLAN-071](../plan/PLAN-071.md) §9.6 (the freshness
  cadence this is adjacent to, and the clock both rest on)

## Acceptance

- `make docs-verify` green.
- PLAN-078 carries Context, Proposal, Risks, Scope, Alternatives, an explicit
  approval boundary and an implementation backlog estimated separately from
  approval.
- The RAUC measurement — commands and output — is **in the plan**, not
  asserted.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: the measurement was taken and it decided the design.

  ### The question, and the measured answer

  **Does an expired signer make previously published bundles uninstallable?**
  Both readings were available — the bundle's CMS does carry a `signingTime`
  attribute — so the answer had to be measured rather than argued.

  **RAUC 1.13 verifies against `now` by default**, and the tree gets that
  behaviour because `pkgs/rauc/system.conf.in` never sets
  `[keyring] use-bundle-signing-time`. So an expired signer **does** make every
  bundle it signed refuse, at `rauc install`'s `Verifying signature` step. The
  behaviour the design needs is the one RAUC already does, and **the mechanism
  cost of the plan is zero**; every cost it carries is operational.

  The decisive secondary finding is about the other setting.
  `use-bundle-signing-time=true` is **not** a milder expiry — it is none:
  `signingTime` is chosen by whoever holds the key, and a bundle signed by a
  signer that had expired 370 days earlier, with the signing host's clock rolled
  back into its old window, is **accepted**. That closed off the middle position
  and made the design a single choice rather than a trade.

  The finding that made the design viable is that the release side can repair
  its own archive: `rauc resign` under a signer reissued from the **unchanged**
  CA leaves the payload byte-identical and the result installs on an untouched
  device. `resign` itself refuses at the device's semantics, so the release host
  must opt into signing-time semantics **locally** — which is sound because the
  two are different machines with different exposure, and is measured rather
  than hoped for.

  ### What was run

  The pinned `IMAGE_DEBIAN_TRIXIE`
  (`debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132`)
  with the distribution's **rauc 1.13** — the same upstream release
  `pkgs/rauc/versions.env` pins — and OpenSSL 3.5.7, following
  `tests/rauc-trust-negative-test.sh`'s precedent that reading and verifying
  with a distro rauc is fair. Certificate windows and verification clocks moved
  with `libfaketime`. Containers `ai-agent-44xybep3-*`, `--label ai-agent=true`,
  all `--rm`; scratch under the worktree's gitignored `tmp/`.

  | group | what it measured | verdict |
  | --- | --- | --- |
  | M0 | `rauc bundle` with an expired signer and no `--keyring` | created silently |
  | M1–M6 | `rauc info` at the real clock, `+10d`, `-10d`, with and without `use-bundle-signing-time` | now-semantics by default; signingTime-semantics when set; `certificate is not yet valid` when behind |
  | M10 | an expired signer with a backdated `signingTime` | **accepted** under signing-time semantics, refused by default |
  | M12 | a foreign CA under signing-time semantics | still refused — it relaxes expiry only |
  | M11.1–4 | the real `rauc install` path over D-Bus, four clock/config combinations | same verdicts, at the `Verifying signature` step |
  | R1–R10 | `rauc resign` of an archived bundle; payload comparison | repairable release-side; payload byte-identical; forgery still refused |
  | W1–W4 | RAUC's imminent-expiry warning | emitted by `rauc bundle --keyring` and `resign`, **not** by `rauc info --keyring` |
  | P1–P3 | an intermediate CA under `pathlen:0` vs `pathlen:1` | `pathlen:0` refuses (`path length constraint exceeded`); `pathlen:1` accepts; the intermediate must travel in the bundle |

  Every command and its output is quoted in PLAN-078's measurement section.

  ### Two corrections to the brief's premises, both measured

  - **A factory reflash to a known-good older release is unaffected.**
    `docs/design/release-artifacts.md` §1 gives a release both a
    `<board>-mos-<epoch>.img` and a `mos-<board>-<epoch>.raucb`; a reflash
    writes the `.img`, which carries no CMS signature and which RAUC never
    verifies. The archive collision is real but applies to the `.raucb` path
    only.
  - **The intermediate-CA option has an expiry of its own.** Both
    `gen-dev-keys.sh` and the §2.1 ceremony mint the CA with
    `basicConstraints=critical,CA:TRUE,pathlen:0`, which **forbids** an
    intermediate. Adopting one after a production CA exists means issuing a new
    root certificate — a §2.4 rollover, which is the one procedure this plan
    cannot perform. PLAN-077 §4.2 records that production material has never
    existed, so the decision is free today and expensive after the first
    ceremony. That is why PLAN-078 puts it to the user as a decision with a
    deadline rather than a recommendation.

  ### A measurement that was discarded

  The first `rauc install` run produced three identical verdicts. The cause was
  process leakage, not RAUC: `kill` hit the wrapping subshell rather than the
  service, so a leftover `rauc service` kept owning `de.pengutronix.rauc` and
  served the later cases at the earlier clock and the earlier config. The client
  prints a normal-looking refusal either way, so the contamination was visible
  only in the service log's PID. Each case was re-run in its own container.

  Recorded because the failure is silent and the same shape would contaminate
  any future D-Bus-mediated measurement in this tree.

  ### Gate results

  | gate | result |
  | --- | --- |
  | `make docs-verify` | **green** |

  `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

  ### Out-of-scope files touched

  None committed beyond the two PMA records. Scratch lived in the worktree's
  gitignored `tmp/`; every container was `--rm` and named `ai-agent-44xybep3-*`.
  Host `/dev/mapper` and `losetup -a` were empty before and after the one run
  that needed device-mapper.

  ### Handoff

  PLAN-078 ends at an approval boundary with **two open decisions**, both in its
  §4: the reissue posture (intermediate CA / monthly root access / a 90-day
  window), and — if the intermediate is chosen — the `pathlen:1` change to the
  CA ceremony, which must be taken before the first production ceremony runs.
