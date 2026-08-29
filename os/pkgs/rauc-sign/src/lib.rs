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
//! Transport (how metadata reaches the device), the Uptane director/image
//! repository split, and mosd's install orchestration are phase 2's second half
//! and are deliberately not modelled here.

pub mod client;
pub mod keys;
pub mod repo;
