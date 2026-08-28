//! Route-level tests driving the router directly with the fake settings
//! backend; no network or bus daemon involved.
//!
//! The exceptions are [`power_bus`] and [`settings_signal`], which drive the
//! real D-Bus client against a fake mosd on a private bus, because what they
//! assert lives below the fake backend's trait.

mod broken_classes;
mod power_bus;
mod settings_signal;

use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ACCEPT, ALLOW, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, COOKIE, LOCATION, RETRY_AFTER,
    SET_COOKIE,
};
use axum::http::{HeaderName, Request, Response, StatusCode};
use serde_json::json;
use tempfile::TempDir;
use tower::ServiceExt;

use crate::assets::serve;
use crate::auth;
use crate::bundle::Store;
use crate::routes::{AppState, app};
use crate::settings_api::{FakeSettings, SettingsApi};

const SIGNING_KEY: [u8; 32] = [7u8; 32];

fn test_app(tree: serde_json::Value) -> (Router, Arc<FakeSettings>) {
    let fake = Arc::new(FakeSettings::new(tree));
    let state = AppState::new(fake.clone(), SIGNING_KEY);
    (app(state), fake)
}

fn unconfigured_tree() -> serde_json::Value {
    json!({ "hostname": "mos", "network": {}, "access": {} })
}

fn configured_tree(password: &str) -> serde_json::Value {
    let hash = auth::hash_password(password).unwrap();
    json!({
        "hostname": "mos",
        "network": {},
        "access": { "webAdmin": { "password_hash": hash } },
    })
}

/// Log in against a configured tree and return the session cookie value.
async fn login(router: &Router, password: &str) -> String {
    let response = post_form(router, "/login", &format!("password={password}"), None).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    session_cookie_value(&response)
}

async fn body_string(response: Response<axum::body::Body>) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

async fn send(router: &Router, request: Request<Body>) -> Response<axum::body::Body> {
    router.clone().oneshot(request).await.unwrap()
}

async fn get(router: &Router, path: &str, cookie: Option<&str>) -> Response<axum::body::Body> {
    let mut builder = Request::builder().uri(path);
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, format!("apid_session={cookie}"));
    }
    send(router, builder.body(Body::empty()).unwrap()).await
}

async fn post_form(
    router: &Router,
    path: &str,
    body: &str,
    cookie: Option<&str>,
) -> Response<axum::body::Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded");
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, format!("apid_session={cookie}"));
    }
    send(router, builder.body(Body::from(body.to_string())).unwrap()).await
}

fn location(response: &Response<axum::body::Body>) -> &str {
    response.headers().get(LOCATION).unwrap().to_str().unwrap()
}

/// The `apid_session=<value>` part of the `Set-Cookie` response header.
fn session_cookie_value(response: &Response<axum::body::Body>) -> String {
    let header = response
        .headers()
        .get(SET_COOKIE)
        .expect("Set-Cookie header")
        .to_str()
        .unwrap();
    let (pair, attrs) = header.split_once(';').unwrap();
    for attr in ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"] {
        assert!(attrs.contains(attr), "cookie should carry {attr}: {header}");
    }
    pair.strip_prefix("apid_session=").unwrap().to_string()
}

#[tokio::test]
async fn setup_mode_redirects_everything_to_setup() {
    let (router, _) = test_app(unconfigured_tree());
    for path in ["/", "/login", "/no-such-page"] {
        let response = get(&router, path, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/setup");
    }
    assert_eq!(get(&router, "/setup", None).await.status(), StatusCode::OK);
    assert_eq!(
        get(&router, "/healthz", None).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn setup_writes_hash_and_creates_session() {
    let (router, fake) = test_app(unconfigured_tree());
    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/");
    let cookie = session_cookie_value(&response);

    let stored = fake
        .get_settings("access.webAdmin.password_hash")
        .await
        .unwrap();
    let stored = stored.as_str().unwrap();
    assert!(stored.starts_with("$argon2id$"));
    argon2::password_hash::PasswordHash::new(stored).expect("stored hash parses as PHC");
    assert!(auth::verify_password(stored, "hunter2secret"));

    let response = get(&router, "/", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn setup_rejects_short_and_mismatched_passwords() {
    let (router, _) = test_app(unconfigured_tree());
    let short = post_form(&router, "/setup", "password=short&confirm=short", None).await;
    assert_eq!(short.status(), StatusCode::BAD_REQUEST);
    let mismatch = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=different1",
        None,
    )
    .await;
    assert_eq!(mismatch.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn setup_conflicts_when_already_configured() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn login_logout_flow() {
    let (router, _) = test_app(configured_tree("hunter2secret"));

    let response = get(&router, "/", None).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");

    // A wrong password here would arm the backoff window and reject the
    // correct one that follows; the refusal is asserted on its own router in
    // `the_first_failure_arms_the_backoff_window`.
    let right = post_form(&router, "/login", "password=hunter2secret", None).await;
    assert_eq!(right.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&right), "/");
    let cookie = session_cookie_value(&right);

    assert_eq!(
        get(&router, "/", Some(&cookie)).await.status(),
        StatusCode::OK
    );

    let logout = post_form(&router, "/logout", "", Some(&cookie)).await;
    assert_eq!(logout.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&logout), "/login");

    let after = get(&router, "/", Some(&cookie)).await;
    assert_eq!(after.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&after), "/login");
}

#[tokio::test]
async fn the_first_failure_arms_the_backoff_window() {
    let (router, _) = test_app(configured_tree("hunter2secret"));

    // The first wrong password is answered, and costs a window.
    let first = post_form(&router, "/login", "password=wrongpass", None).await;
    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    assert!(first.headers().get(SET_COOKIE).is_none());

    // Every attempt inside that window is refused without being checked --
    // including the correct password, which is the point: the daemon cannot
    // tell the guesser apart from the administrator, so it answers neither.
    let second = post_form(&router, "/login", "password=wrongpass", None).await;
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);

    let correct = post_form(&router, "/login", "password=hunter2secret", None).await;
    assert_eq!(correct.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(
        correct.headers().get(SET_COOKIE).is_none(),
        "a refused attempt must not mint a session"
    );
}

#[tokio::test]
async fn status_page_renders_hostname_and_network_state() {
    let hash = auth::hash_password("hunter2secret").unwrap();
    let (router, fake) = test_app(json!({
        "hostname": "statusbox",
        "network": {},
        "access": { "webAdmin": { "password_hash": hash } },
    }));
    fake.set_state_entry(
        "network",
        json!({ "eth0": { "file": "50-mos-eth0.network", "dhcp": true } }),
    );
    fake.set_state_entry("uptime", json!(90_061));
    let cookie = login(&router, "hunter2secret").await;
    let response = get(&router, "/", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(body.contains("statusbox"), "hostname missing: {body}");
    assert!(body.contains("eth0"), "network state missing: {body}");
    // 90 061 s = 1d 1h 1m 1s: the pane renders mosd's number, humanized.
    assert!(body.contains("Uptime: 1d 1h 1m"), "uptime missing: {body}");
}

/// Uptime reaches the pane from mosd's live-state tree and from nowhere else:
/// a backend with no `uptime` state renders the unavailable notice, where a
/// handler that still read `/proc/uptime` for itself would render a real
/// number on any Linux host.
#[tokio::test]
async fn uptime_is_read_from_mosd_state_and_not_from_proc() {
    let (router, _fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = get(&router, "/", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(body.contains("Uptime unavailable."), "{body}");
    assert!(!body.contains("<p>Uptime: "), "{body}");
}

#[tokio::test]
async fn unauthenticated_panes_redirect_to_login() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    for path in ["/network", "/hostname"] {
        let response = get(&router, path, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/login");
    }
}

#[tokio::test]
async fn network_post_writes_dhcp_variant() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(&router, "/network", "iface=eth0&dhcp=on", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/network?saved=1");
    assert_eq!(
        fake.get_settings("network.eth0").await.unwrap(),
        json!({ "dhcp": true })
    );

    let saved = get(&router, "/network?saved=1", Some(&cookie)).await;
    assert!(body_string(saved).await.contains("Settings saved."));
}

#[tokio::test]
async fn network_post_writes_static_variant() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(
        &router,
        "/network",
        "iface=eth0&address=192.168.1.10%2F24&gateway=192.168.1.1&dns=1.1.1.1%2C+8.8.8.8",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.eth0").await.unwrap(),
        json!({
            "dhcp": false,
            "static": {
                "address": "192.168.1.10/24",
                "gateway": "192.168.1.1",
                "dns": ["1.1.1.1", "8.8.8.8"],
            },
        })
    );

    // Empty gateway is omitted; empty dns stays an empty list.
    let response = post_form(
        &router,
        "/network",
        "iface=eth1&address=10.0.0.2%2F8",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.eth1").await.unwrap(),
        json!({ "dhcp": false, "static": { "address": "10.0.0.2/8", "dns": [] } })
    );
}

/// A dotted interface name (the RFCT-135 VLAN case) is written as a quoted
/// segment, so the daemon sees one key and not two.
#[tokio::test]
async fn network_post_quotes_a_dotted_iface_name() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(&router, "/network", "iface=eth0.100&dhcp=on", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(fake.set_paths(), vec![r#"network."eth0.100""#.to_string()]);
}

#[tokio::test]
async fn network_post_rejects_bad_iface_name_and_cidr() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    for body in [
        "iface=bad%2Fname&dhcp=on",
        "iface=waytoolongiface016&dhcp=on",
        "iface=&dhcp=on",
        "iface=eth0&address=999.1.1.1%2F24",
        "iface=eth0&address=192.168.1.10",
        "iface=eth0&address=1.2.3.4%2F33",
    ] {
        let response = post_form(&router, "/network", body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
    }
    assert!(fake.set_paths().is_empty(), "no write on validation error");
}

#[tokio::test]
async fn hostname_post_writes_json_string() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(&router, "/hostname", "hostname=box-01", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/hostname?saved=1");
    assert_eq!(
        fake.get_settings("hostname").await.unwrap(),
        json!("box-01")
    );
}

#[tokio::test]
async fn hostname_post_rejects_invalid_names() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let too_long = format!("hostname={}", "a".repeat(64));
    for body in [
        "hostname=",
        "hostname=-leading",
        "hostname=trailing-",
        "hostname=has_underscore",
        too_long.as_str(),
    ] {
        let response = post_form(&router, "/hostname", body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
    }
    assert!(fake.set_paths().is_empty(), "no write on validation error");
}

#[tokio::test]
async fn wizard_full_submit_writes_password_hostname_network_in_order() {
    let (router, fake) = test_app(unconfigured_tree());
    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret&hostname=newbox\
         &iface=eth0&address=192.168.1.10%2F24",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/");
    session_cookie_value(&response);
    assert_eq!(
        fake.set_paths(),
        vec!["access.webAdmin", "hostname", "network.eth0"]
    );
    assert_eq!(
        fake.get_settings("hostname").await.unwrap(),
        json!("newbox")
    );
    assert_eq!(
        fake.get_settings("network.eth0").await.unwrap(),
        json!({ "dhcp": false, "static": { "address": "192.168.1.10/24", "dns": [] } })
    );
}

#[tokio::test]
async fn wizard_password_only_writes_only_access() {
    let (router, fake) = test_app(unconfigured_tree());
    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(fake.set_paths(), vec!["access.webAdmin"]);
}

#[tokio::test]
async fn wizard_unchanged_hostname_is_not_rewritten() {
    let (router, fake) = test_app(unconfigured_tree());
    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret&hostname=mos",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(fake.set_paths(), vec!["access.webAdmin"]);
}

#[tokio::test]
async fn wizard_rejects_invalid_optional_fields_without_writing() {
    let (router, fake) = test_app(unconfigured_tree());
    for body in [
        "password=hunter2secret&confirm=hunter2secret&hostname=-bad",
        "password=hunter2secret&confirm=hunter2secret&iface=eth0&address=not-a-cidr",
    ] {
        let response = post_form(&router, "/setup", body, None).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
    }
    assert!(fake.set_paths().is_empty(), "no write on validation error");
}

#[tokio::test]
async fn tampered_cookie_is_rejected() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    let response = post_form(&router, "/login", "password=hunter2secret", None).await;
    let cookie = session_cookie_value(&response);

    let mut tampered = cookie.clone().into_bytes();
    let last = tampered.last_mut().unwrap();
    *last = if *last == b'a' { b'b' } else { b'a' };
    let tampered = String::from_utf8(tampered).unwrap();

    let response = get(&router, "/", Some(&tampered)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");
}

// Power pane

/// One quiet period of the fake's polling deadline, used to give a detached
/// power task every chance to run before asserting that none was started.
async fn assert_no_power_call(fake: &FakeSettings, context: &str) {
    let calls = fake.await_power_calls(1).await;
    assert!(
        calls.is_empty(),
        "{context} must not reach mosd's power interface, got {calls:?}"
    );
}

#[tokio::test]
async fn power_pane_offers_both_confirmations() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = get(&router, "/power", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(body.contains(r#"action="/power/reboot""#), "{body}");
    assert!(body.contains(r#"action="/power/poweroff""#), "{body}");
    // The confirmation control, not a bare button: a required checkbox whose
    // value is the token the handler insists on.
    assert!(
        body.contains(r#"<input type="checkbox" name="confirm" value="reboot" required>"#),
        "{body}"
    );
    assert!(
        body.contains(r#"<input type="checkbox" name="confirm" value="poweroff" required>"#),
        "{body}"
    );
}

#[tokio::test]
async fn confirmed_post_reaches_mosd_reboot() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(&router, "/power/reboot", "confirm=reboot", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(fake.await_power_calls(1).await, vec!["reboot".to_string()]);
    assert!(fake.set_paths().is_empty(), "power writes no settings");
}

#[tokio::test]
async fn confirmed_post_reaches_mosd_power_off() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(
        &router,
        "/power/poweroff",
        "confirm=poweroff",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        fake.await_power_calls(1).await,
        vec!["power_off".to_string()]
    );
    assert!(fake.set_paths().is_empty(), "power writes no settings");
}

#[tokio::test]
async fn unconfirmed_post_is_rejected_without_acting() {
    for (path, body) in [
        ("/power/reboot", ""),
        ("/power/reboot", "confirm="),
        // The other action's token must not unlock this one.
        ("/power/reboot", "confirm=poweroff"),
        ("/power/reboot", "confirm=on"),
        ("/power/poweroff", ""),
        ("/power/poweroff", "confirm=reboot"),
        ("/power/poweroff", "confirm=yes"),
    ] {
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let cookie = login(&router, "hunter2secret").await;
        let response = post_form(&router, path, body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path} {body}"
        );
        assert_no_power_call(&fake, &format!("`{path}` with `{body}`")).await;
    }
}

#[tokio::test]
async fn unauthenticated_power_post_is_rejected_without_acting() {
    for (path, body) in [
        ("/power/reboot", "confirm=reboot"),
        ("/power/poweroff", "confirm=poweroff"),
    ] {
        // No cookie at all.
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let response = post_form(&router, path, body, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/login");
        assert_no_power_call(&fake, &format!("anonymous POST `{path}`")).await;

        // A forged cookie is no better than none.
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let response = post_form(&router, path, body, Some("deadbeef.deadbeef")).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/login");
        assert_no_power_call(&fake, &format!("forged-cookie POST `{path}`")).await;

        // In setup mode nobody is authenticated yet either.
        let (router, fake) = test_app(unconfigured_tree());
        let response = post_form(&router, path, body, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/setup");
        assert_no_power_call(&fake, &format!("setup-mode POST `{path}`")).await;
    }
}

#[tokio::test]
async fn get_on_power_actions_is_not_routed_and_does_not_act() {
    for path in ["/power/reboot", "/power/poweroff"] {
        // Authenticated, so the gate lets the request reach the router: there
        // is simply no GET handler, hence 405.
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let cookie = login(&router, "hunter2secret").await;
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path}"
        );
        assert_no_power_call(&fake, &format!("authenticated GET `{path}`")).await;

        // And a query string cannot smuggle the confirmation in either.
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let cookie = login(&router, "hunter2secret").await;
        let response = get(&router, &format!("{path}?confirm=reboot"), Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED, "{path}");
        assert_no_power_call(&fake, &format!("authenticated GET `{path}` with query")).await;

        // Anonymous GET never gets past the gate at all.
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let response = get(&router, path, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "GET {path}");
        assert_eq!(location(&response), "/login");
        assert_no_power_call(&fake, &format!("anonymous GET `{path}`")).await;
    }
}

// SSH pane

/// Real `ssh-keygen` output, the same three keys `mosd/mosd/src/reconciler/
/// sshd.rs` tests against, so both sides of the D-Bus boundary are exercised
/// with identical input. Public keys are not secrets; these correspond to no
/// device and the private halves were discarded at generation.
const REAL_ED25519_LINE: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8 rfct-034-test-ed25519";
const REAL_RSA_LINE: &str = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDT2F3imgGgI+xGNSQI+0alU1qRwyU3gCc8wU6msXSzZsVc8OYlg4VIqxsV/GLpBmgRz5lGoxjTT2TU0t1VwaMs845NqRIWzpG88ohD1LMn7RnUrNTxf4syFuvmELmYstqMfc6Q6rApqFoA6023Rl2orgd8N3SQ2wPAw8Rk9OLwim9/R7tX8C8FTbnMtepzTvOUNGTDAaKYhTZZnZpsGCwKa9f2aWyaS2XqLwn9uWpmHRUAkV10l45W2rLhnceejwwHotlZUIAFt8rlmS1ojRaLWqECVAuO5CDTt64KLLRniw8yHIYsWkeVsHZXCxq+J7oUVI3ogOSYs1M4I2eFCccD rfct-034-test-rsa";
const REAL_ED25519_SECOND_LINE: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILFM+HTH5h41h/zyK4CwjXx9E1l8Nwks1NaywRMiSsEP rfct-034-test-ed25519-second";

/// Fingerprints as `ssh-keygen -lf` printed them for the three keys above.
/// Comparing apid's fingerprint against values that came out of OpenSSH is the
/// point: a fingerprint checked only against itself proves nothing, and this
/// one is the handle a removal is addressed by.
const REAL_ED25519_FINGERPRINT: &str = "SHA256:HrgN3GLi6Mop2uSRjgOoxImM8zRkFmgqCKoeGD9QOaM";
const REAL_RSA_FINGERPRINT: &str = "SHA256:zv0xTYuVTo5pFpcl/svzzz/vJFvoguWxKlghlXQS1bE";
const REAL_ED25519_SECOND_FINGERPRINT: &str = "SHA256:d7yiR/zCsNFh8WmU6CGLWEG5vE06icIelqVoNc8TT2E";

/// Percent-encode one form value.
///
/// Everything outside the unreserved set is escaped, including the space, so a
/// case that is about a stray space or a control character survives the trip
/// to the handler as the byte it is meant to be.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The canonical `<type> <blob>` half of a full `ssh-keygen` line.
fn canonical(line: &str) -> String {
    let mut fields = line.splitn(3, ' ');
    let key_type = fields.next().unwrap();
    let blob = fields.next().unwrap();
    format!("{key_type} {blob}")
}

/// The comment half of a full `ssh-keygen` line.
fn comment_of(line: &str) -> &str {
    line.splitn(3, ' ').nth(2).unwrap()
}

/// A configured tree carrying an `access.ssh` subtree holding `keys`.
fn ssh_tree(keys: serde_json::Value) -> serde_json::Value {
    let hash = auth::hash_password("hunter2secret").unwrap();
    json!({
        "hostname": "mos",
        "network": {},
        "access": {
            "webAdmin": { "password_hash": hash },
            "ssh": {
                "enabled": false,
                "port": 22,
                "permitRootLogin": true,
                "passwordAuthentication": true,
                "listenAddresses": [],
                "authorizedKeys": keys,
            },
        },
    })
}

/// The stored form of one parsed key: comment split out of the key text.
fn stored_key(line: &str) -> serde_json::Value {
    json!({ "key": canonical(line), "comment": comment_of(line) })
}

/// One of an unbounded family of distinct, structurally real ed25519 key lines.
///
/// Derived from the committed fixture by overwriting the last byte of its
/// 32-byte public key, so every line parses, declares `ssh-ed25519` inside its
/// blob the way `parse_authorized_key` requires, and differs from every other.
/// A cap test needs distinct keys specifically: repeating one fixture would
/// meet the duplicate rule long before the bound.
///
/// The private halves were never generated, so none of these authorises
/// anything anywhere.
fn generated_key_line(index: u8) -> String {
    let blob = REAL_ED25519_LINE
        .split(' ')
        .nth(1)
        .expect("the fixture is `<type> <blob> <comment>`");
    let mut bytes = mosd_settings::decode_base64(blob).expect("the fixture blob decodes");
    let last = bytes.len() - 1;
    bytes[last] = index;
    format!("ssh-ed25519 {}", mosd_settings::encode_base64_nopad(&bytes))
}

/// Published sshd state carrying the three flags the pane reads.
fn sshd_state(effective: bool, requested: bool, transient_active: bool) -> serde_json::Value {
    json!({
        "enabled": false,
        "passwordAuthentication": effective,
        "passwordAuthenticationRequested": requested,
        "transientPasswordActive": transient_active,
        // Plural: mosd renders one file per managed login account and
        // publishes every path. apid reads none of them; the
        // fixture carries the real key name so it keeps describing state that
        // exists.
        "authorizedKeysPaths": [
            "/etc/ssh/authorized_keys.d/root",
            "/etc/ssh/authorized_keys.d/mos",
        ],
        "authorizedKeys": [],
    })
}

/// The stored key list, as JSON.
async fn stored_key_list(fake: &FakeSettings) -> serde_json::Value {
    fake.get_settings("access.ssh.authorizedKeys")
        .await
        .unwrap()
}

/// Every mutating SSH route, with a body that would be acted on if the request
/// were let through.
/// Every mutating route in the whole application, SSH's included.
///
/// Hand-written, and the test below is what keeps it honest: it reads
/// `routes.rs` for every path registered with `post(...)` and fails naming any
/// that is missing here. Without that, adding a route and forgetting this list
/// leaves exactly one unauthenticated write path and every existing test still
/// green -- the list would describe the routes someone remembered.
const ALL_MUTATIONS: [(&str, &str); 13] = [
    ("/ssh/enable", "enabled=on"),
    (
        "/password",
        "current=hunter2secret&password=newsecret9&confirm=newsecret9",
    ),
    (
        "/ssh/password",
        "confirm=set-transient-password&password=hunter2secret",
    ),
    ("/ssh/keys/add", "key=ssh-ed25519%20AAAA"),
    ("/ssh/keys/remove", "identifier=SHA256%3Aanything"),
    ("/containers/enable", "enabled=on"),
    ("/mqtt/enable", "enabled=on"),
    ("/hostname", "hostname=renamed"),
    // POST /network was reachable with no test asserting it rejects an
    // anonymous request. `unauthenticated_panes_redirect_to_login` covers the
    // GET and reads as if it covered the pane; the POST -- which rewrites an
    // interface's addressing -- was covered by nothing. Found by the coverage
    // test at the bottom of this file, on the day it was written.
    ("/network", "iface=eth0&dhcp=on"),
    ("/network/peers/add", "iface=wg0&publicKey=AAAA"),
    ("/network/peers/remove", "iface=wg0&publicKey=AAAA"),
    ("/power/reboot", "confirm=reboot"),
    ("/power/poweroff", "confirm=poweroff"),
];

const SSH_MUTATIONS: [(&str, &str); 4] = [
    ("/ssh/enable", "enabled=on"),
    (
        "/ssh/password",
        "confirm=set-transient-password&password=hunter2secret",
    ),
    ("/ssh/keys/add", "key=ssh-ed25519%20AAAA"),
    ("/ssh/keys/remove", "identifier=SHA256%3Aanything"),
];

/// Nothing reached mosd through either mutating interface.
fn assert_nothing_written(fake: &FakeSettings, context: &str) {
    assert!(
        fake.set_paths().is_empty(),
        "{context} must write no settings, got {:?}",
        fake.set_paths()
    );
    assert_eq!(
        fake.transient_password_calls(),
        0,
        "{context} must not set a transient password"
    );
    // Power is a third way to act that writes no setting. Checking only
    // set_paths would let a rejected /power/reboot look identical to a
    // successful one.
    assert!(
        fake.power_calls().is_empty(),
        "{context} must request no power action, got {:?}",
        fake.power_calls()
    );
}

/// POST one key line to `/ssh/keys/add`, encoded as submitted.
async fn add_key(router: &Router, line: &str, cookie: &str) -> Response<axum::body::Body> {
    post_form(
        router,
        "/ssh/keys/add",
        &format!("key={}", urlencode(line)),
        Some(cookie),
    )
    .await
}

#[tokio::test]
async fn ssh_pane_states_that_every_authorized_key_is_a_root_key() {
    // A correctness requirement, not a wording preference: the key list is
    // `%u`-expanded over one shared file, so an operator adding a colleague's
    // key is granting root. Asserted against a literal rather than against the
    // constant the pane renders, so rewording it fails here instead of passing.
    let (router, _) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
    assert!(
        body.contains("Every authorized key is a root key."),
        "the root-key sentence must be on the pane: {body}"
    );
    assert!(
        body.contains("logs in as root"),
        "the pane must say what that means: {body}"
    );
}

#[tokio::test]
async fn ssh_pane_shows_state_and_the_reboot_lifetime() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    fake.set_state_entry("sshd", sshd_state(true, true, true));
    let cookie = login(&router, "hunter2secret").await;
    let response = get(&router, "/ssh", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(body.contains("SSH: <b>disabled</b>"), "{body}");
    assert!(
        body.contains("Password authentication: <b>yes</b>"),
        "{body}"
    );
    assert!(
        body.contains("Transient root password: <b>active until the next reboot</b>"),
        "{body}"
    );
    assert!(
        body.contains("This password lasts until the next reboot."),
        "the transient form must state its lifetime: {body}"
    );
    // Rendering the pane writes nothing.
    assert_nothing_written(&fake, "GET /ssh");
}

#[tokio::test]
async fn ssh_pane_explains_a_suppressed_password_authentication() {
    const EXPLANATION: &str = "switched on in settings but off in sshd";

    // Requested but suppressed: the pane says why rather than a bare "no".
    let (router, fake) = test_app(ssh_tree(json!([])));
    fake.set_state_entry("sshd", sshd_state(false, true, false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
    assert!(
        body.contains("Password authentication: <b>no</b>"),
        "{body}"
    );
    assert!(body.contains(EXPLANATION), "{body}");

    // Not requested: "no" is the whole story, and the explanation must NOT
    // appear — it would be a false account of why it is off.
    let (router, fake) = test_app(ssh_tree(json!([])));
    fake.set_state_entry("sshd", sshd_state(false, false, false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
    assert!(!body.contains(EXPLANATION), "{body}");

    // Requested and in force: nothing to explain.
    let (router, fake) = test_app(ssh_tree(json!([])));
    fake.set_state_entry("sshd", sshd_state(true, true, true));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
    assert!(!body.contains(EXPLANATION), "{body}");
}

#[tokio::test]
async fn ssh_pane_lists_fingerprints_and_never_key_material() {
    let (router, _) = test_app(ssh_tree(json!([
        stored_key(REAL_ED25519_LINE),
        stored_key(REAL_RSA_LINE),
    ])));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;

    assert!(body.contains(REAL_ED25519_FINGERPRINT), "{body}");
    assert!(body.contains(REAL_RSA_FINGERPRINT), "{body}");
    assert!(body.contains("rfct-034-test-ed25519"), "comment missing");
    for line in [REAL_ED25519_LINE, REAL_RSA_LINE] {
        let blob = line.split(' ').nth(1).unwrap();
        assert!(
            !body.contains(blob),
            "key material must never reach the pane: {body}"
        );
    }
}

#[tokio::test]
async fn ssh_enable_writes_the_flag_in_both_directions() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(&router, "/ssh/enable", "enabled=on", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/ssh?saved=1");
    assert_eq!(
        fake.get_settings("access.ssh.enabled").await.unwrap(),
        json!(true)
    );

    // An unticked checkbox is absent from the body, and has to switch SSH off
    // rather than leave it as it was.
    let response = post_form(&router, "/ssh/enable", "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("access.ssh.enabled").await.unwrap(),
        json!(false)
    );
    assert_eq!(fake.set_paths(), vec!["access.ssh.enabled"; 2]);

    let saved = get(&router, "/ssh?saved=1", Some(&cookie)).await;
    assert!(body_string(saved).await.contains("Settings saved."));
}

#[tokio::test]
async fn unauthenticated_mutating_routes_are_rejected_one_by_one() {
    // Each path on its own, rather than "the gate exists" -- and from
    // ALL_MUTATIONS rather than a hand-listed four, so a route added to the
    // application is covered here by being added to one list that a test
    // verifies against the router's own source.
    let paths: Vec<(&str, &str)> = std::iter::once(("/ssh", "")).chain(ALL_MUTATIONS).collect();
    for (path, body) in paths {
        let send_one = async |router: &Router, cookie: Option<&str>| {
            if path == "/ssh" {
                get(router, path, cookie).await
            } else {
                post_form(router, path, body, cookie).await
            }
        };

        // No cookie at all.
        let (router, fake) = test_app(ssh_tree(json!([])));
        let response = send_one(&router, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/login");
        assert_nothing_written(&fake, &format!("anonymous `{path}`"));

        // A forged cookie is no better than none.
        let (router, fake) = test_app(ssh_tree(json!([])));
        let response = send_one(&router, Some("deadbeef.deadbeef")).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/login");
        assert_nothing_written(&fake, &format!("forged-cookie `{path}`"));

        // In setup mode nobody is authenticated yet either.
        let (router, fake) = test_app(unconfigured_tree());
        let response = send_one(&router, None).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&response), "/setup");
        assert_nothing_written(&fake, &format!("setup-mode `{path}`"));
    }
}

#[tokio::test]
async fn get_on_ssh_mutations_is_not_routed_and_does_not_act() {
    for (path, body) in SSH_MUTATIONS {
        // Authenticated, so the gate lets the request reach the router: there
        // is simply no GET handler, hence 405.
        let (router, fake) = test_app(ssh_tree(json!([])));
        let cookie = login(&router, "hunter2secret").await;
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path}"
        );
        assert_nothing_written(&fake, &format!("authenticated GET `{path}`"));

        // A query string cannot smuggle the form body in either.
        let response = get(&router, &format!("{path}?{body}"), Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path}?{body}"
        );
        assert_nothing_written(&fake, &format!("authenticated GET `{path}` with a query"));
    }
}

#[tokio::test]
async fn transient_password_reaches_mosd_and_never_the_settings_tree() {
    const PASSWORD: &str = "correct horse battery";

    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(
        &router,
        "/ssh/password",
        &format!(
            "confirm=set-transient-password&password={}",
            urlencode(PASSWORD)
        ),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/ssh?saved=1");
    assert_eq!(fake.transient_password_calls(), 1);

    // Nothing at all was written into the settings tree...
    assert!(
        fake.set_paths().is_empty(),
        "a transient password must write no setting, got {:?}",
        fake.set_paths()
    );
    // ...and the password is nowhere inside it either. A password that reached
    // the tree would be persisted, re-applied on the next boot and readable by
    // anything that can call GetSettings.
    let tree = fake.get_settings("").await.unwrap().to_string();
    assert!(
        !tree.contains(PASSWORD),
        "the password must not appear in the settings tree"
    );
    assert!(
        !tree.contains("correct horse"),
        "nor any prefix of it: {tree}"
    );
}

#[tokio::test]
async fn transient_password_requires_the_confirmation_token() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    for body in [
        "password=hunter2secret",
        "confirm=&password=hunter2secret",
        "confirm=on&password=hunter2secret",
        "confirm=yes&password=hunter2secret",
        // The power actions' tokens must not unlock this one.
        "confirm=reboot&password=hunter2secret",
    ] {
        let response = post_form(&router, "/ssh/password", body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
    }
    assert_nothing_written(&fake, "an unconfirmed transient-password POST");

    // The pane offers the confirmation control the handler insists on: a
    // required checkbox whose value is that token, not a bare button.
    let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
    assert!(
        body.contains(
            r#"<input type="checkbox" name="confirm" value="set-transient-password" required>"#
        ),
        "{body}"
    );
}

#[tokio::test]
async fn transient_password_length_boundaries_hold_in_both_directions() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    let submit = async |password: String| {
        post_form(
            &router,
            "/ssh/password",
            &format!("confirm=set-transient-password&password={password}"),
            Some(&cookie),
        )
        .await
    };

    // 7 rejected, 8 accepted: the floor, from both sides.
    assert_eq!(
        submit("a".repeat(7)).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(submit("a".repeat(8)).await.status(), StatusCode::SEE_OTHER);

    // 72 accepted, 73 rejected: the ceiling, from both sides. 73 is the byte
    // at which bcrypt starts ignoring input, so it is where the pane stops.
    assert_eq!(submit("a".repeat(72)).await.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        submit("a".repeat(73)).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    // Exactly the two accepted lengths reached mosd, and neither wrote a
    // setting.
    assert_eq!(fake.transient_password_calls(), 2);
    assert!(fake.set_paths().is_empty(), "no setting is written");
}

#[tokio::test]
async fn transient_password_rejects_forbidden_bytes() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    for (ch, what) in [('\0', "NUL"), ('\n', "newline"), ('\r', "carriage return")] {
        let response = post_form(
            &router,
            "/ssh/password",
            &format!(
                "confirm=set-transient-password&password={}",
                urlencode(&format!("hunter2{ch}secret"))
            ),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "a {what} must be rejected"
        );
    }
    assert_nothing_written(&fake, "a password holding a forbidden byte");
}

#[tokio::test]
async fn key_add_stores_the_parsed_key_with_its_comment_split_out() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    let response = add_key(&router, REAL_ED25519_LINE, &cookie).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/ssh?saved=1");
    assert_eq!(fake.set_paths(), vec!["access.ssh.authorizedKeys"]);
    // The comment lives in its own field, so the same key pasted under two
    // labels is one key rather than two.
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)])
    );

    // A second key appends rather than replaces.
    let response = add_key(&router, REAL_RSA_LINE, &cookie).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE), stored_key(REAL_RSA_LINE)])
    );
}

#[tokio::test]
async fn key_add_rejects_hostile_input_one_character_at_a_time() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let base = canonical(REAL_ED25519_LINE);
    let mut cases: Vec<(String, &str)> = Vec::new();
    for (ch, what) in [
        ('\0', "NUL"),
        ('\n', "line feed"),
        ('\r', "carriage return"),
        ('\t', "tab"),
        ('\u{7f}', "delete"),
    ] {
        cases.push((format!("{base} host{ch}name"), what));
    }
    // A leading space and a double space between the fields: both are why the
    // submitted line is handed to the parser untrimmed. Trimming here would
    // accept a line mosd would not.
    cases.push((format!(" {REAL_ED25519_LINE}"), "leading space"));
    let mut fields = REAL_ED25519_LINE.splitn(3, ' ');
    let (key_type, blob) = (fields.next().unwrap(), fields.next().unwrap());
    cases.push((
        format!("{key_type}  {blob}"),
        "double space between the fields",
    ));

    for (line, what) in &cases {
        let response = add_key(&router, line, &cookie).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "a {what} must be rejected"
        );
    }
    assert_nothing_written(&fake, "a key holding hostile input");
    assert_eq!(
        stored_key_list(&fake).await,
        json!([]),
        "no unparsed key may reach the settings tree"
    );
}

#[tokio::test]
async fn key_add_accepts_a_comment_holding_shell_metacharacters() {
    // The comment reaches a file sshd reads, not a shell. Rejecting these
    // would refuse labels operators really write and would buy nothing.
    const COMMENT: &str = r#"ops$team`whoami`;rm -rf / "quoted" \escape"#;
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;
    let line = format!("{} {COMMENT}", canonical(REAL_ED25519_LINE));
    let response = add_key(&router, &line, &cookie).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        stored_key_list(&fake).await,
        json!([{ "key": canonical(REAL_ED25519_LINE), "comment": COMMENT }])
    );
}

#[tokio::test]
async fn key_add_rejects_a_duplicate_through_the_shared_validator() {
    let (router, fake) = test_app(ssh_tree(json!([stored_key(REAL_ED25519_LINE)])));
    let cookie = login(&router, "hunter2secret").await;
    // The same key under a different label is one key, not two.
    let line = format!("{} another-label", canonical(REAL_ED25519_LINE));
    let response = add_key(&router, &line, &cookie).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_nothing_written(&fake, "a duplicate key");
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)])
    );
}

