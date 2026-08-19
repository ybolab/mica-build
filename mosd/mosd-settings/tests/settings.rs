//! Integration tests for the mosd-settings public API.

use std::fs;

use serde_json::json;

use mosd_settings::{
    AccessSettings, ApMode, ConsoleSettings, DEFAULT_PATH, DeviceCredentialSettings, IfaceSettings,
    MigrateV0ToV1, Migration, MigrationRegistry, ProvisioningSettings, ProvisioningState,
    SCHEMA_VERSION, Settings, SettingsError, SshSettings, StaticConfig, Store, WebAdminSettings,
    WifiApSettings, WifiClientSettings, WifiNetwork, WifiSettings, json_path_get, migrate,
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
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(3)));

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
    // This step stops at v2; only `Store::load` walks all the way to v3.
    assert_eq!(settings.schema_version, 2);
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
        migrate(&mut doc, 0, 4),
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

// --- Schema v3: access / provisioning / wifi --------------------------------

/// A realistic v2 document: non-default hostname, a static-addressed
/// interface, and a webd-written admin hash.
const V2_DOCUMENT: &str = concat!(
    "schema_version = 2\n",
    "hostname = \"edge-42\"\n\n",
    "[network.eth0]\n",
    "dhcp = false\n\n",
    "[network.eth0.static]\n",
    "address = \"10.0.0.7/24\"\n",
    "gateway = \"10.0.0.1\"\n",
    "dns = [\"10.0.0.1\", \"1.1.1.1\"]\n\n",
    "[access.webAdmin]\n",
    "password_hash = \"$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2g\"\n",
);

const V2_PASSWORD_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2g";

/// A v3 tree carrying a value in every subtree, used by the round-trip tests.
fn v3_populated() -> Settings {
    Settings {
        schema_version: SCHEMA_VERSION,
        hostname: "edge-42".to_string(),
        network: [(
            "eth0".to_string(),
            IfaceSettings {
                dhcp: false,
                static_: Some(StaticConfig {
                    address: "10.0.0.7/24".to_string(),
                    gateway: Some("10.0.0.1".to_string()),
                    dns: vec!["10.0.0.1".to_string(), "1.1.1.1".to_string()],
                }),
            },
        )]
        .into_iter()
        .collect(),
        access: AccessSettings {
            web_admin: Some(WebAdminSettings {
                password_hash: V2_PASSWORD_HASH.to_string(),
            }),
            ssh: SshSettings {
                enabled: true,
                port: 2222,
                permit_root_login: false,
                password_authentication: false,
                listen_addresses: vec!["10.0.0.7".to_string()],
            },
            console: ConsoleSettings {
                shell_enabled: true,
            },
            device: DeviceCredentialSettings {
                password_hash: Some("$argon2id$v=19$m=19456,t=2,p=1$ZGV2$ZGV2aGFzaA".to_string()),
                generation: 4,
            },
        },
        provisioning: ProvisioningSettings {
            state: ProvisioningState::Complete,
            device_id: Some("a1b2c3d4e5f6".to_string()),
            seeded_generation: 7,
        },
        wifi: WifiSettings {
            client: WifiClientSettings {
                enabled: true,
                interface: "wlan1".to_string(),
                networks: vec![WifiNetwork {
                    ssid: "site-ap".to_string(),
                    psk: Some("hunter2hunter2".to_string()),
                    hidden: true,
                    priority: 10,
                }],
            },
            ap: WifiApSettings {
                mode: ApMode::Always,
                interface: "wlan1".to_string(),
                ssid: Some("appliance-a1b2".to_string()),
                psk: Some("provisioning-pin".to_string()),
                channel: 11,
                country_code: "CN".to_string(),
                address: "10.42.0.1/24".to_string(),
                hold_down_seconds: 30,
                grace_seconds: 15,
            },
        },
    }
}

