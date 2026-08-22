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
//! The rule is string parsing and this crate has **zero dependencies** on
//! purpose, so that depending on it commits a consumer to nothing else.

#![forbid(unsafe_code)]

/// The prefix every mos bus name carries.
pub const PREFIX: &str = "com.mos.";

/// The prefix an extension bus name carries — `ext` **with its trailing
/// dot**, because `ext` is a namespace only when it is a whole dotted
/// component. `com.mos.extra.thing` merely starts with the same characters
/// and is an ordinary system name whose class is `extra`.
pub const EXTENSION_PREFIX: &str = "com.mos.ext.";

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

/// Parse `bus_name` under both grammars, or `None` when it is not a mos name.
///
/// `None` covers three things, and they are all "not ours" rather than
/// errors: a name outside `com.mos.` entirely, a name with nothing after
/// `com.mos.`, and a name with an empty dotted component (`com.mos.sensor.`)
/// — a D-Bus bus name has no empty components, so that is malformed rather
/// than a `sensor` carrying an empty suffix, and a caller should not have to
/// tell those two apart for itself.
///
/// # `com.mos.ext` is deliberately **not** an extension
///
/// The bare prefix has no fourth component, so there is no extension class to
/// publish under; calling it an extension would mean publishing with an empty
/// class. It parses as a **system** name of class `ext` instead, which is the
/// conservative reading: it keeps the name in the system half of the
/// namespace, where the policy's default `<deny own="*"/>` governs it, rather
/// than letting a name nobody granted slip into the half extensions may own.
/// Whether the D-Bus `own_prefix="com.mos.ext"` grant happens to match this
/// bare name is a separate measurement and does not change the
/// classification.
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
/// ```
pub fn parse(bus_name: &str) -> Option<BusName<'_>> {
    if let Some(rest) = bus_name.strip_prefix(EXTENSION_PREFIX) {
        return split(Origin::Extension, rest);
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
    /// is an ordinary system class.
    #[test]
    fn ext_is_a_namespace_only_as_a_whole_component() {
        assert_eq!(parse("com.mos.extra.thing"), system("extra", Some("thing")));
        assert_eq!(parse("com.mos.extension"), system("extension", None));
    }

    /// The bare prefix has no fourth component, so there is no extension
    /// class to publish under. It stays in the system half, where the
    /// policy's default `<deny own="*"/>` governs it.
    #[test]
    fn the_bare_extension_prefix_is_a_system_name_of_class_ext() {
        assert_eq!(parse("com.mos.ext"), system("ext", None));
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
