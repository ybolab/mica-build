# RFCT-307 The development-grade marker is staged but never installed

- **status**: in_progress
- **priority**: P0
- **owner**: meta-marker-install/bkd-8ud12dym
- **createdAt**: 2026-09-04 20:05
- **relatedPlan**: [PLAN-077](../plan/PLAN-077.md)

## Description

`main` composes an x64 image that fails `bash verify/run.sh --verify --board x64`:

```
FAIL: the baked meta/ is exactly the public set: /srv/mos/meta/GENERATED marks this
tree's signing material DEVELOPMENT-GRADE and the packed root ships no
/usr/share/mos/meta/GENERATED.
```

[RFCT-305](RFCT-305.md) (PLAN-077 slice G1) added `GENERATED` to
`rootfs/build.sh`'s `META_PUBLIC` as a **conditional** third entry. The staging
side is correct — the build log says `staged and checked 3 of 3 public-set
entries` and `_out/x64/meta-public/usr/share/mos/meta/GENERATED` exists — and
`rootfs/build.sh` copies the whole staged tree into the composition context. The
**install** side never learned about it. `rootfs/compose/compose-install.sh`
names each public-set path explicitly, on purpose, and its own comment prices
that choice as *"naming them means a third public file is a reviewed line here
as well as there"*. That reviewed line was never written, so the marker is
audited, staged, copied into the build context and then dropped.

The consequence is not cosmetic. The image reports itself production on
`GET /api/v1/system/info` and `build/src/release-manifest.ts`'s publication gate
reads the same absent file, so a bench image built on unprotected development
keys is one the gate would let out to a customer channel.

Neither contributing branch ran the case: the seam's composed run
([RFCT-301](RFCT-301.md)) had a two-entry allowlist, so tree and image agreed
and the biconditional held; RFCT-305 added the third entry and explicitly did
not compose an image, naming this exact pairing as the thing it had not proven.

## ActiveForm

Installing the conditional development-grade marker on the composition path,
and reconciling the named set against the staged set.

## Dependencies

- **blocked by**: (none) — RFCT-305 is merged at `86402c33`
- **blocks**: PLAN-037 Gate B (Gate A is not green until a composed image passes)

## Acceptance

- The marker reaches the image, and a production-shaped tree (no
  `meta/GENERATED`) still produces an image with none.
- A composed x64 image and `bash verify/run.sh --verify --board x64` **green**,
  in both dispositions.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- `compose-install.sh`'s header comment corrected — it still says two files.
- The third-place question answered, and a recommendation on making the two
  lists fail when they disagree.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.
