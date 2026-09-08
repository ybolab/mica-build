# PLAN-925 Align the Wi-Fi client switch with the settings API

- **status**: completed
- **createdAt**: 2026-09-08 09:42 UTC
- **approvedAt**: 2026-09-08 09:42 UTC
- **relatedTask**: RFCT-946

## Investigation

The built-in network page sends a boolean to
`PUT /api/v1/settings/wifi.client.enabled`. The settings writer admits six
other paths and returns 409 `settings_read_only` before calling mosd.
Both sides are unchanged from mainline baseline `09c384cd22de`; the board
port did not introduce the mismatch. The device reproduced the refusal.
The UI screenshot fixture accepts every mutation, so it does not exercise
the real backend allowlist.

The settings model already accepts this boolean. The client reconciler owns
supplicant and DHCP activation, including the enabled-with-no-networks idle
state. The AP reconciler reports same-interface station/AP conflicts. These
existing application semantics remain owned by mosd and its task/state API.

## Proposal and authorization

The user's existing repair and continuation instructions cover the API
defect discovered during the requested Wi-Fi test. The latest instruction
explicitly stops packaging because of disk space. Implement only the source
repair and scoped validation; do not rebuild images, packages or installers.

1. Admit only `wifi.client.enabled` as a boolean scalar setting.
2. Keep other Wi-Fi paths read-only through the generic settings writer.
3. Exercise enable and disable, returned tasks, settings readback, invalid
   payload rejection and browser authentication/CSRF behavior.
4. Regenerate OpenAPI from the real generator and update the API contract.
5. Run focused Rust checks with debug info and incremental caching disabled
   to limit disk use. Record source delivery separately from device rollout.

## Risks and alternatives

Accepting a settings write queues reconciliation; 202 does not promise radio
association. Radio conflicts and runtime failures still need task/state
inspection. Opening the entire Wi-Fi subtree would unnecessarily widen the
write surface. Direct D-Bus control proved connectivity during testing, but
does not repair the browser contract. No device deployment is included.

## Verification

- Rust formatting and `cargo clippy --locked -p apid --all-targets -- -D warnings`
  passed in the pinned native arm64 Rust-check container.
- `cargo nextest run --locked -p apid --bin apid`: 325 passed, zero skipped,
  including enable/disable task readback, session/CSRF, invalid-value and
  adjacent-path refusal regressions.
- The checked-in OpenAPI document was regenerated with `apid --openapi`;
  the document-drift test and a direct comparison passed.
- Documentation checks: 491 links, 760 status assertions and 150 board
  dossier assertions passed. Source review found no introduced correctness
  issues in the scoped change.

An initial unrestricted apid test selection reached two process-level tests
that require a separately built mosd binary. Both failed at that missing
prerequisite, before their behavioral assertions. The final scoped run is
the 325 apid binary tests above; it is not the full workspace gate or a live
device deployment. The test build disabled debug information and incremental
compilation. No images, packages or installers were built after the stop.
Existing SD/RAUC artifacts and the running device predate this API change.
