//! `mos-busname` — the one rule that turns a `com.mos.*` bus name into the
//! `<class>` the rest of the system keys off (`docs/design/bus.md` §5,
//! PLAN-011 D5).
//!
//! Two grammars share one namespace:
//!
//! | Grammar | Origin | Example | Class |
//! |---|---|---|---|
//! | `com.mos.<class>[.<suffix>]` | system | `com.mos.sensor.abc123` | `sensor` |
//! | `com.mos.ext.<class>[.<suffix>]` | extension | `com.mos.ext.sensor.abc123` | `sensor` |
//!
//! So the class is the **third** dotted component of a system name and the
//! **fourth** of an extension name. A reader that takes the third component
//! unconditionally publishes `com.mos.ext.sensor.abc123` under the class
//! `ext`, which is the defect PLAN-011 M5 names; the MQTT bridge and mosd's
//! service registry both have to make that distinction, and two copies of it
//! would be two rules that can drift. Hence one crate, depended on rather
//! than restated.
//!
//! The bare namespace `com.mos.ext` matches neither grammar and is `None`:
//! it carries no class, and the D-Bus grant lets an unprivileged uid own it,
//! so classifying it as system-origin would be origin spoofing. [`parse`] has
//! the measurement.
//!
//! The rule is string parsing and this crate has **zero dependencies** on
//! purpose, so that depending on it commits a consumer to nothing else.

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
/// refuses `com.mos.extra` — measured, `docs/task/RFCT-093.md` §"Investigation
/// — `own_prefix` semantics (measured 2026-08-22)". Policy and parser agree on
/// one rule, which is the point.
pub const EXTENSION_PREFIX: &str = "com.mos.ext.";

/// The extension namespace itself, without a service under it.
///
/// Not a bus name this crate can classify — see [`parse`] — but named here
/// because a consumer that must recognise it (mosd's service registry, which
/// records it as a conformance gap) should match this rather than a literal
/// of its own.
pub const EXTENSION_NAMESPACE: &str = "com.mos.ext";

/// Which half of the `com.mos.*` namespace a name comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Origin {
    /// `com.mos.<class>[.<suffix>]` — a service that is part of the system
    /// image, governed by the D-Bus policy's default `<deny own="*"/>`.
    System,
    /// `com.mos.ext.<class>[.<suffix>]` — an extension service, which owns
    /// its name under the `com.mos.ext` grant (PLAN-011 D5).
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
    pub class: &'a str,
    /// Everything after the class, dots included and the separating dot
    /// dropped: `a.b` for `com.mos.ext.sensor.a.b`. `None` when the name
    /// ends at the class, which is one service of that class rather than one
    /// instance among several (`com.mos.mosd`).
    pub suffix: Option<&'a str>,
}

