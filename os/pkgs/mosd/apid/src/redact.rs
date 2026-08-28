//! The structural redactor every value leaving §2.2's two read-only roots
//! passes through.
//!
//! `docs/design/api.md` §2.2 states the rule for the settings root, where
//! `GetSettings("access")` would otherwise hand the admin password hash to any
//! authenticated caller. It is applied to the live-state root as well: mosd's
//! state tree is untyped and written by reconcilers, so nothing stops the same
//! field names appearing there, and a denylist that covers one root while the
//! other serves them verbatim is a hole with a tested-looking lid.
//!
//! The list is fail-open: a secret-bearing field under a name it does not
//! carry is served. §2.2 says the mitigation is a test rather than a hope, and
//! `every_redacted_field_name_comes_back_redacted_from_the_settings_root` is
//! that test.

use serde_json::Value;

/// What a redacted field carries in place of its value.
pub const REDACTED: &str = "<redacted>";

/// The field names whose values never leave the device (§2.2).
///
/// Names and not dot-paths, because the two `psk` fields sit inside arrays and
/// the dot-path syntax cannot name an array element.
///
/// `privateKey` is on the list for a value nothing in this tree serves. A
/// WireGuard private key is not in the settings schema and is not in live
/// state — `docs/task/RFCT-200.md` §4 puts it in a mode-0640 file on STATE and
/// states *"there is no read-back route for the private key, ever"* — so today
/// this entry redacts nothing. It is the fail-closed half of that rule: the day
/// a field of that name appears anywhere in either tree, it is already covered,
/// rather than being served in the clear until somebody remembers this file.
const SECRET_FIELDS: [&str; 5] = ["psk", "passwordHash", "password_hash", "hash", "privateKey"];

/// Whether a field named `name` is redacted.
fn is_secret(name: &str) -> bool {
    SECRET_FIELDS.contains(&name)
}

/// `value`, read from dot-path `path`, with every secret it carries replaced.
///
/// `path` is read as well as the value, because a dot-path can name a secret
/// field directly: `GET /api/v1/settings/access.webAdmin.password_hash`
/// answers the hash as a bare JSON string, and a bare string has no field name
/// left in it for the structural walk below to key on.
pub fn redact(value: Value, path: &str) -> Value {
    let leaf = path.rsplit('.').next().unwrap_or_default();
    if is_secret(leaf) {
        return Value::String(REDACTED.to_string());
    }
    walk(value)
}

/// `value` with the value of every secret-bearing field replaced by
/// [`REDACTED`], at any depth and inside arrays.
fn walk(value: Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(name, child)| {
                    let child = if is_secret(&name) {
                        Value::String(REDACTED.to_string())
                    } else {
                        walk(child)
                    };
                    (name, child)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(walk).collect()),
        other => other,
    }
}
