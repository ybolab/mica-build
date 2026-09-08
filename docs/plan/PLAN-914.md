# PLAN-914 Classify FIT signature as a tree-wide export debt

- **status**: completed
- **createdAt**: 2026-08-31 UTC
- **approvedAt**: 2026-08-31 09:01 UTC
- **completedAt**: 2026-08-31 09:06 UTC
- **relatedTask**: RFCT-924

## Context

The s905x5m U-Boot artifact target ends in a section-5 audit of the produced
`.config`. It currently accumulates bootcount, redundant-environment, FIT /
FIT-signature, and `SYS_BOOTM_LEN` failures in one variable and rejects the
artifact stage if that variable is nonzero.

RFCT-920 closed the bootcount and redundant-environment groups. The final
config still has `CONFIG_FIT` disabled, no `CONFIG_FIT_SIGNATURE` line, and
`CONFIG_SYS_BOOTM_LEN=0x4000000`; the current target therefore refuses export
in two groups. This makes s905x5m subject to a FIT-signing export block that
cx3576 does not meet either: `docs/design/boards.md` records that
`CONFIG_FIT_SIGNATURE` is configured nowhere in the tree. x64 does not use a
U-Boot chain.

The owner decided on 2026-08-31 that FIT signing is a deferred mainline design
decision. A real solution must decide FIT assembly, signing-key custody and
rotation, the public key's path into U-Boot's DTB, and its board scope. RFCT-925
records that work. The owner also requires the current gap to stay measurable
and conspicuous: an exported artifact must never imply that s905x5m verifies
its kernel.

## Proposal

1. Extract the current produced-config section-5 audit from the s905x5m
   Dockerfile into a small Bash checker, invoked unchanged by the Dockerfile's
   `contract` stage. Preserve every existing symbol count, positive control,
   MMC-environment assertion, and `SYS_BOOTM_LEN` arithmetic.
2. Split the checker state into `export_failures` for board-owned requirements
   and `fit_tree_debt` for the FIT pair. The FIT branch remains a real check;
   when either required symbol is absent, it prints its observed evidence plus
   prominent warnings containing both of these facts:

   ```text
   s905x5m is NOT verifying its kernel
   U-Boot chain of trust is incomplete
   ```

   It names RFCT-925 as the mainline owner of the debt, but does not add to
   `export_failures`.
3. Leave bootcount, redundant environment, and `SYS_BOOTM_LEN` on the
   blocking path. The final refusal reports the number of board-owned failures;
   a successful board-owned gate with `fit_tree_debt=1` prints another warning
   before artifact export completes.
4. Add a focused checker fixture suite. One controlled config retains the
   current 64 MiB bootm value and must exit nonzero while printing the FIT
   warnings. A second has all three board-owned groups satisfied but lacks FIT
   and FIT signature; it must exit zero only while printing the same warnings.
   This proves the non-silent-success property without changing a real board
   configuration.
5. Add a narrow section-5 note in `docs/design/boards.md` that links
   RFCT-925 and records the owner-approved temporary classification. It does
   not delete or weaken the contract text; an owner-level future revision can
   replace the annotation after the shared design exists.
6. Run the focused fixture suite locally and the normal s905x5m U-Boot export
   target from an isolated non-Git snapshot on `192.168.27.200`. Record its
   FIT warnings and the `SYS_BOOTM_LEN` export refusal. No board access or
   storage action is part of verification.

## Risks

- A warning that is emitted only on a failing build could be missed after the
  last board-owned gap closes. The passing fixture and explicit successful-path
  warning guard against that failure mode.
- Moving the logic into a script could accidentally lose a Docker-only input
  path. The script will receive the same final `.config` and built-DTB location,
  and the normal Docker target remains the integration check.
- The annotation is not a long-term substitute for verified boot. It must link
  the open RFCT-925 record and state the missing security property plainly.

## Scope

- `os/boards/s905x5m/bsp/uboot/Dockerfile` and a focused extracted checker plus
  its fixture target.
- `docs/design/boards.md`, RFCT-924, RFCT-925, and this plan record.
- No U-Boot config, FIT image, key material, boot script, partition layout,
  hardware, deployment, eMMC, boot area, `bootloader_a`, or remote push.

## Alternatives

- Keep the inline Dockerfile gate and rely only on a full remote build:
  rejected because it cannot exercise a successful board-owned export while
  FIT remains intentionally absent.
- Enable FIT/signature in the board defconfig: rejected because it would hide
  unresolved FIT assembly, key custody/rotation, and U-Boot-DTB key-injection
  decisions behind symbols alone.
- Remove the FIT check: rejected because the requirement must remain measured
  and the lack of kernel verification must be impossible to mistake for a
  complete chain of trust.

## Annotations

- Awaiting explicit approval to implement.
- Explicit implementation authorization received in the 2026-08-31 review.
- A concurrent worker has already changed the same gate's bootm branch to
  require s905x5m's derived `0x4000000`. To preserve that hunk and minimize
  overlap, the approved implementation keeps the checker inline rather than
  extracting it. Integration verification uses isolated current and altered
  temporary snapshots on `192.168.27.200` to prove both required paths.
- Completed: the gate now uses separate board-owned and tree-debt state. FIT
  absence leaves the measured evidence and prominent security warnings intact;
  it does not increment the export-failure count. A successful debt-path build
  ends by naming the remaining FIT debt rather than claiming full compliance.

## Implementation

- Retained the current final-`.config` evidence for both FIT symbols and split
  its consequence from the board-owned export-failure counter.
- Preserved the concurrent exact `0x4000000` s905x5m bootm branch and changed
  its failure increment to the board-owned counter.
- Added the owner-approved RFCT-925 cross-reference in the section-5 contract
  as an annotation, not a replacement of the long-term FIT requirement.

## Verification

- Current isolated build on `192.168.27.200`: exit 0, three bootloader output
  files, FIT disabled/signature absent, and all required warnings including
  `s905x5m does NOT verify its kernel`.
- Controlled final-config mismatch on the same host: 32 MiB observed against
  the derived 64 MiB expectation, exit nonzero, one board-owned failure, no
  artifact export, with FIT warnings still printed first.
- `bash docs/verify-index.sh`: 48/48 PASS. `git diff --check`: PASS.
