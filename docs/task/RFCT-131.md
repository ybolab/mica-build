# RFCT-131 /healthz answers ok before checking anything, and two documents read it as a statement about the appliance

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
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
