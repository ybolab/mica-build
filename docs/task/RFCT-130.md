# RFCT-130 Three distinct settings failures reach the API as one error code, so a missing path and a bad value are indistinguishable

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26

`to_fdo` maps `SettingsError::NotFound`, `SettingsError::ReadOnly` and
`SettingsError::Validation` all onto `fdo::Error::InvalidArgs`
(`mosd/mosd/src/bus.rs:487-491`). The three are separate variants with separate
messages in `mosd/mosd-settings/src/error.rs:9-21`, and the distinction is
destroyed at the bus boundary.

apid recovers the fdo error *name* correctly by downcast
(`mosd/apid/src/routes.rs:535-536`), so nothing is lost after mosd — but there
is only one name left to recover. `FDO_INVALID_ARGS` therefore answers
`422 Unprocessable Entity` with the single code `settings_rejected`
(`mosd/apid/src/routes.rs:541-544`) for all three conditions. A client asking
for a dot-path that does not exist gets the same status and the same code as
one submitting a malformed value, and can separate them only by parsing
mosd's message text — which is prose, not contract.

Splitting them is a mosd change: `NotFound` wants its own fdo name so the API
can answer `404`, and `ReadOnly` wants one so the API can answer `409`. apid's
match arm is the consumer that makes the split worth making.
