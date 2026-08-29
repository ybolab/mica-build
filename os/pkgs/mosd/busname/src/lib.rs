//! `mos-busname` — the one rule that turns a `com.mos.*` bus name into the
//! `<class>` the rest of the system keys off (`docs/design/bus.md` §5).
//!
//! Two grammars share one namespace:
//!
//! | Grammar | Origin | Example | Class |
//! |---|---|---|---|
//! | `com.mos.<class>[.<suffix>]` | system | `com.mos.sensor.abc123` | `sensor` |
//! | `com.mos.ext.<class>[.<suffix>]` | extension | `com.mos.ext.sensor.abc123` | `sensor` |
//!
//! So the class is the third dotted component of a system name and the fourth
//! of an extension name; a reader that takes the third unconditionally
//! publishes `com.mos.ext.sensor.abc123` under the class `ext`. The MQTT bridge
//! and mosd's service registry both need that distinction, so it lives here
//! once. The bare namespace `com.mos.ext` is extension origin with no class —
//! measurably ownable by an unprivileged uid, so calling it system-origin would
//! be origin spoofing, and it has no fourth component to name; [`parse`]
//! carries the measurement. This crate has zero dependencies on purpose, so
//! depending on it commits a consumer to nothing else.

#![forbid(unsafe_code)]

/// The prefix every mos bus name carries.
pub const PREFIX: &str = "com.mos.";

/// The prefix an extension bus name carries — `ext` **with its trailing
/// dot**, because `ext` is a namespace only when it is a whole dotted
/// component. `com.mos.extra.thing` merely starts with the same characters
/// and is an ordinary system name whose class is `extra`.
///
/// The D-Bus policy draws that boundary in the same place:
/// `own_prefix="com.mos.ext"` requires the next character to be a `.`, so it
/// refuses `com.mos.extra` — measured.md` §"Investigation
/// — `own_prefix` semantics (measured 2026-08-22)". Policy and parser agree on
/// one rule, which is the point.
pub const EXTENSION_PREFIX: &str = "com.mos.ext.";

/// The extension namespace itself, with no service name under it.
///
/// The one name that parses to an [`Origin::Extension`] with no class — see
/// [`parse`]. Named here so a consumer that must recognise it matches a
/// constant rather than a literal of its own, though a consumer should
/// normally match on `class: None` instead and let the type carry it.
pub const EXTENSION_NAMESPACE: &str = "com.mos.ext";

/// Which half of the `com.mos.*` namespace a name comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Origin {
    /// `com.mos.<class>[.<suffix>]` — a service that is part of the system
    /// image, governed by the D-Bus policy's default `<deny own="*"/>`.
    System,
    /// `com.mos.ext[.<class>[.<suffix>]]` — a name the `com.mos.ext` grant
    /// makes ownable, which is a **measured** property of the name and not an
    /// inference: the default `<deny own="*"/>` refuses `com.mos.other`, and
    /// only the grant lets anything here be owned at all. Says nothing about
    /// who owns it or whether they are trusted.
    Extension,
}

/// A parsed `com.mos.*` bus name, borrowing from the name it was parsed from.
///
/// The four facts a caller needs are all here, so nothing downstream has to
/// split the name a second time: that it *is* a mos name (the parse
/// succeeded), which half of the namespace it is in, its class, and its
/// suffix if it has one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct BusName<'a> {
    /// System or extension — which of the two grammars matched.
    pub origin: Origin,
    /// The class: `docs/design/bus.md` §5's registry entry, and the
    /// `<class>` segment of an MQTT topic. Never `ext` for an extension.
    ///
    /// `None` for the bare [`EXTENSION_NAMESPACE`] and only for it: a name in
    /// the extension namespace with nothing under it. A `None` here cannot
    /// form a topic address, and a consumer must refuse rather than
    /// substitute — the type is what stops `ext` or an empty segment being
    /// published as though it were a class.
    pub class: Option<&'a str>,
    /// Everything after the class, dots included and the separating dot
    /// dropped: `a.b` for `com.mos.ext.sensor.a.b`. `None` when the name
    /// ends at the class, which is one service of that class rather than one
    /// instance among several (`com.mos.mosd`).
    pub suffix: Option<&'a str>,
}

