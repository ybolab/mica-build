# RFCT-131 /healthz answers ok before checking anything, and two documents read it as a statement about the appliance

- **status**: completed
- **priority**: P2
- **owner**: bkd/xexc9k2h
- **createdAt**: 2026-08-26

The handler is two lines and performs no check:

```rust
async fn healthz() -> &'static str {
    "ok"
}
```

(`mosd/apid/src/routes.rs:722-724`). It is exempted from the auth gate at
`:674` and answers while mosd is dead, while the settings tree is unreadable,
and while every pane on the device returns 502.

That narrow guarantee — "the apid process is listening" — is the correct one
for the boot health gate, which probes apid's liveness at
`os/rootfs/overlay-v2/usr/lib/mos/mos-health:218-231` and checks systemd's
failed units separately at `:169-180`. The problem is elsewhere. Two documents
name the endpoint as if it reported appliance health:
`docs/plan/PLAN-005.md:149` lists it as one of four `healthGate` checks beside
*"all system services running"*, and `docs/design/boards.md:98` makes *"booting
to apid healthz on hardware"* a board bring-up criterion. A board that reaches
that line with mosd crash-looping passes it.

Both readings want narrowing to what the endpoint actually proves. Neither
document is otherwise wrong; the sentence is.

## Resolution

No code change, by design: `/healthz` stays the two-line liveness probe
(`os/pkgs/mosd/apid/src/routes.rs:729-731`), exempt from the gate, because
the boot health gate depends on exactly that behaviour and checks failed
units separately. What was narrowed is the two overstated readings
(commit `b6a1400`):

- `docs/design/boards.md` bring-up criterion (the task's ":98", the
  "booting to apid healthz on hardware" sentence): now "apid liveness on
  hardware — `/healthz`, which proves only that the apid process is
  listening, not that mosd or any other service on the board is healthy."
- `docs/design/api.md` §1.2 route-table row, where the endpoint is
  documented: the row now states the narrow meaning ("a liveness probe
  only: it proves the apid process is listening and checks nothing else").
  §2.3's healthz bullet and §2.4's case 3 already stated the narrow
  guarantee and are unchanged in substance.

`docs/plan/PLAN-005.md:149` is deliberately untouched: plan documents are
history, and the historical `healthGate` sentence there stands corrected
by the design documents above.

<!-- dated-record: a frozen worklist or exhibit of what was measured then; re-pointing its citations would falsify the record; exempt from docs/verify-citations.sh (RFCT-172) -->
