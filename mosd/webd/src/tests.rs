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
        builder = builder.header(COOKIE, format!("webd_session={cookie}"));
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
        builder = builder.header(COOKIE, format!("webd_session={cookie}"));
    }
    send(router, builder.body(Body::from(body.to_string())).unwrap()).await
}

fn location(response: &Response<axum::body::Body>) -> &str {
    response.headers().get(LOCATION).unwrap().to_str().unwrap()
}

/// The `webd_session=<value>` part of the `Set-Cookie` response header.
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
    pair.strip_prefix("webd_session=").unwrap().to_string()
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