#[tokio::test]
async fn key_remove_takes_a_fingerprint_or_the_exact_key_text() {
    for identifier in [REAL_RSA_FINGERPRINT.to_string(), canonical(REAL_RSA_LINE)] {
        let (router, fake) = test_app(ssh_tree(json!([
            stored_key(REAL_ED25519_LINE),
            stored_key(REAL_RSA_LINE),
            stored_key(REAL_ED25519_SECOND_LINE),
        ])));
        let cookie = login(&router, "hunter2secret").await;
        let response = post_form(
            &router,
            "/ssh/keys/remove",
            &format!("identifier={}", urlencode(&identifier)),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{identifier}");
        assert_eq!(location(&response), "/ssh?saved=1");
        // The named key went and the other two stayed, in order. An index
        // would have been ambiguous about which of the three this was.
        assert_eq!(
            stored_key_list(&fake).await,
            json!([
                stored_key(REAL_ED25519_LINE),
                stored_key(REAL_ED25519_SECOND_LINE),
            ]),
            "{identifier}"
        );
    }
}

#[tokio::test]
async fn key_remove_of_an_absent_key_is_an_error_not_a_silent_success() {
    let (router, fake) = test_app(ssh_tree(json!([stored_key(REAL_ED25519_LINE)])));
    let cookie = login(&router, "hunter2secret").await;
    for identifier in [
        // A well-formed fingerprint of a key that is not in the list.
        REAL_ED25519_SECOND_FINGERPRINT,
        // An empty identifier must not match the first entry, or any entry.
        "",
        "SHA256:not-a-fingerprint",
        // A list index is not an identifier this route accepts.
        "0",
    ] {
        let response = post_form(
            &router,
            "/ssh/keys/remove",
            &format!("identifier={}", urlencode(identifier)),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "`{identifier}`"
        );
    }
    assert_nothing_written(&fake, "removing a key that is not there");
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)]),
        "a failed removal must leave the list untouched"
    );
}

#[tokio::test]
async fn the_pane_and_a_removal_agree_on_the_fingerprint_openssh_prints() {
    // The pane renders a fingerprint and a removal is addressed by it, so the
    // two only line up if apid's fingerprint is the one `ssh-keygen -lf`
    // prints. These constants came from that command.
    for (line, expected) in [
        (REAL_ED25519_LINE, REAL_ED25519_FINGERPRINT),
        (REAL_RSA_LINE, REAL_RSA_FINGERPRINT),
        (REAL_ED25519_SECOND_LINE, REAL_ED25519_SECOND_FINGERPRINT),
    ] {
        let (router, fake) = test_app(ssh_tree(json!([stored_key(line)])));
        let cookie = login(&router, "hunter2secret").await;
        let body = body_string(get(&router, "/ssh", Some(&cookie)).await).await;
        assert!(body.contains(expected), "pane should show {expected}");

        let response = post_form(
            &router,
            "/ssh/keys/remove",
            &format!("identifier={}", urlencode(expected)),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{expected}");
        assert_eq!(stored_key_list(&fake).await, json!([]));
    }
}

// The asset router: §4.1 precedence, the reserved `/api/` subtree, §4.2's SPA
// fallback and §4.3's headers as applied.

/// What a browser sends on a navigation.
const BROWSER_ACCEPT: &str =
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/// The served set §2.1 owns. Passed in because this phase does not define one
/// and must not invent it; a bundle declaring `v1` intersects it.
const SERVED: &[&str] = &["v1"];

/// Stage `files` as generation 1 and activate it, returning the store's root.
///
/// Installation goes through `bundle::Store::activate` rather than writing
/// `bundles/1` and `current` by hand, so the tree these tests serve is a tree
/// §5.3 accepted: validated, mode-normalised, digested and pointed at by a
/// renamed symlink.
fn install_bundle(files: &[(&str, &str)]) -> TempDir {
    let dir = TempDir::new().expect("temp bundle store");
    let store = Store::new(dir.path());
    let staging = store.staging_dir(1);
    for (relative, contents) in files {
        let path = staging.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).expect("create staged parent");
        std::fs::write(path, contents).expect("write staged file");
    }
    store.activate(1, SERVED).expect("activate the staged tree");
    dir
}

/// Every regular file in the installed tree, relative to the bundle root,
/// sorted.
fn installed_files(root: &Path) -> Vec<String> {
    let store = Store::new(root);
    let generation = store
        .active_generation()
        .expect("read current")
        .expect("a bundle is active");
    let bundle = store.bundle_dir(generation);
    let mut found = Vec::new();
    let mut stack = vec![bundle.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("read installed dir") {
            let entry = entry.expect("installed dir entry");
            if entry.file_type().expect("entry type").is_dir() {
                stack.push(entry.path());
            } else {
                found.push(
                    entry
                        .path()
                        .strip_prefix(&bundle)
                        .expect("inside the bundle")
                        .display()
                        .to_string(),
                );
            }
        }
    }
    found.sort();
    found
}

/// The router as shipped, with the bundle store rooted at `bundle_root`.
fn test_app_serving(tree: serde_json::Value, bundle_root: &Path) -> Router {
    let fake = Arc::new(FakeSettings::new(tree));
    // A fixed uptime, so the status pane renders its uptime line (which
    // `without_the_uptime_line` requires) from the fake like everything else.
    fake.set_state_entry("uptime", json!(90_061));
    app(AppState::new(fake, SIGNING_KEY).with_bundle_root(bundle_root))
}

/// The asset router with **§4.1 rule 1 deleted**, and nothing else.
///
/// This is the control that makes the reservation's test bidirectional in the
/// sense §4.1 means. A test that asks for `/api/foo` and asserts 404 proves
/// nothing when no file was ever placed there — the 404 is indistinguishable
/// from an unhandled path. Here the same bundle, reached through the same
/// asset handler with the reservation removed, serves the file's bytes.
fn asset_router_without_the_api_reservation(bundle_root: &Path) -> Router {
    let fake = Arc::new(FakeSettings::new(configured_tree("hunter2secret")));
    let state = AppState::new(fake, SIGNING_KEY).with_bundle_root(bundle_root);
    Router::new().fallback(serve::fallback).with_state(state)
}

async fn request(
    router: &Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    accept: Option<&str>,
) -> Response<axum::body::Body> {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, format!("apid_session={cookie}"));
    }
    if let Some(accept) = accept {
        builder = builder.header(ACCEPT, accept);
    }
    send(router, builder.body(Body::empty()).unwrap()).await
}

fn header_value(response: &Response<axum::body::Body>, name: HeaderName) -> String {
    response
        .headers()
        .get(&name)
        .unwrap_or_else(|| panic!("response carries {name}"))
        .to_str()
        .unwrap()
        .to_string()
}

/// §4.1 rule 1, stated the way §4.2 condition 1 needs it: a bundle that
/// **actually contains** files under `api/` cannot serve one.
///
/// The bundle really has them — `installed_files` lists them out of the
/// installed tree — and the same router serves `/decoy.txt` from the same
/// bundle, so the answers below are the reservation and not an empty
/// directory. `api/versions` shadows a route that now exists, so its
/// assertion is that the declared handler answered rather than that nothing
/// did.
/// `each_guard_is_exercised_by_exactly_one_hostile_feature` in `assets::path`
/// is the discipline this follows: the assertion has to distinguish the guard
/// from its absence.
#[tokio::test]
async fn a_bundle_cannot_shadow_the_reserved_api_subtree() {
    const VERSIONS_BYTES: &str = "BUNDLE-SHADOWS-API-VERSIONS";
    const SETTINGS_BYTES: &str = "BUNDLE-SHADOWS-API-V1-SETTINGS";

    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("decoy.txt", "the bundle is reachable"),
        ("api/versions", VERSIONS_BYTES),
        ("api/v1/settings", SETTINGS_BYTES),
    ]);

    // The files are in the installed tree, not merely in the staged one.
    let listed = installed_files(bundle.path());
    assert!(
        listed.contains(&"api/versions".to_string())
            && listed.contains(&"api/v1/settings".to_string()),
        "the installed bundle must actually contain the shadowing files: {listed:?}"
    );

    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    // The bundle is reachable through this very router, so a 404 under `/api/`
    // cannot be explained by the bundle not being served.
    let response = request(&router, "GET", "/decoy.txt", Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "the bundle is reachable");

    // The declared route answers with its own document, not with the file the
    // bundle put in its way.
    let response = request(&router, "GET", "/api/versions", Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        !body.contains(VERSIONS_BYTES),
        "/api/versions answered with the bundle's own bytes: {body}"
    );
    assert_eq!(body, VERSIONS_BODY);

    for (path, bytes) in [("/api/v1/settings", SETTINGS_BYTES)] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        let status = response.status();
        let content_type = header_value(&response, CONTENT_TYPE);
        let cache_control = header_value(&response, CACHE_CONTROL);
        let body = body_string(response).await;

        // Asserted first, and on the body rather than on the status, so that
        // deleting the reservation fails this test **with the bundle's own
        // bytes printed** rather than with a bare `200 != 404`. The guard is
        // then distinguishable from its absence by reading the failure.
        assert!(
            !body.contains(bytes),
            "{path}: the reserved subtree answered with the bundle's own bytes: {body}"
        );
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(content_type, "application/json", "{path}");
        assert_eq!(cache_control, "no-store", "{path}");
        let envelope: serde_json::Value = serde_json::from_str(&body).expect("§2.4 envelope");
        assert_eq!(envelope["error"]["code"], "not_found", "{path}");
        assert_eq!(envelope["error"]["source"], "apid", "{path}");
        assert!(
            envelope["error"]["message"].is_string(),
            "{path}: §2.4 requires a message"
        );
    }
}

/// The other direction of the same guard: with §4.1 rule 1 removed, the very
/// same bundle serves its own file at `/api/versions`.
///
/// Without this the test above would pass against a router that had no
/// reservation and simply no bundle.
#[tokio::test]
async fn without_the_reservation_the_bundle_does_shadow_the_api() {
    const VERSIONS_BYTES: &str = "BUNDLE-SHADOWS-API-VERSIONS";

    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("api/versions", VERSIONS_BYTES),
    ]);
    let unreserved = asset_router_without_the_api_reservation(bundle.path());

    let response = request(&unreserved, "GET", "/api/versions", None, None).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "without the reservation the asset router answers under /api/"
    );
    assert_eq!(
        body_string(response).await,
        VERSIONS_BYTES,
        "and it answers with the bundle's own bytes, which is the failure the \
         reservation prevents"
    );
}

/// The reservation covers the subtree and every method, for every path the
/// API does not declare. The declared paths are asserted separately, below.
#[tokio::test]
async fn the_api_reservation_answers_every_shape_with_the_envelope() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    for (method, path) in [
        ("GET", "/api"),
        ("GET", "/api/"),
        ("GET", "/api/v1"),
        ("GET", "/api/versions/extra"),
        ("GET", "/api/v1/settings"),
        ("GET", "/api/v1/actions/reboot"),
        // `/api/v1/wifi/client/networks` was here until PLAN-023 M5 declared
        // it. Its prefix and its trailing-slash spelling took its place, and
        // they are the more useful cases: neither is a route this router
        // serves, so both must still reach the reservation rather than the
        // collection beside them.
        ("GET", "/api/v1/wifi/client"),
        ("GET", "/api/v1/wifi/client/networks/"),
        ("POST", "/api/v1/settings"),
    ] {
        let response = request(&router, method, path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "{method} {path} must be the reserved subtree's own 404"
        );
        assert_eq!(
            header_value(&response, CONTENT_TYPE),
            "application/json",
            "{method} {path}"
        );
        let envelope: serde_json::Value =
            serde_json::from_str(&body_string(response).await).expect("§2.4 envelope");
        assert_eq!(envelope["error"]["code"], "not_found", "{method} {path}");
    }
}

// §2.1's two discovery endpoints, and what the rest of the reserved subtree
// still answers now that two of its paths are declared.

/// The exact document §2.1's discovery table gives for the served set.
const VERSIONS_BODY: &str = r#"{"versions":["v1"],"current":"v1"}"#;

/// The exact document §2.1's discovery table gives for `/api/v1/meta`.
///
/// Built from `mosd_settings::SCHEMA_VERSION` rather than from a literal,
/// which is the whole point of the field: a schema bump moves this expectation
/// and the handler together, and a hand-copied number in either is what fails.
fn meta_body() -> String {
    format!(
        r#"{{"api":"v1","settingsSchemaVersion":{},"daemon":"apid"}}"#,
        mosd_settings::SCHEMA_VERSION
    )
}

/// Both headers §4.3 asks of every `/api/` response, successes included.
fn assert_api_headers(response: &Response<axum::body::Body>, context: &str) {
    assert_eq!(
        header_value(response, CONTENT_TYPE),
        "application/json",
        "{context}"
    );
    assert_eq!(
        header_value(response, CACHE_CONTROL),
        "no-store",
        "{context}"
    );
}

/// The `error` object of a §2.4 envelope.
async fn envelope(response: Response<axum::body::Body>) -> serde_json::Value {
    let body = body_string(response).await;
    let parsed: serde_json::Value =
        serde_json::from_str(&body).unwrap_or_else(|_| panic!("§2.4 envelope, got: {body}"));
    parsed["error"].clone()
}

/// §2.1: unauthenticated, and the answer is the table's document exactly.
#[tokio::test]
async fn api_versions_answers_the_served_set_without_a_session() {
    let (router, _) = test_app(configured_tree("hunter2secret"));

    let response = get(&router, "/api/versions", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "/api/versions");
    assert_eq!(body_string(response).await, VERSIONS_BODY);
}

/// The first of §2.1's two reasons the endpoint is unauthenticated: a
/// factory-fresh device has no `access.webAdmin`, so the gate is in setup mode
/// and sends everything else to `/setup`.
#[tokio::test]
async fn api_versions_answers_in_setup_mode() {
    let (router, _) = test_app(unconfigured_tree());

    // The control, so the 200 below is the hand-off and not a device that
    // happened to be out of setup mode.
    let redirected = get(&router, "/", None).await;
    assert_eq!(redirected.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&redirected), "/setup");

    let response = get(&router, "/api/versions", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, VERSIONS_BODY);
}

/// The hand-off is above the gate's `GetSettings("access")` call, so the
/// question "which versions does this device serve?" is still answerable when
/// mosd is not answering.
#[tokio::test]
async fn api_versions_answers_when_the_settings_call_fails() {
    // A tree with no `access` subtree at all: the fake fails the read, which
    // is the gate's mosd-unreachable branch.
    let (router, _) = test_app(json!({}));

    let failed = get(&router, "/", None).await;
    assert_eq!(
        failed.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "the control: the gate's own bus call must be failing"
    );

    let response = get(&router, "/api/versions", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, VERSIONS_BODY);
}

/// §2.1's second discovery endpoint, answered for a valid session.
#[tokio::test]
async fn api_v1_meta_answers_for_a_session() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/api/v1/meta", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "/api/v1/meta");
    assert_eq!(body_string(response).await, meta_body());
}

/// §3.1's trap, refused: a client that follows the gate's redirect lands on
/// `GET /login`, which answers **200 with HTML**, so a script reads the whole
/// exchange as success. The answer is §2.4's envelope with the status that
/// matches it.
#[tokio::test]
async fn api_v1_meta_without_a_session_is_401_and_the_envelope() {
    let (router, _) = test_app(configured_tree("hunter2secret"));

    let response = get(&router, "/api/v1/meta", None).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_api_headers(&response, "/api/v1/meta");
    let error = envelope(response).await;
    assert_eq!(error["code"], "not_authenticated");
    assert_eq!(error["source"], "apid");
    assert!(error["message"].is_string(), "§2.4 requires a message");
    // §2.4 defines `path` as the settings dot-path at fault, and a request
    // that failed to authenticate names none.
    assert_eq!(error.get("path"), None);
}

/// Setup mode is the branch a path-prefix implementation breaks: no session
/// can exist there, and the gate sends everything it still owns to `/setup`.
#[tokio::test]
async fn api_v1_meta_is_401_in_setup_mode_too() {
    let (router, _) = test_app(unconfigured_tree());

    let response = get(&router, "/api/v1/meta", None).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_api_headers(&response, "/api/v1/meta");
    assert_eq!(envelope(response).await["code"], "not_authenticated");
}

/// The declared paths are the only ones that changed. Every other path under
/// `/api` keeps **both** of its answers: the subtree's own 404 with a session,
/// and the gate's redirect without one, in either gate mode.
///
/// The bare family prefixes are members of this class rather than exceptions
/// to it. axum's `{*path}` wildcard matches at least one character, so
/// `/api/v1/settings` and `/api/v1/settings/` name no dot-path and reach the
/// not-found handler — and the gate's predicate has to agree with the router
/// about that, or an unauthenticated request for one of them would be handed
/// to a route that does not exist instead of being redirected.
#[tokio::test]
async fn every_other_api_path_keeps_both_of_its_answers() {
    // `/api/v1/ssh/authorized-keys` left this list when PLAN-023 M5 declared
    // it: it is now a served collection, and the test that holds its answers
    // is `the_ssh_key_collection_lists_adds_and_removes`.
    const UNDECLARED: [&str; 5] = [
        "/api/v1/actions/reboot",
        "/api/v1/settings",
        "/api/v1/settings/",
        "/api/v1/state",
        "/api/v1/state/",
    ];

    let (router, _) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let (fresh, _) = test_app(unconfigured_tree());

    for path in UNDECLARED {
        // With a session: the reserved subtree's own envelope, byte for byte.
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_api_headers(&response, path);
        assert_eq!(
            body_string(response).await,
            json!({
                "error": {
                    "code": "not_found",
                    "message": format!("no API route at {path}"),
                    "source": "apid",
                }
            })
            .to_string(),
            "{path}"
        );

        // Without one: the gate's redirect to `/login`.
        let redirected = get(&router, path, None).await;
        assert_eq!(redirected.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&redirected), "/login", "{path}");

        // And in setup mode, the gate's redirect to `/setup`.
        let redirected = get(&fresh, path, None).await;
        assert_eq!(redirected.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(location(&redirected), "/setup", "{path}");
    }
}

/// `mosd/apid/openapi.json` is the bytes `apid --openapi` prints.
///
/// A local `cargo test` failure and not only a CI one: whoever changed a route
/// is the person holding the command that regenerates the file.
#[test]
fn the_committed_openapi_document_is_the_generated_one() {
    assert_eq!(
        crate::openapi::document_json(),
        include_str!("../openapi.json"),
        "mosd/apid/openapi.json is stale; from mosd/, regenerate it with:\n    \
         cargo run -p apid -- --openapi > apid/openapi.json"
    );
}

/// The document describes the served surface, §3.1's outcome included: a
/// client that reads only `openapi.json` has to be able to learn that
/// `/api/v1/meta` can answer 401.
#[test]
fn the_openapi_document_covers_the_declared_routes() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    assert!(
        document["paths"]["/api/versions"]["get"]["responses"]["200"].is_object(),
        "{document}"
    );
    let meta = &document["paths"]["/api/v1/meta"]["get"]["responses"];
    assert!(meta["200"].is_object(), "{meta}");
    assert!(meta["401"].is_object(), "{meta}");
}

/// §4.1 rules 2 and 3: a declared route wins structurally, and the bundle
/// files of the same name are never consulted.
#[tokio::test]
async fn declared_routes_win_over_bundle_files_of_the_same_name() {
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("healthz", "BUNDLE-SHADOWS-HEALTHZ"),
        ("login", "BUNDLE-SHADOWS-LOGIN"),
        ("network", "BUNDLE-SHADOWS-NETWORK"),
    ]);
    let listed = installed_files(bundle.path());
    for name in ["healthz", "login", "network"] {
        assert!(listed.contains(&name.to_string()), "{name} in {listed:?}");
    }

    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let response = request(&router, "GET", "/healthz", None, None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "ok");

    for (path, shadow) in [
        ("/network", "BUNDLE-SHADOWS-NETWORK"),
        ("/login", "BUNDLE-SHADOWS-LOGIN"),
    ] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = body_string(response).await;
        assert!(!body.contains(shadow), "{path} was answered by the bundle");
        assert!(
            body.contains("<!DOCTYPE html>"),
            "{path} is a built-in pane"
        );
    }
}

/// §4.2 condition 2. Anything that is not `GET` or `HEAD` and reaches the
/// asset router is a client error, and it is never HTML.
#[tokio::test]
async fn a_write_method_reaching_the_asset_router_is_405_and_never_html() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        let response = request(
            &router,
            method,
            "/settings/network",
            Some(&cookie),
            Some(BROWSER_ACCEPT),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method} /settings/network"
        );
        assert_eq!(header_value(&response, ALLOW), "GET, HEAD", "{method}");
        assert!(response.headers().get(CONTENT_TYPE).is_none(), "{method}");
        assert_eq!(body_string(response).await, "", "{method}");
    }
}

/// §4.2 condition 3. This is the condition that separates a navigation from a
/// data call when both are `GET`, and it is the whole of §4.2's stated
/// property: a request a developer expected to be JSON never comes back as
/// HTML with a 200.
#[tokio::test]
async fn a_json_client_never_gets_the_spa_fallback() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    // Three shapes of data call, and none of them may come back as HTML: the
    // explicit one §4.2 names, the `*/*` a `fetch()` sends when it sets no
    // `Accept`, and no header at all.
    for accept in [Some("application/json"), Some("*/*"), None] {
        let response = request(&router, "GET", "/settings/network", Some(&cookie), accept).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{accept:?}");
        assert_eq!(body_string(response).await, "", "{accept:?}");
    }

    // The same path, asked for as a navigation.
    for accept in [BROWSER_ACCEPT, "text/html"] {
        let response = request(
            &router,
            "GET",
            "/settings/network",
            Some(&cookie),
            Some(accept),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "{accept}");
        assert_eq!(
            body_string(response).await,
            "<!doctype html><title>custom</title>",
            "{accept}"
        );
    }
}

/// §4.2 condition 4, implemented as the heuristic §4.2 names: a final segment
/// with a `.` is a filename, and a miss on a filename is a 404 with an empty
/// body even for a browser navigation.
#[tokio::test]
async fn a_dotted_final_segment_misses_with_an_empty_body() {
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("assets/app.a1b2c3.js", "//real"),
    ]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let response = request(
        &router,
        "GET",
        "/assets/app.deadbeef.js",
        Some(&cookie),
        Some(BROWSER_ACCEPT),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_string(response).await, "");

    // A path with no dot in its final segment is a client-side route.
    let response = request(
        &router,
        "GET",
        "/settings/network",
        Some(&cookie),
        Some(BROWSER_ACCEPT),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    // And the file that does exist is served, so the 404 above is a miss and
    // not the extension being refused.
    let response = request(
        &router,
        "GET",
        "/assets/app.a1b2c3.js",
        Some(&cookie),
        Some(BROWSER_ACCEPT),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "//real");
}

/// §4.2 condition 5, and §6.1 classes 1 and 2: with no readable index the
/// answer is the **built-in UI**, not a 404 and not a 500.
#[tokio::test]
async fn without_a_readable_index_the_fallback_is_the_built_in_ui() {
    // Class 1: no bundle installed at all, which is the shipped state of every
    // device.
    let empty = TempDir::new().unwrap();
    let router = test_app_serving(configured_tree("hunter2secret"), empty.path());
    let cookie = login(&router, "hunter2secret").await;
    for path in ["/", "/settings/network"] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(header_value(&response, CACHE_CONTROL), "no-store", "{path}");
        assert!(
            body_string(response).await.contains("Network state"),
            "{path} must be the built-in status pane"
        );
    }

    // Class 2, reached the only way it can be — the tree was mutated outside
    // the install path, because §5.3 refuses to activate a bundle without a
    // regular `index.html`.
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("assets/app.a1b2c3.js", "//real"),
    ]);
    let store = Store::new(bundle.path());
    let installed = store.bundle_dir(1);
    std::fs::remove_file(installed.join("index.html")).unwrap();
    std::os::unix::fs::symlink("assets/app.a1b2c3.js", installed.join("index.html")).unwrap();

    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;
    for path in ["/", "/settings/network"] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = body_string(response).await;
        assert!(body.contains("Network state"), "{path}: built-in UI");
        assert!(!body.contains("//real"), "{path}: the symlink was followed");
    }
}

/// §4.1's `/` exception, both branches.
#[tokio::test]
async fn the_site_root_is_the_bundle_index_when_one_is_active() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let response = request(&router, "GET", "/", Some(&cookie), Some(BROWSER_ACCEPT)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_string(response).await,
        "<!doctype html><title>custom</title>"
    );

    // §4.1's `/` rule has no `Accept` condition: it is a declared route with
    // two branches and no more.
    let response = request(&router, "GET", "/", Some(&cookie), Some("application/json")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body_string(response).await.contains("<title>custom"));

    // Deactivate — §5.3's operation and §6.3's escape — and `/` is the
    // built-in UI again, with no restart.
    assert!(Store::new(bundle.path()).deactivate().unwrap());
    let response = request(&router, "GET", "/", Some(&cookie), Some(BROWSER_ACCEPT)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body_string(response).await.contains("Network state"));
}

/// §4.3 as applied: `nosniff` on every asset response, the content type from
/// the allowlist, and the cache class per §4.3's table — including the
/// manifest's opt-in immutable directory.
#[tokio::test]
async fn every_asset_response_carries_nosniff_and_its_cache_class() {
    let manifest = r#"{"name":"custom","version":"1.0",
        "immutableDir":"assets","apiVersions":["v1"]}"#;
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("mos-ui.json", manifest),
        ("assets/app.a1b2c3.js", "//real"),
        ("assets/logo.svg", "<svg/>"),
        ("robots.txt", "User-agent: *"),
        ("data.bin", "\u{0}\u{1}"),
    ]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    for (path, content_type, cache_control) in [
        ("/index.html", "text/html; charset=utf-8", "no-store"),
        (
            "/assets/app.a1b2c3.js",
            "text/javascript; charset=utf-8",
            "public, max-age=31536000, immutable",
        ),
        (
            "/assets/logo.svg",
            "image/svg+xml",
            "public, max-age=31536000, immutable",
        ),
        ("/robots.txt", "text/plain; charset=utf-8", "no-cache"),
        ("/data.bin", "application/octet-stream", "no-cache"),
    ] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            header_value(&response, CONTENT_TYPE),
            content_type,
            "{path}"
        );
        assert_eq!(
            header_value(&response, CACHE_CONTROL),
            cache_control,
            "{path}"
        );
        assert_eq!(
            header_value(&response, HeaderName::from_static("x-content-type-options")),
            "nosniff",
            "{path}"
        );
    }

    // The SPA fallback is an HTML document and is `no-store` with it — §4.3's
    // first row names it explicitly, because a cached index makes a new bundle
    // invisible however correctly its assets are named.
    let response = request(
        &router,
        "GET",
        "/settings/network",
        Some(&cookie),
        Some(BROWSER_ACCEPT),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header_value(&response, CACHE_CONTROL), "no-store");
    assert_eq!(
        header_value(&response, HeaderName::from_static("x-content-type-options")),
        "nosniff"
    );

    // A refusal is an asset response too.
    let response = request(
        &router,
        "GET",
        "/assets/missing.js",
        Some(&cookie),
        Some(BROWSER_ACCEPT),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        header_value(&response, HeaderName::from_static("x-content-type-options")),
        "nosniff"
    );
}

/// §4.4's suite, at the router rather than at `assets::path`: a hostile request
/// is a 404 and is never answered by §4.2's fallback, even though every one of
/// these satisfies §4.2's own five conditions.
#[tokio::test]
async fn a_hostile_path_is_404_and_never_the_spa_fallback() {
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("etc/passwd", "decoy"),
    ]);
    let store = Store::new(bundle.path());
    std::os::unix::fs::symlink("/etc/passwd", store.bundle_dir(1).join("leak")).unwrap();

    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "/../../etc/passwd",
        "/%2e%2e%2fetc%2fpasswd",
        "/%252e%252e%2fetc%2fpasswd",
        "/index%00",
        "/leak",
    ] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        let body = body_string(response).await;
        assert_eq!(body, "", "{path} must have an empty body");
        assert!(!body.contains("root:"), "{path} read the real /etc/passwd");
    }
}

/// `HEAD` is §4.2 condition 2's other admitted method, and it answers with the
/// headers its `GET` would carry.
#[tokio::test]
async fn head_is_admitted_and_carries_the_same_headers_as_get() {
    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("assets/app.a1b2c3.js", "//real"),
    ]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let head = request(
        &router,
        "HEAD",
        "/assets/app.a1b2c3.js",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(
        header_value(&head, CONTENT_TYPE),
        "text/javascript; charset=utf-8"
    );
    assert_eq!(header_value(&head, CACHE_CONTROL), "no-cache");
    assert_eq!(
        header_value(&head, HeaderName::from_static("x-content-type-options")),
        "nosniff"
    );
}

// §6.3's escape: the built-in UI at the reserved `/builtin/` prefix, and the
// control that deactivates a custom UI.

/// The prefix, spelled out here rather than imported, so that changing the
/// spelling in `routes.rs` fails these tests instead of silently moving with
/// them.
const ESCAPE: &str = "/builtin/";
const ESCAPE_BARE: &str = "/builtin";
const ESCAPE_DEACTIVATE: &str = "/builtin/deactivate";

/// A marker that only the built-in `pane()` shell emits: the navigation entry
/// added for §6.3's discoverability. A bundle cannot produce it by accident,
/// and none of the bundles below contains it.
const BUILT_IN_PANE: &str = ">Built-in UI<";

/// A marker that only §6.3's escape control emits.
const ESCAPE_CONTROL: &str = "action=\"/builtin/deactivate\"";

/// A **link** to the escape. Deliberately not the bare path: the subtree's own
/// 404 echoes the path that was asked for, so `contains("/builtin/")` would be
/// satisfied by the request rather than by the page naming the way back.
const ESCAPE_LINK: &str = "href=\"/builtin/\"";

/// The asset router with **§6.3's reserved prefix deleted**, and nothing else.
///
/// This is the guard fired, and it is kept as a standing test the way
/// `asset_router_without_the_api_reservation` is. axum consults a fallback
/// exactly when no declared route matched, so removing the declaration is what
/// puts the asset service in front of `/builtin/...`: "the asset service
/// mounted ahead of the declared routes" and "the declaration removed" are the
/// same observable in this router, and the second is the one it can express.
fn asset_router_without_the_builtin_reservation(bundle_root: &Path) -> Router {
    let fake = Arc::new(FakeSettings::new(configured_tree("hunter2secret")));
    let state = AppState::new(fake, SIGNING_KEY).with_bundle_root(bundle_root);
    Router::new().fallback(serve::fallback).with_state(state)
}

/// A bundle whose files would occupy §6.3's prefix if anything let them.
fn bundle_shadowing_the_prefix() -> TempDir {
    install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("decoy.txt", "the bundle is reachable"),
        ("builtin/index.html", PREFIX_PANE_BYTES),
        ("builtin/assets/app.js", PREFIX_ASSET_BYTES),
    ])
}

const PREFIX_PANE_BYTES: &str = "BUNDLE-SHADOWS-BUILTIN-PANE";
const PREFIX_ASSET_BYTES: &str = "BUNDLE-SHADOWS-BUILTIN-ASSET";

/// §6.3 candidate (A): a bundle that **actually contains** files at and under
/// the reserved prefix cannot serve one of them.
///
/// Built the way `a_bundle_cannot_shadow_the_reserved_api_subtree` is, and for
/// the same reason: a test that asks for `/builtin/` and asserts "built-in"
/// proves nothing unless the bundle really shipped something there and the
/// bundle is really being served. `installed_files` establishes the first and
/// `/decoy.txt` establishes the second.
#[tokio::test]
async fn a_bundle_cannot_shadow_the_reserved_builtin_prefix() {
    let bundle = bundle_shadowing_the_prefix();

    // The files are in the installed tree, not merely in the staged one.
    let listed = installed_files(bundle.path());
    for name in ["builtin/index.html", "builtin/assets/app.js"] {
        assert!(
            listed.contains(&name.to_string()),
            "the installed bundle must actually contain {name}: {listed:?}"
        );
    }

    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    // The bundle is reachable through this very router, so nothing below can
    // be explained by the bundle not being served at all.
    let response = request(&router, "GET", "/decoy.txt", Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "the bundle is reachable");

    for (path, expected) in [
        (ESCAPE_BARE, StatusCode::OK),
        (ESCAPE, StatusCode::OK),
        ("/builtin/index.html", StatusCode::NOT_FOUND),
        ("/builtin/assets/app.js", StatusCode::NOT_FOUND),
    ] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        let status = response.status();
        let body = body_string(response).await;

        // Asserted first, and on the body rather than on the status, so that
        // deleting the reservation fails this test **with the bundle's own
        // bytes printed** rather than with a bare `200 != 404`.
        for shadow in [PREFIX_PANE_BYTES, PREFIX_ASSET_BYTES] {
            assert!(
                !body.contains(shadow),
                "{path}: the reserved prefix answered with the bundle's own bytes: {body}"
            );
        }
        assert!(
            !body.contains("<title>custom"),
            "{path}: the reserved prefix answered with the bundle's index: {body}"
        );
        // The binary's own copy answered: this markup exists only in
        // `routes.rs`.
        assert!(
            body.contains(BUILT_IN_PANE) || body.contains(ESCAPE_LINK),
            "{path}: the answer is not the binary's own page: {body}"
        );
        assert_eq!(status, expected, "{path}");
    }

    // And the pane the operator is sent to carries the control that performs
    // §6.3 candidate (B).
    for path in [ESCAPE_BARE, ESCAPE] {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        let body = body_string(response).await;
        assert!(
            body.contains(ESCAPE_CONTROL),
            "{path}: (A) without (B) is a way in and not a way out: {body}"
        );
        assert!(
            body.contains("Network state"),
            "{path}: the status pane moved here, unconditionally: {body}"
        );
    }
}

/// The other direction of the same guard, kept standing: with §6.3's
/// declaration removed the very same bundle answers at the escape's own paths.
///
/// Without this the test above would pass against a router that reserved
/// nothing and simply had no bundle.
#[tokio::test]
async fn without_the_reservation_the_bundle_does_shadow_the_builtin_prefix() {
    let bundle = bundle_shadowing_the_prefix();
    let unreserved = asset_router_without_the_builtin_reservation(bundle.path());

    for (path, bytes) in [
        ("/builtin/index.html", PREFIX_PANE_BYTES),
        ("/builtin/assets/app.js", PREFIX_ASSET_BYTES),
    ] {
        let response = request(&unreserved, "GET", path, None, None).await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{path}: without the reservation the asset router answers under the prefix"
        );
        assert_eq!(
            body_string(response).await,
            bytes,
            "{path}: and it answers with the bundle's own bytes, which is the \
             failure the reservation prevents"
        );
    }

    // The escape's own URL, answered by the bundle through §4.2's SPA
    // fallback: an operator following the one documented action would land on
    // the very UI that is broken, with no control to escape it.
    let response = request(&unreserved, "GET", ESCAPE, None, Some(BROWSER_ACCEPT)).await;
    assert_eq!(response.status(), StatusCode::OK, "{ESCAPE}");
    let body = body_string(response).await;
    assert!(
        body.contains("<title>custom"),
        "{ESCAPE}: without the reservation this is the bundle's index: {body}"
    );
    assert!(
        !body.contains(ESCAPE_CONTROL),
        "{ESCAPE}: and it carries no escape control: {body}"
    );
}

/// The status pane's one wall-clock-dependent line, elided so two renderings
/// taken a second apart compare byte for byte.
///
/// The elision is asserted to have fired, so it cannot quietly mask a pane
/// that failed to render the line at all.
fn without_the_uptime_line(body: &str, context: &str) -> String {
    let start = body
        .find("<p>Uptime: ")
        .unwrap_or_else(|| panic!("{context}: the status pane must render an uptime line: {body}"));
    let end = body[start..]
        .find("</p>")
        .map(|offset| start + offset + "</p>".len())
        .unwrap_or_else(|| panic!("{context}: unterminated uptime line: {body}"));
    format!("{}<p>UPTIME</p>{}", &body[..start], &body[end..])
}

/// One bundle-store state, carried by the name the diff will report.
struct StoreState {
    name: &'static str,
    /// Held for the lifetime of the test; the root may point inside it or not
    /// exist at all.
    _dir: TempDir,
    root: std::path::PathBuf,
}