/// R3.1: a real v2 document keeps every v2 value across the upgrade and gains
/// the v3 subtrees at their documented defaults.
#[test]
fn real_v2_document_survives_the_upgrade_to_v3() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.toml");
    fs::write(&path, V2_DOCUMENT).unwrap();

    let settings = Store::new(&path).load().unwrap();

    // Everything v2 could express is byte-identical to what went in.
    assert_eq!(settings.schema_version, 3);
    assert_eq!(SCHEMA_VERSION, 3);
    assert_eq!(settings.hostname, "edge-42");
    assert_eq!(
        settings.network["eth0"],
        IfaceSettings {
            dhcp: false,
            static_: Some(StaticConfig {
                address: "10.0.0.7/24".to_string(),
                gateway: Some("10.0.0.1".to_string()),
                dns: vec!["10.0.0.1".to_string(), "1.1.1.1".to_string()],
            }),
        }
    );
    assert_eq!(settings.network.len(), 1);
    assert_eq!(
        settings.access.web_admin,
        Some(WebAdminSettings {
            password_hash: V2_PASSWORD_HASH.to_string(),
        })
    );

    // The v3 subtrees arrive at their documented defaults.
    assert_eq!(settings.access.ssh, SshSettings::default());
    assert!(!settings.access.ssh.enabled);
    assert_eq!(settings.access.ssh.port, 22);
    assert!(settings.access.ssh.permit_root_login);
    assert!(settings.access.ssh.password_authentication);
    assert!(settings.access.ssh.listen_addresses.is_empty());
    assert!(!settings.access.console.shell_enabled);
    assert_eq!(settings.access.device.password_hash, None);
    assert_eq!(settings.access.device.generation, 0);
    assert_eq!(settings.provisioning.state, ProvisioningState::Pending);
    assert_eq!(settings.provisioning.device_id, None);
    assert_eq!(settings.provisioning.seeded_generation, 0);
    assert!(!settings.wifi.client.enabled);
    assert_eq!(settings.wifi.client.interface, "wlan0");
    assert!(settings.wifi.client.networks.is_empty());
    assert_eq!(settings.wifi.ap.mode, ApMode::Off);
    assert_eq!(settings.wifi.ap.interface, "wlan0");
    assert_eq!(settings.wifi.ap.ssid, None);
    assert_eq!(settings.wifi.ap.psk, None);
    assert_eq!(settings.wifi.ap.channel, 6);
    assert_eq!(settings.wifi.ap.country_code, "US");
    assert_eq!(settings.wifi.ap.address, "192.168.4.1/24");
    assert_eq!(settings.wifi.ap.hold_down_seconds, 120);
    assert_eq!(settings.wifi.ap.grace_seconds, 60);
}

/// R3.2: v3 -> v2 -> v3 keeps every v2-representable value and resets the
/// v3-only ones to their defaults.
#[test]
fn v3_document_round_trips_down_to_v2_and_back() {
    let original = v3_populated();
    let mut doc: toml::Table = toml::to_string(&original).unwrap().parse().unwrap();

    migrate(&mut doc, 3, 2).unwrap();
    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(2)));
    migrate(&mut doc, 2, 3).unwrap();

    let text = toml::to_string(&doc).unwrap();
    let restored: Settings = toml::from_str(&text).unwrap();

    // v2-representable values are unchanged.
    assert_eq!(restored.schema_version, original.schema_version);
    assert_eq!(restored.hostname, original.hostname);
    assert_eq!(restored.network, original.network);
    assert_eq!(restored.access.web_admin, original.access.web_admin);

    // v3-only values are back at their defaults, not at the pre-rollback ones.
    assert_eq!(restored.access.ssh, SshSettings::default());
    assert_eq!(restored.access.console, ConsoleSettings::default());
    assert_eq!(restored.access.device, DeviceCredentialSettings::default());
    assert_eq!(restored.provisioning, ProvisioningSettings::default());
    assert_eq!(restored.wifi, WifiSettings::default());
    assert_ne!(restored, original);
}

