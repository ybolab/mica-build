//! Server-side TUF signing for mos releases (PLAN-006 Part A/L, phase 1).
//!
//! This crate produces and verifies a plain directory of static TUF metadata and
//! target files. It is a release-pipeline tool: it runs on a build host, never on
//! a device. The on-device Uptane client and the director/image repository split
//! are later phases and are deliberately not modelled here.

pub mod keys;
pub mod repo;
