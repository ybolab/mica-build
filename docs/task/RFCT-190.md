# RFCT-190 PLAN-021 M3a: the os tree ghost-reference sweep — provenance and board tokens

- **status**: in progress
- **priority**: P2
- **owner**: bkd/ah44np0x
- **createdAt**: 2026-08-27
- **plan**: PLAN-021 (M3)

PLAN-021 M3's os/** half: comments and docs-in-code across os/** still name
files that no longer exist under those names. This sweep rewrites each ghost
reference to name what replaced it, or marks it dated inline where the
successor is not derivable from the repo. Zero behaviour change.

## Scopes

1. **verify-image-v2.sh ghosts** (~60 hits): references to the deleted
   os/verify-image-v2.sh are rewritten to name the os/verify/ v2 suite that
   replaced it, or marked dated.
2. **Provenance ghosts** (~31 hits): references to os/update/bundle.sh and
   os/mkimage-v2.sh (since moved/renamed) get the same treatment — successor
   path or dated marker.
3. **board/ tokens** (~17 hits): comments still spelling the pre-rename
   `board/` tree are repointed to os/boards/... or marked dated.
4. **Coordinated deletion** (one commit, approved via PLAN-021 + L1 ruling):
   the dead SYSTEM_CONF_IN override knob in os/pkgs/rauc/render-config.sh is
   deleted (SYSTEM_CONF_OUT stays), and the docs/design/api.md citation that
   quotes "rootfs.0" at a render-config.sh line is re-anchored by content in
   the same commit.

Acceptance is the measured count delta per scope (before/after grep counts),
not a return code; every residual hit is justified individually.
