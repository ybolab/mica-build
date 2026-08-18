//! Integration tests for the mosd-settings public API.

use std::fs;

use serde_json::json;

use mosd_settings::{
    DEFAULT_PATH, IfaceSettings, MigrateV0ToV1, Migration, MigrationRegistry, SCHEMA_VERSION,
    Settings, SettingsError, StaticConfig, Store, WebAdminSettings, json_path_get, migrate,
};

fn populated() -> Settings {
    let mut settings = Settings::default();
    settings.network.insert(
        "eth0".to_string(),
        IfaceSettings {
            dhcp: false,
            static_: Some(StaticConfig {
                address: "192.168.1.10/24".to_string(),
                gateway: Some("192.168.1.1".to_string()),
                dns: vec!["1.1.1.1".to_string(), "9.9.9.9".to_string()],
            }),
        },
    );
    settings.network.insert(
        "wlan0".to_string(),
        IfaceSettings {
            dhcp: true,
            static_: None,
        },
    );
    settings
}

// --- Store -----------------------------------------------------------------

#[test]
fn save_load_roundtrip_with_network() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("settings.toml"));
    let settings = populated();
    store.save(&settings).unwrap();

    let text = fs::read_to_string(dir.path().join("settings.toml")).unwrap();
    let doc: toml::Table = text.parse().unwrap();
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(2)));

    assert_eq!(store.load().unwrap(), settings);
}

#[test]
fn save_is_atomic_and_leaves_no_temp_files() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("settings.toml"));
    store.save(&Settings::default()).unwrap();

    let updated = Settings {
        hostname: "renamed".to_string(),
        ..Settings::default()
    };
    store.save(&updated).unwrap();

    let entries: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries, vec![std::ffi::OsString::from("settings.toml")]);
    assert_eq!(store.load().unwrap(), updated);
}

#[test]
fn load_missing_file_returns_defaults_without_creating_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.toml");
    let store = Store::new(&path);
    assert_eq!(store.load().unwrap(), Settings::default());
    assert!(!path.exists());
}

#[test]
fn default_path_is_the_state_location() {
    assert_eq!(DEFAULT_PATH, "/var/lib/mos/settings.toml");
    let _store = Store::default_path();
}

// --- Dot-path get ----------------------------------------------------------

#[test]
fn get_whole_tree_scalar_and_nested() {
    let settings = populated();
    let whole = settings.get("").unwrap();
    assert_eq!(whole, settings.get(".").unwrap());
    assert_eq!(whole["hostname"], json!("mos"));

    assert_eq!(settings.get("hostname").unwrap(), json!("mos"));
    assert_eq!(
        settings.get("network.eth0.static.address").unwrap(),
        json!("192.168.1.10/24")
    );
    assert_eq!(settings.get("network.wlan0.dhcp").unwrap(), json!(true));
}

#[test]
fn get_unknown_path_is_not_found() {
    let settings = Settings::default();
    assert!(matches!(
        settings.get("network.eth9.dhcp"),
        Err(SettingsError::NotFound(_))
    ));
    assert!(matches!(
        settings.get("hostname..x"),
        Err(SettingsError::NotFound(_))
    ));
}

// --- Dot-path set ----------------------------------------------------------

#[test]
fn set_scalar_and_create_intermediate_entries() {
    let mut settings = Settings::default();
    settings.set("hostname", json!("edge-1")).unwrap();
    assert_eq!(settings.hostname, "edge-1");

    settings.set("network.eth0.dhcp", json!(true)).unwrap();
    assert_eq!(
        settings.network["eth0"],
        IfaceSettings {
            dhcp: true,
            static_: None
        }
    );

    settings.set("network.eth0.dhcp", json!(false)).unwrap();
    settings
        .set("network.eth0.static.address", json!("10.0.0.2/24"))
        .unwrap();
    settings
        .set("network.eth0.static.gateway", json!("10.0.0.1"))
        .unwrap();
    settings
        .set("network.eth0.static.dns", json!(["10.0.0.1"]))
        .unwrap();
    assert_eq!(
        settings.network["eth0"].static_,
        Some(StaticConfig {
            address: "10.0.0.2/24".to_string(),
            gateway: Some("10.0.0.1".to_string()),
            dns: vec!["10.0.0.1".to_string()],
        })
    );
}

#[test]
fn set_and_get_web_admin_roundtrip() {
    let mut settings = Settings::default();
    assert!(matches!(
        settings.get("access.webAdmin"),
        Err(SettingsError::NotFound(_))
    ));

    settings
        .set("access.webAdmin", json!({"password_hash": "x"}))
        .unwrap();
    assert_eq!(
        settings.access.web_admin,
        Some(WebAdminSettings {
            password_hash: "x".to_string()
        })
    );
    assert_eq!(
        settings.get("access.webAdmin.password_hash").unwrap(),
        json!("x")
    );
}

#[test]
fn set_whole_tree_replaces_settings() {
    let mut settings = Settings::default();
    let replacement = populated();
    settings
        .set(".", serde_json::to_value(&replacement).unwrap())
        .unwrap();
    assert_eq!(settings, replacement);
}

