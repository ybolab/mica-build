//! Route-level tests driving the router directly with the fake settings
//! backend; no network or D-Bus involved.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::header::{CONTENT_TYPE, COOKIE, LOCATION, SET_COOKIE};
use axum::http::{Request, Response, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use crate::auth;
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