/// Parse `bus_name` under both grammars, or `None` when this grammar yields
/// no class for it.
///
/// `None` covers four things, and they are all "no class to publish under"
/// rather than errors: a name outside `com.mos.` entirely, a name with
/// nothing after `com.mos.`, a name with an empty dotted component
/// (`com.mos.sensor.`) — a D-Bus bus name has no empty components, so that is
/// malformed rather than a `sensor` carrying an empty suffix — and the bare
/// [`EXTENSION_NAMESPACE`], below.
///
/// # `com.mos.ext` is **neither** system nor extension
///
/// The bare namespace has no component after it, so there is no class to
/// classify it by. A parser whose whole job is to yield a class has nothing
/// to yield, and `None` says exactly that. Both alternatives are worse:
///
/// - **Not `Origin::System`.** An unprivileged uid can own this name:
///   `own_prefix="com.mos.ext"` matches the bare prefix itself, so the
///   extension grant governs it and the default `<deny own="*"/>` does not.
///   That is measured, not reasoned — `docs/task/RFCT-093.md` §"Investigation
///   — `own_prefix` semantics (measured 2026-08-22)" against dbus-daemon
///   1.12.20, asserted by `mosd/hack/dbus-policy-test.sh` section 4. Calling
///   it system-origin would let any unprivileged third party present itself
///   to operators, to the dashboard and to the MQTT bridge **as the system**.
/// - **Not `Origin::Extension`** with an empty or invented class either:
///   there is no fourth component, and manufacturing one would put a service
///   on the bridge under a class nobody chose.
///
/// `None` here means "a `com.mos.` name this grammar cannot classify", which
/// is a different fact from "not a mos name at all" (`com.example.foo`). This
/// parser signals both the same way, deliberately: telling them apart is
/// mosd's service registry's job, because only the registry has somewhere to
/// put the answer — the first is a conformance gap to record against a
/// service that is on the bus, the second is simply not addressed to us.
///
/// ```
/// use mos_busname::{Origin, parse};
///
/// let system = parse("com.mos.sensor.abc123").expect("a mos name");
/// assert_eq!((system.origin, system.class, system.suffix), (Origin::System, "sensor", Some("abc123")));
///
/// let extension = parse("com.mos.ext.sensor.abc123").expect("a mos name");
/// assert_eq!((extension.origin, extension.class, extension.suffix), (Origin::Extension, "sensor", Some("abc123")));
///
/// assert_eq!(parse("com.example.foo"), None);
/// assert_eq!(parse("com.mos.ext"), None);
/// ```
pub fn parse(bus_name: &str) -> Option<BusName<'_>> {
    if let Some(rest) = bus_name.strip_prefix(EXTENSION_PREFIX) {
        return split(Origin::Extension, rest);
    }
    if bus_name == EXTENSION_NAMESPACE {
        return None;
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
        class,
        suffix,
    })
}

#[cfg(test)]
mod tests {
    use super::{BusName, Origin, parse};

    fn system<'a>(class: &'a str, suffix: Option<&'a str>) -> Option<BusName<'a>> {
        Some(BusName {
            origin: Origin::System,
            class,
            suffix,
        })
    }

    fn extension<'a>(class: &'a str, suffix: Option<&'a str>) -> Option<BusName<'a>> {
        Some(BusName {
            origin: Origin::Extension,
            class,
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
    /// measured in `docs/task/RFCT-093.md` — so these rows are where the
    /// parser and the policy are asserted to agree.
    #[test]
    fn ext_is_a_namespace_only_as_a_whole_component() {
        assert_eq!(parse("com.mos.extra"), system("extra", None));
        assert_eq!(parse("com.mos.extra.thing"), system("extra", Some("thing")));
        assert_eq!(parse("com.mos.extension"), system("extension", None));
    }

    /// The bare namespace carries no class, so this grammar cannot classify
    /// it, and neither answer it could invent is safe.
    ///
    /// Not system: `own_prefix="com.mos.ext"` matches the bare prefix itself,
    /// so an unprivileged uid (65534) can own this name — measured against
    /// dbus-daemon 1.12.20 in `docs/task/RFCT-093.md` §"Investigation —
    /// `own_prefix` semantics (measured 2026-08-22)" and asserted by
    /// `mosd/hack/dbus-policy-test.sh` section 4. Classifying it as system
    /// would publish a third party to operators as the system itself. Not an
    /// extension either: there is no fourth component to take a class from.
    #[test]
    fn the_bare_extension_namespace_has_no_class_and_so_is_none() {
        assert_eq!(parse("com.mos.ext"), None);
        assert_eq!(parse(super::EXTENSION_NAMESPACE), None);
    }

    #[test]
    fn what_is_not_a_mos_name_is_none() {
        assert_eq!(parse("com.mos."), None);
        assert_eq!(parse("com.mos"), None);
        assert_eq!(parse("com.example.foo"), None);
        assert_eq!(parse(""), None);
    }

    /// A bus name has no empty components, so these are malformed rather than
    /// a class with an empty suffix.
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
            assert_ne!(parsed.class, "ext", "{name}");
        }
    }
}