#[test]
fn set_errors_leave_state_unchanged() {
    let mut settings = populated();
    let before = settings.clone();

    assert!(matches!(
        settings.set("schema_version", json!(3)),
        Err(SettingsError::ReadOnly(_))
    ));
    assert!(matches!(
        settings.set("bogus.path", json!(1)),
        Err(SettingsError::Validation { .. })
    ));
    assert!(matches!(
        settings.set("hostname.sub", json!("x")),
        Err(SettingsError::Validation { .. })
    ));
    assert!(matches!(
        settings.set("network.eth0.dhcp", json!("yes")),
        Err(SettingsError::Validation { .. })
    ));
    assert!(matches!(
        settings.set("hostname", json!(5)),
        Err(SettingsError::Validation { .. })
    ));

    let mut wrong_version = serde_json::to_value(&before).unwrap();
    wrong_version["schema_version"] = json!(1);
    assert!(matches!(
        settings.set("", wrong_version),
        Err(SettingsError::ReadOnly(_))
    ));

    assert_eq!(settings, before);
}

// --- Migrations ------------------------------------------------------------

#[test]
fn v0_document_migrates_up_and_back_down() {
    let mut doc: toml::Table = "hostname = \"legacy\"".parse().unwrap();
    let original = doc.clone();

    migrate(&mut doc, 0, 1).unwrap();
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(1)));
    assert_eq!(
        doc.get("hostname"),
        Some(&toml::Value::String("legacy".to_string()))
    );
    assert!(doc.contains_key("network"));

    migrate(&mut doc, 1, 0).unwrap();
    assert_eq!(doc, original);
}

#[test]
fn v1_document_migrates_up_to_v2() {
    let mut doc: toml::Table = "schema_version = 1\nhostname = \"legacy\"\n\n[network]\n"
        .parse()
        .unwrap();

    migrate(&mut doc, 1, 2).unwrap();
    let text = toml::to_string(&doc).unwrap();
    let settings: Settings = toml::from_str(&text).unwrap();
    assert_eq!(settings.schema_version, SCHEMA_VERSION);
    assert_eq!(settings.hostname, "legacy");
    assert!(settings.network.is_empty());
    assert!(settings.access.web_admin.is_none());
    assert_eq!(
        doc.get("access"),
        Some(&toml::Value::Table(toml::Table::new()))
    );
}

#[test]
fn v2_document_migrates_down_to_v1_dropping_access() {
    let mut doc: toml::Table = concat!(
        "schema_version = 2\n",
        "hostname = \"mos\"\n\n",
        "[network]\n\n",
        "[access.webAdmin]\n",
        "password_hash = \"$argon2id$v=19$m=19456,t=2,p=1$abc$def\"\n",
    )
    .parse()
    .unwrap();

    migrate(&mut doc, 2, 1).unwrap();
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(1)));
    assert!(!doc.contains_key("access"));
}

#[test]
fn store_load_migrates_v1_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.toml");
    fs::write(
        &path,
        "schema_version = 1\nhostname = \"legacy\"\n\n[network]\n",
    )
    .unwrap();

    let settings = Store::new(&path).load().unwrap();
    assert_eq!(settings.schema_version, SCHEMA_VERSION);
    assert_eq!(settings.hostname, "legacy");
    assert!(settings.access.web_admin.is_none());
}

#[test]
fn store_load_migrates_v0_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.toml");
    fs::write(&path, "hostname = \"legacy\"\n").unwrap();

    let settings = Store::new(&path).load().unwrap();
    assert_eq!(settings.schema_version, SCHEMA_VERSION);
    assert_eq!(settings.hostname, "legacy");
    assert!(settings.network.is_empty());
}

#[test]
fn migrate_errors_on_missing_step() {
    let mut doc = toml::Table::new();
    assert!(matches!(
        migrate(&mut doc, 0, 3),
        Err(SettingsError::Migration(_))
    ));
}

#[test]
fn custom_registry_applies_migrations() {
    let registry = MigrationRegistry::new(vec![Box::new(MigrateV0ToV1)]);
    let mut doc: toml::Table = "hostname = \"legacy\"".parse().unwrap();
    registry.migrate(&mut doc, 0, 1).unwrap();
    assert_eq!(MigrateV0ToV1.target_version(), 1);
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(1)));
    assert!(doc.contains_key("network"));
}

// --- json_path_get ---------------------------------------------------------

#[test]
fn json_path_get_navigates_a_live_state_tree() {
    let tree = json!({
        "hostname": {"current": "mos"},
        "network": {"eth0": {"operstate": "up", "addresses": ["10.0.0.2/24"]}},
    });
    assert_eq!(json_path_get(&tree, ""), Some(&tree));
    assert_eq!(json_path_get(&tree, "."), Some(&tree));
    assert_eq!(
        json_path_get(&tree, "network.eth0.operstate"),
        Some(&json!("up"))
    );
    assert_eq!(json_path_get(&tree, "network.eth1"), None);
    assert_eq!(json_path_get(&tree, "hostname.current.deeper"), None);
    assert_eq!(json_path_get(&tree, "network..eth0"), None);
}
