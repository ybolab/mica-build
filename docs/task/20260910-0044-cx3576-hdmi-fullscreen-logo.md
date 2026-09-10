# 20260910-0044-cx3576-hdmi-fullscreen-logo Show one centered CX3576 HDMI logo without a cursor

- **status**: completed
- **priority**: P1
- **owner**: display/session-20260910-0044
- **createdAt**: 2026-09-10 00:44
- **relatedPlan**: [20260910-0047-cx3576-hdmi-fullscreen-logo](../plan/20260910-0047-cx3576-hdmi-fullscreen-logo.md)

## Description

Investigate and repair the CX3576 HDMI display shown in the supplied screenshot:
two small copies of the board logo occupy the top of the screen and a text cursor
blinks below them. The approved output is one centered logo without a text cursor. Development-stage behavior needs no compatibility path.

## ActiveForm

Completed the centered single-logo and hidden-cursor repair

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full tier: board configuration, authenticated packaging, and focused validation.
- 2026-09-10 00:51: user approved the smaller centered-logo repair.
- The boot-log-cleanup task also discusses loader-logo reservations. Its owned
  changes must remain separate; this task will identify any concrete overlap.
- Tracking uses repository files and the PMA task-state serializer.
- Confirmed that the exported forced kernel command line omits the board.env
  logo options; the historical boot log agrees. Authenticated packaging asserts
  that same incomplete command line.
- Confirmed fixed 720x405 rendering and default per-CPU repetition: a 1920-pixel
  framebuffer fits two copies at x=0 and x=728. The original PNG is 1920x1080.
- Confirmed that disabling getty does not hide the default VT underline cursor.
- Found that the existing late-hotplug claim omits init-only logo lifetime; the
  narrowed repair leaves logo lifetime and hotplug behavior out of scope.
- Implementation is approved; physical display acceptance requires the board.
- Planning validation passed: all five `make docs-verify` checks, task/plan
  status and index consistency, relative links, and `git diff --check`.
- RED: all four new display-policy regressions failed on the original inputs.
  GREEN: all four pass after the three command-line declarations were aligned.
- Full build gate: 388 tests passed, zero failed; TypeScript checking passed.
  The board schema lint and all five documentation checks passed.
- Actual packaging of the previous exported kernel is refused with
  `FIT kernel command policy differs from authenticated packaging`; no kernel
  component output is created for that stale input.
- Scoped pma-cr review passed with zero findings. The pinned fbcon cursor worker
  and cursor drawing entry both reject a VT whose `vc_deccm` is not 1; the VT
  initialization sets it from `global_cursor_default`.
- The kernel build and signed-artifact verification completed successfully.
  Logs are in `.tmp/cx3576-hdmi-20260910/`; outputs are isolated under
  `_out/cx3576-hdmi-20260910/`.
- The separate late-hotplug limitation is tracked by [20260910-0117-cx3576-late-hdmi-logo](20260910-0117-cx3576-late-hdmi-logo.md).

## Delivery

- Image: `/srv/mos/_out/cx3576-hdmi-20260910/image/mos-cx3576-20260910-011849.img` (1,362,100,224 bytes; 1,299 MiB).
- SHA-256: `2f4f2fc21e5cd6c19366574b00880b1ab96043c54d08c2c3aa1ac9ca535d3ed7`.
- Kernel component: `ec1a124dbf543d9862b182b524aa831dc6d70ae36da5570b198b8ac96f7d51d0`; release `6.1.115`.
- Built config and Image both carry the exact centered-single-logo and hidden-VT
  cursor arguments; authenticated packaging accepts the rebuilt component.
- Required FIT signature verification and tamper/missing/unknown-key negatives
  passed. Offline image verification: 123 checks passed, zero skipped. Flash
  geometry and the image checksum passed.
- The signed root and firmware inputs are reused from the existing 1 GiB SYSTEM
  image. Exact source, component and image identities are recorded in
  `_out/cx3576-hdmi-20260910/build-record.json`.
- Physical HDMI output has not been tested on a board. No device was flashed.
- Implementation and artifact delivery are complete; the separate late-hotplug
  follow-up remains pending under its own task.

- complete: Centered single-logo and hidden-cursor policy verified in source, rebuilt kernel, signed FIT and candidate image; physical display remains untested.