/// Parse `bus_name` under both grammars, or `None` when this grammar yields no
/// class for it.
///
/// A `None` return is "not one of ours": a name outside `com.mos.` entirely, a
/// name with nothing after `com.mos.`, and a name with an empty dotted
/// component (`com.mos.sensor.`) — a D-Bus bus name has no empty components, so
/// that is malformed rather than a `sensor` with an empty suffix. Whenever this
/// returns `Some`, `class` and `suffix` are non-empty wherever they are
/// present.
///
/// `com.mos.ext` is extension origin with no class: it parses to
/// `Origin::Extension` with `class: None`, not to `Origin::System` and not to
/// `None`. An unprivileged uid can own the bare name, because
/// `own_prefix="com.mos.ext"` matches the bare prefix itself, so the extension
/// grant governs it and the default `<deny own="*"/>` does not. That is
/// measured, not reasoned — measured against dbus-daemon —
/// `own_prefix` semantics (measured 2026-08-22)" against dbus-daemon 1.12.20,
/// asserted by `mosd/hack/dbus-policy-test.sh` section 4, where uid 65534
/// requesting the bare name is OWNED. Calling it system-origin would let an
/// unprivileged third party present itself to operators, the dashboard and the
/// MQTT bridge as the system. A bare `None` would discard one of the two true
/// things about the name, and there is no fourth component to invent a class
/// from.
///
/// The MQTT bridge and mosd's service registry both read this rule: the bridge
/// refuses to address a service it cannot name a class for, and the registry's
/// conformance gap falls out of the type rather than being re-derived from the
/// prefix. Recording that gap is the registry's job, not this crate's.
///
/// ```
/// use mos_busname::{Origin, parse};
///
/// let system = parse("com.mos.sensor.abc123").expect("a mos name");
/// assert_eq!((system.origin, system.class, system.suffix), (Origin::System, Some("sensor"), Some("abc123")));
///
/// let extension = parse("com.mos.ext.sensor.abc123").expect("a mos name");
/// assert_eq!((extension.origin, extension.class, extension.suffix), (Origin::Extension, Some("sensor"), Some("abc123")));
///
/// // The bare namespace: in the extension half, with no class to publish under.
/// let bare = parse("com.mos.ext").expect("a mos name");
/// assert_eq!((bare.origin, bare.class, bare.suffix), (Origin::Extension, None, None));
///
/// assert_eq!(parse("com.example.foo"), None);
/// ```
pub fn parse(bus_name: &str) -> Option<BusName<'_>> {
    if let Some(rest) = bus_name.strip_prefix(EXTENSION_PREFIX) {
        return split(Origin::Extension, rest);
    }
    if bus_name == EXTENSION_NAMESPACE {
        return Some(BusName {
            origin: Origin::Extension,
            class: None,
            suffix: None,
        });
    }
    split(Origin::System, bus_name.strip_prefix(PREFIX)?)
}

/// `<class>[.<suffix>]` — everything the prefix left — into its two parts.
fn split(origin: Origin, rest: &str) -> Option<BusName<'_>> {
    if rest.split('.').any(str::is_empty) {
        return None;
    }
    let (class, suffix) = match rest.split_once('.') {
        Some((class, suffix)) => (class, Some(suffix)),
        None => (rest, None),
    };
    Some(BusName {
        origin,
        class: Some(class),
        suffix,
    })
}

#[cfg(test)]
mod tests {
    use super::{BusName, EXTENSION_NAMESPACE, Origin, parse};

    fn system<'a>(class: &'a str, suffix: Option<&'a str>) -> Option<BusName<'a>> {
        Some(BusName {
            origin: Origin::System,
            class: Some(class),
            suffix,
        })
    }

    fn extension<'a>(class: &'a str, suffix: Option<&'a str>) -> Option<BusName<'a>> {
        Some(BusName {
            origin: Origin::Extension,
            class: Some(class),
            suffix,
        })
    }

    #[test]
    fn a_system_name_carries_its_class_in_the_third_component() {
        assert_eq!(parse("com.mos.mosd"), system("mosd", None));
        assert_eq!(
            parse("com.mos.sensor.abc123"),
            system("sensor", Some("abc123"))
        );
    }

