# RFCT-358 Two latent hazards from the first hardware boot: host-resolved symlinks in verify, and the ESP automount a generator writes for a RAUC boot slot

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/na7l21jo
- **createdAt**: 2026-09-08 14:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

Two things RFCT-355 found while triaging the first cx3576 hardware boot, named
there and deliberately left. Both are safe today for a reason nobody chose.

1. **`regularFileFollowingLinks` resolves symlinks against the HOST.** It is
   `statSync(join(root, path))`, which hands the whole path to the host kernel,
   so an ABSOLUTE symlink inside the unpacked root resolves against the
   verifying machine's `/`. RFCT-355 hit it for real on `wifi-regdb-present`
   and closed it in the three regdb checks only, naming the rest.
2. **`systemd-gpt-auto-generator` writes an ESP automount for a RAUC-owned boot
   slot.** Nothing in this tree wrote `efi.automount`; the generator writes it
   because the boot slots are typed ESP and appear in no fstab. It is inert on
   cx3576 only because `CONFIG_AUTOFS_FS` is off.

## ActiveForm

Migrating the verifier's path resolution into the unpacked root, and closing the
generated ESP automount independently of a kernel symbol

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Item 1: every call site classified, the migrated ones' verdicts compared
  before and after on a real assembled image, discriminating tests added
  wherever a migrated site has a fixture, and the fate of
  `regularFileFollowingLinks` decided in writing.
- Item 2: closed independently of `CONFIG_AUTOFS_FS`, with an assertion that
  reads the image, and the three boards' exposure measured rather than assumed.
- `verify/run.sh --verify --board cx3576` and `--board virt-arm64` green on
  images built here; every verdict that moved reported with its cause.
- `verify/run.sh` and `make docs-verify` green, the latter from a `git archive`
  into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched;
  nothing display- or kernel-config-related, and neither the factory-root gate
  nor the smoke build record.

## Notes

(filled in as the work lands)