/// R3.3: rolling back to v2 removes exactly the v3-only keys and keeps
/// `access.webAdmin`.
#[test]
fn v3_document_migrates_down_to_v2_dropping_only_v3_keys() {
    let mut doc: toml::Table = toml::to_string(&v3_populated()).unwrap().parse().unwrap();
    assert!(doc.contains_key("provisioning"));
    assert!(doc.contains_key("wifi"));

    migrate(&mut doc, 3, 2).unwrap();

    assert_eq!(doc.get("schema_version"), Some(&toml::Value::Integer(2)));
    assert!(!doc.contains_key("provisioning"));
    assert!(!doc.contains_key("wifi"));

    let access = doc["access"].as_table().unwrap();
    assert!(!access.contains_key("ssh"));
    assert!(!access.contains_key("console"));
    assert!(!access.contains_key("device"));
    assert_eq!(
        access["webAdmin"]["password_hash"].as_str(),
        Some(V2_PASSWORD_HASH)
    );
    assert_eq!(
        doc.get("hostname"),
        Some(&toml::Value::String("edge-42".to_string()))
    );

    // The result is a document v2 software can actually deserialize: no
    // v3-only key is left behind for `deny_unknown_fields` to trip over.
    let text = toml::to_string(&doc).unwrap();
    assert!(!text.contains("provisioning"));
    assert!(!text.contains("wifi"));
    assert!(!text.contains("shellEnabled"));
}

/// R3.4: `deny_unknown_fields` still rejects a typo inside a new subtree.
#[test]
fn v3_document_with_unknown_key_fails_to_load() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.toml");
    fs::write(
        &path,
        concat!(
            "schema_version = 3\n",
            "hostname = \"edge-42\"\n\n",
            "[network]\n\n",
            "[access.ssh]\n",
            "enabld = true\n",
        ),
    )
    .unwrap();

    let err = Store::new(&path).load().unwrap_err();
    let SettingsError::Parse(message) = &err else {
        panic!("expected a parse error, got {err:?}");
    };
    assert!(
        message.contains("unknown field `enabld`"),
        "error should name the offending key, got: {message}"
    );

    // The same document without the typo loads.
    fs::write(
        &path,
        concat!(
            "schema_version = 3\n",
            "hostname = \"edge-42\"\n\n",
            "[network]\n\n",
            "[access.ssh]\n",
            "enabled = true\n",
        ),
    )
    .unwrap();
    assert!(Store::new(&path).load().unwrap().access.ssh.enabled);
}

/// R3.5: every new leaf is reachable through the dot-path API.
#[test]
fn dot_path_reaches_every_new_leaf() {
    let mut settings = Settings::default();

    let writes: Vec<(&str, serde_json::Value)> = vec![
        ("access.ssh.enabled", json!(true)),
        ("access.ssh.port", json!(2222)),
        ("access.ssh.permitRootLogin", json!(false)),
        ("access.ssh.passwordAuthentication", json!(false)),
        (
            "access.ssh.listenAddresses",
            json!(["10.0.0.7", "127.0.0.1"]),
        ),
        ("access.console.shellEnabled", json!(true)),
        ("access.device.passwordHash", json!("$argon2id$v=19$x$y$z")),
        ("access.device.generation", json!(4)),
        ("provisioning.state", json!("complete")),
        ("provisioning.deviceId", json!("a1b2c3d4e5f6")),
        ("provisioning.seededGeneration", json!(7)),
        ("wifi.client.enabled", json!(true)),
        ("wifi.client.interface", json!("wlan1")),
        (
            "wifi.client.networks",
            json!([
                {"ssid": "site-ap", "psk": "hunter2hunter2", "hidden": true, "priority": 10},
                {"ssid": "open-ap", "hidden": false, "priority": 0}
            ]),
        ),
        ("wifi.ap.mode", json!("provisioning")),
        ("wifi.ap.interface", json!("wlan1")),
        ("wifi.ap.ssid", json!("appliance-a1b2")),
        ("wifi.ap.psk", json!("provisioning-pin")),
        ("wifi.ap.channel", json!(11)),
        ("wifi.ap.countryCode", json!("CN")),
        ("wifi.ap.address", json!("10.42.0.1/24")),
        ("wifi.ap.holdDownSeconds", json!(30)),
        ("wifi.ap.graceSeconds", json!(15)),
    ];

    // Each write is read back verbatim. `psk` is left out of the second network
    // on purpose: an absent key is how an open network is spelled, and it stays
    // absent on the way out.
    for (path, value) in &writes {
        settings.set(path, value.clone()).unwrap();
        assert_eq!(
            &settings.get(path).unwrap(),
            value,
            "round trip at `{path}`"
        );
    }

    // The writes landed on the typed tree, not just on the JSON projection.
    assert_eq!(settings.access.ssh.port, 2222);
    assert!(settings.access.console.shell_enabled);
    assert_eq!(settings.access.device.generation, 4);
    assert_eq!(settings.provisioning.state, ProvisioningState::Complete);
    assert_eq!(settings.wifi.ap.mode, ApMode::Provisioning);
    assert_eq!(
        settings.wifi.client.networks,
        vec![
            WifiNetwork {
                ssid: "site-ap".to_string(),
                psk: Some("hunter2hunter2".to_string()),
                hidden: true,
                priority: 10,
            },
            WifiNetwork {
                ssid: "open-ap".to_string(),
                psk: None,
                hidden: false,
                priority: 0,
            },
        ]
    );
}

