//! Route-level tests driving the router directly with the fake settings
//! backend; no network or D-Bus involved.

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

    let wrong = post_form(&router, "/login", "password=wrongpass", None).await;
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    assert!(wrong.headers().get(SET_COOKIE).is_none());

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
async fn five_failures_lock_out_logins() {
    let (router, _) = test_app(configured_tree("hunter2secret"));
    for _ in 0..5 {
        let response = post_form(&router, "/login", "password=wrongpass", None).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    // Even the correct password is rejected while locked out.
    let locked = post_form(&router, "/login", "password=hunter2secret", None).await;
    assert_eq!(locked.status(), StatusCode::TOO_MANY_REQUESTS);
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

// ---------------------------------------------------------------------------
// Power pane
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSH pane
// ---------------------------------------------------------------------------

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
        // Plural since RFCT-053: mosd renders one file per managed login
        // account and publishes every path. apid reads none of them; the
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
async fn unauthenticated_ssh_routes_are_rejected_one_by_one() {
    // Each of the five paths on its own, rather than "the gate exists".
    for (path, body) in [
        ("/ssh", ""),
        SSH_MUTATIONS[0],
        SSH_MUTATIONS[1],
        SSH_MUTATIONS[2],
        SSH_MUTATIONS[3],
    ] {
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

// ---------------------------------------------------------------------------
// The asset router: §4.1 precedence, the reserved `/api/` subtree, §4.2's SPA
// fallback and §4.3's headers as applied.
// ---------------------------------------------------------------------------

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
/// bundle, so the 404s below are the reservation and not an empty directory.
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

    for (path, bytes) in [
        ("/api/versions", VERSIONS_BYTES),
        ("/api/v1/settings", SETTINGS_BYTES),
    ] {
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

/// The reservation covers the subtree, every method, and `/api/versions` in
/// particular — which is deliberately *not* implemented in this phase.
#[tokio::test]
async fn the_api_reservation_answers_every_shape_with_the_envelope() {
    let bundle = install_bundle(&[("index.html", "<!doctype html><title>custom</title>")]);
    let router = test_app_serving(configured_tree("hunter2secret"), bundle.path());
    let cookie = login(&router, "hunter2secret").await;

    for (method, path) in [
        ("GET", "/api"),
        ("GET", "/api/"),
        ("GET", "/api/versions"),
        ("GET", "/api/v1/settings"),
        ("GET", "/api/v1/settings/network.eth0"),
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

// ---------------------------------------------------------------------------
// §6.3's escape: the built-in UI at the reserved `/builtin/` prefix, and the
// control that deactivates a custom UI.
// ---------------------------------------------------------------------------

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
/// This is deliberately **not** an enumeration of §6.1's five classes as
/// behaviours — that suite is RFCT-078's. It is the input set for the property
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
/// The 502 page §6.3 actually cites is **not** among them, and F2 in
/// `docs/task/RFCT-075.md` records why.
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