/// Bundle-store states that differ in every way §6.1 distinguishes, named by
/// identity.
///
/// This is deliberately not an enumeration of §6.1's five classes as
/// behaviours — that suite is `broken_classes`. It is the input set for the property
/// §6.3 actually argues from: *"the built-in handlers do not read `/srv/ui` at
/// all, so no bundle state ... can affect them."*
fn bundle_store_states() -> Vec<StoreState> {
    let mut states = Vec::new();

    let dir = TempDir::new().unwrap();
    let root = dir.path().join("no-store-here");
    states.push(StoreState {
        name: "no store directory at all",
        _dir: dir,
        root,
    });

    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("blocker"), b"not a directory").unwrap();
    let root = dir.path().join("blocker").join("ui");
    states.push(StoreState {
        name: "store root unreachable: its parent is a regular file",
        _dir: dir,
        root,
    });

    let dir = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("assets/app.a1b2c3.js", "//real"),
    ]);
    let root = dir.path().to_path_buf();
    states.push(StoreState {
        name: "a healthy bundle active",
        _dir: dir,
        root,
    });

    let dir = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("assets/app.a1b2c3.js", "//real"),
    ]);
    let installed = Store::new(dir.path()).bundle_dir(1);
    std::fs::remove_file(installed.join("index.html")).unwrap();
    std::os::unix::fs::symlink("assets/app.a1b2c3.js", installed.join("index.html")).unwrap();
    let root = dir.path().to_path_buf();
    states.push(StoreState {
        name: "active bundle whose index is a symlink, not a regular file",
        _dir: dir,
        root,
    });

    let dir = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        (
            "mos-ui.json",
            r#"{"name":"ui","version":"1","immutableDir":"assets","apiVersions":["v1"]}"#,
        ),
    ]);
    std::fs::write(
        Store::new(dir.path()).bundle_dir(1).join("mos-ui.json"),
        b"{ this is not json",
    )
    .unwrap();
    let root = dir.path().to_path_buf();
    states.push(StoreState {
        name: "active bundle whose manifest was corrupted after install",
        _dir: dir,
        root,
    });

    let dir = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let store = Store::new(dir.path());
    std::fs::remove_file(store.current_link()).unwrap();
    std::os::unix::fs::symlink("/nonexistent/elsewhere", store.current_link()).unwrap();
    let root = dir.path().to_path_buf();
    states.push(StoreState {
        name: "current repointed outside the store",
        _dir: dir,
        root,
    });

    states
}

/// §6.3's property, asserted directly: the escape's answer does not depend on
/// bundle state, because the handlers behind it never read the bundle store.
///
/// Every state in `bundle_store_states` produces the **same page** at the
/// reserved prefix. The control that makes that meaningful is the second half:
/// `/` — the one handler that *does* read the store — is asserted to disagree
/// across the very same states, so the equality above is a property of the
/// escape and not of the states being indistinguishable.
#[tokio::test]
async fn the_escape_answers_identically_whatever_the_bundle_store_holds() {
    let states = bundle_store_states();
    let mut escape_pages: Vec<(&'static str, String)> = Vec::new();
    let mut roots: Vec<(&'static str, String)> = Vec::new();

    for state in &states {
        let router = test_app_serving(configured_tree("hunter2secret"), &state.root);
        let cookie = login(&router, "hunter2secret").await;

        let response = request(&router, "GET", ESCAPE, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::OK, "{}", state.name);
        let body = body_string(response).await;
        assert!(
            body.contains(ESCAPE_CONTROL),
            "{}: the escape must carry its control: {body}",
            state.name
        );
        escape_pages.push((state.name, without_the_uptime_line(&body, state.name)));

        let response = request(&router, "GET", "/", Some(&cookie), Some(BROWSER_ACCEPT)).await;
        roots.push((state.name, body_string(response).await));
    }

    // Every escape page equals the first, named by identity when one does not.
    let (first_name, first) = &escape_pages[0];
    let differing: Vec<&str> = escape_pages
        .iter()
        .skip(1)
        .filter(|(_, page)| page != first)
        .map(|(name, _)| *name)
        .collect();
    assert!(
        differing.is_empty(),
        "the escape must not depend on bundle state, but these differ from \
         '{first_name}': {differing:?}"
    );

    // The control: `/` reads the store, so it must **not** be identical across
    // the same states. Otherwise the states are not actually different and the
    // assertion above is vacuous.
    let serving_the_bundle: Vec<&str> = roots
        .iter()
        .filter(|(_, body)| body.contains("<title>custom"))
        .map(|(name, _)| *name)
        .collect();
    // Named by identity, not counted. A corrupted `mos-ui.json` is in this set
    // on purpose: §4.3's immutable cache class is opt-in, so an unparseable
    // manifest costs the bundle that class and nothing else — the index is
    // still a readable regular file and `/` still serves it.
    assert_eq!(
        serving_the_bundle,
        vec![
            "a healthy bundle active",
            "active bundle whose manifest was corrupted after install",
        ],
        "exactly the states whose index is a readable regular file may reach \
         the bundle at `/`; if this set were empty the states above would be \
         indistinguishable and the equality assertion would prove nothing"
    );
}

/// §6.3 candidate (B), performed from the pane (A) makes reachable: one POST
/// deactivates, `/` reverts, and a second POST is the same success.
#[tokio::test]
async fn the_escape_control_deactivates_the_custom_ui_and_the_root_reverts() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let store = Store::new(bundle.path());
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    assert_eq!(store.active_generation().unwrap(), Some(1));
    let response = request(&router, "GET", "/", Some(&cookie), Some(BROWSER_ACCEPT)).await;
    assert!(body_string(response).await.contains("<title>custom"));

    let response = post_form(&router, ESCAPE_DEACTIVATE, "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        body.contains("has been deactivated"),
        "the pane must say what happened: {body}"
    );

    // §5.3's operation really ran: the pointer is gone, which is what survives
    // a reboot.
    assert_eq!(
        store.active_generation().unwrap(),
        None,
        "`current` must be gone"
    );
    assert!(
        store.bundle_dir(1).is_dir(),
        "the bundle's files stay on disk; deactivate is not delete"
    );

    // And `/` is the built-in UI again, with no restart.
    let response = request(&router, "GET", "/", Some(&cookie), Some(BROWSER_ACCEPT)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body_string(response).await.contains("Network state"));

    // A second click is the same success and says so: §6.3's outcome must not
    // depend on what was wrong, and "nothing was active" is not an error.
    let response = post_form(&router, ESCAPE_DEACTIVATE, "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        body_string(response)
            .await
            .contains("No custom UI was active"),
        "an idempotent second deactivate must not read as a failure"
    );
}

/// The escape is a state change, so it is POST-only — the same decision the
/// power and SSH mutations in this crate already made.
#[tokio::test]
async fn get_on_the_escape_control_is_not_routed_and_leaves_the_bundle_active() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let store = Store::new(bundle.path());
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, ESCAPE_DEACTIVATE, Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(
        store.active_generation().unwrap(),
        Some(1),
        "an authenticated GET must not deactivate"
    );

    // Anonymous never gets past the gate at all.
    let response = get(&router, ESCAPE_DEACTIVATE, None).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");

    let response = post_form(&router, ESCAPE_DEACTIVATE, "", None).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");
    assert_eq!(
        store.active_generation().unwrap(),
        Some(1),
        "an anonymous POST must not deactivate"
    );
}

/// Which built-in panes an operator reaches while a bundle that ships a file
/// at every one of their names is active — **by identity**, both directions.
#[tokio::test]
async fn the_built_in_panes_reachable_beside_an_active_bundle_are_named() {
    // Declared by identity. `/builtin/` is the Status pane, moved there by
    // §6.3; the other four were already declared routes and so were already
    // unshadowable — §6.3 asks for exactly one *unconditional* path to the
    // built-in UI and this is the set it produces.
    let expected = ["/builtin/", "/hostname", "/network", "/power", "/ssh"];

    // Probed: the expected set plus paths that must **not** answer from the
    // binary, so an over-wide reservation shows up as an unexpected member.
    let probed = [
        "/builtin/",
        "/hostname",
        "/network",
        "/power",
        "/ssh",
        "/",
        "/builtin/index.html",
        "/decoy.txt",
    ];

    let bundle = install_bundle(&[
        ("index.html", "<!doctype html><title>custom</title>"),
        ("decoy.txt", "the bundle is reachable"),
        ("builtin/index.html", PREFIX_PANE_BYTES),
        ("hostname", "BUNDLE-SHADOWS-HOSTNAME"),
        ("network", "BUNDLE-SHADOWS-NETWORK"),
        ("power", "BUNDLE-SHADOWS-POWER"),
        ("ssh", "BUNDLE-SHADOWS-SSH"),
    ]);
    let listed = installed_files(bundle.path());
    for name in ["hostname", "network", "power", "ssh", "builtin/index.html"] {
        assert!(
            listed.contains(&name.to_string()),
            "the installed bundle must actually contain {name}: {listed:?}"
        );
    }

    // The full settings tree and the published `sshd` state, so that every
    // pane in the expected set really renders: a pane that 503s for want of a
    // fixture would drop out of the observed set and read as a routing result.
    let fake = Arc::new(FakeSettings::new(ssh_tree(json!([]))));
    fake.set_state_entry("sshd", sshd_state(false, false, false));
    let router = app(AppState::new(fake, SIGNING_KEY).with_bundle_root(bundle.path()));
    let cookie = login(&router, "hunter2secret").await;

    let mut observed = Vec::new();
    for path in probed {
        let response = request(&router, "GET", path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        if body_string(response).await.contains(BUILT_IN_PANE) {
            observed.push(path);
        }
    }
    observed.sort_unstable();

    let missing: Vec<&str> = expected
        .iter()
        .filter(|path| !observed.contains(path))
        .copied()
        .collect();
    let unexpected: Vec<&str> = observed
        .iter()
        .filter(|path| !expected.contains(path))
        .copied()
        .collect();
    assert!(
        missing.is_empty() && unexpected.is_empty(),
        "built-in panes reachable beside an active bundle: missing {missing:?}, \
         unexpected {unexpected:?}"
    );
}

/// §6.3's stated cost — *"(A) only helps an operator who knows the URL"* —
/// closed on the built-in surfaces that lead to it, named by identity.
///
/// The mosd-unavailable page §6.3 cites is not among them: it is reached only
/// when a mosd call fails, which a broken bundle does not cause.
#[tokio::test]
async fn the_escape_path_is_named_on_the_surfaces_that_lead_to_it() {
    let bundle = bundle_shadowing_the_prefix();
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let surfaces: [(&str, Option<&str>); 3] = [
        // What an operator with a broken custom UI sees first when logged out.
        ("/login", None),
        // The navigation on every built-in pane, for one already logged in.
        ("/network", Some(&cookie)),
        // The reserved subtree's own 404 — a mistyped path under the prefix.
        ("/builtin/index.html", Some(&cookie)),
    ];

    let mut silent = Vec::new();
    for (path, cookie) in surfaces {
        let response = request(&router, "GET", path, cookie, Some(BROWSER_ACCEPT)).await;
        if !body_string(response).await.contains(ESCAPE_LINK) {
            silent.push(path);
        }
    }
    assert!(
        silent.is_empty(),
        "these built-in surfaces must link {ESCAPE}, and do not: {silent:?}"
    );
}

// access.md §6: the audit trail and the persisted backoff counter, observed
// through the router — the same surface an attacker and an operator use

/// The router with the guard counters and the audit ring persisted under
/// `dir`, which is what production gets from `main.rs`.
fn persistent_app(tree: serde_json::Value, dir: &Path) -> Router {
    let fake = Arc::new(FakeSettings::new(tree));
    app(AppState::new(fake, SIGNING_KEY).with_persistence(dir))
}

/// Every line of the audit log under `dir`, parsed, oldest first.
fn audit_lines(dir: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join("audit.log"))
        .expect("the audit log exists")
        .lines()
        .map(|line| serde_json::from_str(line).expect("every audit line parses as JSON"))
        .collect()
}

/// The `(event, outcome)` pairs of `lines`, for order-sensitive assertions.
fn audit_events(lines: &[serde_json::Value]) -> Vec<(String, String)> {
    lines
        .iter()
        .map(|line| {
            (
                line["event"].as_str().expect("event").to_string(),
                line["outcome"].as_str().expect("outcome").to_string(),
            )
        })
        .collect()
}

/// §6's login trail: success, logout and failed logins all leave lines — and
/// none of those lines carries password material, which is asserted against
/// the raw bytes rather than the parsed fields so a secret hiding in an
/// unexpected field would still fail the test.
///
/// A failed login answers 401 or 429 depending on the login guard's clock,
/// not only on this test's ordering: `LoginGuard::begin_attempt` charges the
/// attempt at admission and `confirm_failure` re-arms a real-time window
/// (`BACKOFF_BASE`, one second) from the outcome, so a run descheduled across
/// that window sees the second wrong attempt admitted (401) where an
/// unloaded run sees it refused (429). The curve itself has its own tests in
/// `auth.rs`; this test is about the audit trail, so it accepts either
/// status and asserts the audit line matches the status actually answered.
#[tokio::test]
async fn the_audit_trail_records_the_login_lifecycle_and_never_the_password() {
    let dir = TempDir::new().unwrap();
    let router = persistent_app(configured_tree("hunter2secret"), dir.path());

    let cookie = login(&router, "hunter2secret").await;
    assert_eq!(
        post_form(&router, "/logout", "", Some(&cookie))
            .await
            .status(),
        StatusCode::SEE_OTHER
    );
    let mut expected = vec![
        ("login".to_string(), "success".to_string()),
        ("logout".to_string(), "ok".to_string()),
    ];
    for _ in 0..2 {
        let wrong = post_form(&router, "/login", "password=not-the-password", None).await;
        let outcome = match wrong.status() {
            StatusCode::UNAUTHORIZED => "wrong-password",
            StatusCode::TOO_MANY_REQUESTS => "throttled",
            other => panic!("a wrong login must answer 401 or 429, not {other}"),
        };
        expected.push(("login".to_string(), outcome.to_string()));
    }

    let lines = audit_lines(dir.path());
    assert_eq!(audit_events(&lines), expected);
    // `oneshot` drives the router with no connection, so the ConnectInfo
    // extension is absent — and that must degrade to a marker, never to a
    // rejected login (audit wiring must not be what makes a login fail).
    for line in &lines {
        assert_eq!(line["source"], "unknown");
    }
    let raw = std::fs::read_to_string(dir.path().join("audit.log")).unwrap();
    for secret in [
        "hunter2secret",
        "not-the-password",
        "password_hash",
        "argon2",
    ] {
        assert!(
            !raw.contains(secret),
            "the audit log contains credential material: {secret}"
        );
    }
}

/// The other §6 events: setup completion, a transient root password, a power
/// action, and the custom-UI escape. One session drives all four, and the
/// transient password never reaches the file.
#[tokio::test]
async fn the_audit_trail_records_setup_transient_password_power_and_the_escape() {
    let dir = TempDir::new().unwrap();
    let bundles = TempDir::new().unwrap();
    let fake = Arc::new(FakeSettings::new(unconfigured_tree()));
    let router = app(AppState::new(fake, SIGNING_KEY)
        .with_persistence(dir.path())
        .with_bundle_root(bundles.path()));

    let setup = post_form(
        &router,
        "/setup",
        "password=first-boot-pw&confirm=first-boot-pw",
        None,
    )
    .await;
    assert_eq!(setup.status(), StatusCode::SEE_OTHER);
    let cookie = session_cookie_value(&setup);

    let transient = post_form(
        &router,
        "/ssh/password",
        "password=one-session-pw&confirm=set-transient-password",
        Some(&cookie),
    )
    .await;
    assert_eq!(transient.status(), StatusCode::SEE_OTHER);
    let reboot = post_form(&router, "/power/reboot", "confirm=reboot", Some(&cookie)).await;
    assert_eq!(reboot.status(), StatusCode::ACCEPTED);
    let escape = post_form(&router, "/builtin/deactivate", "", Some(&cookie)).await;
    assert_eq!(escape.status(), StatusCode::OK);

    let lines = audit_lines(dir.path());
    assert_eq!(
        audit_events(&lines),
        [
            ("setup".to_string(), "completed".to_string()),
            ("transient-password".to_string(), "set".to_string()),
            // Recorded BEFORE the D-Bus dispatch: for a power action the line
            // written after the call is the line that may never hit the disk.
            ("reboot".to_string(), "requested".to_string()),
            // Nothing was active, and the trail says so rather than claiming
            // a custom UI stopped being served.
            ("custom-ui".to_string(), "no-op".to_string()),
        ]
    );
    let raw = std::fs::read_to_string(dir.path().join("audit.log")).unwrap();
    for secret in ["first-boot-pw", "one-session-pw"] {
        assert!(
            !raw.contains(secret),
            "the audit log contains a password: {secret}"
        );
    }
}

