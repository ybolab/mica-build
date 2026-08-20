//! Static asset hosting: path resolution and content classification.
//!
//! `docs/design/api.md` §4.3 and §4.4, as pure functions. Nothing here builds
//! a response or touches axum: [`path::resolve`] decides *which file*, and
//! [`mime::content_type`] and [`mime::cache_class`] decide *what headers it is
//! served with*. The asset router applies them, applies §4.2's fallback for
//! the one rejection that permits it
//! ([`path::Rejection::eligible_for_fallback`]), and answers §4.3's `/api/`
//! row with [`mime::CacheClass::NoStore`].

// Nothing in the crate calls these yet: the asset router that does is the next
// task in this phase, and it lands separately. Remove this attribute with the
// route that consumes them; the unit tests below each module are what exercise
// them until then.
#![allow(dead_code)]

pub mod mime;
pub mod path;