/// R3.5 rejection case: an out-of-domain enum value is refused and leaves the
/// tree untouched.
#[test]
fn set_rejects_unknown_ap_mode_and_leaves_settings_unchanged() {
    let mut settings = Settings::default();
    settings.set("wifi.ap.mode", json!("always")).unwrap();
    let before = settings.clone();

    let err = settings.set("wifi.ap.mode", json!("captive")).unwrap_err();
    assert!(
        matches!(&err, SettingsError::Validation { path, .. } if path == "wifi.ap.mode"),
        "expected a validation error at `wifi.ap.mode`, got {err:?}"
    );
    assert_eq!(settings, before);
    assert_eq!(settings.wifi.ap.mode, ApMode::Always);

    // Same for the other new enum, and for a mistyped scalar.
    assert!(matches!(
        settings.set("provisioning.state", json!("half")),
        Err(SettingsError::Validation { .. })
    ));
    assert!(matches!(
        settings.set("access.ssh.port", json!("22")),
        Err(SettingsError::Validation { .. })
    ));
    assert!(matches!(
        settings.set("wifi.client.networks", json!([{"psk": "x"}])),
        Err(SettingsError::Validation { .. })
    ));
    assert_eq!(settings, before);
}

/// R3.6: the three-step registry still walks a v0 and a v1 document all the
/// way to a valid v3 tree.
#[test]
fn v0_and_v1_documents_walk_all_the_way_to_v3() {
    let dir = tempfile::tempdir().unwrap();

    let v0 = dir.path().join("v0.toml");
    fs::write(&v0, "hostname = \"legacy\"\n").unwrap();
    let from_v0 = Store::new(&v0).load().unwrap();

    let v1 = dir.path().join("v1.toml");
    fs::write(
        &v1,
        "schema_version = 1\nhostname = \"legacy\"\n\n[network]\n",
    )
    .unwrap();
    let from_v1 = Store::new(&v1).load().unwrap();

    for settings in [&from_v0, &from_v1] {
        assert_eq!(settings.schema_version, 3);
        assert_eq!(settings.hostname, "legacy");
        assert!(settings.network.is_empty());
        assert_eq!(settings.access, AccessSettings::default());
        assert_eq!(settings.provisioning, ProvisioningSettings::default());
        assert_eq!(settings.wifi, WifiSettings::default());
    }
    assert_eq!(from_v0, from_v1);

    // And the walked tree is a tree the store can write back and re-read.
    let out = dir.path().join("out.toml");
    let store = Store::new(&out);
    store.save(&from_v0).unwrap();
    assert_eq!(store.load().unwrap(), from_v0);
}
