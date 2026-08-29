# RFCT-253 `access.ssh` is bus-writable and grants a remote capability, which the platform-switch rule does not cover

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-29
- **plan**: PLAN-027 (M4 residue, filed from RFCT-224's decision record)

RFCT-224 settled the bus writability of platform switches for the class and
wrote the rule into `docs/design/bus.md` §11.6: *a platform switch is read-only
on the item tree unless a remote broker client may flip it.* `container` and
`mqtt` were decided under it and stay out of `WRITABLE_SUBTREES`.

`access.ssh` is the one LISTED entry that rule strains against, and RFCT-224
named it rather than quietly excluding it. Its measurement stands as the
evidence base for this task; nothing here needs re-auditing, only deciding.

## What was measured, and where

`docs/task/RFCT-224.md` "Residue" records it: `access.ssh` is remotely writable
today and it does grant a remote capability — `sshd`, `permitRootLogin`,
`listenAddresses`. The same record's enumeration table marks it as the single
row whose answer is deferred, against eight other roots that are consistent.

The reason it was left alone is also on record and remains good: narrowing a
shipped writable subtree is a **behaviour change**, not a documentation fix, and
the MQTT bridge defaults to `Mode::ReadOnly`
(`os/pkgs/mosd/mqttd/src/config.rs`), so a write requires an explicit operator
opt-in. The exposure is therefore real but not open by default.

RFCT-224 also established the frame this task inherits: `WRITABLE_SUBTREES` is
NOT an access boundary — `SetSettings` writes any settings path without
consulting it — so the list is precisely and only the REMOTE write surface.
Whatever is in it is what a broker client may flip. That is what makes
`access.ssh`'s membership a live question rather than a stylistic one.

## Scope when claimed

Decide whether `access.ssh` should remain remotely writable, and make the tree
say only that. Three shapes are open and choosing between them is the work:

- **Keep it, and say why.** State the exception in §11.6 in the section's own
  decision + reason + what-would-change-it shape, so the rule covers it rather
  than being strained by it. The weakest option only if the reasoning is thin.
- **Narrow it.** Split the subtree so the remotely writable part excludes the
  capability-granting keys (`permitRootLogin` is the sharp one), leaving
  operator-facing settings reachable. This needs its own plan: it changes
  shipped behaviour and any integrator writing that path over MQTT today.
- **Remove it from the list.** The largest change, and it must account for what
  breaks — an operator who enables SSH over the bridge today.

Whichever is taken, the projection must be pinned by a test the way RFCT-224
pinned `container` and `mqtt`, and the sentinel method it used is the standard
to meet: plant the change, watch named tests fail, revert, and record which
tests failed.

## Acceptance criteria

1. The decision is written into `docs/design/bus.md` §11.6 so the class rule
   covers `access.ssh` rather than admitting a documented exception to itself.
2. Whatever the tree exposes after the decision is pinned by a test, not by
   inspection.
3. If the subtree is narrowed or removed: the behaviour change is stated where
   an integrator reading about MQTT control would find it, and the migration
   consequence for a device that has SSH enabled over the bridge is named.
4. If it is kept: the reason distinguishes it from `container` and `mqtt` on
   something other than "it is already there".

## Dependencies

- **blocked by**: (none — claimable any time, but a narrowing or removal needs a
  plan of its own; this is not a documentation fix)
- **blocks**: nothing. The exposure is not open by default, which is why this is
  P2 rather than higher.