    #[test]
    fn an_extension_name_carries_its_class_in_the_fourth_component() {
        assert_eq!(
            parse("com.mos.ext.sensor.abc123"),
            extension("sensor", Some("abc123"))
        );
        assert_eq!(parse("com.mos.ext.sensor"), extension("sensor", None));
        assert_eq!(
            parse("com.mos.ext.sensor.a.b"),
            extension("sensor", Some("a.b"))
        );
    }

    /// The separator boundary: `ext` is a namespace only as a whole dotted
    /// component, so a class that merely begins with those three characters
    /// is an ordinary system class. The D-Bus policy draws the boundary in the
    /// same place — `own_prefix="com.mos.ext"` refuses `com.mos.extra`,
    /// measured on record` — so these rows are where the
    /// parser and the policy are asserted to agree.
    #[test]
    fn ext_is_a_namespace_only_as_a_whole_component() {
        assert_eq!(parse("com.mos.extra"), system("extra", None));
        assert_eq!(parse("com.mos.extra.thing"), system("extra", Some("thing")));
        assert_eq!(parse("com.mos.extension"), system("extension", None));
    }

    /// The bare namespace is in the extension half of the namespace — a
    /// measured fact, not an inference — and carries no class.
    #[test]
    fn the_bare_extension_namespace_is_an_extension_with_no_class() {
        let expected = Some(BusName {
            origin: Origin::Extension,
            class: None,
            suffix: None,
        });
        assert_eq!(parse("com.mos.ext"), expected);
        assert_eq!(parse(EXTENSION_NAMESPACE), expected);
    }

    /// The risk this classification exists to close, asserted by name so that
    /// a refactor which "simplifies" [`Origin`] fails loudly instead of
    /// quietly reopening it.
    ///
    /// `own_prefix="com.mos.ext"` matches the bare prefix itself, so an
    /// unprivileged uid (65534) requesting `com.mos.ext` is OWNED — measured
    /// against dbus-daemon 1.12.20.md` §"Investigation —
    /// `own_prefix` semantics (measured 2026-08-22)", asserted by
    /// `mosd/hack/dbus-policy-test.sh` section 4.
    #[test]
    fn the_bare_extension_namespace_is_never_system_origin() {
        let parsed = parse(EXTENSION_NAMESPACE).expect("com.mos.ext is a mos name");
        assert_ne!(
            parsed.origin,
            Origin::System,
            "com.mos.ext must never be system-origin: an unprivileged uid can own it \
             (measured against dbus-daemon 1.12.20), so classifying it as system lets a \
             third party present itself as the system"
        );
        assert_eq!(
            parsed.class, None,
            "com.mos.ext has no fourth component, so any class here is invented and would \
             put a service on the bridge under a class nobody chose"
        );
    }

    #[test]
    fn what_is_not_a_mos_name_is_none() {
        assert_eq!(parse("com.mos."), None);
        assert_eq!(parse("com.mos"), None);
        assert_eq!(parse("com.example.foo"), None);
        assert_eq!(parse(""), None);
    }

    /// A bus name has no empty components, so these are malformed rather than
    /// a class with an empty suffix. `com.mos.ext.` is in this group and not
    /// with the bare namespace: the trailing dot promises a component that is
    /// not there, which D-Bus rejects as a name outright.
    #[test]
    fn a_name_with_an_empty_component_is_none() {
        assert_eq!(parse("com.mos.sensor."), None);
        assert_eq!(parse("com.mos..sensor"), None);
        assert_eq!(parse("com.mos.ext."), None);
        assert_eq!(parse("com.mos.ext.sensor."), None);
    }

    /// The property the whole crate exists for: no extension ever resolves to
    /// the class `ext`, whatever its suffix.
    #[test]
    fn an_extension_never_resolves_to_the_class_ext() {
        for name in [
            "com.mos.ext.sensor",
            "com.mos.ext.sensor.abc123",
            "com.mos.ext.io.a.b.c",
            "com.mos.ext.meter.x",
        ] {
            let parsed = parse(name).unwrap_or_else(|| panic!("{name} is a mos name"));
            assert_eq!(parsed.origin, Origin::Extension, "{name}");
            assert_ne!(parsed.class, Some("ext"), "{name}");
        }
    }
}
