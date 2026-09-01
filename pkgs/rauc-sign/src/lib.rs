//! TUF signing and verification for mos releases.
//!
//! Two halves share this crate because they share one metadata format:
//!
//! - [`repo`] + the `rauc-sign` binary: the release side (phase 1). Produces and
//!   maintains the static TUF repository on a build host, never on a device.
//! - [`client`] + the `rauc-verify` binary: the device side (phase 2,
//!   first half). Verifies a LOCAL copy of that repository against a pinned
//!   trusted root and a persistent per-role version state.
//!
//! - [`update`] + [`http`] + the `rauc-update` binary: phase 2's second half,
//!   the device-side update client. Selects a compatible target from the
//!   signed release metadata, downloads it resumably into a bounded reserve
//!   directory over plain HTTP, and imports offline "lockbox" media — always
//!   through the same verified walk as [`client`].
//!
//! Still deliberately not modelled here: the Uptane director/image repository
//! split, and mosd's install orchestration (the `--install` handoff shells out
//! to `rauc install`; mosd's D-Bus route is documented, not linked).

pub mod client;
pub mod http;
pub mod keys;
pub mod repo;
pub mod update;
