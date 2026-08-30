# RFCT-269 Drop the retained-topic upgrade guidance for the removed system projection

- **status**: completed
- **priority**: P3
- **owner**: roy/mqtt-review-fixes-20260830
- **createdAt**: 2026-08-30 13:00

## Description

`docs/design/bus.md` section 7 and its Chinese counterpart describe a
one-time broker purge of `N/<deviceId>/mosd/#` records left by a release
that published the mosd system tree. No such release was ever fielded: the
project is in development and no device has published to a broker, so
there is no broker to migrate and the section documents a procedure nobody
can need. Remove it, the changelog sentences that point at it, and renumber
the cross-references.

## Acceptance

- Neither `bus.md` carries an upgrade-cleanup section or a reference to
  `N/<deviceId>/mosd/#`.
- The changelog no longer says the cleanup guidance remains applicable.
- Section cross-references inside both documents resolve.
- `make docs-verify` passes.

## ActiveForm

Removing the never-needed retained-topic migration guidance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Documentation only; no code or policy changes.

- complete: Section removed from both bus.md files, changelog references dropped, cross-references renumbered; docs-verify 48/48.