/// §6's actual requirement, end to end: the armed window survives a daemon
/// restart. A wrong password through the first router persists the counter;
/// a second router built over the same STATE directory refuses the CORRECT
/// password inside the armed window — the classic pull-the-power bypass,
/// closed at the HTTP surface.
///
/// The deadline is widened in the file between the two halves, deliberately:
/// a first failure arms only a one-second window, and a debug-build argon2
/// verification alone can outlast that, so a test racing the real deadline
/// is a test of the machine's load. Widening stands in for the longer window
/// a longer failure run would have earned, and it keeps both halves honest —
/// the write path is proven by reading back what the 401 persisted, the read
/// path by the second router honouring what the file says.
#[tokio::test]
async fn the_backoff_window_survives_a_restart_at_the_http_surface() {
    let dir = TempDir::new().unwrap();
    // Hash once, share: each `configured_tree` call costs a full argon2 hash.
    let tree = configured_tree("hunter2secret");

    let before = persistent_app(tree.clone(), dir.path());
    let wrong = post_form(&before, "/login", "password=not-the-password", None).await;
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    drop(before);

    // The failure was persisted by the request itself, not by any shutdown
    // hook — there is none to rely on when the power is pulled.
    let path = dir.path().join("login_guard.json");
    let mut persisted: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert!(persisted["failures"].as_u64().unwrap() >= 1);
    assert!(persisted["locked_until_unix"].as_u64().unwrap() > 0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    persisted["locked_until_unix"] = serde_json::json!(now + 60);
    std::fs::write(&path, persisted.to_string()).unwrap();

    let after = persistent_app(tree, dir.path());
    let refused = post_form(&after, "/login", "password=hunter2secret", None).await;
    assert_eq!(
        refused.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a restart admitted an attempt the armed window had refused"
    );
    // And the refusal itself is on the trail.
    assert_eq!(
        audit_events(&audit_lines(dir.path())).last().unwrap(),
        &("login".to_string(), "throttled".to_string())
    );
}

// The container pane

/// A settings tree with the container subtree, authenticated as `ssh_tree`.
fn container_tree(enabled: bool) -> serde_json::Value {
    let hash = auth::hash_password("hunter2secret").unwrap();
    json!({
        "hostname": "mos",
        "network": {},
        "access": { "webAdmin": { "password_hash": hash } },
        "container": { "enabled": enabled },
    })
}

#[tokio::test]
async fn the_container_pane_states_the_root_consequence_not_a_generic_warning() {
    let (router, _fake) = test_app(container_tree(false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/containers", Some(&cookie)).await).await;

    // The pane must state the specific consequence. Each clause is asserted
    // separately: a page that said only "runs as root" would pass a check for
    // the word "root" while leaving out what an operator needs to act on --
    // that writing a file into the Quadlet directory is what exercises it.
    assert!(
        body.contains("run as root"),
        "the pane must say containers run as root: {body}"
    );
    assert!(
        body.contains("Rootless mode is not built"),
        "the pane must say WHY there is no confinement, or an operator may assume a user namespace: {body}"
    );
    assert!(
        body.contains(".container file"),
        "the pane must name the act that grants the capability: {body}"
    );
}

#[tokio::test]
async fn enabling_containers_writes_the_switch() {
    let (router, fake) = test_app(container_tree(false));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(&router, "/containers/enable", "enabled=on", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/containers?saved=1");
    assert_eq!(fake.set_paths(), vec!["container.enabled"]);
}

#[tokio::test]
async fn an_unticked_box_disables_rather_than_doing_nothing() {
    // A checkbox absent from the form body is how HTML says "off". Reading it
    // as "no change" would make the switch impossible to turn back off through
    // the pane, and the failure is silent: the page redirects and reports
    // "Settings saved."
    let (router, fake) = test_app(container_tree(true));
    let cookie = login(&router, "hunter2secret").await;

    post_form(&router, "/containers/enable", "", Some(&cookie)).await;
    assert_eq!(fake.set_paths(), vec!["container.enabled"]);
    // The VALUE, not just that a write happened: a handler that wrote `true`
    // unconditionally would record the same path and pass a path-only check.
    assert_eq!(
        fake.get_settings("container.enabled").await.unwrap(),
        json!(false),
        "an unticked checkbox must write false, not leave the setting alone"
    );
}

#[tokio::test]
async fn the_pane_does_not_list_quadlet_files_while_containers_are_off() {
    // With the bind down, `/etc/containers/systemd` is the image's empty
    // directory. Listing what is on persistent storage would show the operator
    // files the generator cannot see, which reads as "these are running".
    let (router, _fake) = test_app(container_tree(false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/containers", Some(&cookie)).await).await;
    assert!(
        body.contains("Not listed while containers are disabled"),
        "the pane must explain the empty list rather than showing one: {body}"
    );
}

// The MQTT pane

/// A settings tree with the mqtt subtree, authenticated as `ssh_tree`.
fn mqtt_tree(enabled: bool) -> serde_json::Value {
    let hash = auth::hash_password("hunter2secret").unwrap();
    json!({
        "hostname": "mos",
        "network": {},
        "access": { "webAdmin": { "password_hash": hash } },
        "mqtt": {
            "enabled": enabled,
            "listen": { "address": "127.0.0.1", "port": 1883 },
            "auth": { "enabled": false },
        },
    })
}

/// The live-state subtree mosd's mqtt reconciler publishes, copied **verbatim**
/// from the reconciler's own expectation of it.
///
/// Source: `mosd/mosd/src/reconciler/mqtt.rs`, test
/// `live_state_names_both_units_and_the_config_path` -- its assertions on
/// `configPath`, `listen.address`, `listen.port`, `auth.enabled` and `units`,
/// for `settings(true, "127.0.0.1", 1883, false)`. The exact key set is pinned
/// separately there by `the_published_shape_is_the_contract_with_the_apid_pane`,
/// which names this file as the consumer.
///
/// Copy it; do not adjust it. A fixture written here to match what the pane
/// reads is a test of the pane against itself: it cannot detect that it
/// disagrees with the producer, so both crates stay green while the pane
/// renders "unknown" for every value and the open-listener warning cannot fire
/// at all. This is still a second copy in a second crate -- apid and mosd talk
/// over a bus and share no type -- but a named source makes the copy
/// auditable.
///
/// One field is necessarily not verbatim: `configPath` is the reconciler's own
/// `config_path`, which is a `tempfile` directory in that test, so the
/// production default (`DEFAULT_CONFIG_PATH`, same file) stands in for it.
const MQTT_PUBLISHED_STATE: &str = r#"{
    "enabled": true,
    "listen": { "address": "127.0.0.1", "port": 1883 },
    "auth": { "enabled": false },
    "configPath": "/run/mos/mqtt-broker.toml",
    "units": [
        {
            "unit": "mos-mqtt-broker.service",
            "activeState": "active",
            "unitFileState": "enabled-runtime"
        },
        {
            "unit": "mos-mqttd.service",
            "activeState": "active",
            "unitFileState": "enabled-runtime"
        }
    ]
}"#;

/// The published state with both units in the state a working switch produces.
///
/// The *structure* always comes from [`MQTT_PUBLISHED_STATE`]; only values are
/// substituted, so no test here can quietly reintroduce a shape the reconciler
/// does not publish. Both units follow the switch, because one switch drives
/// both halves.
fn mqtt_state(enabled: bool, address: &str, port: u64, auth_enabled: bool) -> serde_json::Value {
    let active_state = if enabled { "active" } else { "inactive" };
    mqtt_state_with_units(
        enabled,
        address,
        port,
        auth_enabled,
        active_state,
        active_state,
    )
}

/// The same, with the broker unit's `activeState` chosen explicitly -- which
/// is the only way to describe a broker that took the settings and then
/// exited.
fn mqtt_state_with_unit(
    enabled: bool,
    address: &str,
    port: u64,
    auth_enabled: bool,
    active_state: &str,
) -> serde_json::Value {
    let bridge = if enabled { "active" } else { "inactive" };
    mqtt_state_with_units(enabled, address, port, auth_enabled, active_state, bridge)
}

/// The same with both units' `activeState` chosen, each written into the entry
/// that carries its own name.
///
/// Selecting the entry rather than indexing it is the point: the pane does the
/// same, so a fixture that reordered `units` would still describe the units it
/// means to describe.
fn mqtt_state_with_units(
    enabled: bool,
    address: &str,
    port: u64,
    auth_enabled: bool,
    broker_state: &str,
    bridge_state: &str,
) -> serde_json::Value {
    let mut state: serde_json::Value =
        serde_json::from_str(MQTT_PUBLISHED_STATE).expect("the golden published state parses");
    state["enabled"] = json!(enabled);
    state["listen"]["address"] = json!(address);
    state["listen"]["port"] = json!(port);
    state["auth"]["enabled"] = json!(auth_enabled);
    set_unit_state(&mut state, "mos-mqtt-broker.service", broker_state);
    set_unit_state(&mut state, "mos-mqttd.service", bridge_state);
    state
}

/// Write one `units` entry's `activeState`, found by its `unit` field.
fn set_unit_state(state: &mut serde_json::Value, unit: &str, active_state: &str) {
    let entry = state["units"]
        .as_array_mut()
        .expect("the golden `units` is an array")
        .iter_mut()
        .find(|entry| entry["unit"] == json!(unit))
        .unwrap_or_else(|| panic!("the golden state publishes no unit named {unit}"));
    entry["activeState"] = json!(active_state);
}

#[tokio::test]
async fn the_mqtt_pane_states_the_behaviour_change_not_a_generic_warning() {
    let (router, _fake) = test_app(mqtt_tree(false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    // The container pane's rule, applied here: state the consequence, not a
    // caution. Each clause separately, because a page that said only "MQTT is
    // disabled by default" would pass a check for the switch's name while
    // leaving out the thing an operator has to act on -- that a unit which was
    // running before the update is not running now.
    assert!(
        body.contains("stops the MQTT bridge"),
        "the pane must say the update stops a unit that was running: {body}"
    );
    assert!(
        body.contains("mos-mqttd"),
        "the pane must name the unit that stops, or the operator cannot look for it: {body}"
    );
    assert!(
        body.contains("only ever retried"),
        "the pane must say why nothing that worked has broken: {body}"
    );
}

#[tokio::test]
async fn the_mqtt_pane_says_the_switch_drives_both_halves() {
    // The switch is not "enable the broker". A pane that named only one of the
    // two would leave an operator turning MQTT off and expecting the bridge to
    // carry on reaching some other broker.
    let (router, _fake) = test_app(mqtt_tree(true));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(body.contains("MQTT: <b>enabled</b>"), "{body}");
    assert!(body.contains("mos-mqtt-broker.service"), "{body}");
    assert!(body.contains("mos-mqttd.service"), "{body}");
    assert!(
        body.contains("Turning it off stops both"),
        "the pane must say the switch stops both halves: {body}"
    );
}

#[tokio::test]
async fn the_mqtt_pane_says_listen_and_auth_are_not_validated_by_the_switch() {
    // D2: `listen` and `auth` are a separate configuration and the switch
    // validates neither. That was a decision, and the pane is the only place
    // an operator meets the switch -- so it is where the decision is stated,
    // or they will assume the switch checked something for them.
    let (router, _fake) = test_app(mqtt_tree(true));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(
        body.contains("configured separately from this switch"),
        "the pane must say the listener is configured elsewhere: {body}"
    );
    assert!(
        body.contains("this switch does not validate them"),
        "the pane must say the switch validates nothing: {body}"
    );
    assert!(
        body.contains("refuse to start"),
        "the pane must say nothing refuses to start on a listen/auth combination: {body}"
    );
}

#[tokio::test]
async fn the_mqtt_pane_renders_before_mosd_has_published_any_state() {
    // No `set_state_entry`, so `get_state("mqtt")` fails -- which is the state
    // of a device that has just booted. The pane has to render anyway: a 503
    // here would mean the switch cannot be turned on until something else has
    // already turned it on.
    for enabled in [false, true] {
        let (router, _fake) = test_app(mqtt_tree(enabled));
        let cookie = login(&router, "hunter2secret").await;
        let response = get(&router, "/mqtt", Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK, "enabled={enabled}");
        let body = body_string(response).await;
        assert!(
            body.contains("Live MQTT state unavailable"),
            "the missing state must be reported, not silently rendered as a listener: {body}"
        );
        // Unknown, not a made-up default: `127.0.0.1` on the page would be a
        // claim about a listener nobody has measured.
        assert!(
            body.contains("Listen address: <b>unknown</b>"),
            "an unpublished address must read as unknown: {body}"
        );
        assert!(
            body.contains("Listen port: <b>unknown</b>"),
            "an unpublished port must read as unknown: {body}"
        );
        assert!(
            body.contains("Authentication: <b>unknown</b>"),
            "unpublished auth must read as unknown, not as disabled: {body}"
        );
        // Same rule for the units: no published `units` array means no claim
        // about whether either half is running.
        assert!(
            body.contains("Broker unit: <b>unknown</b>"),
            "an unpublished broker unit must read as unknown, not as active: {body}"
        );
        assert!(
            body.contains("Bridge unit: <b>unknown</b>"),
            "an unpublished bridge unit must read as unknown: {body}"
        );
        // And the form is still there to submit.
        assert!(body.contains(r#"action="/mqtt/enable""#), "{body}");
    }
}

#[tokio::test]
async fn the_mqtt_pane_shows_the_published_listener_read_only() {
    // The reconciler's real published JSON, not a shape invented here -- see
    // [`MQTT_PUBLISHED_STATE`]. Every value below has to come out of the
    // nested tree it actually publishes; "unknown" anywhere means the pane is
    // reading a key nobody writes.
    let (router, fake) = test_app(mqtt_tree(true));
    fake.set_state_entry("mqtt", mqtt_state(true, "127.0.0.1", 1883, true));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(body.contains("Listen address: <b>127.0.0.1</b>"), "{body}");
    assert!(body.contains("Listen port: <b>1883</b>"), "{body}");
    assert!(body.contains("Authentication: <b>enabled</b>"), "{body}");
    assert!(
        !body.contains("unknown"),
        "nothing may read as unknown when the reconciler has published all of it: {body}"
    );
    // Both halves of the switch, from the `units` array.
    assert!(body.contains("Broker unit: <b>active</b>"), "{body}");
    assert!(body.contains("Bridge unit: <b>active</b>"), "{body}");
    assert!(
        body.contains("unit file enabled-runtime"),
        "the published `unitFileState` must reach the page too: {body}"
    );
    // Read-only: the only writable control on the pane is the switch.
    assert_eq!(
        body.matches("<form").count(),
        2,
        "the pane must carry the switch form and the nav logout form and nothing else -- \
         the listener is displayed, not edited: {body}"
    );
}

#[tokio::test]
async fn a_failed_bridge_is_named_on_the_pane_with_its_own_journal() {
    // The other half of the switch, which fails for its own reasons -- the
    // cloud endpoint it dials, not the listener. The published `units` array
    // carries a separate entry for it, so the pane can report it separately;
    // a page that only ever spoke about the broker would leave an operator
    // with MQTT "on", a healthy broker, and nothing carried anywhere.
    let (router, fake) = test_app(mqtt_tree(true));
    fake.set_state_entry(
        "mqtt",
        mqtt_state_with_units(true, "127.0.0.1", 1883, false, "active", "failed"),
    );
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(
        body.contains("Bridge unit: <b>failed</b>"),
        "the bridge's own state must be on the page: {body}"
    );
    assert!(
        body.contains("The bridge unit has failed"),
        "a failed bridge must be stated plainly: {body}"
    );
    assert!(
        body.contains("journalctl -u mos-mqttd"),
        "the pane must point at the bridge's journal, not the broker's: {body}"
    );
    // And it must not be reported as a broker failure: they are different
    // units with different journals, and sending an operator to the wrong one
    // is worse than sending them nowhere.
    assert!(
        body.contains("Broker unit: <b>active</b>"),
        "the healthy half must still read as healthy: {body}"
    );
    assert!(
        !body.contains("The broker unit has failed"),
        "a failed bridge must not be reported as a failed broker: {body}"
    );
}

#[tokio::test]
async fn a_unit_is_read_by_name_and_not_by_its_position() {
    // `units` is published broker-first today and nothing promises it stays
    // that way. Read by index, this reversal would still render two units,
    // both states would still be real states, and the page would report the
    // bridge under the broker's name with nothing failing anywhere.
    let mut state = mqtt_state_with_units(true, "127.0.0.1", 1883, false, "active", "failed");
    state["units"]
        .as_array_mut()
        .expect("`units` is an array")
        .reverse();

    let (router, fake) = test_app(mqtt_tree(true));
    fake.set_state_entry("mqtt", state);
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(
        body.contains("Broker unit: <b>active</b>"),
        "the broker is whichever entry is NAMED mos-mqtt-broker.service: {body}"
    );
    assert!(
        body.contains("Bridge unit: <b>failed</b>"),
        "the failed bridge must stay attached to its own name: {body}"
    );
}

#[tokio::test]
async fn enabling_mqtt_writes_the_master_switch_and_nothing_else() {
    let (router, fake) = test_app(mqtt_tree(false));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(&router, "/mqtt/enable", "enabled=on", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/mqtt?saved=1");
    // D1: the switch is a master switch and nothing else. A handler that also
    // wrote `mqtt.listen` or `mqtt.auth` -- to "make it safe" -- would be the
    // coupling D2 forbids, arriving through the save path instead of a gate.
    assert_eq!(fake.set_paths(), vec!["mqtt.enabled"]);
    assert_eq!(
        fake.get_settings("mqtt.enabled").await.unwrap(),
        json!(true)
    );
}

#[tokio::test]
async fn an_unticked_mqtt_box_disables_rather_than_doing_nothing() {
    // A checkbox absent from the form body is how HTML says "off". Reading it
    // as "no change" would make MQTT impossible to turn back off through the
    // pane, and the failure is silent: the page redirects and says "Settings
    // saved."
    let (router, fake) = test_app(mqtt_tree(true));
    let cookie = login(&router, "hunter2secret").await;

    post_form(&router, "/mqtt/enable", "", Some(&cookie)).await;
    assert_eq!(fake.set_paths(), vec!["mqtt.enabled"]);
    assert_eq!(
        fake.get_settings("mqtt.enabled").await.unwrap(),
        json!(false),
        "an unticked checkbox must write false, not leave the setting alone"
    );
}

#[tokio::test]
async fn an_open_mqtt_listener_is_warned_about_and_still_saves() {
    // The guard on D2. A broker bound off-host with authentication off is
    // worth saying out loud and is NOT worth refusing: an operator who widened
    // the bind made a decision, and a pane that answered it by declining to
    // save would be a pane whose reason for not saving cannot be read
    // anywhere. Both halves are asserted here, in one test, because it is the
    // combination that is the requirement -- a warning alone would pass a
    // check for the text while the save path had quietly grown a gate.
    let (router, fake) = test_app(mqtt_tree(true));
    fake.set_state_entry("mqtt", mqtt_state(true, "0.0.0.0", 1883, false));
    let cookie = login(&router, "hunter2secret").await;

    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;
    assert!(
        body.contains("accepts unauthenticated connections from the network"),
        "an off-host bind with auth off must be stated as what it lets a stranger do: {body}"
    );

    // ...and the form still submits, in exactly that state.
    let response = post_form(&router, "/mqtt/enable", "enabled=on", Some(&cookie)).await;
    assert_eq!(
        response.status(),
        StatusCode::SEE_OTHER,
        "the switch must save while the listener is open: {body}"
    );
    assert_eq!(location(&response), "/mqtt?saved=1");
    assert_eq!(fake.set_paths(), vec!["mqtt.enabled"]);
    assert_eq!(
        fake.get_settings("mqtt.enabled").await.unwrap(),
        json!(true),
        "an open listener must not turn the save into a no-op"
    );
}

#[tokio::test]
async fn the_mqtt_open_listener_warning_tracks_the_configuration_not_the_page() {
    // Three configurations that must NOT warn, so the warning means something
    // when it does appear. A pane that warned on everything would train an
    // operator to ignore it.
    let quiet = [
        // Loopback with auth off: the default, and unreachable from off-host.
        (true, "127.0.0.1", false),
        // Loopback v6, same reasoning -- the broker treats both as loopback.
        (true, "::1", false),
        // Off-host WITH auth: a deliberate, defended configuration.
        (true, "0.0.0.0", true),
    ];
    for (enabled, address, auth_enabled) in quiet {
        let (router, fake) = test_app(mqtt_tree(enabled));
        fake.set_state_entry("mqtt", mqtt_state(enabled, address, 1883, auth_enabled));
        let cookie = login(&router, "hunter2secret").await;
        let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;
        assert!(
            !body.contains("accepts unauthenticated connections"),
            "{address} with auth={auth_enabled} must not warn: {body}"
        );
    }

    // And with the switch off there is no listener to warn about: the broker
    // is not running, so an open bind in the last published state describes
    // something that has already stopped.
    let (router, fake) = test_app(mqtt_tree(false));
    fake.set_state_entry("mqtt", mqtt_state(false, "0.0.0.0", 1883, false));
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;
    assert!(
        !body.contains("accepts unauthenticated connections"),
        "a stopped broker must not be reported as accepting connections: {body}"
    );
}

#[tokio::test]
async fn a_failed_broker_is_named_on_the_pane_with_somewhere_to_look() {
    // The switch is on, so the pane would otherwise say "enabled" and stop.
    // That is the request, not the outcome: the broker took the settings, hit
    // a listen address it could not parse and exited. Nothing rejected the
    // value -- rejecting it would couple the master switch to the listener --
    // so the unit state is the only evidence there is, and the pane is where an operator
    // meets it.
    let (router, fake) = test_app(mqtt_tree(true));
    fake.set_state_entry(
        "mqtt",
        mqtt_state_with_unit(true, "localhost", 1883, false, "failed"),
    );
    let cookie = login(&router, "hunter2secret").await;
    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;

    assert!(
        body.contains("Broker unit: <b>failed</b>"),
        "the unit state must be on the page, not just the switch position: {body}"
    );
    assert!(
        body.contains("The broker unit has failed"),
        "a failed broker must be stated plainly: {body}"
    );
    assert!(
        body.contains("journalctl -u mos-mqtt-broker"),
        "the pane must say where the reason is, since it does not have the reason: {body}"
    );
    // And it must not claim to know why. The pane has a unit state, not the
    // journal; naming the listen address as the cause would be a diagnosis it
    // has not made, and would be wrong for every other way a broker can fail.
    assert!(
        !body.contains("is not an IP address"),
        "the pane must not guess at the cause of the failure: {body}"
    );
}

#[tokio::test]
async fn a_broker_that_is_running_is_not_reported_as_failed() {
    // So the failure notice means something when it appears.
    for (enabled, active_state) in [(true, "active"), (false, "inactive"), (true, "activating")] {
        let (router, fake) = test_app(mqtt_tree(enabled));
        fake.set_state_entry(
            "mqtt",
            mqtt_state_with_unit(enabled, "127.0.0.1", 1883, false, active_state),
        );
        let cookie = login(&router, "hunter2secret").await;
        let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;
        assert!(
            !body.contains("The broker unit has failed"),
            "a unit in {active_state} must not be reported as failed: {body}"
        );
        assert!(
            body.contains(&format!("Broker unit: <b>{active_state}</b>")),
            "the unit state must be reported as published: {body}"
        );
    }
}

#[tokio::test]
async fn a_listen_address_the_broker_cannot_use_does_not_stop_the_switch_saving() {
    // The same rule as the open-listener guard: apid does not validate the
    // listen address. `localhost` is exactly
    // the value that kills the broker -- it binds an interface and does not
    // resolve names -- and it must still be possible to save the switch while
    // it is set, in both directions. A pane that refused here, or greyed the
    // button out, would have made the master switch depend on `listen` being
    // valid through the UI instead of through a gate.
    let (router, fake) = test_app(mqtt_tree(false));
    fake.set_state_entry(
        "mqtt",
        mqtt_state_with_unit(false, "localhost", 1883, false, "failed"),
    );
    let cookie = login(&router, "hunter2secret").await;

    let body = body_string(get(&router, "/mqtt", Some(&cookie)).await).await;
    assert!(
        body.contains(r#"<button type="submit">Save</button>"#),
        "the Save button must be present and not disabled on any listen value: {body}"
    );

    let response = post_form(&router, "/mqtt/enable", "enabled=on", Some(&cookie)).await;
    assert_eq!(
        response.status(),
        StatusCode::SEE_OTHER,
        "the switch must save while the listen address is one the broker cannot use"
    );
    assert_eq!(location(&response), "/mqtt?saved=1");
    assert_eq!(fake.set_paths(), vec!["mqtt.enabled"]);
    assert_eq!(
        fake.get_settings("mqtt.enabled").await.unwrap(),
        json!(true)
    );
    // And nothing rewrote the address to something the broker would accept:
    // repairing it here would be the same coupling arriving as a courtesy.
    assert_eq!(
        fake.get_settings("mqtt.listen.address").await.unwrap(),
        json!("127.0.0.1"),
        "saving the switch must not touch the listener at all"
    );

    // Off again, with the same broken address.
    let response = post_form(&router, "/mqtt/enable", "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("mqtt.enabled").await.unwrap(),
        json!(false)
    );
    assert_eq!(fake.set_paths(), vec!["mqtt.enabled"; 2]);
}

/// Every `post(...)` route registered in `routes.rs` appears in
/// [`ALL_MUTATIONS`], which is what the authentication tests iterate.
///
/// This is a test about the test list. The auth coverage above enumerates
/// paths by hand, so a new mutating route is authenticated by the middleware
/// but never *asserted* to be -- and the day the middleware is refactored,
/// nothing fails. Reading the router's own source closes that gap.
#[test]
fn every_mutating_route_is_covered_by_the_authentication_tests() {
    let source = include_str!("routes.rs");
    let mut registered: Vec<String> = Vec::new();
    for line in source.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix(".route(\"") else {
            continue;
        };
        let Some((path, tail)) = rest.split_once('"') else {
            continue;
        };
        if tail.contains("post(") {
            registered.push(path.to_string());
        }
    }
    assert!(
        !registered.is_empty(),
        "no post routes were found in routes.rs, so this test cannot fail and proves nothing -- the .route() spelling it parses must have changed"
    );

    let covered: Vec<&str> = ALL_MUTATIONS.iter().map(|(path, _)| *path).collect();
    // Routes reachable before authentication, by design: these are how an
    // operator authenticates. Named individually so adding one is a decision.
    let public = ["/setup", "/login", "/logout"];
    // /ssh is a GET pane, not a mutation, and is exercised as the first entry
    // of the loop above rather than as a member of ALL_MUTATIONS.
    let missing: Vec<&String> = registered
        .iter()
        .filter(|path| !covered.contains(&path.as_str()) && !public.contains(&path.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "these mutating routes are not in ALL_MUTATIONS, so no test asserts they reject an unauthenticated request: {missing:?}"
    );
}

// §2.2's two read-only resource roots.

/// A tree in the shape §2.2's inventory describes, carrying every one of the
/// four redacted field names — at three depths and inside an array — so a walk
/// over the responses below proves the denylist covers all of them.
///
/// The admin hash is a real one so `login` works against this tree; every
/// other secret is a marker string, which is what the "no plaintext survived"
/// assertions look for.
fn secret_tree(password: &str) -> serde_json::Value {
    json!({
        "hostname": "mos",
        // The field the denylist's fail-closed entry exists for. No shipped
        // schema has it — `WireguardConfig` carries no private key and never
        // will — so the fixture plants the hypothetical the entry guards
        // against: a settings tree that somehow holds one must not serve it.
        "network": {
            "wg0": { "kind": "wireguard", "privateKey": "wg-plaintext-marker" },
        },
        "access": {
            "webAdmin": { "password_hash": auth::hash_password(password).unwrap() },
            "device": { "passwordHash": "device-plaintext-marker" },
            "ssh": {
                "enabled": true,
                "authorizedKeys": [
                    { "comment": "laptop", "hash": "keyhash-plaintext-marker" },
                ],
            },
            // The one settings field that really is named `hash`: a bearer
            // token digest, inside an array, under the subtree the auth gate
            // reads on every request.
            "apiTokens": [
                {
                    "id": "3f2a9c41",
                    "name": "ci-deploy",
                    "hash": "token-digest-plaintext-marker",
                    "created": 1_700_000_000,
                },
            ],
        },
        "wifi": {
            "ap": { "ssid": "mos-ap", "psk": "ap-plaintext-marker" },
            "client": {
                "networks": [
                    { "ssid": "home", "psk": "home-plaintext-marker" },
                    {
                        "ssid": "work",
                        "psk": "work-plaintext-marker",
                        "extra": { "hash": "deep-plaintext-marker" },
                    },
                ],
            },
        },
    })
}

/// The live-state entry the state tests read, carrying all five names too:
/// §2.2 states the redaction rule for the settings root, and this campaign
/// extends it to the state root, so the state root is held to the same proof.
fn secret_state_entry() -> serde_json::Value {
    json!({
        "psk": "state-ap-plaintext-marker",
        "privateKey": "state-private-plaintext-marker",
        "peers": [
            { "ssid": "home", "psk": "state-peer-plaintext-marker" },
            { "id": "laptop", "hash": "state-hash-plaintext-marker" },
        ],
        "admin": {
            "passwordHash": "state-camel-plaintext-marker",
            "nested": { "password_hash": "state-snake-plaintext-marker" },
        },
    })
}

/// Every marker string [`secret_tree`] and [`secret_state_entry`] plant.
const PLAINTEXT_MARKERS: [&str; 12] = [
    "token-digest-plaintext-marker",
    "wg-plaintext-marker",
    "state-private-plaintext-marker",
    "device-plaintext-marker",
    "keyhash-plaintext-marker",
    "ap-plaintext-marker",
    "home-plaintext-marker",
    "work-plaintext-marker",
    "deep-plaintext-marker",
    "state-ap-plaintext-marker",
    "state-peer-plaintext-marker",
    "state-hash-plaintext-marker",
];

/// The field names §2.2's redaction rule names, `privateKey` included.
const SECRET_FIELD_NAMES: [&str; 5] =
    ["psk", "passwordHash", "password_hash", "hash", "privateKey"];

/// The sentinel a redacted field carries.
const REDACTED: &str = "<redacted>";

/// Collect every secret-bearing field in `value` — at any depth, inside arrays
/// included — as `(name, value)` pairs.
///
/// Written independently of the redactor under test: it walks the *response*,
/// so a redactor that missed a branch is caught by the value it left behind
/// rather than by agreeing with itself.
fn secret_fields(value: &serde_json::Value, found: &mut Vec<(String, serde_json::Value)>) {
    match value {
        serde_json::Value::Object(fields) => {
            for (name, child) in fields {
                if SECRET_FIELD_NAMES.contains(&name.as_str()) {
                    found.push((name.clone(), child.clone()));
                } else {
                    secret_fields(child, found);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                secret_fields(item, found);
            }
        }
        _ => {}
    }
}

/// §2.2: the dot-path IS the resource identifier, so the body is exactly what
/// `GetSettings("<dot-path>")` returns.
#[tokio::test]
async fn the_settings_root_answers_the_dot_paths_value_for_a_session() {
    let (router, _) = test_app(secret_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/api/v1/settings/hostname", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "/api/v1/settings/hostname");
    assert_eq!(body_string(response).await, r#""mos""#);

    // A subtree, and a scalar reached through one: the passthrough has no
    // shape of its own to impose.
    let response = get(&router, "/api/v1/settings/access.ssh", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(value["enabled"], json!(true));

    let response = get(
        &router,
        "/api/v1/settings/access.ssh.enabled",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "true");
}

/// The second root, which is a different tree in mosd and so a different route
/// here (§2.2): untyped, in memory, and written only from inside mosd.
#[tokio::test]
async fn the_state_root_answers_the_dot_paths_value_for_a_session() {
    let (router, fake) = test_app(secret_tree("hunter2secret"));
    fake.set_state_entry("hostname", json!({ "applied": "mos" }));
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/api/v1/state/hostname", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "/api/v1/state/hostname");
    assert_eq!(body_string(response).await, r#"{"applied":"mos"}"#);

    let response = get(&router, "/api/v1/state/hostname.applied", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, r#""mos""#);
}

/// The two roots are separate: a settings dot-path is not a state dot-path,
/// and the routes do not fall back to each other.
#[tokio::test]
async fn the_two_roots_do_not_answer_for_each_other() {
    let (router, fake) = test_app(secret_tree("hunter2secret"));
    fake.set_state_entry("hostname", json!({ "applied": "mos" }));
    let cookie = login(&router, "hunter2secret").await;

    // `hostname` exists in both, with different values.
    let settings = get(&router, "/api/v1/settings/hostname", Some(&cookie)).await;
    let state = get(&router, "/api/v1/state/hostname", Some(&cookie)).await;
    assert_ne!(
        body_string(settings).await,
        body_string(state).await,
        "one root answered for the other"
    );

    // `network` exists only in the settings tree, so the state root must fail
    // rather than serve the settings value.
    let response = get(&router, "/api/v1/state/network", Some(&cookie)).await;
    assert_ne!(response.status(), StatusCode::OK);
}

/// The document describes the served surface: a client reading only
/// `openapi.json` has to learn both families and every outcome they have.
#[test]
fn the_openapi_document_covers_the_resource_routes() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    for path in ["/api/v1/settings/{path}", "/api/v1/state/{path}"] {
        let responses = &document["paths"][path]["get"]["responses"];
        for status in ["200", "401", "422", "500", "503"] {
            assert!(
                responses[status].is_object(),
                "{path} is missing its {status}: {document}"
            );
        }
    }

    // §2.2's sentinel is a value a client can receive, so the schema of the
    // body has to say so; a client that has not been told treats
    // `"<redacted>"` as the credential.
    assert!(
        document["components"]["schemas"]["ResourceValue"]["description"]
            .as_str()
            .is_some_and(|text| text.contains(REDACTED)),
        "the resource body's schema does not describe the redaction sentinel: {document}"
    );
}

/// §2.2's redaction rule, driven from the failing side: every field the
/// denylist names, at every depth the tree puts one and inside the arrays the
/// dot-path syntax cannot address, comes back as the sentinel.
///
/// The rule is fail-open — a secret-bearing field under a name not on the list
/// is served — so this test is the mitigation §2.2 asks for. It walks the
/// response rather than checking known locations, so a field added to the
/// fixture is covered without editing an assertion here.
#[tokio::test]
async fn every_redacted_field_name_comes_back_redacted_from_the_settings_root() {
    let (router, _) = test_app(secret_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    // Three subtrees rather than one, because the whole-tree dot-path is `""`
    // and this route family takes a non-empty one. Between them they hold all
    // five names.
    let mut found = Vec::new();
    let mut bodies = String::new();
    for path in [
        "/api/v1/settings/access",
        "/api/v1/settings/wifi",
        "/api/v1/settings/network",
    ] {
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = body_string(response).await;
        secret_fields(&serde_json::from_str(&body).unwrap(), &mut found);
        bodies.push_str(&body);
    }

    let names: Vec<&str> = found.iter().map(|(name, _)| name.as_str()).collect();
    for name in SECRET_FIELD_NAMES {
        assert!(
            names.contains(&name),
            "the fixture no longer carries a `{name}` field, so this test does not cover it: {names:?}"
        );
    }
    for (name, value) in &found {
        assert_eq!(value, &json!(REDACTED), "`{name}` was served in the clear");
    }
    // The walk only sees fields it recognises. This sees the bytes.
    for marker in PLAINTEXT_MARKERS {
        assert!(
            !bodies.contains(marker),
            "`{marker}` reached the wire: {bodies}"
        );
    }
}

/// A settings read of `access` never carries a token digest.
///
/// The general rule is asserted above by walking every field name on the
/// denylist. This one names the field that made the rule load-bearing rather
/// than precautionary: `access.apiTokens[].hash` is the first field of the
/// settings schema actually named `hash`, it holds a credential digest, and it
/// sits in the subtree the auth gate reads on every single request -- so a
/// regression here is a digest served to every authenticated caller and to
/// every future bearer-token holder.
///
/// The subtree and the entry and the field are all asserted, because the three
/// break differently: a denylist entry removed, a walk that stops at an array,
/// and a dot-path that names the field directly and so has no field name left
/// to key on.
#[tokio::test]
async fn a_settings_read_of_access_never_carries_a_token_digest() {
    let (router, _) = test_app(secret_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    // The subtree the gate reads.
    let response = get(&router, "/api/v1/settings/access", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        !body.contains("token-digest-plaintext-marker"),
        "a token digest reached the wire: {body}"
    );

    // The entry is still served -- the id, the name and the clock reading are
    // what `GET /api/v1/tokens` lists -- so this is redaction and not removal.
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    let entry = &value["apiTokens"][0];
    assert_eq!(entry["id"], json!("3f2a9c41"));
    assert_eq!(entry["name"], json!("ci-deploy"));
    assert_eq!(entry["created"], json!(1_700_000_000));
    assert_eq!(entry["hash"], json!(REDACTED));

    // The array on its own, which is the walk's array branch with nothing
    // above it to have caught the field first.
    let response = get(&router, "/api/v1/settings/access.apiTokens", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        !body.contains("token-digest-plaintext-marker"),
        "the token array served the digest: {body}"
    );

    // There is no dot-path that reaches one entry: the syntax has no array
    // indexing, which is why the denylist is by field name and not by path.
    let response = get(
        &router,
        "/api/v1/settings/access.apiTokens.0.hash",
        Some(&cookie),
    )
    .await;
    let status = response.status();
    assert_ne!(
        status,
        StatusCode::OK,
        "an indexed dot-path resolved: {}",
        body_string(response).await
    );
}

/// The same rule on the state root. §2.2 states it for the settings root only;
/// this campaign extends it, because a denylist that covers one root while the
/// other serves the same field names verbatim is a hole with a tested-looking
/// lid.
#[tokio::test]
async fn the_state_root_is_redacted_by_the_same_rule() {
    let (router, fake) = test_app(secret_tree("hunter2secret"));
    fake.set_state_entry("wifiAp", secret_state_entry());
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/api/v1/state/wifiAp", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;

    let mut found = Vec::new();
    secret_fields(&serde_json::from_str(&body).unwrap(), &mut found);
    let names: Vec<&str> = found.iter().map(|(name, _)| name.as_str()).collect();
    for name in SECRET_FIELD_NAMES {
        assert!(names.contains(&name), "not covered: {name} in {names:?}");
    }
    for (name, value) in &found {
        assert_eq!(value, &json!(REDACTED), "`{name}` was served in the clear");
    }
    for marker in PLAINTEXT_MARKERS {
        assert!(
            !body.contains(marker),
            "`{marker}` reached the wire: {body}"
        );
    }
}

/// The structural walk keys on a field name, and a dot-path that names a
/// secret field directly leaves no field name in the value: the response is
/// the bare hash. So the requested path is redacted as well as the tree.
#[tokio::test]
async fn a_dot_path_that_names_a_secret_field_answers_the_sentinel() {
    let (router, fake) = test_app(secret_tree("hunter2secret"));
    fake.set_state_entry("wifiAp", secret_state_entry());
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "/api/v1/settings/access.webAdmin.password_hash",
        "/api/v1/settings/access.device.passwordHash",
        "/api/v1/settings/wifi.ap.psk",
        "/api/v1/settings/network.wg0.privateKey",
        "/api/v1/state/wifiAp.psk",
        "/api/v1/state/wifiAp.privateKey",
        "/api/v1/state/wifiAp.admin.passwordHash",
    ] {
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            body_string(response).await,
            format!(r#""{REDACTED}""#),
            "{path}"
        );
    }
}

/// A `zbus::Error::MethodError` naming `name`, with `message` as the body mosd
/// sent back.
///
/// Constructed rather than provoked: `FakeSettings` returns plain `anyhow`
/// errors, which are §2.4's `mosd_unreachable` fallback row and cannot reach
/// the other three.
fn method_error(name: &'static str, message: &str) -> zbus::Error {
    let reply_to = zbus::message::Message::method_call("/com/mos/mosd", "GetSettings")
        .expect("a well-formed method call")
        .build(&())
        .expect("an empty body serialises");
    let name = zbus::names::ErrorName::try_from(name).expect("a well-formed fdo error name");
    zbus::Error::MethodError(name.into(), Some(message.to_string()), reply_to)
}

/// A [`SettingsApi`] whose resource reads fail with the error the test chose.
///
/// `access` and the whole tree still read, because that is what the gate and
/// `login_submit` need to get a session as far as a route that fails.
struct FailingSettings {
    tree: serde_json::Value,
    /// The fdo error name mosd answered with, or `None` for a failure that
    /// never reached mosd at all.
    fdo_name: Option<&'static str>,
}

impl FailingSettings {
    fn error(&self) -> anyhow::Error {
        match self.fdo_name {
            Some(name) => method_error(name, MOSD_MESSAGE).into(),
            None => anyhow::anyhow!("no connection to mosd"),
        }
    }
}

/// The text mosd is pretending to have sent, which §2.4 requires apid to carry
/// through untouched.
const MOSD_MESSAGE: &str = "invalid settings value at `network.eth0.100`: unknown field `100`";

#[async_trait::async_trait]
impl SettingsApi for FailingSettings {
    async fn get_settings(&self, path: &str) -> anyhow::Result<serde_json::Value> {
        if path.is_empty() || path == "access" {
            return Ok(if path.is_empty() {
                self.tree.clone()
            } else {
                self.tree["access"].clone()
            });
        }
        Err(self.error())
    }

    /// The settings root stopped being read-only with PLAN-023 M4, and this
    /// fixture answers the write the same way it answers a read: §2.4's
    /// classification is exactly what the write route has to inherit.
    async fn set_settings(&self, _path: &str, _value: &serde_json::Value) -> anyhow::Result<()> {
        Err(self.error())
    }

    async fn get_state(&self, _path: &str) -> anyhow::Result<serde_json::Value> {
        Err(self.error())
    }

    async fn reboot(&self) -> anyhow::Result<()> {
        unreachable!("the resource routes are read-only")
    }

    async fn power_off(&self) -> anyhow::Result<()> {
        unreachable!("the resource routes are read-only")
    }

    async fn set_transient_root_password(&self, _password: &str) -> anyhow::Result<()> {
        unreachable!("the resource routes are read-only")
    }

    /// The one write this fixture *does* answer, because §2.4's classification
    /// is exactly what the rotate route has to inherit from the read routes.
    async fn rotate_wireguard_key(&self, _iface: &str) -> anyhow::Result<String> {
        Err(self.error())
    }
}

/// A router whose resource reads fail the way `fdo_name` says, plus a session
/// cookie for it.
async fn failing_app(fdo_name: Option<&'static str>) -> (Router, String) {
    let api = Arc::new(FailingSettings {
        tree: configured_tree("hunter2secret"),
        fdo_name,
    });
    let router = app(AppState::new(api, SIGNING_KEY));
    let cookie = login(&router, "hunter2secret").await;
    (router, cookie)
}

/// The premise the classification rests on: `err.into()` in `bus_client.rs`
/// converts a `zbus::Error` to `anyhow::Error` through the blanket `From`,
/// which STORES the concrete error rather than flattening it, so the fdo name
/// is still there to be recovered. If this ever stops holding, every row of
/// §2.4's table below collapses into the fallback and the tests would say so
/// one at a time; this says it once, in the one sentence it depends on.
#[test]
fn the_zbus_error_survives_the_conversion_to_anyhow() {
    let err: anyhow::Error = method_error("org.freedesktop.DBus.Error.InvalidArgs", "boom").into();
    let recovered = err
        .downcast_ref::<zbus::Error>()
        .expect("the conversion kept the zbus error");
    match recovered {
        zbus::Error::MethodError(name, message, _) => {
            assert_eq!(name.as_str(), "org.freedesktop.DBus.Error.InvalidArgs");
            assert_eq!(message.as_deref(), Some("boom"));
        }
        other => panic!("the variant changed: {other:?}"),
    }
}

/// §2.4's table, row by row: mosd classifies, apid translates the
/// classification, and mosd's message is carried through verbatim.
#[tokio::test]
async fn each_fdo_error_name_gets_its_own_envelope() {
    for (fdo_name, code, status) in [
        (
            "com.mos.mosd1.Error.NotFound",
            "settings_not_found",
            StatusCode::NOT_FOUND,
        ),
        (
            "com.mos.mosd1.Error.ReadOnly",
            "settings_read_only",
            StatusCode::CONFLICT,
        ),
        (
            "org.freedesktop.DBus.Error.InvalidArgs",
            "settings_rejected",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "org.freedesktop.DBus.Error.IOError",
            "settings_io",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (
            "org.freedesktop.DBus.Error.Failed",
            "mosd_failed",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        for path in ["/api/v1/settings/wifi.ap", "/api/v1/state/wifiAp"] {
            let (router, cookie) = failing_app(Some(fdo_name)).await;
            let response = get(&router, path, Some(&cookie)).await;
            assert_eq!(response.status(), status, "{fdo_name} at {path}");
            assert_api_headers(&response, path);
            assert_eq!(
                response.headers().get(axum::http::header::RETRY_AFTER),
                None,
                "only the unreachable class carries Retry-After: {fdo_name}"
            );
            let error = envelope(response).await;
            assert_eq!(error["code"], code, "{fdo_name}");
            assert_eq!(error["source"], "mosd", "{fdo_name}");
            // §2.4: apid substituting its own phrasing would hide every
            // message mosd learns to produce.
            assert_eq!(error["message"], MOSD_MESSAGE, "{fdo_name}");
            // §2.4's optional member, which these routes DO name.
            assert_eq!(
                error["path"],
                json!(path.rsplit('/').next().unwrap()),
                "{fdo_name}"
            );
        }
    }
}

/// The fallback row, and the only one whose `source` is apid: the call could
/// not be made at all, which is a statement about this server rather than
/// about the request. 503, because apid itself is up and answering.
#[tokio::test]
async fn an_unreachable_mosd_is_503_with_retry_after() {
    // No `MethodError` at all, and a `MethodError` under a name §2.4's table
    // does not list: both are the fallback.
    for fdo_name in [None, Some("org.freedesktop.DBus.Error.UnknownObject")] {
        for path in ["/api/v1/settings/wifi.ap", "/api/v1/state/wifiAp"] {
            let (router, cookie) = failing_app(fdo_name).await;
            let response = get(&router, path, Some(&cookie)).await;
            assert_eq!(
                response.status(),
                StatusCode::SERVICE_UNAVAILABLE,
                "{fdo_name:?} at {path}"
            );
            assert_api_headers(&response, path);
            assert_eq!(
                header_value(&response, axum::http::header::RETRY_AFTER),
                "5",
                "{fdo_name:?} at {path}"
            );
            let error = envelope(response).await;
            assert_eq!(error["code"], "mosd_unreachable");
            assert_eq!(error["source"], "apid");
            assert!(error["message"].is_string());
        }
    }
}

/// The HTML half of the same condition: a pane whose mosd call fails answers
/// **503 with `Retry-After`**, exactly like the API path above, so one outage
/// no longer reports as 502 on one surface and 503 on the other.
#[tokio::test]
async fn an_unreachable_mosd_is_503_with_retry_after_on_the_html_panes_too() {
    let (router, cookie) = failing_app(None).await;

    let response = get(&router, "/hostname", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        header_value(&response, axum::http::header::RETRY_AFTER),
        "5"
    );
    let body = body_string(response).await;
    assert!(body.contains("The management daemon is unavailable."));
}

/// A dot-path that does not exist answers **404 `settings_not_found`**, no
/// longer 422: mosd names `SettingsError::NotFound` with its own error name
/// (`com.mos.mosd1.Error.NotFound`), so a missing path and a bad value stop
/// sharing a code. The 422 assertion beside it is the control: a rejection
/// that IS a rejection still reports as one.
#[tokio::test]
async fn a_dot_path_that_does_not_exist_is_404_and_a_rejection_stays_422() {
    let (router, cookie) = failing_app(Some("com.mos.mosd1.Error.NotFound")).await;
    let response = get(&router, "/api/v1/settings/no.such.path", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["path"], json!("no.such.path"));

    let (router, cookie) = failing_app(Some("org.freedesktop.DBus.Error.InvalidArgs")).await;
    let response = get(&router, "/api/v1/settings/no.such.path", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_rejected");
    assert_eq!(error["path"], json!("no.such.path"));
}

/// §3.1's trap again, for the routes this campaign adds: an unauthenticated
/// resource read answers §2.4's envelope with a 401 and **never** a redirect,
/// in both gate modes. They inherit it from `ApiSession`; inheriting is not
/// the same as being asserted.
#[tokio::test]
async fn the_resource_routes_are_401_without_a_session_in_both_gate_modes() {
    const PATHS: [&str; 2] = ["/api/v1/settings/hostname", "/api/v1/state/hostname"];

    let (configured, _) = test_app(secret_tree("hunter2secret"));
    let (fresh, _) = test_app(unconfigured_tree());

    for (mode, router) in [("configured", &configured), ("setup mode", &fresh)] {
        for path in PATHS {
            let response = get(router, path, None).await;
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{path} in {mode}"
            );
            assert_eq!(
                response.headers().get(LOCATION),
                None,
                "{path} in {mode} answered a redirect, which a script reads as success"
            );
            assert_api_headers(&response, path);
            let error = envelope(response).await;
            assert_eq!(error["code"], "not_authenticated", "{path} in {mode}");
            assert_eq!(error["source"], "apid", "{path} in {mode}");
            // §2.4's `path` is the dot-path at fault, and a request that failed
            // to authenticate never named one: the read did not happen.
            assert_eq!(error.get("path"), None, "{path} in {mode}");
        }
    }
}

/// The three spellings of each resource root are one string plus two suffixes.
///
/// The router, the OpenAPI attribute and the gate predicate each need a
/// different one, and a typo in any of them would serve a path the document
/// does not describe or hand off a path the router does not have.
#[test]
fn the_resource_path_spellings_agree() {
    for (prefix, route, doc) in [
        crate::routes::SETTINGS_SPELLINGS,
        crate::routes::STATE_SPELLINGS,
    ] {
        assert_eq!(route, format!("{prefix}{{*path}}"));
        assert_eq!(doc, format!("{prefix}{{path}}"));
    }
}

// RFCT-134: the admin password can be changed after setup, on both surfaces.

/// POST a JSON body, the shape the API's one write route takes.
async fn post_json(
    router: &Router,
    path: &str,
    body: &str,
    cookie: Option<&str>,
) -> Response<axum::body::Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header(CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, format!("apid_session={cookie}"));
    }
    send(router, builder.body(Body::from(body.to_string())).unwrap()).await
}

/// A wrong current password writes nothing and the old credential stands.
///
/// The current password is demanded even though the caller holds a session: a
/// session is a browser artifact that outlives the moment of typing, and an
/// unattended browser must not be enough to rotate the one credential on the
/// management surface.
#[tokio::test]
async fn the_password_pane_rejects_a_wrong_current_password() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(
        &router,
        "/password",
        "current=not-the-password&password=newsecret9&confirm=newsecret9",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(
        fake.set_paths().is_empty(),
        "a refused change must write nothing, got {:?}",
        fake.set_paths()
    );
    // The acting session is untouched by a refusal.
    assert_eq!(
        get(&router, "/", Some(&cookie)).await.status(),
        StatusCode::OK
    );
    // And the old password still logs in.
    let _ = login(&router, "hunter2secret").await;
}

/// The decided semantics, end to end: the new hash lands in the settings
/// tree, every other session is invalidated, and the acting session survives.
#[tokio::test]
async fn the_password_pane_changes_the_password_and_keeps_the_acting_session() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let other = login(&router, "hunter2secret").await;
    let acting = login(&router, "hunter2secret").await;

    let response = post_form(
        &router,
        "/password",
        "current=hunter2secret&password=newsecret9&confirm=newsecret9",
        Some(&acting),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/password?saved=1");
    assert_eq!(fake.set_paths(), vec!["access.webAdmin"]);

    // The stored hash is a new one and verifies the new password.
    let stored = fake
        .get_settings("access.webAdmin.password_hash")
        .await
        .unwrap();
    let stored = stored.as_str().unwrap();
    assert!(stored.starts_with("$argon2id$"));
    assert!(auth::verify_password(stored, "newsecret9"));

    // The acting session survives its own change; the other session is gone.
    assert_eq!(
        get(&router, "/", Some(&acting)).await.status(),
        StatusCode::OK
    );
    let evicted = get(&router, "/", Some(&other)).await;
    assert_eq!(evicted.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&evicted), "/login");

    // The new password logs in (first, so the success resets the login
    // guard), and the old one no longer does.
    let _ = login(&router, "newsecret9").await;
    let old = post_form(&router, "/login", "password=hunter2secret", None).await;
    assert_eq!(old.status(), StatusCode::UNAUTHORIZED);
}

/// A mismatched confirmation is refused before the current password is even
/// looked at, in the same shape as the setup wizard's refusal.
#[tokio::test]
async fn the_password_pane_rejects_a_mismatched_confirmation() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(
        &router,
        "/password",
        "current=hunter2secret&password=newsecret9&confirm=different1",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(fake.set_paths().is_empty());
}

/// The API half of the same refusal: §2.4's envelope, `wrong_password`, and
/// nothing written.
#[tokio::test]
async fn the_api_password_change_rejects_a_wrong_current_password() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/actions/change-password",
        r#"{"currentPassword":"not-the-password","newPassword":"newsecret9"}"#,
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_api_headers(&response, "/api/v1/actions/change-password");
    let error = envelope(response).await;
    assert_eq!(error["code"], "wrong_password");
    assert_eq!(error["source"], "apid");
    assert!(fake.set_paths().is_empty());
}

/// The API half of the success: 204, the hash written, the other session
/// dropped, the calling session kept.
#[tokio::test]
async fn the_api_password_change_succeeds_and_drops_the_other_sessions() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let other = login(&router, "hunter2secret").await;
    let acting = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/actions/change-password",
        r#"{"currentPassword":"hunter2secret","newPassword":"newsecret9"}"#,
        Some(&acting),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(fake.set_paths(), vec!["access.webAdmin"]);

    let stored = fake
        .get_settings("access.webAdmin.password_hash")
        .await
        .unwrap();
    assert!(auth::verify_password(
        stored.as_str().unwrap(),
        "newsecret9"
    ));

    assert_eq!(
        get(&router, "/", Some(&acting)).await.status(),
        StatusCode::OK
    );
    let evicted = get(&router, "/", Some(&other)).await;
    assert_eq!(evicted.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&evicted), "/login");
}

/// A new password under eight characters is refused with `validation_failed`,
/// the same floor the setup wizard enforces.
#[tokio::test]
async fn the_api_password_change_rejects_a_short_new_password() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/actions/change-password",
        r#"{"currentPassword":"hunter2secret","newPassword":"short"}"#,
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert_eq!(error["code"], "validation_failed");
    assert!(fake.set_paths().is_empty());
}

/// §3.1's trap, held for the one write route: unauthenticated is §2.4's 401
/// envelope in both gate modes, never a redirect a script reads as success.
#[tokio::test]
async fn the_api_password_change_is_401_without_a_session_in_both_gate_modes() {
    let (configured, _) = test_app(configured_tree("hunter2secret"));
    let (fresh, _) = test_app(unconfigured_tree());

    for (mode, router) in [("configured", &configured), ("setup mode", &fresh)] {
        let response = post_json(
            router,
            "/api/v1/actions/change-password",
            r#"{"currentPassword":"hunter2secret","newPassword":"newsecret9"}"#,
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{mode}");
        assert_eq!(response.headers().get(LOCATION), None, "{mode}");
        let error = envelope(response).await;
        assert_eq!(error["code"], "not_authenticated", "{mode}");
    }
}

/// A body that is not the declared shape answers §2.4's envelope rather than
/// axum's plain-text rejection.
#[tokio::test]
async fn the_api_password_change_rejects_a_malformed_body_with_the_envelope() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/actions/change-password",
        r#"{"currentPassword":"hunter2secret"}"#,
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_api_headers(&response, "/api/v1/actions/change-password");
    let error = envelope(response).await;
    assert_eq!(error["code"], "request_invalid");
    assert_eq!(error["source"], "apid");
    assert!(fake.set_paths().is_empty());
}

// RFCT-132 / RFCT-133: the gate's cache of the `access` subtree.
//
// The subscription itself — the proxy's `#[zbus(signal)]` member feeding the
// cache over a real bus — is exercised in `tests/settings_signal.rs`. Here
// the cache's route-level contract is driven through the real router, with
// the subscription state set by hand where a watcher would set it.

/// The lockout rule at the route level: with no live subscription every
/// unauthenticated request reads the bus — the pre-cache behaviour, and the
/// fallback the rule demands; with one, the first request fills the cache and
/// the rest are served from it; an invalidation forces exactly one re-read;
/// a lapse falls all the way back to direct reads.
#[tokio::test]
async fn the_gate_serves_access_from_the_cache_only_while_subscribed() {
    let fake = Arc::new(FakeSettings::new(configured_tree("hunter2secret")));
    let state = AppState::new(fake.clone(), SIGNING_KEY);
    let cache = state.access_cache().clone();
    let router = app(state);

    get(&router, "/login", None).await;
    get(&router, "/login", None).await;
    assert_eq!(
        fake.settings_reads("access"),
        2,
        "no subscription: every request must read the bus"
    );

    cache.subscribed();
    get(&router, "/login", None).await;
    get(&router, "/login", None).await;
    get(&router, "/login", None).await;
    assert_eq!(
        fake.settings_reads("access"),
        3,
        "subscribed: one fill, then cache hits"
    );

    // What the watcher does on a SettingsChanged that touches `access`.
    cache.invalidate();
    get(&router, "/login", None).await;
    get(&router, "/login", None).await;
    assert_eq!(
        fake.settings_reads("access"),
        4,
        "a change costs exactly one re-read"
    );

    cache.lapsed();
    get(&router, "/login", None).await;
    get(&router, "/login", None).await;
    assert_eq!(
        fake.settings_reads("access"),
        6,
        "a lapsed subscription must fall back to direct reads"
    );
}

/// The password change against the cache — the sequence RFCT-132 names as
/// the hard case, made real by the change-password route: the flow itself
/// verifies against the bus even while the cache is primed, its write drops
/// the cached snapshot without waiting for the `SettingsChanged` round trip,
/// and the next unauthenticated request re-reads and observes the
/// post-change tree.
#[tokio::test]
async fn a_password_change_neither_reads_nor_leaves_a_stale_access_snapshot() {
    let fake = Arc::new(FakeSettings::new(configured_tree("hunter2secret")));
    let state = AppState::new(fake.clone(), SIGNING_KEY);
    let cache = state.access_cache().clone();
    let router = app(state);
    let cookie = login(&router, "hunter2secret").await;

    cache.subscribed();
    get(&router, "/login", None).await;
    let primed = cache.get().expect("the gate's read must fill the cache");
    let reads_before = fake.settings_reads("access");

    let response = post_json(
        &router,
        "/api/v1/actions/change-password",
        r#"{"currentPassword":"hunter2secret","newPassword":"brand-new-secret"}"#,
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        fake.settings_reads("access") > reads_before,
        "the change flow must verify against the bus, never the gate's cache"
    );
    assert_eq!(
        cache.get(),
        None,
        "the write must drop the cached snapshot before any signal arrives"
    );

    get(&router, "/login", None).await;
    let refilled = cache.get().expect("the next gate read must refill");
    assert_ne!(
        refilled, primed,
        "the refill must observe the post-change credential"
    );
    login(&router, "brand-new-secret").await;
}

/// Completing setup IS the setup-mode decision changing under the gate — the
/// exact decision the cache must never serve stale. The wizard's
/// `access.webAdmin` write drops the cache, so the next unauthenticated
/// request re-reads and redirects to `/login`, not back into `/setup`.
#[tokio::test]
async fn completing_setup_drops_the_cached_setup_mode_decision() {
    let fake = Arc::new(FakeSettings::new(unconfigured_tree()));
    let state = AppState::new(fake.clone(), SIGNING_KEY);
    let cache = state.access_cache().clone();
    let router = app(state);

    cache.subscribed();
    let response = get(&router, "/", None).await;
    assert_eq!(location(&response), "/setup");
    assert!(
        cache.get().is_some(),
        "the setup-mode read must have filled the cache"
    );

    let response = post_form(
        &router,
        "/setup",
        "password=hunter2secret&confirm=hunter2secret",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);

    let response = get(&router, "/", None).await;
    assert_eq!(
        location(&response),
        "/login",
        "the gate must not answer setup mode from the pre-write snapshot"
    );
}

// PLAN-022 M6: the typed network pane, the rotate-key route, and the two
// live-state fields M5 added.

/// A settings tree with `network` entries of every kind, in the shape schema
/// v7 stores them.
///
/// `eth1` carries no addressing at all, which is what a bridge port is; `wg0`
/// carries a peer whose key is a real 32-byte base64 value, so a rejection in
/// these tests is a verdict on the code under test and not on a malformed
/// fixture.
fn kinds_tree(password: &str) -> serde_json::Value {
    json!({
        "hostname": "mos",
        "network": {
            "eth0": { "dhcp": true },
            "eth1": { "dhcp": false },
            "eth0.100": {
                "kind": "vlan",
                "dhcp": false,
                "static": { "address": "192.168.100.2/24", "dns": [] },
                "vlan": { "parent": "eth0", "id": 100 },
            },
            "br0": { "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth1"] } },
            "wg0": {
                "kind": "wireguard",
                "dhcp": false,
                "static": { "address": "10.8.0.2/24", "dns": [] },
                "wireguard": {
                    "listenPort": 51820,
                    "peers": [{
                        "publicKey": PEER_KEY,
                        "allowedIps": ["10.8.0.0/24"],
                        "endpoint": "vpn.example.net:51820",
                    }],
                },
            },
        },
        "access": { "webAdmin": { "password_hash": auth::hash_password(password).unwrap() } },
    })
}

/// A syntactically valid X25519 public key: 32 bytes in padded base64.
///
/// Its private half was never generated — this is 32 constant bytes — so it
/// authorises nothing anywhere. It exists so that a rejection in these tests is
/// a verdict on the rule under test rather than on the shape of the value.
const PEER_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

/// A second one, distinct from [`PEER_KEY`], for the add/remove tests.
const OTHER_PEER_KEY: &str = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";

/// The live-state object mosd's network reconciler publishes for `kinds_tree`,
/// including the two fields M5 added: `kind` on every entry and `publicKey` on
/// the tunnel.
///
/// There is no private key in it because mosd never puts one there — the state
/// tree is served over D-Bus and over `GET /api/v1/state/network`.
fn network_state() -> serde_json::Value {
    json!({
        "eth0": { "file": "50-mos-eth0.network", "dhcp": true, "kind": "physical" },
        "eth1": { "file": "50-mos-eth1.network", "dhcp": false, "kind": "physical" },
        "eth0.100": { "file": "50-mos-eth0.100.network", "dhcp": false, "kind": "vlan" },
        "br0": { "file": "50-mos-br0.network", "dhcp": true, "kind": "bridge" },
        "wg0": {
            "file": "50-mos-wg0.network",
            "dhcp": false,
            "kind": "wireguard",
            "publicKey": PEER_KEY,
        },
    })
}

/// A router over [`kinds_tree`] with [`network_state`] published, plus a
/// session cookie for it.
async fn kinds_app() -> (Router, Arc<FakeSettings>, String) {
    let (router, fake) = test_app(kinds_tree("hunter2secret"));
    fake.set_state_entry("network", network_state());
    let cookie = login(&router, "hunter2secret").await;
    (router, fake, cookie)
}

/// The pane renders one typed form per kind, filled in from the stored entry.
#[tokio::test]
async fn the_network_pane_renders_the_typed_fields_of_every_kind() {
    let (router, _, cookie) = kinds_app().await;
    let body = body_string(get(&router, "/network", Some(&cookie)).await).await;

    // The kind control itself, with each of the four values selectable.
    for kind in ["physical", "vlan", "bridge", "wireguard"] {
        assert!(
            body.contains(&format!(r#"value="{kind}""#)),
            "no option for kind {kind}: {body}"
        );
    }
    // Each kind's own parameters, pre-filled from the tree rather than blank.
    for filled in [
        r#"name="vlanParent" value="eth0""#,
        r#"name="vlanId" value="100""#,
        r#"name="bridgePorts" value="eth1""#,
        r#"name="listenPort" value="51820""#,
    ] {
        assert!(body.contains(filled), "missing {filled}: {body}");
    }
    // And the peer list of the one tunnel, with its remove control.
    assert!(body.contains(PEER_KEY), "the peer is not listed: {body}");
    assert!(
        body.contains("/network/peers/add") && body.contains("/network/peers/remove"),
        "the peer controls are missing: {body}"
    );
}

/// The live-state reader: `kind` for every entry and `publicKey` for the
/// tunnel, which are the two fields M5 added to the per-interface object.
#[tokio::test]
async fn the_network_pane_renders_the_live_kind_and_public_key() {
    let (router, _, cookie) = kinds_app().await;
    let body = body_string(get(&router, "/network", Some(&cookie)).await).await;

    for unit in [
        "50-mos-eth0.network",
        "50-mos-eth0.100.network",
        "50-mos-br0.network",
        "50-mos-wg0.network",
    ] {
        assert!(body.contains(unit), "no live unit name {unit}: {body}");
    }
    assert!(
        body.contains("Public key:"),
        "the tunnel's public half is not rendered: {body}"
    );
}

/// mosd having published no state yet is a fact the pane states, not a 502:
/// the stored configuration is still worth showing.
#[tokio::test]
async fn the_network_pane_renders_without_live_state() {
    let (router, _) = test_app(kinds_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/network", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        body.contains("has published no state"),
        "the pane hides the absence instead of stating it: {body}"
    );
}

/// One entry whose body this pane cannot read must not blank out the others.
#[tokio::test]
async fn an_unreadable_entry_is_named_and_the_rest_still_render() {
    let mut tree = kinds_tree("hunter2secret");
    tree["network"]["broken"] = json!({ "dhcp": true, "notAField": 1 });
    let (router, _) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    let body = body_string(get(&router, "/network", Some(&cookie)).await).await;
    assert!(
        body.contains("network.broken holds a body this pane cannot read"),
        "the unreadable entry is not named: {body}"
    );
    assert!(
        body.contains(r#"name="iface" value="eth0""#),
        "a readable entry stopped rendering: {body}"
    );
}

/// The three virtual kinds, written through the quoted-path writer as the
/// typed bodies mosd deserializes.
#[tokio::test]
async fn network_post_writes_each_virtual_kind() {
    let (router, fake, cookie) = kinds_app().await;

    // A VLAN whose parent is a declared entry.
    let response = post_form(
        &router,
        "/network",
        "iface=eth0.200&kind=vlan&vlanParent=eth0&vlanId=200&address=192.168.200.2%2F24",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings(r#"network."eth0.200""#).await.unwrap(),
        json!({
            "kind": "vlan",
            "dhcp": false,
            "static": { "address": "192.168.200.2/24", "dns": [] },
            "vlan": { "parent": "eth0", "id": 200 },
        })
    );

    // A port first, then the bridge over it: the reconciler requires a port to
    // be a declared entry before a bridge may name it, and a port carries no
    // addressing of its own. `eth1` is already `br0`'s, so this makes its own.
    let response = post_form(&router, "/network", "iface=eth2&address=", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.eth2").await.unwrap(),
        json!({ "dhcp": false })
    );
    let response = post_form(
        &router,
        "/network",
        "iface=br1&kind=bridge&bridgePorts=eth2&dhcp=on",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.br1").await.unwrap(),
        json!({ "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth2"] } })
    );

    // A tunnel, whose peer list this form does not carry.
    let response = post_form(
        &router,
        "/network",
        "iface=wg1&kind=wireguard&listenPort=51821&address=10.9.0.2%2F24",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.wg1").await.unwrap(),
        json!({
            "kind": "wireguard",
            "dhcp": false,
            "static": { "address": "10.9.0.2/24", "dns": [] },
            "wireguard": { "listenPort": 51821, "peers": [] },
        })
    );

    // The dotted name went through the quoted-path writer, and the bare ones
    // did not need it.
    assert!(
        fake.set_paths()
            .contains(&r#"network."eth0.200""#.to_string()),
        "{:?}",
        fake.set_paths()
    );
}

/// Saving a tunnel from the form keeps the peers the form does not carry.
///
/// The failure this pins is silent: changing a listen port would otherwise
/// disconnect every far end, and the pane would report "Settings saved."
#[tokio::test]
async fn saving_a_tunnel_keeps_the_peers_the_form_does_not_carry() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(
        &router,
        "/network",
        "iface=wg0&kind=wireguard&listenPort=51999&address=10.8.0.2%2F24",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let stored = fake.get_settings("network.wg0").await.unwrap();
    assert_eq!(stored["wireguard"]["listenPort"], json!(51999));
    assert_eq!(
        stored["wireguard"]["peers"][0]["publicKey"],
        json!(PEER_KEY),
        "the peer list was dropped by a save that never mentioned it: {stored}"
    );
}

/// A value left in another kind's box is never written: the form renders all
/// four groups at once, and only the group the submitted kind names is read.
#[tokio::test]
async fn only_the_submitted_kinds_block_reaches_the_tree() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(
        &router,
        "/network",
        "iface=eth2&kind=physical&dhcp=on&vlanParent=eth0&vlanId=7&bridgePorts=eth1&listenPort=99",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.eth2").await.unwrap(),
        json!({ "dhcp": true }),
        "a block belonging to another kind reached the tree"
    );
}

/// An interface with DHCP off and no address is an interface with no
/// addressing, which is exactly what a bridge port is.
///
/// It used to be a 422. It cannot stay one: a bridge port must carry neither
/// `dhcp` nor `static`, and it must already be a declared entry before a bridge
/// may name it, so refusing this body made a bridge unbuildable through the
/// pane.
#[tokio::test]
async fn an_entry_with_no_addressing_is_written_rather_than_refused() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(&router, "/network", "iface=eth1&address=", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.get_settings("network.eth1").await.unwrap(),
        json!({ "dhcp": false })
    );
}

/// The reconciler's cross-field rules, echoed by the pane for a readable error.
///
/// Each row is a rule `validate_network` enforces in mosd. The pane is not the
/// boundary — the settings file is writable without apid — so this asserts the
/// echo, and that nothing was written when it fired.
#[tokio::test]
async fn the_pane_echoes_the_reconcilers_cross_field_rules() {
    for (body, fragment) in [
        // A VLAN parent that is not a declared entry.
        (
            "iface=eth9.100&kind=vlan&vlanParent=nosuch&vlanId=100&dhcp=on",
            "is not a declared network entry",
        ),
        // A bridge port that is not a declared entry.
        (
            "iface=br9&kind=bridge&bridgePorts=nosuch&dhcp=on",
            "is not a declared network entry",
        ),
        // A bridge port that carries addressing of its own.
        (
            "iface=br9&kind=bridge&bridgePorts=eth0&dhcp=on",
            "must not carry addressing of its own",
        ),
        // A port already claimed by another bridge.
        (
            "iface=br9&kind=bridge&bridgePorts=eth1&dhcp=on",
            "claimed as a port by both bridge",
        ),
        // Editing a declared port to take an address, which no check confined
        // to that one entry could see.
        ("iface=eth1&dhcp=on", "must not carry addressing of its own"),
        // A VLAN with no parent named at all.
        (
            "iface=eth9.100&kind=vlan&vlanId=100&dhcp=on",
            "needs a parent",
        ),
        // A VLAN id that is not a number.
        (
            "iface=eth9.100&kind=vlan&vlanParent=eth0&vlanId=abc&dhcp=on",
            "VLAN id must be a whole number",
        ),
        // A listen port that is not a number.
        (
            "iface=wg9&kind=wireguard&listenPort=nope&dhcp=on",
            "listen port must be a whole number",
        ),
        // A kind the schema does not have.
        ("iface=eth9&kind=tunnel&dhcp=on", "is not an interface kind"),
    ] {
        let (router, fake, cookie) = kinds_app().await;
        let response = post_form(&router, "/network", body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
        let rendered = body_string(response).await;
        assert!(
            rendered.contains(fragment),
            "{body} did not explain itself: {rendered}"
        );
        assert!(
            fake.set_paths().is_empty(),
            "{body} wrote {:?}",
            fake.set_paths()
        );
    }
}

/// Peers are added and removed at the peer list's own dot-path, quoted when
/// the interface name carries a dot.
#[tokio::test]
async fn peer_add_and_remove_rewrite_only_the_peer_list() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(
        &router,
        "/network/peers/add",
        &format!(
            "iface=wg0&publicKey={}&allowedIps=10.8.1.0%2F24%2C+fd00%3A%3A%2F64&endpoint=%5B2001%3Adb8%3A%3A1%5D%3A51820&persistentKeepalive=25",
            OTHER_PEER_KEY.replace('=', "%3D")
        ),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/network?saved=1");
    assert_eq!(
        fake.set_paths(),
        vec!["network.wg0.wireguard.peers".to_string()]
    );
    let peers = fake
        .get_settings("network.wg0.wireguard.peers")
        .await
        .unwrap();
    assert_eq!(peers.as_array().unwrap().len(), 2, "{peers}");
    assert_eq!(peers[1]["publicKey"], json!(OTHER_PEER_KEY));
    assert_eq!(
        peers[1]["allowedIps"],
        json!(["10.8.1.0/24", "fd00::/64"]),
        "{peers}"
    );
    assert_eq!(peers[1]["endpoint"], json!("[2001:db8::1]:51820"));
    assert_eq!(peers[1]["persistentKeepalive"], json!(25));

    // And back out again, by the public key that identifies it.
    let response = post_form(
        &router,
        "/network/peers/remove",
        &format!("iface=wg0&publicKey={}", OTHER_PEER_KEY.replace('=', "%3D")),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let peers = fake
        .get_settings("network.wg0.wireguard.peers")
        .await
        .unwrap();
    assert_eq!(peers.as_array().unwrap().len(), 1, "{peers}");
    assert_eq!(peers[0]["publicKey"], json!(PEER_KEY));
}

/// A dotted tunnel name reaches the peer list as one quoted segment.
#[tokio::test]
async fn a_dotted_tunnel_name_is_quoted_on_the_peer_path() {
    let mut tree = kinds_tree("hunter2secret");
    tree["network"]["wg.0"] = json!({
        "kind": "wireguard",
        "dhcp": false,
        "wireguard": { "peers": [] },
    });
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    let response = post_form(
        &router,
        "/network/peers/add",
        &format!("iface=wg.0&publicKey={}", PEER_KEY.replace('=', "%3D")),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        fake.set_paths(),
        vec![r#"network."wg.0".wireguard.peers"#.to_string()]
    );
}

/// `docs/task/RFCT-210.md` section 2.4's sweep, settled by running it: the
/// pane's peer-add for an interface that is **not a declared network entry**
/// neither refuses nor 404s -- it succeeds, and writes a `network.wg9` entry
/// of the default kind carrying a WireGuard block.
///
/// That finding was recorded there explicitly as a reading of the write path
/// and *not* as an observed run, and this is the run. The chain it names:
/// `stored_peers` answers an empty list rather than an error for an unknown
/// interface, `write_peers` writes straight to the peer list's own dot-path,
/// `validate_peers` never looks at the interface, and the settings setter
/// creates missing intermediates by documented contract.
///
/// The pane is left as it is -- M6 fixes this structurally on the API side,
/// where `POST /api/v1/network/{iface}/peers` answers 404 before anything is
/// written. Its paired test is
/// `the_api_peer_add_refuses_an_undeclared_interface_where_the_pane_writes_one`.
#[tokio::test]
async fn the_pane_peer_add_writes_a_broken_entry_for_an_undeclared_interface() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(
        &router,
        "/network/peers/add",
        &format!("iface=wg9&publicKey={}", PEER_KEY.replace('=', "%3D")),
        Some(&cookie),
    )
    .await;

    // Not 422, not 404: the redirect a successful save gives.
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/network?saved=1");
    assert_eq!(
        fake.set_paths(),
        vec!["network.wg9.wireguard.peers".to_string()]
    );
    // And what is now in the tree is the broken entry the finding describes:
    // no `kind`, so physical by default, carrying a WireGuard block.
    let entry = fake.get_settings("network.wg9").await.unwrap();
    assert_eq!(entry.get("kind"), None, "{entry}");
    assert_eq!(entry["wireguard"]["peers"][0]["publicKey"], json!(PEER_KEY));
}

/// A peer the reconciler would refuse is refused here first, and the refusal
/// never echoes the key.
///
/// The reconciler names a bad peer by its index for a reason it states: an
/// operator who pasted a *private* key into the field would otherwise find it
/// in the error text. The echo keeps that property.
#[tokio::test]
async fn a_peer_the_reconciler_would_refuse_is_refused_by_the_form() {
    const PASTED_SECRET: &str = "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO";
    for (body, fragment) in [
        (
            format!("iface=wg0&publicKey={PASTED_SECRET}"),
            "is not a WireGuard key",
        ),
        (
            format!(
                "iface=wg0&publicKey={}&allowedIps=not-an-address",
                OTHER_PEER_KEY.replace('=', "%3D")
            ),
            "is not an IP address or CIDR",
        ),
        (
            format!(
                "iface=wg0&publicKey={}&endpoint=vpn.example.net",
                OTHER_PEER_KEY.replace('=', "%3D")
            ),
            "is not host:port",
        ),
        (
            format!(
                "iface=wg0&publicKey={}&persistentKeepalive=forever",
                OTHER_PEER_KEY.replace('=', "%3D")
            ),
            "keepalive must be a whole number",
        ),
    ] {
        let (router, fake, cookie) = kinds_app().await;
        let response = post_form(&router, "/network/peers/add", &body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
        let rendered = body_string(response).await;
        assert!(rendered.contains(fragment), "{body}: {rendered}");
        assert!(
            !rendered.contains(PASTED_SECRET),
            "the refusal echoed the value back: {rendered}"
        );
        assert!(fake.set_paths().is_empty(), "{body} wrote something");
    }
}

/// Removing a peer nobody has is an error rather than a silent no-op rewrite.
#[tokio::test]
async fn removing_a_peer_that_is_not_there_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let response = post_form(
        &router,
        "/network/peers/remove",
        &format!("iface=wg0&publicKey={}", OTHER_PEER_KEY.replace('=', "%3D")),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(fake.set_paths().is_empty());
}

/// Adding a peer twice is refused: two `[WireGuardPeer]` sections with one
/// public key is a tunnel whose far end is described twice.
#[tokio::test]
async fn a_duplicate_peer_is_refused() {
    let (router, fake, cookie) = kinds_app().await;
    let response = post_form(
        &router,
        "/network/peers/add",
        &format!("iface=wg0&publicKey={}", PEER_KEY.replace('=', "%3D")),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(fake.set_paths().is_empty());
}

// The rotate-key route.

/// The route in the three spellings that have to agree: the constant the
/// router registers, what a caller sends, and what the document describes.
const ROTATE_PATH: &str = "/api/v1/actions/wireguard/wg0/rotate-key";

/// §2.1's action route: mosd draws the key, and the body carries its public
/// half and nothing else.
#[tokio::test]
async fn the_rotate_route_answers_the_new_public_key() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(&router, ROTATE_PATH, "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, ROTATE_PATH);
    let body: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();

    assert_eq!(
        fake.rotations(),
        vec![(
            "wg0".to_string(),
            body["publicKey"].as_str().unwrap().to_string()
        )]
    );
    // The whole body, by identity: a member added here would be a member
    // shipped to every client, and the one member that must never appear is a
    // private key.
    assert_eq!(
        body.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["publicKey"],
        "{body}"
    );
}

/// It rotates and it does not write: the settings tree holds no key, so there
/// is nothing there for a rotation to change.
#[tokio::test]
async fn a_rotation_writes_nothing_to_the_settings_tree() {
    let (router, fake, cookie) = kinds_app().await;
    let before = fake.get_settings("network.wg0").await.unwrap();

    let response = post_form(&router, ROTATE_PATH, "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(fake.get_settings("network.wg0").await.unwrap(), before);
}

/// §2.4's classification, inherited whole by the action route: mosd's fdo error
/// name decides the status and the code, and the envelope names the settings
/// dot-path at fault.
#[tokio::test]
async fn the_rotate_routes_failures_take_the_shared_envelope() {
    for (fdo_name, code, status) in [
        // PLAN-023 M6's correction, on the apid side: **no apid logic
        // changed**. mosd split its one `InvalidArgs` into a not-found for an
        // undeclared entry and an `InvalidArgs` for one of the wrong kind, and
        // the classifier below already mapped both names. This row is the
        // proof that it did.
        (
            Some("com.mos.mosd1.Error.NotFound"),
            "settings_not_found",
            StatusCode::NOT_FOUND,
        ),
        (
            Some("org.freedesktop.DBus.Error.InvalidArgs"),
            "settings_rejected",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            Some("org.freedesktop.DBus.Error.IOError"),
            "settings_io",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (
            Some("org.freedesktop.DBus.Error.Failed"),
            "mosd_failed",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (None, "mosd_unreachable", StatusCode::SERVICE_UNAVAILABLE),
    ] {
        let (router, cookie) = failing_app(fdo_name).await;
        let response = post_form(&router, ROTATE_PATH, "", Some(&cookie)).await;
        assert_eq!(response.status(), status, "{fdo_name:?}");
        assert_api_headers(&response, ROTATE_PATH);
        let error = envelope(response).await;
        assert_eq!(error["code"], code, "{fdo_name:?}");
        // The dot-path at fault is the entry whose kind mosd refused, not the
        // HTTP path: §2.4's member is a settings dot-path.
        assert_eq!(error["path"], json!("network.wg0"), "{fdo_name:?}");
    }
}

/// A dotted tunnel name reaches the envelope as a quoted segment, because that
/// is the dot-path an operator would type at the settings route.
#[tokio::test]
async fn the_rotate_envelope_quotes_a_dotted_interface_name() {
    let (router, cookie) = failing_app(Some("org.freedesktop.DBus.Error.InvalidArgs")).await;
    let response = post_form(
        &router,
        "/api/v1/actions/wireguard/wg.0/rotate-key",
        "",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["path"], json!(r#"network."wg.0""#));
}

/// §3.1's trap, for the one route this milestone adds: an unauthenticated call
/// answers §2.4's envelope with a 401 and **never** a redirect, in both gate
/// modes. It is a POST, so a client that followed the gate's 303 would land on
/// `GET /login`, read 200, and believe it had rotated a key.
#[tokio::test]
async fn the_rotate_route_is_401_without_a_session_in_both_gate_modes() {
    let (configured, _) = test_app(kinds_tree("hunter2secret"));
    let (fresh, _) = test_app(unconfigured_tree());

    for (mode, router) in [("configured", &configured), ("setup mode", &fresh)] {
        let response = post_form(router, ROTATE_PATH, "", None).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{mode}");
        assert_eq!(
            response.headers().get(LOCATION),
            None,
            "{mode} answered a redirect, which a script reads as success"
        );
        assert_api_headers(&response, mode);
        assert_eq!(
            envelope(response).await["code"],
            "not_authenticated",
            "{mode}"
        );
    }
}

/// The gate hands off exactly what the router serves, and nothing else: an
/// interface name carrying a path separator is not this route.
#[tokio::test]
async fn a_rotate_path_with_an_extra_segment_is_the_subtrees_404() {
    let (router, _, cookie) = kinds_app().await;
    for path in [
        "/api/v1/actions/wireguard/a/b/rotate-key",
        "/api/v1/actions/wireguard/wg0/rotate-key/extra",
        "/api/v1/actions/wireguard/wg0",
    ] {
        let response = post_form(&router, path, "", Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(envelope(response).await["code"], "not_found", "{path}");
    }
}

/// The gate and the router agree about the empty interface segment, which is a
/// path this router really serves: `{iface}` matches zero characters where
/// `{*path}` matches at least one.
///
/// The consequence is what is asserted: an unauthenticated call answers §2.4's
/// envelope rather than the gate's redirect, exactly as the named interface
/// does, and mosd is what refuses the empty name.
#[tokio::test]
async fn the_empty_interface_segment_is_the_route_and_not_a_redirect() {
    const EMPTY: &str = "/api/v1/actions/wireguard//rotate-key";

    let (router, _) = test_app(kinds_tree("hunter2secret"));
    let response = post_form(&router, EMPTY, "", None).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers().get(LOCATION), None);
    assert_eq!(envelope(response).await["code"], "not_authenticated");

    let (router, cookie) = failing_app(Some("org.freedesktop.DBus.Error.InvalidArgs")).await;
    let response = post_form(&router, EMPTY, "", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["path"], json!("network."));
}

/// There is no GET on it. A rotation replaces a tunnel's identity, so nothing
/// that merely follows a link may perform one.
#[tokio::test]
async fn the_rotate_route_has_no_get() {
    let (router, fake, cookie) = kinds_app().await;
    let response = get(&router, ROTATE_PATH, Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert!(fake.rotations().is_empty());
}

/// The document describes the route this milestone adds, with every outcome it
/// has: a client reading only `openapi.json` has to learn them.
#[test]
fn the_openapi_document_covers_the_rotate_route() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    let responses =
        &document["paths"]["/api/v1/actions/wireguard/{iface}/rotate-key"]["post"]["responses"];
    // 404 arrived with PLAN-023 M6: an interface that is not a declared entry
    // names nothing, which is what every other read on this API already
    // answered 404 for.
    for status in ["200", "401", "404", "422", "500", "503"] {
        assert!(
            responses[status].is_object(),
            "the rotate route is missing its {status}: {document}"
        );
    }
    // And it is a POST only: a documented GET would be a contract for a route
    // that does not exist.
    assert!(
        document["paths"]["/api/v1/actions/wireguard/{iface}/rotate-key"]["get"].is_null(),
        "{document}"
    );
    // The success body carries the public half and no other member.
    let properties = &document["components"]["schemas"]["WireguardRotation"]["properties"];
    assert_eq!(
        properties.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["publicKey"],
        "{document}"
    );
}

/// The fail-closed guard, driven from the failing side: a `privateKey` planted
/// in either tree comes back as the sentinel, and its value reaches no surface
/// this daemon serves.
///
/// Nothing in the shipped schema produces such a field. That is the point: the
/// denylist entry exists so that the day one appears, it is already covered.
#[tokio::test]
async fn a_private_key_planted_in_either_tree_never_reaches_the_wire() {
    const CANARY: &str = "PLANTED-PRIVATE-KEY-CANARY";
    let mut tree = kinds_tree("hunter2secret");
    tree["network"]["wg0"]["privateKey"] = json!(CANARY);
    let (router, fake) = test_app(tree);
    let mut state = network_state();
    state["wg0"]["privateKey"] = json!(CANARY);
    fake.set_state_entry("network", state);
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "/api/v1/settings/network",
        "/api/v1/settings/network.wg0",
        "/api/v1/state/network",
        "/api/v1/state/network.wg0",
        "/network",
    ] {
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = body_string(response).await;
        assert!(!body.contains(CANARY), "{path} served the canary: {body}");
    }

    // And read directly, where the structural walk has no field name left to
    // key on, the answer is the sentinel rather than the value.
    for path in [
        "/api/v1/state/network.wg0.privateKey",
        "/api/v1/settings/network.wg0.privateKey",
    ] {
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            body_string(response).await,
            format!(r#""{REDACTED}""#),
            "{path}"
        );
    }
}

/// The live-state fields M5 added reach the API surface: `kind` on every entry
/// and `publicKey` on the tunnel, passed through untouched.
#[tokio::test]
async fn the_state_route_serves_the_kind_and_the_public_key() {
    let (router, _, cookie) = kinds_app().await;

    let response = get(&router, "/api/v1/state/network", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(body["eth0"]["kind"], json!("physical"));
    assert_eq!(body["eth0.100"]["kind"], json!("vlan"));
    assert_eq!(body["br0"]["kind"], json!("bridge"));
    assert_eq!(body["wg0"]["kind"], json!("wireguard"));
    assert_eq!(body["wg0"]["publicKey"], json!(PEER_KEY));
    // No entry carries a private key, because mosd publishes none.
    for (name, entry) in body.as_object().unwrap() {
        assert!(
            entry.get("privateKey").is_none(),
            "{name} carries a private key: {entry}"
        );
    }
}

// RFCT-212: `GET /api/v1/health` (§2.4 case 3) and §2.4's envelope on a method
// a declared `/api/` route does not serve.

/// A tree with an admin password, and a live-state tree carrying the `uptime`
/// key mosd serves at read time.
fn health_app(uptime: u64) -> (Router, Arc<FakeSettings>) {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    fake.set_state_entry("uptime", json!(uptime));
    (router, fake)
}

/// §2.4 case 3's first shape, exactly: `apid` ok, `mosd` ok, and `checkedAt`
/// carrying the appliance's uptime.
///
/// `checkedAt` is asserted as a JSON **number**, which is the decision
/// `docs/task/RFCT-212.md` §3 records: there is no trusted wall clock in this
/// crate, and the one clock there is — `GET /api/v1/state/uptime` — is a bare
/// count of whole seconds. A health answer stamped any other way would be
/// stamped with a clock this appliance does not have.
#[tokio::test]
async fn health_reports_a_reachable_mosd_and_stamps_the_answer_with_uptime() {
    let (router, _) = health_app(90_061);
    let cookie = login(&router, "hunter2secret").await;

    let response = get(&router, "/api/v1/health", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "/api/v1/health");
    let body: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(body["apid"], json!("ok"));
    assert_eq!(body["mosd"], json!("ok"));
    assert_eq!(body["checkedAt"], json!(90_061));
    // Omitted rather than nulled on the reachable answer, the rule the
    // envelope's own optional member already follows.
    assert!(body.get("detail").is_none(), "{body}");
}

/// The case the route exists for: mosd is dead and the answer is still **200**.
///
/// A 503 here would be indistinguishable from the endpoint itself being down,
/// which is the confusion §2.4 case 3 says the route removes. The fixture is
/// the discriminating one: `FailingSettings` answers `GetSettings("access")` —
/// so the gate is satisfied, a session mints, and the access cache is warm —
/// and fails every state read. A health route reading a cached flag instead of
/// the bus would report `ok` here.
#[tokio::test]
async fn health_reports_an_unreachable_mosd_and_still_answers_200() {
    let (router, cookie) = failing_app(None).await;

    let response = get(&router, "/api/v1/health", Some(&cookie)).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "a dead mosd is reported in the body, never as a status code"
    );
    assert_api_headers(&response, "/api/v1/health");
    assert_eq!(response.headers().get(RETRY_AFTER), None);
    let body: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(body["apid"], json!("ok"));
    assert_eq!(body["mosd"], json!("unreachable"));
    assert!(
        body["detail"].as_str().is_some_and(|d| !d.is_empty()),
        "the unreachable answer must say why: {body}"
    );
    assert!(body.get("checkedAt").is_none(), "{body}");
}

/// The probe is a live bus call and not a flag: move the appliance's uptime and
/// the next answer moves with it, in the same router and the same session.
#[tokio::test]
async fn health_reads_the_bus_on_every_request() {
    let (router, fake) = health_app(10);
    let cookie = login(&router, "hunter2secret").await;

    let first = get(&router, "/api/v1/health", Some(&cookie)).await;
    let first: serde_json::Value = serde_json::from_str(&body_string(first).await).unwrap();
    assert_eq!(first["checkedAt"], json!(10));

    fake.set_state_entry("uptime", json!(4_711));
    let second = get(&router, "/api/v1/health", Some(&cookie)).await;
    let second: serde_json::Value = serde_json::from_str(&body_string(second).await).unwrap();
    assert_eq!(
        second["checkedAt"],
        json!(4_711),
        "a second request must have made its own call"
    );

    // And it is the state tree it reads, not the settings tree the gate's
    // cache holds.
    assert_eq!(fake.settings_reads("uptime"), 0);
}

/// Authenticated like every other `/api/v1/` route, and its refusal is §2.4's
/// envelope rather than the gate's HTML redirect (§3.1).
#[tokio::test]
async fn health_without_a_session_is_the_envelope_and_not_a_redirect() {
    let (router, _) = health_app(90_061);

    let response = get(&router, "/api/v1/health", None).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers().get(LOCATION), None);
    assert_api_headers(&response, "/api/v1/health anonymous");
    assert_eq!(envelope(response).await["code"], "not_authenticated");
}

/// `/healthz` is unchanged by any of this, and this test is the pin.
///
/// The boot health gate probes exactly this path, unauthenticated, and treats
/// any non-2xx as a failed boot (`os/rootfs/overlay-v2/usr/lib/mos/mos-health`),
/// so its path, its exemption, its status, its literal body and the fact that
/// it is not JSON are all load-bearing. §2.4 case 3 is explicit that `/healthz`
/// cannot be fixed and that the API adds a second endpoint instead — the two
/// answer different questions.
#[tokio::test]
async fn healthz_is_untouched_by_the_health_route() {
    let (router, _) = health_app(90_061);

    let response = get(&router, "/healthz", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header_value(&response, CONTENT_TYPE),
        "text/plain; charset=utf-8"
    );
    assert_eq!(body_string(response).await, "ok");

    // Still `ok` with mosd dead, which is the property §2.4 case 3 calls the
    // trap and answers with a second route rather than by changing this one.
    let (failing, _) = failing_app(None).await;
    let response = get(&failing, "/healthz", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "ok");
}

/// Every declared `/api/` route, on a method it does not serve: §2.4's
/// envelope, 405, and an `Allow` header naming what the route does serve.
///
/// The expectation names the `Allow` value per route rather than deriving it,
/// so a route that quietly gained or lost a method fails here.
#[tokio::test]
async fn a_wrong_method_on_a_declared_api_route_answers_the_envelope() {
    let (router, fake) = health_app(90_061);
    fake.set_state_entry(
        "network",
        json!({ "wg0": { "kind": "wireguard", "publicKey": "k" } }),
    );
    let cookie = login(&router, "hunter2secret").await;

    for (method, path, allow) in [
        ("POST", "/api/versions", "GET,HEAD"),
        ("POST", "/api/v1/meta", "GET,HEAD"),
        ("DELETE", "/api/v1/health", "GET,HEAD"),
        ("POST", "/api/v1/settings/hostname", "GET,HEAD,PUT"),
        ("PUT", "/api/v1/state/uptime", "GET,HEAD"),
        ("GET", "/api/v1/actions/change-password", "POST"),
        ("GET", "/api/v1/actions/wireguard/wg0/rotate-key", "POST"),
        // M7's three verbs. `GET` on each of them is the assertion that no
        // `GET` handler is declared: the HTML router refuses the same thing
        // deliberately so a browser prefetch, a crawler or a mis-clicked link
        // cannot power the appliance off, and `actions` is named `actions` so
        // no reader expects a `GET` to work there. Asserted here rather than in
        // a test of their own so the `Allow` value is checked by the same
        // per-route expectation every other declared route is checked by.
        ("GET", "/api/v1/actions/reboot", "POST"),
        ("GET", "/api/v1/actions/poweroff", "POST"),
        ("GET", "/api/v1/actions/transient-root-password", "POST"),
        ("PUT", "/api/v1/tokens", "GET,HEAD,POST"),
        ("GET", "/api/v1/tokens/deadbeef", "DELETE"),
    ] {
        let response = request(&router, method, path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method} {path}"
        );
        assert_eq!(header_value(&response, ALLOW), allow, "{method} {path}");
        assert_api_headers(&response, &format!("{method} {path}"));
        let error = envelope(response).await;
        assert_eq!(error["code"], "method_not_allowed", "{method} {path}");
        // apid, not mosd: the router refused this before any bus call.
        assert_eq!(error["source"], "apid", "{method} {path}");
        assert!(
            error["message"].is_string(),
            "{method} {path}: §2.4 requires a message"
        );
        // A wrong method names no settings dot-path, so the optional member is
        // absent rather than empty.
        assert!(error.get("path").is_none(), "{method} {path}: {error}");
    }
}

/// The 405 is the router's answer and not an authenticated one, which is what
/// the shipped tree already did: `is_declared_api_route` tests the path and not
/// the method, so the gate hands a wrong-method request off exactly as it hands
/// off a right one. Recorded because it is a property, not an accident.
#[tokio::test]
async fn the_405_envelope_does_not_depend_on_a_session() {
    let (router, _) = health_app(90_061);

    let response = request(&router, "POST", "/api/v1/meta", None, None).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(response.headers().get(LOCATION), None);
    assert_eq!(header_value(&response, ALLOW), "GET,HEAD");
    assert_eq!(envelope(response).await["code"], "method_not_allowed");
}

/// The asset router's 405 is outside `/api/` and is not unified with the one
/// above: `docs/design/api.md` §4.2 condition 2 gives it a bare body, its own
/// `Allow: GET, HEAD` and no `Content-Type` at all, and §2.4's envelope is a
/// promise about `/api/v1/` routes only.
///
/// Asserted here as a contrast — the same method against both routers in one
/// test — so that a later attempt to give the whole server one 405 fails with
/// the distinction printed rather than silently widening a promise.
#[tokio::test]
async fn the_asset_router_405_is_not_the_api_envelope() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    let asset = request(&router, "POST", "/settings/network", Some(&cookie), None).await;
    assert_eq!(asset.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_value(&asset, ALLOW), "GET, HEAD");
    assert!(asset.headers().get(CONTENT_TYPE).is_none());
    assert_eq!(body_string(asset).await, "");

    let api = request(&router, "POST", "/api/v1/meta", Some(&cookie), None).await;
    assert_eq!(api.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header_value(&api, CONTENT_TYPE), "application/json");
    assert_eq!(envelope(api).await["code"], "method_not_allowed");
}

/// The reserved subtree's own 404 is untouched by the 405: a path the API does
/// not declare is still `not_found`, on every method, health-adjacent spellings
/// included.
#[tokio::test]
async fn the_api_fallback_404_survives_the_405() {
    let (router, _) = health_app(90_061);
    let cookie = login(&router, "hunter2secret").await;

    for (method, path) in [
        ("GET", "/api/v1/health/extra"),
        ("POST", "/api/v1/health/extra"),
        ("GET", "/api/v1/healthz"),
        ("DELETE", "/api/v1/nope"),
        ("POST", "/api/nope"),
    ] {
        let response = request(&router, method, path, Some(&cookie), Some(BROWSER_ACCEPT)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(response.headers().get(ALLOW), None, "{method} {path}");
        assert_eq!(
            envelope(response).await["code"],
            "not_found",
            "{method} {path}"
        );
    }
}

/// The document describes the route and the outcome this milestone adds: a
/// client reading only `openapi.json` has to be able to learn both.
#[test]
fn the_openapi_document_covers_health_and_the_405() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    let health = &document["paths"]["/api/v1/health"]["get"]["responses"];
    assert!(health["200"].is_object(), "{health}");
    assert!(health["401"].is_object(), "{health}");
    assert!(health["405"].is_object(), "{health}");

    let schema = &document["components"]["schemas"]["ApiHealth"];
    let required = schema["required"].as_array().expect("required members");
    for member in ["apid", "mosd"] {
        assert!(
            required.iter().any(|name| name == member),
            "{member} is always on the wire: {schema}"
        );
    }
    for member in ["checkedAt", "detail"] {
        assert!(
            !required.iter().any(|name| name == member),
            "{member} is outcome-dependent and must be optional: {schema}"
        );
    }

    // Every declared path now documents the 405 it can answer.
    let paths = document["paths"].as_object().expect("paths");
    for (path, item) in paths {
        for (method, operation) in item.as_object().expect("an operation map") {
            assert!(
                operation["responses"]["405"].is_object(),
                "{method} {path} answers a 405 it does not document"
            );
        }
    }
}

// RFCT-213: §3.2's bearer token — the credential, the three `/api/v1/tokens`
// routes, and the bootstrap pane under §6.3's reserved prefix.

/// A stored entry and the plaintext that opens it, both derived from `index`
/// so two calls differ in every field identity is keyed on.
///
/// Built here rather than minted, because a test that needs a full list needs
/// 32 of them and the mint is one of the things under test.
fn seeded_token(index: usize) -> (serde_json::Value, String) {
    let id = format!("{index:08x}");
    let secret = format!("{index:064x}");
    (
        json!({
            "id": id,
            "name": format!("seeded-{index}"),
            "hash": crate::token::digest(&secret),
            "created": 1,
        }),
        format!("mos_{id}_{secret}"),
    )
}

/// A configured tree holding `count` usable tokens, with their plaintexts.
fn token_tree(password: &str, count: usize) -> (serde_json::Value, Vec<String>) {
    let (entries, wires): (Vec<_>, Vec<_>) = (0..count).map(seeded_token).unzip();
    let mut tree = configured_tree(password);
    tree["access"]["apiTokens"] = json!(entries);
    (tree, wires)
}

/// A request carrying a bearer token and **no cookie**, which is what makes
/// every assertion below about the token rather than about the session.
async fn bearer(
    router: &Router,
    method: &str,
    path: &str,
    token: &str,
) -> Response<axum::body::Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    send(router, builder.body(Body::empty()).unwrap()).await
}

/// A JSON body carrying a bearer token and no cookie.
async fn bearer_json(
    router: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: &str,
) -> Response<axum::body::Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"));
    send(router, builder.body(Body::from(body.to_string())).unwrap()).await
}

/// Mint through §3.2's bootstrap and return the plaintext.
///
/// The pane is the only mint a browser can reach, so this is also the path a
/// first token has to come down: every bearer assertion below that starts from
/// a session starts here.
async fn mint_via_pane(router: &Router, cookie: &str, name: &str) -> String {
    let response = post_form(
        router,
        "/builtin/tokens",
        &format!("name={name}"),
        Some(cookie),
    )
    .await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "the mint pane answers 200"
    );
    let body = body_string(response).await;
    let rest = body
        .split_once("<pre>")
        .unwrap_or_else(|| panic!("the plaintext is displayed once, in a <pre>: {body}"))
        .1;
    rest.split_once("</pre>")
        .expect("a closed <pre>")
        .0
        .to_string()
}

/// The pane's sentence, ratified by `docs/task/RFCT-210.md` §3 and asserted
/// byte for byte.
///
/// Token revocation on a password change stays out — a password change would
/// otherwise destroy N credentials the operator cannot see, with no
/// confirmation and no undo — so the pane has to say so. A paraphrase would
/// quietly drop the containment advice, which is the part of it that matters,
/// so the assertion is verbatim rather than on keywords.
#[tokio::test]
async fn the_password_pane_carries_the_ratified_token_sentence() {
    const SENTENCE: &str = "API tokens are not affected. Changing this password signs other browsers out, but every API token keeps working. If you are changing this password because you think someone else has access, revoke your API tokens as well, and check the SSH authorized keys — every one of them is a root key.";

    let (router, _) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let body = body_string(get(&router, "/password", Some(&cookie)).await).await;
    assert!(
        body.contains(SENTENCE),
        "the pane must carry it verbatim: {body}"
    );
}

/// The bootstrap end to end: a browser session mints, the plaintext appears
/// once, the tree keeps only a digest, and the token then authenticates the
/// API on its own.
#[tokio::test]
async fn the_bootstrap_pane_mints_a_token_that_authenticates_the_api() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    let wire = mint_via_pane(&router, &cookie, "ci-deploy").await;

    // The write is the whole array at the collection's dot-path: the dot-path
    // syntax has no array indexing.
    assert_eq!(fake.set_paths(), vec!["access.apiTokens".to_string()]);
    let stored = fake.get_settings("access.apiTokens").await.unwrap();
    let entry = &stored[0];
    assert_eq!(entry["name"], json!("ci-deploy"));
    assert_eq!(
        entry["hash"],
        json!(crate::token::digest(wire.rsplit('_').next().unwrap()))
    );
    // Only the digest is stored. The plaintext is in one response and nowhere
    // else, ever.
    assert!(!stored.to_string().contains(&wire), "{stored}");

    // The token is a credential on its own: no cookie on this request.
    let response = bearer(&router, "GET", "/api/v1/meta", &wire).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, meta_body());
}

/// Amendment 1's dual-credential ruling, on the routes it names: every route
/// that shipped before the token takes either credential, and neither of them
/// stopped working.
#[tokio::test]
async fn every_shipped_api_route_takes_a_bearer_or_the_cookie() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, fake) = test_app(tree);
    fake.set_state_entry("uptime", json!(42));
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "/api/v1/meta",
        "/api/v1/health",
        "/api/v1/settings/hostname",
        "/api/v1/state/uptime",
    ] {
        assert_eq!(
            bearer(&router, "GET", path, &wires[0]).await.status(),
            StatusCode::OK,
            "{path} must accept a bearer token"
        );
        assert_eq!(
            get(&router, path, Some(&cookie)).await.status(),
            StatusCode::OK,
            "{path} must keep accepting the session cookie"
        );
    }

    // The one shipped write, which the amendment names beside the four reads.
    let response = bearer_json(
        &router,
        "POST",
        "/api/v1/actions/change-password",
        &wires[0],
        r#"{"currentPassword":"hunter2secret","newPassword":"newsecret9"}"#,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

/// The boundary inside Amendment 1: the three token routes take a bearer and
/// nothing else, and a session cookie presented to any of them is a 401.
///
/// §3.2 rejects the cookie-accepting mint by name, because it would put a
/// permanent-credential factory inside the surface §3.3 makes its strongest
/// statement about. The amendment preserves the credentials of routes that
/// already shipped, and these had not.
#[tokio::test]
async fn the_token_routes_refuse_a_session_cookie() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    for (method, path, body) in [
        ("GET", "/api/v1/tokens", None),
        ("POST", "/api/v1/tokens", Some(r#"{"name":"ci"}"#)),
        ("DELETE", "/api/v1/tokens/00000000", None),
    ] {
        let response = match body {
            Some(body) => post_json(&router, path, body, Some(&cookie)).await,
            None => request(&router, method, path, Some(&cookie), None).await,
        };
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path} must refuse a cookie"
        );
        // §2.4's envelope and not the gate's HTML redirect.
        assert_eq!(response.headers().get(LOCATION), None, "{method} {path}");
        assert_eq!(
            envelope(response).await["code"],
            "not_authenticated",
            "{method} {path}"
        );
    }
    assert!(
        fake.set_paths().is_empty(),
        "a refused request must write nothing: {:?}",
        fake.set_paths()
    );

    // The same three, with the bearer they do accept.
    assert_eq!(
        bearer(&router, "GET", "/api/v1/tokens", &wires[0])
            .await
            .status(),
        StatusCode::OK
    );
}

/// The three routes as a lifecycle: mint, list, revoke, and the revoked token
/// stops being accepted on the next request.
#[tokio::test]
async fn the_api_mints_lists_and_revokes() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, _) = test_app(tree);

    let response = bearer_json(
        &router,
        "POST",
        "/api/v1/tokens",
        &wires[0],
        r#"{"name":"ci-deploy"}"#,
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_api_headers(&response, "POST /api/v1/tokens");
    let minted: serde_json::Value =
        serde_json::from_str(&body_string(response).await).expect("a JSON body");
    let wire = minted["token"].as_str().expect("the plaintext").to_string();
    let id = minted["id"].as_str().expect("the id").to_string();
    assert_eq!(minted["name"], json!("ci-deploy"));
    assert!(crate::token::parse(&wire).is_some(), "{wire}");

    // The listing carries identity and never a secret — neither the digest
    // that is stored nor the plaintext that is not.
    let response = bearer(&router, "GET", "/api/v1/tokens", &wire).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(
        !body.contains(&wire),
        "the plaintext reached a listing: {body}"
    );
    assert!(
        !body.contains("hash"),
        "the digest reached a listing: {body}"
    );
    let listed: serde_json::Value = serde_json::from_str(&body).unwrap();
    let names: Vec<&str> = listed
        .as_array()
        .expect("an array")
        .iter()
        .map(|row| row["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["seeded-0", "ci-deploy"]);

    // Revocation takes effect on the next request.
    let response = bearer(&router, "DELETE", &format!("/api/v1/tokens/{id}"), &wire).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        bearer(&router, "GET", "/api/v1/tokens", &wire)
            .await
            .status(),
        StatusCode::UNAUTHORIZED,
        "a revoked token must stop working"
    );
    assert_eq!(
        bearer(&router, "GET", "/api/v1/tokens", &wires[0])
            .await
            .status(),
        StatusCode::OK,
        "revoking one token must not revoke another"
    );
}

/// The cap is answered at the route, in the caller's terms.
///
/// The store makes a full list a hard refusal, so without a check here the
/// caller meets it as a failed write — a 500 about mosd — instead of an answer
/// about the request. 409 and not 422: the body is well formed and what refuses
/// it is the collection's state.
#[tokio::test]
async fn a_full_token_list_refuses_the_mint_at_the_route() {
    let (tree, wires) = token_tree("hunter2secret", mosd_settings::MAX_TOKENS);
    let (router, fake) = test_app(tree);

    let response = bearer_json(
        &router,
        "POST",
        "/api/v1/tokens",
        &wires[0],
        r#"{"name":"one-too-many"}"#,
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error = envelope(response).await;
    assert_eq!(error["code"], "token_limit_reached");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!("access.apiTokens"));
    assert!(
        error["message"].as_str().unwrap().contains("32"),
        "the message names the cap: {error}"
    );
    assert!(
        fake.set_paths().is_empty(),
        "a refused mint must write nothing: {:?}",
        fake.set_paths()
    );

    // The pane refuses it too, and says so where the operator is looking.
    let cookie = login(&router, "hunter2secret").await;
    let response = post_form(
        &router,
        "/builtin/tokens",
        "name=one-too-many",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body_string(response).await.contains("maximum of 32"));
    assert!(fake.set_paths().is_empty());
}

/// A name the store would refuse is refused at the route, as a 422 about the
/// body rather than as a failed write.
#[tokio::test]
async fn a_name_the_store_refuses_is_a_422() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, fake) = test_app(tree);

    for body in [r#"{"name":""}"#, r#"{"name":"ci\ndeploy"}"#] {
        let response = bearer_json(&router, "POST", "/api/v1/tokens", &wires[0], body).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
        assert_eq!(
            envelope(response).await["code"],
            "validation_failed",
            "{body}"
        );
    }
    // And a body that is not this shape at all is a 400, not a 422.
    let response = bearer_json(&router, "POST", "/api/v1/tokens", &wires[0], "{}").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(envelope(response).await["code"], "request_invalid");

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The collection error contract (`docs/task/RFCT-210.md` §2.4): a well-formed
/// identifier that names nothing is **404**, and 422 is reserved for an
/// identifier that is not well formed at all.
///
/// Paired with `the_builtin_revoke_pane_answers_422_where_the_api_answers_404`,
/// which asserts the HTML surface's deliberately different answer to the same
/// condition.
#[tokio::test]
async fn an_absent_token_id_is_404_and_a_malformed_one_is_422() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, fake) = test_app(tree);

    // Well formed, and no entry carries it.
    let response = bearer(&router, "DELETE", "/api/v1/tokens/deadbeef", &wires[0]).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!("access.apiTokens"));

    // Not an identifier at all: well formed and absent is a different answer
    // from not well formed, and they must not share a status.
    for path in ["/api/v1/tokens/NOTHEX", "/api/v1/tokens/ci-deploy"] {
        let response = bearer(&router, "DELETE", path, &wires[0]).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
        assert_eq!(
            envelope(response).await["code"],
            "validation_failed",
            "{path}"
        );
    }

    // The empty spelling is not this route -- measured, and not assumed from
    // the rotate action, whose empty `{iface}` segment is interior rather than
    // trailing and IS served. `/api/v1/tokens/` reaches the reserved subtree's
    // own not-found handler, so `token_id` must not release it to the gate: a
    // path the gate released to a route that does not exist would answer a 404
    // where an unauthenticated caller is supposed to be redirected.
    let cookie = login(&router, "hunter2secret").await;
    let response = request(&router, "DELETE", "/api/v1/tokens/", Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(envelope(response).await["code"], "not_found");

    let response = bearer(&router, "DELETE", "/api/v1/tokens/", &wires[0]).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The HTML half of the split recorded in `docs/task/RFCT-210.md` §2.4: the
/// pane answers **422** where `DELETE /api/v1/tokens/{id}` answers **404**, on
/// the same condition.
///
/// The pane's body is a re-rendered page, no consumer on that surface reads the
/// status, and the condition really is the re-submit-the-form one — the list
/// may have changed since the page was loaded. Paired with
/// `an_absent_token_id_is_404_and_a_malformed_one_is_422`.
#[tokio::test]
async fn the_builtin_revoke_pane_answers_422_where_the_api_answers_404() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    let html = post_form(
        &router,
        "/builtin/tokens/revoke",
        "id=deadbeef",
        Some(&cookie),
    )
    .await;
    let api = bearer(&router, "DELETE", "/api/v1/tokens/deadbeef", &wires[0]).await;

    assert_eq!(html.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(api.status(), StatusCode::NOT_FOUND);
    assert!(body_string(html).await.contains("reload it and try again"));
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The pane revokes, which is §8.1's capability (iii) in full: an operator
/// holding only a browser can drop a leaked token without first holding
/// another one.
#[tokio::test]
async fn the_builtin_pane_lists_and_revokes_without_a_token() {
    let (tree, wires) = token_tree("hunter2secret", 2);
    let (router, _) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    // The pane lists identity and never a secret.
    let body = body_string(get(&router, "/builtin/", Some(&cookie)).await).await;
    assert!(
        body.contains("seeded-0") && body.contains("seeded-1"),
        "{body}"
    );
    assert!(!body.contains(&wires[0]), "a plaintext reached the pane");
    assert!(!body.contains(&crate::token::digest(wires[0].rsplit('_').next().unwrap())));

    let response = post_form(
        &router,
        "/builtin/tokens/revoke",
        "id=00000000",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body_string(response).await.contains("has been revoked"));

    assert_eq!(
        bearer(&router, "GET", "/api/v1/meta", &wires[0])
            .await
            .status(),
        StatusCode::UNAUTHORIZED,
        "the revoked token stops working on the next request"
    );
    assert_eq!(
        bearer(&router, "GET", "/api/v1/meta", &wires[1])
            .await
            .status(),
        StatusCode::OK
    );
}

/// **No GET form of the mint exists, and none may ever be added.**
///
/// `SameSite=Lax` withholds the session cookie from a cross-site form POST and
/// permits it on a top-level cross-site GET navigation, so a GET mint would be
/// a permanent-credential factory reachable from any link an operator clicks.
/// The assertion is that neither `/builtin` route answers a GET at all, and
/// that nothing was written when one was tried.
#[tokio::test]
async fn no_get_reaches_the_bootstrap_mint_or_its_revoke() {
    let (router, fake) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    for path in ["/builtin/tokens", "/builtin/tokens/revoke"] {
        let response = get(&router, path, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path} must not be served"
        );
        assert_eq!(header_value(&response, ALLOW), "POST", "{path}");
    }
    assert!(
        fake.set_paths().is_empty(),
        "a GET must write nothing: {:?}",
        fake.set_paths()
    );
}

/// **Bearer verification is not rate limited, and must not be.**
///
/// 256 bits of `OsRng` is not guessable online, and the login backoff is a
/// single global counter (`auth::GuardStore`), so a shared counter on the token
/// path would let anyone holding a bad token lock out every script *and* every
/// login on the appliance. The assertion is both halves: a good token still
/// works after a long run of bad ones, and the password path's counter was
/// never touched by them.
#[tokio::test]
async fn a_run_of_bad_bearer_tokens_locks_nobody_out() {
    let (tree, wires) = token_tree("hunter2secret", 1);
    let (router, _) = test_app(tree);

    for index in 0..50 {
        // Both misses, alternating: the stored id with the wrong secret, and
        // an id nothing carries. The first is the one a lookup alone would
        // pass, so it has to be in the run.
        let forged = if index % 2 == 0 {
            format!("mos_00000000_{index:063x}f")
        } else {
            format!("mos_ffffffff_{index:064x}")
        };
        assert_eq!(
            bearer(&router, "GET", "/api/v1/meta", &forged)
                .await
                .status(),
            StatusCode::UNAUTHORIZED,
            "attempt {index}"
        );
    }

    assert_eq!(
        bearer(&router, "GET", "/api/v1/meta", &wires[0])
            .await
            .status(),
        StatusCode::OK,
        "a valid token must not be locked out by other tokens' failures"
    );
    // The login guard is global; if the token path armed it, this would be a
    // 429 rather than a redirect.
    let response = post_form(&router, "/login", "password=hunter2secret", None).await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
}

/// The published document describes the routes this milestone adds, and
/// describes them as the code serves them.
#[test]
fn the_openapi_document_covers_the_token_routes() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    let collection = &document["paths"]["/api/v1/tokens"];
    for (method, statuses) in [
        ("get", vec!["200", "401"]),
        ("post", vec!["201", "400", "401", "409", "422"]),
    ] {
        for status in statuses {
            assert!(
                collection[method]["responses"][status].is_object(),
                "{method} /api/v1/tokens must document {status}: {collection}"
            );
        }
    }

    let item = &document["paths"]["/api/v1/tokens/{id}"]["delete"]["responses"];
    for status in ["204", "401", "404", "422"] {
        assert!(
            item[status].is_object(),
            "DELETE must document {status}: {item}"
        );
    }

    // The listing's row carries identity and never a secret, in the document
    // as well as on the wire.
    let summary = &document["components"]["schemas"]["ApiTokenSummary"]["properties"];
    let members: Vec<&str> = summary
        .as_object()
        .expect("properties")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(members, vec!["created", "id", "name"], "{summary}");

    // The plaintext is a member of the mint's response and of nothing else.
    let minted = &document["components"]["schemas"]["MintedToken"]["properties"];
    assert!(minted["token"].is_object(), "{minted}");
}

// PLAN-023 M4 (`docs/task/RFCT-240.md`): the four scalar settings writes, the
// redaction-sentinel refusal, and the write-refusal list.

/// `PUT` a JSON body with a session cookie -- the second of the two
/// credentials this route takes.
async fn put_json(
    router: &Router,
    path: &str,
    body: &str,
    cookie: Option<&str>,
) -> Response<axum::body::Body> {
    let mut builder = Request::builder()
        .method("PUT")
        .uri(path)
        .header(CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, format!("apid_session={cookie}"));
    }
    send(router, builder.body(Body::from(body.to_string())).unwrap()).await
}

/// A tree with all four writable paths already present, so a write is a change
/// of value and never a creation -- the creation case is what the refusal list
/// exists to prevent, and it must not be smuggled into the happy path.
fn writable_tree(password: &str) -> serde_json::Value {
    let mut tree = configured_tree(password);
    tree["access"]["ssh"] = json!({ "enabled": false });
    tree["container"] = json!({ "enabled": false });
    tree["mqtt"] = json!({ "enabled": false });
    tree
}

/// The four dot-paths `docs/task/RFCT-210.md` §2.2 admits, each written and
/// each read back through the route that answers for it.
///
/// 204 and an empty body: the value the caller sent is the value that was
/// written, so there is nothing for a response body to add that a `GET` does
/// not already say.
#[tokio::test]
async fn the_write_route_writes_the_four_scalar_settings() {
    let (router, fake) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    for (path, body) in [
        ("hostname", r#""router7""#),
        ("access.ssh.enabled", "true"),
        ("container.enabled", "true"),
        ("mqtt.enabled", "true"),
    ] {
        let url = format!("/api/v1/settings/{path}");
        let response = put_json(&router, &url, body, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT, "{path}");
        assert_eq!(header_value(&response, CACHE_CONTROL), "no-store", "{path}");
        assert_eq!(body_string(response).await, "", "{path} answers no body");

        let read = get(&router, &url, Some(&cookie)).await;
        assert_eq!(read.status(), StatusCode::OK, "{path}");
        assert_eq!(
            body_string(read).await,
            body,
            "{path} reads back as written"
        );
    }

    assert_eq!(
        fake.set_paths(),
        vec![
            "hostname",
            "access.ssh.enabled",
            "container.enabled",
            "mqtt.enabled"
        ],
        "one bus write per request, at the dot-path the URL named"
    );
}

/// §2.2's round trip, driven exactly as the client that motivates the rule
/// would drive it: read a subtree, hand it back, and find the credential
/// intact rather than replaced by the sentinel.
///
/// *"A redacted field is **read-only through the API**: a `PUT` whose body
/// contains `"<redacted>"` is rejected at 422 rather than written, because
/// writing the sentinel would silently destroy the credential."*
/// (`docs/design/api.md:1292-1295`) Without the refusal this test's `PUT`
/// succeeds and `access.webAdmin.password_hash` becomes the literal string
/// `<redacted>`, which no password verifies against and no operator can undo.
#[tokio::test]
async fn a_write_carrying_the_redaction_sentinel_is_refused_and_writes_nothing() {
    let (router, fake) = test_app(secret_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    // The exact bytes a client would have read, sentinels and all.
    let read = get(&router, "/api/v1/settings/access", Some(&cookie)).await;
    assert_eq!(read.status(), StatusCode::OK);
    let redacted = body_string(read).await;
    assert!(
        redacted.contains(REDACTED),
        "the fixture must carry a redacted field: {redacted}"
    );

    let response = put_json(&router, "/api/v1/settings/access", &redacted, Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_api_headers(&response, "the sentinel refusal");
    let error = envelope(response).await;
    assert_eq!(error["code"], "validation_failed");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!("access"));
    assert!(
        error["message"]
            .as_str()
            .is_some_and(|text| text.contains(REDACTED)),
        "the message has to name what it refused: {error}"
    );

    // Nothing reached the bus, and the credential the sentinel stood for still
    // verifies -- which is the whole of what this rule protects.
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert!(
        !login(&router, "hunter2secret").await.is_empty(),
        "the admin hash must still be the hash"
    );

    // The same rule on an allowlisted path, where the sentinel is the whole
    // body rather than a field inside one: a client that read
    // `access.webAdmin.password_hash` got a bare `"<redacted>"` string back.
    let response = put_json(
        &router,
        "/api/v1/settings/hostname",
        &format!("\"{REDACTED}\""),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["code"], "validation_failed");
    assert!(fake.set_paths().is_empty());
}

/// The refusal list: a dot-path the schema has and this route does not write
/// is **409 `settings_read_only`**, answered before any bus call.
///
/// 409 and not 422 for the reason §2.4 already spends it on and the mint route
/// already uses: the body is well formed and nothing about it is wrong, and
/// what refuses it is the state of the surface.
#[tokio::test]
async fn every_dot_path_outside_the_allowlist_is_refused_with_409() {
    let (router, fake) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "schema_version",
        "network",
        "network.eth0",
        "network.eth0.dhcp",
        "access",
        "access.ssh",
        "access.ssh.authorizedKeys",
        "access.webAdmin.password_hash",
        "provisioning",
        "wifi",
        "wifi.client.networks",
        "container",
        "mqtt",
        "mqtt.listen.port",
        // `.` is the whole tree, not a malformed path: `Settings::set`
        // documents `""` and `"."` as replacing the root, so it is a real path
        // this route refuses rather than one it cannot parse.
        ".",
    ] {
        let response = put_json(
            &router,
            &format!("/api/v1/settings/{path}"),
            "true",
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
        assert_api_headers(&response, path);
        let error = envelope(response).await;
        assert_eq!(error["code"], "settings_read_only", "{path}");
        assert_eq!(error["source"], "apid", "{path}");
        assert_eq!(error["path"], json!(path), "{path}");
    }

    assert!(
        fake.set_paths().is_empty(),
        "a refused write must reach no bus call, got {:?}",
        fake.set_paths()
    );
}

/// Two refusals carry a message the general one cannot, and both are asserted
/// because both are the reason the path is refused rather than decoration.
#[tokio::test]
async fn the_two_named_refusals_say_why_rather_than_only_that() {
    let (router, _) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    // `schema_version` is read-only in the tree itself, not merely here: no
    // later milestone widens this route to cover it.
    let response = put_json(
        &router,
        "/api/v1/settings/schema_version",
        "9",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let message = envelope(response).await["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        message.contains("read-only in the settings tree itself"),
        "{message}"
    );

    // `network` names the typed route that owns it, because a raw write here
    // creates an entry of the default kind rather than refusing an interface
    // the device does not have (`docs/task/RFCT-210.md` §2.4).
    let response = put_json(
        &router,
        "/api/v1/settings/network.wg9",
        r#"{"dhcp": true}"#,
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let message = envelope(response).await["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        message.contains("PUT /api/v1/network/{iface}"),
        "the refusal must name the route that does own it: {message}"
    );
}

/// §2.4's rule, on the write route: **well-formed but absent is 404, not
/// well-formed is 422**, and they must not share a status.
///
/// "Absent" is decided on the first segment, and that is a statement about
/// writes. A write may legitimately create the leaf it names -- `Settings::set`
/// creates missing intermediates -- so a missing leaf is not an absent
/// resource; a top-level key the typed schema has no field for is, because no
/// write can ever make the tree deserialize with one.
#[tokio::test]
async fn an_absent_root_is_404_and_a_malformed_path_is_422() {
    let (router, fake) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    for path in ["hostnam", "netwrok.eth0", "acess.ssh.enabled", "sshd"] {
        let response = put_json(
            &router,
            &format!("/api/v1/settings/{path}"),
            "true",
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        let error = envelope(response).await;
        assert_eq!(error["code"], "settings_not_found", "{path}");
        assert!(
            error["message"]
                .as_str()
                .is_some_and(|text| text.contains(path)),
            "{path}: {error}"
        );
    }

    for path in [
        "access..ssh",
        "access.\"ssh",
        "access.\"ssh\"x",
        "hostname.",
    ] {
        let response = put_json(
            &router,
            &format!("/api/v1/settings/{path}"),
            "true",
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "validation_failed", "{path}");
    }

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The eight top-level keys the write route's not-found rule is derived from.
///
/// `is_settings_root` reads them out of `Settings::default()` rather than
/// carrying a list, so this asserts the derivation rather than a copy of it: a
/// field added to `Settings` changes this expectation and the route together,
/// and a `#[serde(skip_serializing_if)]` on a top-level field -- which would
/// drop a real root out of the default tree and turn its 409 into a 404 --
/// fails here.
#[test]
fn the_settings_schema_has_the_eight_roots_the_write_route_knows() {
    let tree = serde_json::to_value(mosd_settings::Settings::default()).unwrap();
    let mut keys: Vec<&str> = tree
        .as_object()
        .expect("the settings tree is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "access",
            "container",
            "hostname",
            "mqtt",
            "network",
            "provisioning",
            "schema_version",
            "wifi",
        ]
    );
}

/// Each writable path's value has one shape, and a body of the wrong shape is
/// a 422 that names the shape rather than a write of whatever arrived.
///
/// The hostname sentence is `HOSTNAME_RULES`, the same string the form pane
/// puts in its error box: one rule, one wording, two surfaces.
#[tokio::test]
async fn a_body_of_the_wrong_shape_is_refused_and_not_written() {
    let (router, fake) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;

    for (path, body, expected) in [
        ("hostname", "true", "text"),
        ("hostname", "7", "text"),
        ("hostname", r#"["a"]"#, "text"),
        ("hostname", r#""-nope-""#, "hyphen"),
        ("hostname", r#""""#, "1-63"),
        ("hostname", r#""has space""#, "1-63"),
        ("access.ssh.enabled", r#""yes""#, "switch"),
        ("container.enabled", "1", "switch"),
        ("mqtt.enabled", "null", "switch"),
    ] {
        let response = put_json(
            &router,
            &format!("/api/v1/settings/{path}"),
            body,
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path} <- {body}"
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "validation_failed", "{path} <- {body}");
        assert_eq!(error["path"], json!(path), "{path} <- {body}");
        assert!(
            error["message"]
                .as_str()
                .is_some_and(|text| text.contains(expected)),
            "{path} <- {body}: {error}"
        );
    }

    // Not JSON at all is 400 and not 422: the request never became a value to
    // validate. Same classification the mint route gives the same condition.
    let response = put_json(
        &router,
        "/api/v1/settings/hostname",
        "router7",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(envelope(response).await["code"], "request_invalid");

    // A body with no `Content-Type: application/json` is the same refusal.
    let response = send(
        &router,
        Request::builder()
            .method("PUT")
            .uri("/api/v1/settings/hostname")
            .header(COOKIE, format!("apid_session={cookie}"))
            .body(Body::from(r#""router7""#))
            .unwrap(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(envelope(response).await["code"], "request_invalid");

    assert!(
        fake.set_paths().is_empty(),
        "a refused write must write nothing, got {:?}",
        fake.set_paths()
    );
}

/// The credential: bearer **or** cookie, which is PLAN-023 Amendment 1's
/// ruling applied to a new route. The bearer-only rule is about the token
/// routes specifically, so this route matches the shipped reads instead.
#[tokio::test]
async fn the_write_route_takes_a_bearer_and_a_cookie_and_refuses_neither_silently() {
    let (router, fake) = test_app(writable_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let token = mint_via_pane(&router, &cookie, "ci").await;

    let response = bearer_json(
        &router,
        "PUT",
        "/api/v1/settings/hostname",
        &token,
        r#""from-bearer""#,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(fake.set_paths().contains(&"hostname".to_string()));

    // No credential at all: §2.4's envelope and never the gate's redirect, in
    // both gate modes -- §3.1's trap, which a write route inherits and which
    // inheriting is not the same as asserting.
    let (fresh, _) = test_app(unconfigured_tree());
    for (mode, router) in [("configured", &router), ("setup mode", &fresh)] {
        let response = put_json(router, "/api/v1/settings/hostname", r#""x""#, None).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{mode}");
        assert_eq!(response.headers().get(LOCATION), None, "{mode}");
        assert_api_headers(&response, mode);
        assert_eq!(
            envelope(response).await["code"],
            "not_authenticated",
            "{mode}"
        );
    }
}

/// A write mosd refuses is classified by §2.4's table exactly as a read is:
/// the route adds no second opinion, and mosd's own message comes through.
#[tokio::test]
async fn a_write_mosd_refuses_carries_mosds_classification() {
    for (fdo_name, code, status) in [
        (
            "org.freedesktop.DBus.Error.InvalidArgs",
            "settings_rejected",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "com.mos.mosd1.Error.ReadOnly",
            "settings_read_only",
            StatusCode::CONFLICT,
        ),
        (
            "org.freedesktop.DBus.Error.IOError",
            "settings_io",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        let (router, cookie) = failing_app(Some(fdo_name)).await;
        let response = put_json(
            &router,
            "/api/v1/settings/hostname",
            r#""router7""#,
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), status, "{fdo_name}");
        let error = envelope(response).await;
        assert_eq!(error["code"], code, "{fdo_name}");
        assert_eq!(error["source"], "mosd", "{fdo_name}");
        assert_eq!(error["message"], MOSD_MESSAGE, "{fdo_name}");
        assert_eq!(error["path"], json!("hostname"), "{fdo_name}");
    }
}

/// The document describes the served surface: a client reading only
/// `openapi.json` has to learn the write route, every outcome it has, and that
/// its body is a bare JSON value.
#[test]
fn the_openapi_document_covers_the_settings_write() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    let write = &document["paths"]["/api/v1/settings/{path}"]["put"];
    for status in [
        "204", "400", "401", "404", "405", "409", "422", "500", "503",
    ] {
        assert!(
            write["responses"][status].is_object(),
            "the settings write must document {status}: {write}"
        );
    }
    assert_eq!(
        write["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/SettingsWrite",
        "{write}"
    );

    // The read is unchanged by the write sharing its path.
    assert!(
        document["paths"]["/api/v1/settings/{path}"]["get"]["responses"]["200"].is_object(),
        "{document}"
    );
}

// PLAN-023 M5 (`docs/task/RFCT-241.md`): the two array collections that already
// exist in the settings tree -- the SSH authorized keys, identified by
// fingerprint, and the WiFi station's known networks, identified by SSID.

/// The whole body as JSON, for the collection routes that answer a document
/// rather than §2.4's envelope.
async fn body_json(response: Response<axum::body::Body>) -> serde_json::Value {
    let body = body_string(response).await;
    serde_json::from_str(&body).unwrap_or_else(|_| panic!("a JSON body, got: {body}"))
}

/// The sentence `docs/task/RFCT-210.md` section 2.5 requires on the listing and
/// on the add, spelled out here rather than read from the constant: a test that
/// compares the code against itself cannot notice the sentence being reworded.
const ROOT_KEY_NOTICE_TEXT: &str = "Every authorized key is a root key.";

/// The SSH collection's dot-path, as every envelope it raises names it.
const SSH_KEYS_DOT_PATH: &str = "access.ssh.authorizedKeys";

/// The WiFi collection's dot-path.
const WIFI_NETWORKS_DOT_PATH: &str = "wifi.client.networks";

/// The item route of one stored key.
fn ssh_key_url(fingerprint: &str) -> String {
    format!(
        "/api/v1/ssh/authorized-keys/{}",
        fingerprint.replace('/', "%2F")
    )
}

/// A configured tree carrying a `wifi.client` subtree holding `networks`.
///
/// The subtree is present even when the list is empty, which is what a real
/// tree looks like: `WifiClientSettings::networks` carries no
/// `skip_serializing_if`, so mosd's serialization of the typed tree always has
/// it.
fn wifi_tree(networks: serde_json::Value) -> serde_json::Value {
    let mut tree = configured_tree("hunter2secret");
    tree["wifi"] = json!({
        "client": { "enabled": false, "interface": "wlan0", "networks": networks },
        "ap": { "mode": "off", "channel": 6 },
    });
    tree
}

/// The stored network list, as JSON.
async fn stored_network_list(fake: &FakeSettings) -> serde_json::Value {
    fake.get_settings(WIFI_NETWORKS_DOT_PATH).await.unwrap()
}

/// The collection end to end: an empty listing, an add, a listing that shows
/// it, and a removal addressed by the fingerprint the add returned.
///
/// The fingerprint is the whole handle: it is what `GET` publishes, what
/// `DELETE` takes, and it is checked against a value that came out of
/// `ssh-keygen` rather than against apid's own arithmetic.
#[tokio::test]
async fn the_ssh_key_collection_lists_adds_and_removes() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let empty = get(&router, "/api/v1/ssh/authorized-keys", Some(&cookie)).await;
    assert_eq!(empty.status(), StatusCode::OK);
    let empty = body_json(empty).await;
    assert_eq!(empty["keys"], json!([]));

    let added = post_json(
        &router,
        "/api/v1/ssh/authorized-keys",
        &json!({ "key": REAL_ED25519_LINE }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(added.status(), StatusCode::CREATED);
    let added = body_json(added).await;
    // Canonicalised by the parser: the comment is lifted out of `key` so the
    // same key pasted under two labels is one key.
    assert_eq!(added["key"]["key"], json!(canonical(REAL_ED25519_LINE)));
    assert_eq!(
        added["key"]["comment"],
        json!(comment_of(REAL_ED25519_LINE))
    );
    assert_eq!(added["key"]["fingerprint"], json!(REAL_ED25519_FINGERPRINT));
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)])
    );
    assert_eq!(fake.set_paths(), vec![SSH_KEYS_DOT_PATH]);

    let listed = body_json(get(&router, "/api/v1/ssh/authorized-keys", Some(&cookie)).await).await;
    assert_eq!(listed["keys"].as_array().unwrap().len(), 1);
    assert_eq!(
        listed["keys"][0]["fingerprint"],
        json!(REAL_ED25519_FINGERPRINT)
    );

    let removed = request(
        &router,
        "DELETE",
        &ssh_key_url(REAL_ED25519_FINGERPRINT),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    assert_eq!(stored_key_list(&fake).await, json!([]));
}

/// The notice is on **both** answers, which is what section 2.5 asks for: a
/// client that only ever adds keys is still told that a key added here logs in
/// as root.
#[tokio::test]
async fn the_root_key_notice_is_on_the_listing_and_on_the_add() {
    let (router, _) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let listed = body_json(get(&router, "/api/v1/ssh/authorized-keys", Some(&cookie)).await).await;
    assert_eq!(listed["notice"], json!(ROOT_KEY_NOTICE_TEXT));

    let added = post_json(
        &router,
        "/api/v1/ssh/authorized-keys",
        &json!({ "key": REAL_ED25519_LINE }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(
        body_json(added).await["notice"],
        json!(ROOT_KEY_NOTICE_TEXT)
    );
}

/// The add runs the parser the pane runs, and refuses the same lines: both
/// surfaces reach `parse_authorized_key`, so a line one accepts is a line the
/// other accepts and a line mosd would reject reaches neither.
///
/// The two answers differ in shape and not in verdict -- the API's envelope
/// carries the parser's own message, the pane re-renders itself around it.
#[tokio::test]
async fn the_key_add_runs_the_same_parser_the_pane_runs() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for line in [
        // An options field in front of the type: the remote-code-execution
        // surface the parser exists to refuse.
        r#"command="rm -rf /" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8"#,
        // A type the whitelist does not carry.
        "ssh-dss AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8",
        // A blob that does not decode.
        "ssh-ed25519 not-base64!!",
        "",
    ] {
        let response = post_json(
            &router,
            "/api/v1/ssh/authorized-keys",
            &json!({ "key": line }).to_string(),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{line:?}"
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "validation_failed", "{line:?}");
        assert_eq!(error["source"], "apid", "{line:?}");
        assert_eq!(error["path"], json!(SSH_KEYS_DOT_PATH), "{line:?}");

        // The pane refuses it too, and neither surface wrote anything.
        let pane = post_form(
            &router,
            "/ssh/keys/add",
            &format!("key={}", urlencode(line)),
            Some(&cookie),
        )
        .await;
        assert_eq!(pane.status(), StatusCode::UNPROCESSABLE_ENTITY, "{line:?}");
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A key already stored is refused at **409 `key_exists`**.
///
/// **This assertion was 422 when M5 shipped it, and the change is a correction
/// rather than a weakening.** M5 answered 422 because the duplicate check lives
/// inside `validate_authorized_keys` and the only ways out were exporting a
/// private constant or matching the validator's words; it declined both and
/// took the validator's own message. PLAN-023 M6's error-contract ruling gives
/// the contract a third clause -- absent is 404, malformed is 422, **duplicate
/// is 409 with a per-collection code** -- and picks the export. This route now
/// decides the duplicate itself, before the validator runs, so the status is
/// stronger than it was and not looser: 422 was one answer for a malformed key
/// and a duplicate alike, and these are now two.
///
/// `validate_authorized_keys` still runs on the rewritten list and still
/// refuses a duplicate. It has to: the settings file is writable without apid,
/// and the reconciler is the boundary. What changed is which of the two answers
/// first, not whether the rule exists in one place.
///
/// The duplicate is submitted under a different comment, which is the case the
/// canonical `key` field exists for: two operators pasting one key under two
/// labels must not end up with two entries granting the same access. That is
/// also why the route compares the parsed `key` and not the submitted line --
/// the identity `validate_authorized_keys` itself uses.
#[tokio::test]
async fn a_duplicate_key_is_409_and_the_stored_list_is_unchanged() {
    let (router, fake) = test_app(ssh_tree(json!([stored_key(REAL_ED25519_LINE)])));
    let cookie = login(&router, "hunter2secret").await;

    let relabelled = format!("{} someone-else", canonical(REAL_ED25519_LINE));
    let response = post_json(
        &router,
        "/api/v1/ssh/authorized-keys",
        &json!({ "key": relabelled }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error = envelope(response).await;
    assert_eq!(error["code"], "key_exists");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!(SSH_KEYS_DOT_PATH));
    // The message must not be the validator's -- this route decided the answer
    // and did not recover it from a sentence.
    assert!(
        !error["message"].as_str().unwrap().contains("entry 0"),
        "the refusal echoed the validator's wording: {error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)])
    );

    // And a malformed key is still 422, which is the distinction the third
    // clause buys: one status no longer covers two conditions.
    let response = post_json(
        &router,
        "/api/v1/ssh/authorized-keys",
        &json!({ "key": "ssh-ed25519 not-base64" }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["code"], "validation_failed");
}

/// The 32-key cap is **409 `key_limit_reached`**, answered from the exported
/// bound exactly as the token mint answers its own from `MAX_TOKENS`.
///
/// The export is the one the ruling picked, and this is the other thing it
/// buys: without a readable bound, a full list reaches the caller either as the
/// shared validator's 422 -- indistinguishable from a malformed key -- or as a
/// failed write, a 500 about mosd, for a request that was never going to be
/// accepted.
#[tokio::test]
async fn a_full_key_list_is_409_and_names_the_bound() {
    let full: Vec<serde_json::Value> = (0..mosd_settings::MAX_KEYS)
        .map(|index| json!({ "key": generated_key_line(index as u8) }))
        .collect();
    let (router, fake) = test_app(ssh_tree(json!(full)));
    let cookie = login(&router, "hunter2secret").await;

    // A key no stored entry carries, so the duplicate rule above cannot be what
    // answers: the two 409s must be told apart by their code.
    let response = post_json(
        &router,
        "/api/v1/ssh/authorized-keys",
        &json!({ "key": generated_key_line(mosd_settings::MAX_KEYS as u8) }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error = envelope(response).await;
    assert_eq!(error["code"], "key_limit_reached");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains(&mosd_settings::MAX_KEYS.to_string()),
        "the refusal must name the bound: {error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// Section 2.4's rule on the SSH item route: a well-formed fingerprint that
/// matches no key is **404**, and a string that is not a fingerprint at all is
/// **422**.
///
/// Paired with `the_ssh_pane_answers_422_where_the_api_answers_404`, which
/// asserts the HTML surface's deliberately different answer to the first of
/// those two conditions.
#[tokio::test]
async fn an_absent_key_fingerprint_is_404_where_the_pane_is_422() {
    let (router, fake) = test_app(ssh_tree(json!([stored_key(REAL_ED25519_LINE)])));
    let cookie = login(&router, "hunter2secret").await;

    // Well formed -- it is a real fingerprint of a real key -- and no stored
    // entry carries it.
    let response = request(
        &router,
        "DELETE",
        &ssh_key_url(REAL_ED25519_SECOND_FINGERPRINT),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!(SSH_KEYS_DOT_PATH));

    // Not an identifier at all. The last of these is the canonical key text,
    // which the pane accepts as an identifier and this route does not: on a
    // path segment there is one interpretation, and it is the fingerprint.
    for identifier in [
        "SHA256:tooshort",
        "HrgN3GLi6Mop2uSRjgOoxImM8zRkFmgqCKoeGD9QOaM",
        "SHA1:HrgN3GLi6Mop2uSRjgOoxImM8zRkFmgqCKoeGD9QOa",
        &canonical(REAL_ED25519_LINE).replace(' ', "%20"),
    ] {
        let response = request(
            &router,
            "DELETE",
            &ssh_key_url(identifier),
            Some(&cookie),
            None,
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{identifier}"
        );
        assert_eq!(
            envelope(response).await["code"],
            "validation_failed",
            "{identifier}"
        );
    }

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)])
    );
}

/// The HTML half of the split recorded in `docs/task/RFCT-210.md` section 2.4:
/// the pane answers **422** where `DELETE /api/v1/ssh/authorized-keys/
/// {fingerprint}` answers **404**, on the same condition.
///
/// It is not drift. The pane's identifier is a submitted string that may be a
/// fingerprint *or* the exact key text, so a value matching nothing is as
/// likely mistyped as absent -- the re-submit-the-form condition 422 means
/// there -- and its body is a re-rendered page no consumer reads a status
/// from. On the API the identifier is a path segment with one interpretation.
/// Paired with `an_absent_key_fingerprint_is_404_where_the_pane_is_422`.
#[tokio::test]
async fn the_ssh_pane_answers_422_where_the_api_answers_404() {
    let (router, fake) = test_app(ssh_tree(json!([stored_key(REAL_ED25519_LINE)])));
    let cookie = login(&router, "hunter2secret").await;

    let html = post_form(
        &router,
        "/ssh/keys/remove",
        &format!("identifier={}", urlencode(REAL_ED25519_SECOND_FINGERPRINT)),
        Some(&cookie),
    )
    .await;
    let api = request(
        &router,
        "DELETE",
        &ssh_key_url(REAL_ED25519_SECOND_FINGERPRINT),
        Some(&cookie),
        None,
    )
    .await;

    assert_eq!(html.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(api.status(), StatusCode::NOT_FOUND);
    assert!(body_string(html).await.contains("reload it and try again"));
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A fingerprint's base64 alphabet contains `/`, so the identifier of a real
/// RSA key is two path segments unless it is percent-encoded. Measured rather
/// than assumed: `%2F` is three characters at match time, so the route matches
/// one segment, and axum decodes it back to a `/` before the handler sees it.
///
/// The gate's predicate has to agree, which is the other half of this: it reads
/// the raw path, sees no separator, and hands the request off.
#[tokio::test]
async fn a_fingerprint_carrying_a_slash_is_addressable_percent_encoded() {
    assert!(
        REAL_RSA_FINGERPRINT.contains('/'),
        "this test is about the `/`, and the fixture no longer has one"
    );
    let (router, fake) = test_app(ssh_tree(json!([
        stored_key(REAL_RSA_LINE),
        stored_key(REAL_ED25519_LINE),
    ])));
    let cookie = login(&router, "hunter2secret").await;

    let response = request(
        &router,
        "DELETE",
        &ssh_key_url(REAL_RSA_FINGERPRINT),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        stored_key_list(&fake).await,
        json!([stored_key(REAL_ED25519_LINE)]),
        "the RSA key and only the RSA key was removed"
    );

    // Unencoded, the same fingerprint is two segments and names no route at
    // all -- which is the reserved subtree's own not-found answer and not this
    // collection's 404.
    let raw = format!("/api/v1/ssh/authorized-keys/{REAL_RSA_FINGERPRINT}");
    let response = request(&router, "DELETE", &raw, Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(envelope(response).await["code"], "not_found");
}

/// The WiFi collection end to end. **It has no pane**, so this is the first
/// management surface the list has ever had: it exists in the settings model
/// and was reachable only by editing the settings file on STATE.
#[tokio::test]
async fn the_wifi_network_collection_lists_adds_and_removes() {
    let (router, fake) = test_app(wifi_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let empty = get(&router, "/api/v1/wifi/client/networks", Some(&cookie)).await;
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(body_json(empty).await, json!([]));

    let added = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        &json!({ "ssid": "roastery", "psk": "hunter2hunter2", "hidden": true, "priority": 7 })
            .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(added.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(added).await,
        json!({ "ssid": "roastery", "psk": REDACTED, "hidden": true, "priority": 7 })
    );
    assert_eq!(fake.set_paths(), vec![WIFI_NETWORKS_DOT_PATH]);
    // The stored value is the real key; only what leaves the device is
    // substituted.
    assert_eq!(
        stored_network_list(&fake).await[0]["psk"],
        json!("hunter2hunter2")
    );

    // An open network: `psk` is absent rather than null, which is the model's
    // own shape.
    let open = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        &json!({ "ssid": "cafe-guest" }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(open.status(), StatusCode::CREATED);
    assert_eq!(
        body_json(open).await,
        json!({ "ssid": "cafe-guest", "hidden": false, "priority": 0 })
    );

    let removed = request(
        &router,
        "DELETE",
        "/api/v1/wifi/client/networks/roastery",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    let left = body_json(get(&router, "/api/v1/wifi/client/networks", Some(&cookie)).await).await;
    assert_eq!(
        left,
        json!([{ "ssid": "cafe-guest", "hidden": false, "priority": 0 }])
    );
}

/// A key written through `POST` is redacted on the next `GET`, and the
/// redaction is section 2.2's structural one rather than a rule this route
/// keeps for itself.
#[tokio::test]
async fn a_posted_psk_is_redacted_on_the_next_read() {
    let (router, fake) = test_app(wifi_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        &json!({ "ssid": "roastery", "psk": "hunter2hunter2" }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);

    let listed = get(&router, "/api/v1/wifi/client/networks", Some(&cookie)).await;
    let body = body_string(listed).await;
    assert!(
        !body.contains("hunter2hunter2"),
        "the stored key left the device: {body}"
    );
    let listed: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(listed[0]["psk"], json!(REDACTED));

    // The same list read through the settings root is redacted too, which is
    // what makes this one list with one rule and not two surfaces with two.
    let through_settings = get(
        &router,
        "/api/v1/settings/wifi.client.networks",
        Some(&cookie),
    )
    .await;
    assert_eq!(body_json(through_settings).await[0]["psk"], json!(REDACTED));
    assert_eq!(
        stored_network_list(&fake).await[0]["psk"],
        json!("hunter2hunter2")
    );
}

/// The round trip that would destroy a working key: read the list, change one
/// field, post the entry back. What comes back carries `"<redacted>"` in
/// `psk`, and storing it would replace the key with ten literal characters.
///
/// The sentinel is checked before the body is even read as a network, which is
/// the ordering the scalar write route landed and the reason it landed it: the
/// caller is answered about the thing it actually got wrong.
#[tokio::test]
async fn posting_a_redacted_psk_back_is_refused_and_the_stored_key_survives() {
    let (router, fake) = test_app(wifi_tree(json!([
        { "ssid": "roastery", "psk": "hunter2hunter2", "hidden": false, "priority": 0 },
    ])));
    let cookie = login(&router, "hunter2secret").await;

    // Exactly what a client that read the collection holds.
    let listed = body_json(get(&router, "/api/v1/wifi/client/networks", Some(&cookie)).await).await;
    let mut edited = listed[0].clone();
    edited["ssid"] = json!("roastery-5g");
    edited["hidden"] = json!(true);
    assert_eq!(edited["psk"], json!(REDACTED));

    let response = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        &edited.to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert_eq!(error["code"], "validation_failed");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!(WIFI_NETWORKS_DOT_PATH));

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(
        stored_network_list(&fake).await,
        json!([{ "ssid": "roastery", "psk": "hunter2hunter2", "hidden": false, "priority": 0 }]),
        "the real key must survive the refusal"
    );
}

/// The SSID is this collection's identity, so a second entry under one SSID is
/// refused rather than appended: with two, a `DELETE` would have no answer to
/// which of them it names.
///
/// 409 and not 422, for the reason the token mint's `token_limit_reached` is a
/// 409: the body is well formed and nothing about it is wrong, and what refuses
/// it is the collection's current state.
#[tokio::test]
async fn a_second_network_under_one_ssid_is_refused() {
    let (router, fake) = test_app(wifi_tree(json!([
        { "ssid": "roastery", "psk": "hunter2hunter2", "hidden": false, "priority": 0 },
    ])));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        &json!({ "ssid": "roastery", "psk": "adifferentkey" }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error = envelope(response).await;
    assert_eq!(error["code"], "ssid_exists");
    assert_eq!(error["path"], json!(WIFI_NETWORKS_DOT_PATH));
    assert!(
        !body_string(get(&router, "/api/v1/wifi/client/networks", Some(&cookie)).await)
            .await
            .contains("adifferentkey")
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A body that is not a network is 422, and the validator is the settings
/// model's own deserializer -- which is what mosd's `Settings::set` validates
/// with, so a body this route accepts is one the store accepts.
#[tokio::test]
async fn a_body_that_is_not_a_network_is_422() {
    let (router, fake) = test_app(wifi_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for body in [
        // No `ssid`: the one field with no default.
        r#"{"psk":"hunter2hunter2"}"#,
        // A field the model does not carry; `deny_unknown_fields` is what
        // catches a typo before it becomes a silently ignored setting.
        r#"{"ssid":"roastery","hiden":true}"#,
        // Wrong types.
        r#"{"ssid":7}"#,
        r#"{"ssid":"roastery","priority":"high"}"#,
        // An array where an object belongs.
        r#"[{"ssid":"roastery"}]"#,
    ] {
        let response =
            post_json(&router, "/api/v1/wifi/client/networks", body, Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
        assert_eq!(
            envelope(response).await["code"],
            "validation_failed",
            "{body}"
        );
    }

    // Not JSON at all is 400 and not 422: the request could not be read, which
    // is a different failure from one that was read and refused.
    let response = post_json(
        &router,
        "/api/v1/wifi/client/networks",
        "{not json",
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(envelope(response).await["code"], "request_invalid");

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// Section 2.4's rule on the WiFi item route, with its 422 half **vacant**.
///
/// An SSID has no grammar -- every non-empty single path segment spells a
/// possible one -- so there is no malformed identifier to answer 422 about and
/// everything absent is 404. That is the rule applied, not an exception to it.
///
/// **There is no paired pane test here, and the absence is the point.** The
/// SSH keys have one (`the_ssh_pane_answers_422_where_the_api_answers_404`)
/// because both surfaces exist and answer differently on purpose. This
/// collection has no HTML pane at all, so there is no form-path behaviour for
/// it to agree or disagree with.
#[tokio::test]
async fn an_absent_ssid_is_404_and_this_collection_has_no_pane_to_disagree_with() {
    let (router, fake) = test_app(wifi_tree(json!([
        { "ssid": "roastery", "psk": "hunter2hunter2", "hidden": false, "priority": 0 },
    ])));
    let cookie = login(&router, "hunter2secret").await;

    for ssid in ["cafe-guest", "roastery-5g", "%20", "SHA256:not-an-ssid"] {
        let response = request(
            &router,
            "DELETE",
            &format!("/api/v1/wifi/client/networks/{ssid}"),
            Some(&cookie),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{ssid}");
        let error = envelope(response).await;
        assert_eq!(error["code"], "settings_not_found", "{ssid}");
        assert_eq!(error["source"], "apid", "{ssid}");
        assert_eq!(error["path"], json!(WIFI_NETWORKS_DOT_PATH), "{ssid}");
    }

    // No pane serves this list -- the assertion behind the paragraph above, so
    // it cannot quietly stop being true. Read out of the router's own source,
    // for the reason `every_mutating_route_is_covered_by_the_authentication_tests`
    // reads it: a hand-listed set of paths to probe would describe the panes
    // somebody remembered.
    let html_wifi_routes: Vec<&str> = include_str!("routes.rs")
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with(".route(\"/wifi"))
        .collect();
    assert!(
        html_wifi_routes.is_empty(),
        "this collection now has a pane, so the paragraph above is stale and a paired 422/404 test is owed: {html_wifi_routes:?}"
    );

    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// Both collections take a bearer token **and** a session cookie, and neither
/// takes nothing.
///
/// PLAN-023 Amendment 1's bearer-only ruling is about the token routes
/// specifically -- the credential factory -- and not about new routes in
/// general, so these are dual-credential exactly as the shipped reads are.
#[tokio::test]
async fn the_two_collections_take_a_cookie_or_a_bearer_and_401_without_either() {
    let mut tree = ssh_tree(json!([]));
    tree["wifi"] = wifi_tree(json!([]))["wifi"].clone();
    let (entries, wires): (Vec<_>, Vec<_>) = (0..1).map(seeded_token).unzip();
    tree["access"]["apiTokens"] = json!(entries);

    let (router, _) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    for path in [
        "/api/v1/ssh/authorized-keys",
        "/api/v1/wifi/client/networks",
    ] {
        assert_eq!(
            get(&router, path, Some(&cookie)).await.status(),
            StatusCode::OK,
            "cookie: {path}"
        );
        assert_eq!(
            bearer(&router, "GET", path, &wires[0]).await.status(),
            StatusCode::OK,
            "bearer: {path}"
        );
        // Neither credential: section 2.4's envelope at 401 and **not** the
        // gate's redirect. These are declared API routes, so the gate hands
        // them off and `ApiSession` answers -- a client that followed a
        // redirect would land on `GET /login`, which is a 200 with an HTML
        // page, and read the whole exchange as success.
        let anonymous = get(&router, path, None).await;
        assert_eq!(
            anonymous.status(),
            StatusCode::UNAUTHORIZED,
            "anonymous: {path}"
        );
        assert_eq!(
            envelope(anonymous).await["code"],
            "not_authenticated",
            "{path}"
        );
    }
}

/// The document describes the served surface: a client reading only
/// `openapi.json` has to learn both collections, every outcome each route has,
/// and that the SSH listing carries a `notice`.
#[test]
fn the_openapi_document_covers_the_two_collections() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    for (path, method, statuses) in [
        (
            "/api/v1/ssh/authorized-keys",
            "get",
            vec!["200", "401", "405", "500", "503"],
        ),
        (
            "/api/v1/ssh/authorized-keys",
            "post",
            vec!["201", "400", "401", "405", "409", "422", "500", "503"],
        ),
        (
            "/api/v1/ssh/authorized-keys/{fingerprint}",
            "delete",
            vec!["204", "401", "404", "405", "422", "500", "503"],
        ),
        (
            "/api/v1/wifi/client/networks",
            "get",
            vec!["200", "401", "405", "500", "503"],
        ),
        (
            "/api/v1/wifi/client/networks",
            "post",
            vec!["201", "400", "401", "405", "409", "422", "500", "503"],
        ),
        (
            "/api/v1/wifi/client/networks/{ssid}",
            "delete",
            vec!["204", "401", "404", "405", "500", "503"],
        ),
    ] {
        let operation = &document["paths"][path][method];
        assert!(operation.is_object(), "{method} {path} is undocumented");
        for status in statuses {
            assert!(
                operation["responses"][status].is_object(),
                "{method} {path} must document {status}: {operation}"
            );
        }
    }

    // The notice is a documented member and not an undeclared extra, on both
    // answers that carry it.
    let schemas = &document["components"]["schemas"];
    assert!(schemas["AuthorizedKeyList"]["properties"]["notice"].is_object());
    assert!(schemas["AddedAuthorizedKey"]["properties"]["notice"].is_object());
    // The WiFi item route documents no 422: its identifier has no grammar, so
    // there is no malformed spelling to answer one for.
    assert!(
        document["paths"]["/api/v1/wifi/client/networks/{ssid}"]["delete"]["responses"]["422"]
            .is_null()
    );
}

/// The documented WiFi entry is the settings model's own shape.
///
/// The route deserializes into `mosd_settings::WifiNetwork` and answers a
/// redacted serialization of it, so `WifiNetworkEntry` is a description of
/// that type rather than a second definition of it. Without this, a field
/// added to the model would be served and undocumented.
#[test]
fn the_wifi_schema_matches_the_settings_model() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");
    let mut documented: Vec<String> =
        document["components"]["schemas"]["WifiNetworkEntry"]["properties"]
            .as_object()
            .expect("WifiNetworkEntry is an object schema")
            .keys()
            .cloned()
            .collect();

    // Every field present: `psk` is the one the model omits when it is absent.
    let model = serde_json::to_value(mosd_settings::WifiNetwork {
        ssid: "roastery".to_string(),
        psk: Some("hunter2hunter2".to_string()),
        hidden: true,
        priority: 7,
    })
    .expect("a network serializes");
    let mut fields: Vec<String> = model
        .as_object()
        .expect("a network is an object")
        .keys()
        .cloned()
        .collect();
    fields.sort();
    documented.sort();
    assert_eq!(
        documented, fields,
        "the documented WiFi entry has drifted from `mosd_settings::WifiNetwork`"
    );
}

// PLAN-023 M6 (`docs/task/RFCT-242.md`): the network cluster typed, the
// WireGuard peer collection, and the rotate-key 404.

/// The API path of one interface.
const NETWORK_MAP_PATH: &str = "/api/v1/network";

/// The `network` dot-path every envelope about the whole map names.
const NETWORK_DOT_PATH: &str = "network";

fn iface_url(iface: &str) -> String {
    format!("{NETWORK_MAP_PATH}/{}", urlencode(iface))
}

fn peers_url(iface: &str) -> String {
    format!("{}/peers", iface_url(iface))
}

fn peer_url(iface: &str, public_key: &str) -> String {
    format!("{}/{}", peers_url(iface), urlencode(public_key))
}

/// The stored map, read back through the fake.
async fn stored_network_map(fake: &FakeSettings) -> serde_json::Value {
    fake.get_settings(NETWORK_DOT_PATH).await.unwrap()
}

/// A syntactically valid X25519 public key whose base64 spelling carries a
/// `/`, which the standard alphabet really does contain.
///
/// Its private half was never generated -- it is 32 copies of one byte -- so
/// it authorises nothing anywhere.
const SLASHED_PEER_KEY: &str = "Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8=";

/// The four relational rules, each with its own route-level test, because the
/// whole reason this cluster is typed rather than a dot-path passthrough is
/// that these rules exist and a passthrough runs none of them
/// (`docs/task/RFCT-210.md` section 2.3 item (i)).
///
/// Each asserts the same three things: **422**, the rule's own sentence in the
/// message, and the stored tree unchanged. The last one is what separates this
/// from the shipped passthrough, which answers 204 and leaves the device's
/// networking broken with the only evidence in a later state read.
#[tokio::test]
async fn a_vlan_parent_that_is_not_declared_is_422_and_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = put_json(
        &router,
        &iface_url("vlan9"),
        &json!({ "kind": "vlan", "dhcp": true, "vlan": { "parent": "eth9", "id": 9 } }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_api_headers(&response, "vlan parent");
    let error = envelope(response).await;
    assert_eq!(error["code"], "validation_failed");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!("network.vlan9"));
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("has VLAN parent \"eth9\", which is not a declared network entry"),
        "{error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);
}

/// Rule two. This is the exact submission `docs/task/RFCT-210.md` section 2.3
/// names as the concrete failure a bare passthrough produces: a bridge naming
/// a port that does not exist, which a `PUT` to
/// `/api/v1/settings/network.br9` would have answered 204 to.
#[tokio::test]
async fn a_bridge_port_that_is_not_declared_is_422_and_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = put_json(
        &router,
        &iface_url("br9"),
        &json!({ "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth9"] } }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert_eq!(error["code"], "validation_failed");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("has bridge port \"eth9\", which is not a declared network entry"),
        "{error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);
}

/// Rule three, and it is the one no check confined to the entry being written
/// could ever see: what is refused here is an edit to `eth1`, and what refuses
/// it is `br0`, a different entry that claims `eth1` as a port.
#[tokio::test]
async fn a_bridge_port_that_carries_addressing_is_422_and_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = put_json(
        &router,
        &iface_url("eth1"),
        &json!({ "dhcp": true }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert!(
        error["message"].as_str().unwrap().contains(
            "network.eth1 is a port of bridge br0 and must not carry addressing of its own"
        ),
        "{error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);
}

/// Rule four. `br0` already claims `eth1`; a second bridge claiming it is a
/// race between two `Bridge=` lines for one file, and it is refused.
#[tokio::test]
async fn a_port_claimed_by_two_bridges_is_422_and_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = put_json(
        &router,
        &iface_url("br1"),
        &json!({ "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth1"] } }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("is claimed as a port by both bridge"),
        "{error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);
}

/// The happy path: declare an interface that did not exist, replace one that
/// did, and remove one.
#[tokio::test]
async fn the_interface_route_declares_replaces_and_removes() {
    let (router, fake, cookie) = kinds_app().await;

    // Declared: `eth2` is not in the stored map, and a `PUT` creates it.
    let response = put_json(
        &router,
        &iface_url("eth2"),
        &json!({ "dhcp": false, "static": { "address": "10.0.0.9/24", "dns": ["1.1.1.1"] } })
            .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(header_value(&response, CACHE_CONTROL), "no-store");
    assert!(body_string(response).await.is_empty());
    assert_eq!(fake.set_paths(), vec!["network.eth2".to_string()]);
    assert_eq!(
        fake.get_settings("network.eth2").await.unwrap(),
        json!({ "dhcp": false, "static": { "address": "10.0.0.9/24", "dns": ["1.1.1.1"] } })
    );

    // Replaced whole: the second body has no `static`, and the stored entry
    // has none afterwards. A `PUT` is the entry, not a patch of it.
    let response = put_json(
        &router,
        &iface_url("eth2"),
        &json!({ "dhcp": true }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        fake.get_settings("network.eth2").await.unwrap(),
        json!({ "dhcp": true })
    );

    // Removed: the whole map is rewritten without it, because the dot-path
    // syntax has no delete.
    let response = request(&router, "DELETE", &iface_url("eth2"), Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        fake.set_paths().last().map(String::as_str),
        Some(NETWORK_DOT_PATH)
    );
    let map = stored_network_map(&fake).await;
    assert!(map.get("eth2").is_none(), "{map}");
    // And nothing else went with it.
    for kept in ["eth0", "eth1", "eth0.100", "br0", "wg0"] {
        assert!(map.get(kept).is_some(), "{kept} was dropped: {map}");
    }
}

/// A removal is re-validated against the map it leaves behind, which is the
/// half a delete-by-dot-path could not do at all.
#[tokio::test]
async fn removing_a_port_a_bridge_still_lists_is_refused() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = request(&router, "DELETE", &iface_url("eth1"), Some(&cookie), None).await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = envelope(response).await;
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("has bridge port \"eth1\", which is not a declared network entry"),
        "{error}"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);

    // Removing the bridge first makes the port removable, which is the order
    // the message asks for.
    assert_eq!(
        request(&router, "DELETE", &iface_url("br0"), Some(&cookie), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(&router, "DELETE", &iface_url("eth1"), Some(&cookie), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
}

/// Section 2.4's rule on the interface item route: absent is 404, malformed is
/// 422, and they are not the same answer.
///
/// There is no 404 on the `PUT`, deliberately: that route's job is to create
/// the entry it names, so an absent one is not an absent resource.
#[tokio::test]
async fn an_absent_interface_is_404_and_a_malformed_name_is_422() {
    let (router, fake, cookie) = kinds_app().await;

    let response = request(&router, "DELETE", &iface_url("eth9"), Some(&cookie), None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_api_headers(&response, "absent interface");
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["source"], "apid");
    assert_eq!(error["path"], json!(NETWORK_DOT_PATH));

    // Not a name any interface could have: sixteen characters is one past
    // `IFNAMSIZ` minus the terminator, and `/` is not in the charset (it
    // reaches the route percent-encoded, so it is one segment).
    for bad in ["waytoolongiface016", "bad%2Fname"] {
        for method in ["PUT", "DELETE"] {
            let path = format!("{NETWORK_MAP_PATH}/{bad}");
            let response = if method == "PUT" {
                put_json(&router, &path, "{\"dhcp\":true}", Some(&cookie)).await
            } else {
                request(&router, method, &path, Some(&cookie), None).await
            };
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{method} {bad}"
            );
            assert_eq!(
                envelope(response).await["code"],
                "validation_failed",
                "{method} {bad}"
            );
        }
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The whole map, replaced in one request and validated as one tree.
///
/// This is what section 2.3 says the typed route gives back in exchange for
/// refusing the passthrough: atomic whole-list replacement, which the
/// passthrough had, **and** the relational validation, which it did not. The
/// second half of this test is the case the item route cannot express at all —
/// a bridge and its port declared together, where sending the bridge first
/// would be refused.
#[tokio::test]
async fn the_whole_map_put_replaces_atomically_and_validates_relationally() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    // Refused as one tree: `br9` names a port that this very body does not
    // declare either.
    let response = put_json(
        &router,
        NETWORK_MAP_PATH,
        &json!({
            "eth0": { "dhcp": true },
            "br9": { "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth7"] } },
        })
        .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["code"], "validation_failed");
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);

    // Accepted as one tree: the same bridge, with its port declared in the
    // same body. Neither entry is legal without the other.
    let response = put_json(
        &router,
        NETWORK_MAP_PATH,
        &json!({
            "eth7": { "dhcp": false },
            "br9": { "kind": "bridge", "dhcp": true, "bridge": { "ports": ["eth7"] } },
        })
        .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(fake.set_paths(), vec![NETWORK_DOT_PATH.to_string()]);
    // Replaced and not merged: every entry the old map had is gone.
    let map = stored_network_map(&fake).await;
    assert_eq!(
        map.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["br9", "eth7"],
        "{map}"
    );

    // A key that is not an interface name is 422, and it names the key.
    let response = put_json(
        &router,
        NETWORK_MAP_PATH,
        &json!({ "waytoolongiface016": { "dhcp": true } }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["code"], "validation_failed");

    // A body that is not a map of interfaces at all is 422; a body that is not
    // JSON is 400.
    for (body, status) in [
        ("[]", StatusCode::UNPROCESSABLE_ENTITY),
        (
            "{\"eth0\":{\"nosuchfield\":1}}",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        ("{", StatusCode::BAD_REQUEST),
    ] {
        let response = put_json(&router, NETWORK_MAP_PATH, body, Some(&cookie)).await;
        assert_eq!(response.status(), status, "{body}");
    }
}

/// A dotted interface name round-trips through the quoted path segment, so the
/// daemon sees one key and not two (M6 acceptance).
#[tokio::test]
async fn a_dotted_interface_name_round_trips_through_the_quoted_path_segment() {
    let (router, fake, cookie) = kinds_app().await;

    let response = put_json(
        &router,
        &iface_url("eth0.100"),
        &json!({ "kind": "vlan", "dhcp": true, "vlan": { "parent": "eth0", "id": 100 } })
            .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(fake.set_paths(), vec![r#"network."eth0.100""#.to_string()]);

    // And the envelope quotes it too, because that is the dot-path an operator
    // would type at the settings route.
    let (router, _, cookie) = kinds_app().await;
    let response = put_json(
        &router,
        &iface_url("wg.9"),
        &json!({ "kind": "vlan", "dhcp": true, "vlan": { "parent": "nope", "id": 1 } }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(envelope(response).await["path"], json!(r#"network."wg.9""#));
}

/// M4's refusal, verified rather than duplicated: a raw settings write under
/// `network` is 409 and names the typed routes this milestone added.
#[tokio::test]
async fn the_settings_passthrough_under_network_is_409_and_names_the_typed_route() {
    let (router, fake, cookie) = kinds_app().await;

    for path in [
        "/api/v1/settings/network",
        "/api/v1/settings/network.br0",
        "/api/v1/settings/network.br0.bridge.ports",
    ] {
        let response = put_json(&router, path, "{\"dhcp\":true}", Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
        let error = envelope(response).await;
        assert_eq!(error["code"], "settings_read_only", "{path}");
        assert!(
            error["message"]
                .as_str()
                .unwrap()
                .contains("/api/v1/network"),
            "{path} did not name the typed route: {error}"
        );
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The peer collection end to end: list, add, remove.
#[tokio::test]
async fn the_peer_collection_lists_adds_and_removes() {
    let (router, fake, cookie) = kinds_app().await;

    let response = get(&router, &peers_url("wg0"), Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_api_headers(&response, "peer listing");
    let listed: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1, "{listed}");
    assert_eq!(listed[0]["publicKey"], json!(PEER_KEY));
    assert_eq!(listed[0]["allowedIps"], json!(["10.8.0.0/24"]));

    let response = post_json(
        &router,
        &peers_url("wg0"),
        &json!({
            "publicKey": OTHER_PEER_KEY,
            "allowedIps": ["10.8.1.0/24"],
            "endpoint": "vpn2.example.net:51820",
            "persistentKeepalive": 25,
        })
        .to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let echoed: serde_json::Value = serde_json::from_str(&body_string(response).await).unwrap();
    assert_eq!(echoed["publicKey"], json!(OTHER_PEER_KEY));
    assert_eq!(echoed["persistentKeepalive"], json!(25));
    // Only the peer list was written, not the whole entry.
    assert_eq!(
        fake.set_paths(),
        vec!["network.wg0.wireguard.peers".to_string()]
    );

    let response = request(
        &router,
        "DELETE",
        &peer_url("wg0", OTHER_PEER_KEY),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let peers = fake
        .get_settings("network.wg0.wireguard.peers")
        .await
        .unwrap();
    assert_eq!(peers.as_array().unwrap().len(), 1, "{peers}");
    assert_eq!(peers[0]["publicKey"], json!(PEER_KEY));
}

/// `docs/task/RFCT-210.md` section 2.4's sweep, discharged: the typed route
/// answers **404 before anything is written** for the interface the pane
/// silently creates a broken entry for.
///
/// Paired with `the_pane_peer_add_writes_a_broken_entry_for_an_undeclared_interface`,
/// which runs the pane's behaviour and confirms the finding was right. The
/// split between them is the whole reason this milestone typed the route
/// instead of adding a guard to the old one.
#[tokio::test]
async fn the_api_peer_add_refuses_an_undeclared_interface_where_the_pane_writes_one() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_json(
        &router,
        &peers_url("wg9"),
        &json!({ "publicKey": PEER_KEY }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_api_headers(&response, "peer add on an undeclared interface");
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["path"], json!(NETWORK_DOT_PATH));
    // Nothing was written, which is the half the pane gets wrong: no write at
    // all, and therefore no `network.wg9` of the default kind.
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert!(
        stored_network_map(&fake).await.get("wg9").is_none(),
        "an undeclared interface was created"
    );

    // The same 404 on the other two operations of the collection.
    assert_eq!(
        get(&router, &peers_url("wg9"), Some(&cookie))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &router,
            "DELETE",
            &peer_url("wg9", PEER_KEY),
            Some(&cookie),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A declared entry of the wrong kind is **422** and not 404, which is the
/// same split mosd's rotate-key now makes: the URL names a real entry, and
/// what is wrong is the argument.
#[tokio::test]
async fn peers_on_an_interface_that_is_not_a_tunnel_are_422() {
    let (router, fake, cookie) = kinds_app().await;

    for (method, path) in [
        ("GET", peers_url("eth0")),
        ("DELETE", peer_url("eth0", PEER_KEY)),
    ] {
        let response = request(&router, method, &path, Some(&cookie), None).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{path}"
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "validation_failed", "{path}");
        assert!(
            error["message"]
                .as_str()
                .unwrap()
                .contains("is not a WireGuard interface"),
            "{error}"
        );
    }

    let response = post_json(
        &router,
        &peers_url("eth0"),
        &json!({ "publicKey": PEER_KEY }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A duplicate public key is **409 `peer_exists`**, following the WiFi
/// collection's `ssid_exists` and not the SSH collection's 422.
///
/// The reason is the identity: the public key is this collection's `DELETE`
/// path segment, so two entries under one key would leave no answer to which
/// one a `DELETE` names -- the argument the WiFi route's 409 makes about an
/// SSID. The SSH 422 is the *shared validator's* own message, inherited rather
/// than decided, and no validator on either side of the bus refuses a
/// duplicate peer. `docs/task/RFCT-242.md` flags this as an open contract
/// question: the ratified rule covers absent and malformed and says nothing
/// about duplicate.
#[tokio::test]
async fn a_duplicate_peer_is_409_and_writes_nothing() {
    let (router, fake, cookie) = kinds_app().await;
    let before = stored_network_map(&fake).await;

    let response = post_json(
        &router,
        &peers_url("wg0"),
        &json!({ "publicKey": PEER_KEY, "allowedIps": ["10.9.0.0/24"] }).to_string(),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error = envelope(response).await;
    assert_eq!(error["code"], "peer_exists");
    assert_eq!(error["path"], json!("network.wg0.wireguard.peers"));
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
    assert_eq!(stored_network_map(&fake).await, before);
}

/// Section 2.4's rule on the peer item route, with both halves live.
#[tokio::test]
async fn an_absent_peer_key_is_404_and_a_malformed_one_is_422() {
    let (router, fake, cookie) = kinds_app().await;

    // Well formed -- it is 32 bytes of base64 -- and no stored peer has it.
    let response = request(
        &router,
        "DELETE",
        &peer_url("wg0", OTHER_PEER_KEY),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let error = envelope(response).await;
    assert_eq!(error["code"], "settings_not_found");
    assert_eq!(error["path"], json!("network.wg0.wireguard.peers"));

    // Not a public key at all, and could never be one.
    for identifier in ["nope", "AAAA", &"A".repeat(44), &"!".repeat(44)] {
        let response = request(
            &router,
            "DELETE",
            &peer_url("wg0", identifier),
            Some(&cookie),
            None,
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{identifier}"
        );
        assert_eq!(
            envelope(response).await["code"],
            "validation_failed",
            "{identifier}"
        );
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// The API answers **404** where the pane answers 422, on the same condition.
///
/// Paired with `an_absent_peer_key_is_404_and_a_malformed_one_is_422` above
/// and kept for the reason `docs/task/RFCT-210.md` section 2.4 gives about the
/// SSH pane: a form's body is a re-rendered page no consumer reads a status
/// from, and its message asks for a re-submit.
#[tokio::test]
async fn the_network_pane_answers_422_where_the_peer_route_answers_404() {
    let (router, fake, cookie) = kinds_app().await;

    let response = post_form(
        &router,
        "/network/peers/remove",
        &format!("iface=wg0&publicKey={}", urlencode(OTHER_PEER_KEY)),
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body_string(response)
            .await
            .contains("No peer of this tunnel has that public key"),
        "the pane re-renders with its own sentence"
    );
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// A public key carrying a `/` is addressable, percent-encoded.
///
/// The base64 alphabet a WireGuard key uses is the standard one, not the
/// URL-safe variant, so a real key can contain `/` and `+`. Sent as `%2F` it
/// is three characters at match time, so the router still matches one segment
/// and axum decodes it back before the handler sees it. Sent unencoded it is
/// two segments and reaches the reserved subtree's own not-found, which is a
/// different answer from this collection's 404.
#[tokio::test]
async fn a_peer_key_carrying_a_slash_is_addressable_percent_encoded() {
    let mut tree = kinds_tree("hunter2secret");
    tree["network"]["wg0"]["wireguard"]["peers"] = json!([{ "publicKey": SLASHED_PEER_KEY }]);
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    assert!(SLASHED_PEER_KEY.contains('/'), "the fixture must carry one");
    let response = request(
        &router,
        "DELETE",
        &peer_url("wg0", SLASHED_PEER_KEY),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        fake.get_settings("network.wg0.wireguard.peers")
            .await
            .unwrap(),
        json!([])
    );

    // Unencoded, the same key is two segments and is not this route.
    let response = request(
        &router,
        "DELETE",
        &format!("{}/{SLASHED_PEER_KEY}", peers_url("wg0")),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(envelope(response).await["code"], "not_found");
}

/// A peer the reconciler would refuse is refused here first, and the refusal
/// never echoes the key -- the property the reconciler's index-only rule
/// exists for, now that the message reaches an HTTP client.
#[tokio::test]
async fn the_peer_add_runs_the_same_validator_the_reconciler_runs() {
    const PASTED_SECRET: &str = "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO";
    let (router, fake, cookie) = kinds_app().await;

    for (body, fragment) in [
        (
            json!({ "publicKey": PASTED_SECRET }),
            "is not a WireGuard key",
        ),
        (
            json!({ "publicKey": OTHER_PEER_KEY, "allowedIps": ["not-a-cidr"] }),
            "is not an IP address or CIDR",
        ),
        (
            json!({ "publicKey": OTHER_PEER_KEY, "endpoint": "no-port" }),
            "is not host:port",
        ),
    ] {
        let response =
            post_json(&router, &peers_url("wg0"), &body.to_string(), Some(&cookie)).await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body}"
        );
        let error = envelope(response).await;
        assert!(
            error["message"].as_str().unwrap().contains(fragment),
            "{body} did not explain itself: {error}"
        );
        assert!(
            !error["message"].as_str().unwrap().contains(PASTED_SECRET),
            "the refusal echoed the value: {error}"
        );
    }

    // A body that is not a peer at all is 422; one that is not JSON is 400.
    for (body, status) in [
        ("{\"nosuchfield\":1}", StatusCode::UNPROCESSABLE_ENTITY),
        ("{", StatusCode::BAD_REQUEST),
    ] {
        let response = post_json(&router, &peers_url("wg0"), body, Some(&cookie)).await;
        assert_eq!(response.status(), status, "{body}");
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

/// An entry this build cannot read stops every route in the cluster, rather
/// than being silently dropped.
///
/// The pane can afford to skip one and name it in the page; these routes
/// cannot. Two of them rewrite the whole map, so a dropped entry is a deleted
/// interface, and all of them validate relationally, so an invisible entry
/// turns a legal bridge port into a 422.
#[tokio::test]
async fn an_unreadable_network_entry_stops_every_route_in_the_cluster() {
    let mut tree = kinds_tree("hunter2secret");
    tree["network"]["mangled"] = json!("not an interface");
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    for (method, path) in [
        ("PUT", iface_url("eth0")),
        ("DELETE", iface_url("eth0")),
        ("GET", peers_url("wg0")),
    ] {
        let response = if method == "PUT" {
            put_json(&router, &path, "{\"dhcp\":true}", Some(&cookie)).await
        } else {
            request(&router, method, &path, Some(&cookie), None).await
        };
        assert_eq!(
            response.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "{method} {path}"
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "settings_invalid", "{method} {path}");
        assert!(
            error["message"].as_str().unwrap().contains("mangled"),
            "the envelope must name the entry: {error}"
        );
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());

    // The whole-map `PUT` is the exception, and deliberately: it does not read
    // the stored map at all, because the map it sends is the map that ends up
    // stored. It is also the only way out of this state through the API.
    let response = put_json(
        &router,
        NETWORK_MAP_PATH,
        &json!({ "eth0": { "dhcp": true } }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

/// Amendment 1's reading, on M6's four routes: a bearer **or** a cookie, and
/// section 2.4's envelope at 401 with neither -- never the gate's redirect.
#[tokio::test]
async fn the_network_cluster_takes_a_cookie_or_a_bearer_and_401_without_either() {
    let mut tree = kinds_tree("hunter2secret");
    let (entries, wires): (Vec<_>, Vec<_>) = (0..1).map(seeded_token).unzip();
    tree["access"]["apiTokens"] = json!(entries);
    let (router, _) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    let peers = peers_url("wg0");
    for path in [peers.as_str()] {
        assert_eq!(
            get(&router, path, Some(&cookie)).await.status(),
            StatusCode::OK,
            "cookie: {path}"
        );
        assert_eq!(
            bearer(&router, "GET", path, &wires[0]).await.status(),
            StatusCode::OK,
            "bearer: {path}"
        );
    }

    // The write routes with a bearer and no cookie.
    assert_eq!(
        bearer_json(
            &router,
            "PUT",
            &iface_url("eth2"),
            &wires[0],
            "{\"dhcp\":true}"
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        bearer(&router, "DELETE", &iface_url("eth2"), &wires[0])
            .await
            .status(),
        StatusCode::NO_CONTENT
    );

    // Neither credential, on every route of the cluster.
    for (method, path) in [
        ("PUT", NETWORK_MAP_PATH.to_string()),
        ("PUT", iface_url("eth0")),
        ("DELETE", iface_url("eth0")),
        ("GET", peers_url("wg0")),
        ("POST", peers_url("wg0")),
        ("DELETE", peer_url("wg0", PEER_KEY)),
    ] {
        let response = request(&router, method, &path, None, None).await;
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
        assert_eq!(
            response.headers().get(LOCATION),
            None,
            "{method} {path} answered a redirect, which a script reads as success"
        );
        assert_eq!(
            envelope(response).await["code"],
            "not_authenticated",
            "{method} {path}"
        );
    }
}

/// The gate hands off exactly what the router serves under this prefix, and
/// nothing else.
///
/// The two precedents this cluster's predicate applies, asserted rather than
/// asserted-about: a **trailing** empty identifier is the collection path with
/// a slash and reaches the reservation, and a `{iface}` in the **middle** may
/// be empty because axum really matches zero characters there.
#[tokio::test]
async fn the_network_paths_the_router_does_not_serve_reach_the_reservation() {
    let (router, _, cookie) = kinds_app().await;

    for (method, path) in [
        ("GET", "/api/v1/network/"),
        ("DELETE", "/api/v1/network/"),
        ("DELETE", "/api/v1/network/wg0/peers/"),
        ("GET", "/api/v1/network/wg0/peers/extra/deep"),
        ("GET", "/api/v1/network/wg0/notpeers"),
    ] {
        let response = request(&router, method, path, Some(&cookie), None).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(
            envelope(response).await["code"],
            "not_found",
            "{method} {path}"
        );
    }

    // The empty interface in the middle IS a route, so an unauthenticated call
    // gets section 2.4's envelope and not the gate's redirect -- the same
    // property the rotate action already has.
    let (fresh, _) = test_app(kinds_tree("hunter2secret"));
    let response = request(&fresh, "GET", "/api/v1/network//peers", None, None).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers().get(LOCATION), None);
    assert_eq!(envelope(response).await["code"], "not_authenticated");
}

/// The document describes every operation this milestone adds, with every
/// outcome each has: a client reading only `openapi.json` has to learn them.
#[test]
fn the_openapi_document_covers_the_network_cluster() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");
    let paths = &document["paths"];

    for (path, method, statuses) in [
        (
            "/api/v1/network",
            "put",
            vec!["204", "400", "401", "422", "500", "503", "405"],
        ),
        (
            "/api/v1/network/{iface}",
            "put",
            vec!["204", "400", "401", "422", "500", "503", "405"],
        ),
        (
            "/api/v1/network/{iface}",
            "delete",
            vec!["204", "401", "404", "422", "500", "503", "405"],
        ),
        (
            "/api/v1/network/{iface}/peers",
            "get",
            vec!["200", "401", "404", "422", "500", "503", "405"],
        ),
        (
            "/api/v1/network/{iface}/peers",
            "post",
            vec![
                "201", "400", "401", "404", "409", "422", "500", "503", "405",
            ],
        ),
        (
            "/api/v1/network/{iface}/peers/{publicKey}",
            "delete",
            vec!["204", "401", "404", "422", "500", "503", "405"],
        ),
    ] {
        for status in statuses {
            assert!(
                paths[path][method]["responses"][status].is_object(),
                "{method} {path} is missing its {status}"
            );
        }
    }

    // No `GET` on the map or on one interface: this milestone adds writes, and
    // the reads are `GET /api/v1/settings/network`. A documented route that
    // does not exist is a contract nothing serves.
    assert!(paths["/api/v1/network"]["get"].is_null(), "{document}");
    assert!(
        paths["/api/v1/network/{iface}"]["get"].is_null(),
        "{document}"
    );

    // And the rotate route gained its 404, which is the whole of the apid-side
    // change for that correction.
    assert!(
        paths["/api/v1/actions/wireguard/{iface}/rotate-key"]["post"]["responses"]["404"]
            .is_object(),
        "{document}"
    );
}

/// The documented interface schema against `mosd_settings::IfaceSettings`
/// itself, field for field, so a field added to the model cannot go
/// undocumented here.
///
/// Four schemas and not one, because the model is four structs; each is
/// compared against a fully-populated instance, since every optional field is
/// `skip_serializing_if` and an absent one would make the comparison vacuous.
#[test]
fn the_network_schema_matches_the_settings_model() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    let peer = mosd_settings::WireguardPeer {
        public_key: PEER_KEY.to_string(),
        allowed_ips: vec!["10.8.0.0/24".to_string()],
        endpoint: Some("vpn.example.net:51820".to_string()),
        persistent_keepalive: Some(25),
    };
    let iface = mosd_settings::IfaceSettings {
        kind: mosd_settings::IfaceKind::Wireguard,
        dhcp: false,
        static_: Some(mosd_settings::StaticConfig {
            address: "10.8.0.2/24".to_string(),
            gateway: Some("10.8.0.1".to_string()),
            dns: vec!["1.1.1.1".to_string()],
        }),
        vlan: Some(mosd_settings::VlanConfig {
            parent: "eth0".to_string(),
            id: 100,
        }),
        bridge: Some(mosd_settings::BridgeConfig {
            ports: vec!["eth1".to_string()],
        }),
        wireguard: Some(mosd_settings::WireguardConfig {
            listen_port: Some(51820),
            peers: vec![peer.clone()],
        }),
    };

    for (schema, model) in [
        ("NetworkInterface", serde_json::to_value(&iface).unwrap()),
        (
            "StaticAddressing",
            serde_json::to_value(iface.static_.clone().unwrap()).unwrap(),
        ),
        (
            "VlanParameters",
            serde_json::to_value(iface.vlan.clone().unwrap()).unwrap(),
        ),
        (
            "BridgeParameters",
            serde_json::to_value(iface.bridge.clone().unwrap()).unwrap(),
        ),
        (
            "WireguardParameters",
            serde_json::to_value(iface.wireguard.clone().unwrap()).unwrap(),
        ),
        ("WireguardPeerEntry", serde_json::to_value(&peer).unwrap()),
    ] {
        let mut documented: Vec<String> = document["components"]["schemas"][schema]["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{schema} is an object schema"))
            .keys()
            .cloned()
            .collect();
        let mut fields: Vec<String> = model
            .as_object()
            .unwrap_or_else(|| panic!("{schema}'s model is an object"))
            .keys()
            .cloned()
            .collect();
        documented.sort();
        fields.sort();
        assert_eq!(
            documented, fields,
            "the documented {schema} has drifted from the settings model"
        );
    }
}

/// The lifted pre-shared key bound, run by the WiFi route for the first time.
///
/// `docs/task/RFCT-241.md` recorded that M5 could not check it: the bound lived
/// inside a private function of the `mosd` binary crate's station reconciler,
/// so a key outside IEEE 802.11i's range was accepted, stored, and refused
/// later by the renderer with the error visible only in live state. M6 lifted
/// it into `mosd-settings` and the reconciler calls the lifted copy, so this is
/// the same rule and not a second one.
#[tokio::test]
async fn a_psk_outside_the_lifted_bounds_is_refused_by_the_wifi_route() {
    let (router, fake) = test_app(wifi_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for psk in ["short07", &"x".repeat(64)] {
        let response = post_json(
            &router,
            "/api/v1/wifi/client/networks",
            &json!({ "ssid": "roastery", "psk": psk }).to_string(),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{} characters",
            psk.len()
        );
        let error = envelope(response).await;
        assert_eq!(error["code"], "validation_failed");
        assert!(
            error["message"].as_str().unwrap().contains("8 to 63"),
            "{error}"
        );
        // The message never names the length observed: a length is a fact
        // about a secret, and this string reaches an HTTP client.
        assert!(
            !error["message"].as_str().unwrap().contains(psk),
            "the refusal echoed the key: {error}"
        );
    }
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());

    // And the two admissible shapes still store: a passphrase in range, and a
    // 64-digit hex PMK, which the bound does not apply to.
    for (ssid, psk) in [("roastery", "hunter2hunter2"), ("lab", &"a".repeat(64))] {
        let response = post_json(
            &router,
            "/api/v1/wifi/client/networks",
            &json!({ "ssid": ssid, "psk": psk }).to_string(),
            Some(&cookie),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED, "{ssid}");
    }
}

/// The collection identifier contract's third clause, held across **every**
/// collection at once: a duplicate is **409**, with a per-collection code.
///
/// One test over all three rather than three that happen to agree. The clause
/// exists because the two shipped answers had diverged — M5's SSH route
/// answered 422 and its WiFi route answered 409 for the same class of condition
/// — and what stops a fourth collection from picking a fourth answer is a test
/// that fails when one of them drifts, not three tests that would each keep
/// passing on their own. `docs/design/api.md` section 2.4 carries the clause.
///
/// The codes are asserted individually and are deliberately **not** one shared
/// constant: the clause says *a per-collection code*, so a client can tell
/// which collection refused it without parsing a path.
#[tokio::test]
async fn every_collection_answers_409_for_a_duplicate() {
    let mut tree = kinds_tree("hunter2secret");
    tree["access"]["ssh"] =
        ssh_tree(json!([stored_key(REAL_ED25519_LINE)]))["access"]["ssh"].clone();
    tree["wifi"] = wifi_tree(json!([
        { "ssid": "roastery", "psk": "hunter2hunter2", "hidden": false, "priority": 0 },
    ]))["wifi"]
        .clone();
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;

    for (path, body, code) in [
        (
            "/api/v1/ssh/authorized-keys",
            json!({ "key": format!("{} relabelled", canonical(REAL_ED25519_LINE)) }),
            "key_exists",
        ),
        (
            "/api/v1/wifi/client/networks",
            json!({ "ssid": "roastery", "psk": "adifferentkey" }),
            "ssid_exists",
        ),
        (
            "/api/v1/network/wg0/peers",
            json!({ "publicKey": PEER_KEY }),
            "peer_exists",
        ),
    ] {
        let response = post_json(&router, path, &body.to_string(), Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
        assert_api_headers(&response, path);
        let error = envelope(response).await;
        assert_eq!(error["code"], code, "{path}");
        assert_eq!(error["source"], "apid", "{path}");
    }
    // Not one of them wrote: a refused duplicate leaves the collection alone.
    assert!(fake.set_paths().is_empty(), "{:?}", fake.set_paths());
}

// PLAN-023 M7: the three actions. No state to `GET` and no idempotency to
// promise, so every assertion below is about the status code, the call that
// did or did not reach mosd, and what the response body does not contain.

const REBOOT_PATH: &str = "/api/v1/actions/reboot";
const POWEROFF_PATH: &str = "/api/v1/actions/poweroff";
const TRANSIENT_PATH: &str = "/api/v1/actions/transient-root-password";

/// **202 and not 204**, on both verbs, with the bus call reaching mosd after
/// the response was built.
///
/// The status is the milestone's first acceptance criterion: the call is
/// spawned on a detached task, so the response goes out before the machine goes
/// down and whether the action completed is not knowable over the connection
/// that asked. `await_power_calls` is what proves the dispatch is detached
/// rather than awaited — a handler that awaited the call would already have the
/// entry when the response arrived, and would have no reason to answer 202.
///
/// Asserted against the form path in the same test rather than trusted from the
/// design: both surfaces answer the same code because both go through one
/// dispatch, and a change to one of them fails here.
#[tokio::test]
async fn the_power_routes_answer_202_like_the_form_path() {
    for (path, expected) in [(REBOOT_PATH, "reboot"), (POWEROFF_PATH, "power_off")] {
        let (router, fake) = test_app(configured_tree("hunter2secret"));
        let cookie = login(&router, "hunter2secret").await;

        let response = post_json(&router, path, "", Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::ACCEPTED, "{path}");
        assert_eq!(
            header_value(&response, CACHE_CONTROL),
            "no-store",
            "{path}"
        );
        assert_eq!(body_string(response).await, "", "{path}: 202 carries no body");
        assert_eq!(
            fake.await_power_calls(1).await,
            vec![expected.to_string()],
            "{path}"
        );
        assert!(fake.set_paths().is_empty(), "{path} writes no settings");
    }

    // The form path answers the same code, measured here and not assumed.
    let (router, _) = test_app(configured_tree("hunter2secret"));
    let cookie = login(&router, "hunter2secret").await;
    let form = post_form(&router, "/power/reboot", "confirm=reboot", Some(&cookie)).await;
    assert_eq!(form.status(), StatusCode::ACCEPTED);
}

/// **The confirmation token is not carried over, and the form still demands
/// it.**
///
/// `PowerAction::confirm_token` and `TRANSIENT_CONFIRM_TOKEN` are compile-time
/// constants, not secrets and not per-session; they stop a mis-click on a
/// rendered page, and there is no mis-click on a `POST` a script constructed.
/// So the API takes none — an empty body is enough — while the form path is
/// unchanged. The asymmetry is deliberate, and this test is what stops a later
/// reading from "harmonising" either half into the other.
#[tokio::test]
async fn the_action_routes_require_no_confirmation_token() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    // No token, and no field carrying one: accepted.
    assert_eq!(
        post_json(&router, REBOOT_PATH, "", Some(&cookie))
            .await
            .status(),
        StatusCode::ACCEPTED
    );
    assert_eq!(
        post_json(
            &router,
            TRANSIENT_PATH,
            &json!({ "password": "hunter2secret" }).to_string(),
            Some(&cookie),
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(fake.transient_password_calls(), 1);

    // The form path is untouched by that reduction: the same request without
    // the token is still refused there.
    let refused = post_form(
        &router,
        "/ssh/password",
        "password=hunter2secret",
        Some(&cookie),
    )
    .await;
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let refused = post_form(&router, "/power/reboot", "", Some(&cookie)).await;
    assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

/// The transient password reaches mosd, is written into no setting, and is
/// nowhere in the tree afterwards — the API half of the property the form path
/// already holds.
#[tokio::test]
async fn the_transient_password_route_sets_it_and_writes_no_setting() {
    const PASSWORD: &str = "correct horse battery";

    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    let response = post_json(
        &router,
        TRANSIENT_PATH,
        &json!({ "password": PASSWORD }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(header_value(&response, CACHE_CONTROL), "no-store");
    assert_eq!(body_string(response).await, "");
    assert_eq!(fake.transient_password_calls(), 1);

    assert!(
        fake.set_paths().is_empty(),
        "a transient password must write no setting, got {:?}",
        fake.set_paths()
    );
    let tree = fake.get_settings("").await.unwrap().to_string();
    assert!(
        !tree.contains(PASSWORD),
        "the password must not appear in the settings tree"
    );
}

/// **The same byte bounds as the form path, because it is the same function.**
///
/// `validate_transient_password` is called by both surfaces, so this asserts
/// the boundaries in both directions and then asserts the form path agrees on
/// the very same inputs. Two copies of the rule could disagree; one cannot, and
/// this is the test that would fail if a second copy ever appeared.
///
/// 72 is bcrypt's limit, which is why the upper bound exists at all: a longer
/// password would be silently shortened to its first 72 bytes.
#[tokio::test]
async fn the_transient_password_route_enforces_the_form_paths_byte_bounds() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for (password, accepted) in [
        ("a".repeat(7), false),
        ("a".repeat(8), true),
        ("a".repeat(72), true),
        ("a".repeat(73), false),
        ("hunter2\0secret".to_string(), false),
        ("hunter2\nsecret".to_string(), false),
        ("hunter2\rsecret".to_string(), false),
    ] {
        let before = fake.transient_password_calls();
        let response = post_json(
            &router,
            TRANSIENT_PATH,
            &json!({ "password": password }).to_string(),
            Some(&cookie),
        )
        .await;
        let context = format!("{} bytes", password.len());
        if accepted {
            assert_eq!(response.status(), StatusCode::NO_CONTENT, "{context}");
            assert_eq!(fake.transient_password_calls(), before + 1, "{context}");
        } else {
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{context}"
            );
            assert_api_headers(&response, &context);
            let error = envelope(response).await;
            assert_eq!(error["code"], "validation_failed", "{context}");
            // apid's own validator refused it, so the envelope says apid and
            // names no dot-path: nothing under `settings` was at fault.
            assert_eq!(error["source"], "apid", "{context}");
            assert!(error.get("path").is_none(), "{context}: {error}");
            assert_eq!(fake.transient_password_calls(), before, "{context}");
        }

        // The form path draws the boundary in the same place, on the same
        // input: one rule, two surfaces.
        let form = post_form(
            &router,
            "/ssh/password",
            &format!(
                "confirm=set-transient-password&password={}",
                urlencode(&password)
            ),
            Some(&cookie),
        )
        .await;
        let expected = if accepted {
            StatusCode::SEE_OTHER
        } else {
            StatusCode::UNPROCESSABLE_ENTITY
        };
        assert_eq!(form.status(), expected, "form path: {context}");
    }
}

/// **A rejected password never appears in the response.**
///
/// The validator's three messages state the bound, the reason for the bound, or
/// the forbidden bytes, and none of them interpolates the password — so the
/// message can be passed through verbatim. This asserts the property the
/// milestone requires rather than the mechanism that provides it: the whole
/// response, headers and body, is searched for the value that was sent.
///
/// The passwords below are distinctive strings rather than runs of one
/// character, so a substring match cannot pass by accident.
#[tokio::test]
async fn a_rejected_transient_password_is_never_echoed() {
    let (router, _) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for password in [
        "shortpw",
        "quagga-vestibule-marzipan-cornice-thimble-quixotic-basalt-lantern-ferrule",
        "quagga\nvestibule",
    ] {
        let response = post_json(
            &router,
            TRANSIENT_PATH,
            &json!({ "password": password }).to_string(),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{password}"
        );
        let headers = format!("{:?}", response.headers());
        let body = body_string(response).await;
        assert!(!body.contains(password), "the body echoed it: {body}");
        assert!(!headers.contains(password), "a header echoed it: {headers}");
        // Nor a distinctive fragment of it: a truncated echo is still an echo.
        for fragment in ["quagga", "shortpw"] {
            if password.contains(fragment) {
                assert!(
                    !body.contains(fragment),
                    "the body echoed `{fragment}`: {body}"
                );
            }
        }
        // It is still a usable §2.4 envelope: the caller has to learn what the
        // bound was without being told what it sent.
        let error: serde_json::Value = serde_json::from_str(&body).expect("§2.4 envelope");
        assert!(error["error"]["message"].as_str().unwrap().contains("bytes"));
    }
}

/// A body that is not this shape is §2.4's `request_invalid` at 400, and the
/// rejection text describes the shape rather than the value — so a malformed
/// body carrying a password does not put it in the response either.
#[tokio::test]
async fn a_malformed_transient_password_body_is_refused_at_400() {
    let (router, fake) = test_app(ssh_tree(json!([])));
    let cookie = login(&router, "hunter2secret").await;

    for body in [
        "not json at all",
        r#"{"password": 7}"#,
        r#"{"passphrase": "hunter2secret"}"#,
        "{}",
    ] {
        let response = post_json(&router, TRANSIENT_PATH, body, Some(&cookie)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
        assert_api_headers(&response, body);
        let error = envelope(response).await;
        assert_eq!(error["code"], "request_invalid", "{body}");
        assert_eq!(error["source"], "apid", "{body}");
    }
    assert_eq!(fake.transient_password_calls(), 0);
    assert!(fake.set_paths().is_empty());
}

/// All three take a bearer token, per Amendment 1's dual-credential reading:
/// `ApiSession`, so a cookie works too and the bearer is what a script uses.
#[tokio::test]
async fn the_action_routes_take_a_bearer_token() {
    let (tree, _) = token_tree("hunter2secret", 0);
    let (router, fake) = test_app(tree);
    let cookie = login(&router, "hunter2secret").await;
    let token = mint_via_pane(&router, &cookie, "deploy").await;

    let response = bearer_json(&router, "POST", TRANSIENT_PATH, &token, r#"{"password":"hunter2secret"}"#).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(fake.transient_password_calls(), 1);

    let response = bearer(&router, "POST", REBOOT_PATH, &token).await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(fake.await_power_calls(1).await, vec!["reboot".to_string()]);
}

/// No credential, no action. The 401 is §2.4's envelope and the machine stays
/// up: this is the one route family where a missing check is unrecoverable.
#[tokio::test]
async fn an_unauthenticated_action_post_is_refused_and_does_not_act() {
    for path in [REBOOT_PATH, POWEROFF_PATH, TRANSIENT_PATH] {
        let (router, fake) = test_app(ssh_tree(json!([])));
        let response = post_json(&router, path, r#"{"password":"hunter2secret"}"#, None).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        assert_api_headers(&response, path);
        assert_eq!(envelope(response).await["code"], "not_authenticated", "{path}");
        // Two calls' worth of deadline, then assert nothing arrived.
        assert!(
            fake.await_power_calls(1).await.is_empty(),
            "{path} acted without a credential"
        );
        assert_eq!(fake.transient_password_calls(), 0, "{path}");
    }
}

/// A failed transient-password call is §2.4's envelope with **no `path`
/// member**: the route writes no setting, so there is no dot-path at fault.
///
/// This is the clause that made `bus_api_error` take an `Option`. Asserted
/// because the alternative — passing a plausible-looking dot-path such as
/// `access.ssh` — would name something that was not at fault, and an empty
/// string would put `"path": ""` on the wire.
#[tokio::test]
async fn a_failed_transient_password_names_no_dot_path() {
    let (router, cookie) = failing_app(Some("org.freedesktop.DBus.Error.Failed")).await;

    let response = post_json(
        &router,
        TRANSIENT_PATH,
        &json!({ "password": "hunter2secret" }).to_string(),
        Some(&cookie),
    )
    .await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_api_headers(&response, TRANSIENT_PATH);
    let error = envelope(response).await;
    assert_eq!(error["code"], "mosd_failed");
    assert_eq!(error["source"], "mosd");
    assert!(error.get("path").is_none(), "{error}");

    // A route that does name one still names it: the member is optional, not
    // removed.
    let response = post_json(
        &router,
        "/api/v1/settings/hostname",
        r#""mos""#,
        Some(&cookie),
    )
    .await;
    assert_eq!(envelope(response).await["path"], "hostname");
}

/// The document describes all three, each `POST`-only: a documented `GET`
/// would be a contract for a route that does not exist, and on these three
/// paths it would be a contract to power the appliance off by following a link.
#[test]
fn the_openapi_document_covers_the_three_actions() {
    let document: serde_json::Value =
        serde_json::from_str(&crate::openapi::document_json()).expect("the document is JSON");

    for (path, statuses) in [
        (REBOOT_PATH, ["202", "401", "405"].as_slice()),
        (POWEROFF_PATH, ["202", "401", "405"].as_slice()),
        (
            TRANSIENT_PATH,
            ["204", "400", "401", "422", "500", "503", "405"].as_slice(),
        ),
    ] {
        let route = &document["paths"][path];
        assert!(route["post"].is_object(), "{path} is missing its POST");
        for status in statuses {
            assert!(
                route["post"]["responses"][status].is_object(),
                "{path} is missing its {status}: {document}"
            );
        }
        for method in ["get", "head", "put", "delete", "patch"] {
            assert!(
                route[method].is_null(),
                "{path} must declare no {method}: {document}"
            );
        }
    }

    // The one request body among the three carries exactly one member.
    let properties = &document["components"]["schemas"]["TransientRootPasswordRequest"]
        ["properties"];
    assert_eq!(
        properties.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["password"],
        "{document}"
    );
}
