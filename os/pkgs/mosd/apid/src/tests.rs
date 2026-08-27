//! Route-level tests driving the router directly with the fake settings
//! backend; no network or bus daemon involved.
//!
//! The one exception is [`power_bus`], which drives the router through the
//! real D-Bus client against a fake mosd on a private bus, because what it
//! asserts lives below the fake backend's trait.

mod broken_classes;
mod power_bus;

use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::header::{
    ACCEPT, ALLOW, CACHE_CONTROL, CONTENT_TYPE, COOKIE, LOCATION, SET_COOKIE,
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
    let cookie = login(&router, "hunter2secret").await;
    let response = get(&router, "/", Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert!(body.contains("statusbox"), "hostname missing: {body}");
    assert!(body.contains("eth0"), "network state missing: {body}");
    assert!(body.contains("Uptime"), "uptime missing: {body}");
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
        "iface=eth0&address=",
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
const ALL_MUTATIONS: [(&str, &str); 11] = [
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
        ("GET", "/api/v1/wifi/client/networks"),
        ("POST", "/api/v1/settings"),
        ("DELETE", "/api/v1/tokens/1"),
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
        StatusCode::BAD_GATEWAY,
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
    const UNDECLARED: [&str; 6] = [
        "/api/v1/actions/reboot",
        "/api/v1/ssh/authorized-keys",
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
    // pane in the expected set really renders: a pane that 502s for want of a
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
/// The 502 page §6.3 cites is not among them: it is reached only when a mosd
/// call fails, which a broken bundle does not cause.
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
    // of a device that has just booted. The pane has to render anyway: a 502
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
        "network": {},
        "access": {
            "webAdmin": { "password_hash": auth::hash_password(password).unwrap() },
            "device": { "passwordHash": "device-plaintext-marker" },
            "ssh": {
                "enabled": true,
                "authorizedKeys": [
                    { "comment": "laptop", "hash": "keyhash-plaintext-marker" },
                ],
            },
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

/// The live-state entry the state tests read, carrying all four names too:
/// §2.2 states the redaction rule for the settings root, and this campaign
/// extends it to the state root, so the state root is held to the same proof.
fn secret_state_entry() -> serde_json::Value {
    json!({
        "psk": "state-ap-plaintext-marker",
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
const PLAINTEXT_MARKERS: [&str; 9] = [
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

/// The four field names §2.2's redaction rule names.
const SECRET_FIELD_NAMES: [&str; 4] = ["psk", "passwordHash", "password_hash", "hash"];

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

    // Two subtrees rather than one, because the whole-tree dot-path is `""`
    // and this route family takes a non-empty one. Between them they hold all
    // four names.
    let mut found = Vec::new();
    let mut bodies = String::new();
    for path in ["/api/v1/settings/access", "/api/v1/settings/wifi"] {
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
        "/api/v1/state/wifiAp.psk",
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

    async fn set_settings(&self, _path: &str, _value: &serde_json::Value) -> anyhow::Result<()> {
        unreachable!("the resource routes are read-only")
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

/// A dot-path that does not exist answers **422 `settings_rejected`, not 404**,
/// and the reading is deliberate. It reaches mosd, which rejects it with
/// `InvalidArgs`, and §2.4's table is exhaustive on the fdo error name. The
/// table's `not_found` row covers unknown ROUTES and collection items, and
/// collections are out of phase 1 — a route that does exist, given a path mosd
/// refused, is a rejection and reports as one.
#[tokio::test]
async fn a_dot_path_that_does_not_exist_is_422_and_not_404() {
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
    assert_eq!(get(&router, "/", Some(&cookie)).await.status(), StatusCode::OK);
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
    assert!(auth::verify_password(stored.as_str().unwrap(), "newsecret9"));

    assert_eq!(
        get(&router, "/", Some(&acting)).await.status(),
        StatusCode::OK
    );
    let evicted = get(&router, "/", Some(&other)).await;
    assert_eq!(evicted.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&evicted), "/login");
}

/// A new password under eight characters is refused with `password_rejected`,
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
    assert_eq!(error["code"], "password_rejected");
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
