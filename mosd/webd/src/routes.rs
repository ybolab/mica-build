//! HTTP routes: auth gate middleware, the first-run setup wizard, login and
//! logout flows, and the status/network/hostname panes.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Form, Query, Request, State};
use axum::http::header::{HOST, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use maud::{DOCTYPE, Markup, PreEscaped, html};
use serde_json::Value;

use crate::auth::{self, LoginGuard};
use crate::session::{self, SessionStore};
use crate::settings_api::SettingsApi;

/// Shared handler state.
#[derive(Clone)]
pub struct AppState {
    api: Arc<dyn SettingsApi>,
    sessions: Arc<SessionStore>,
    guard: Arc<Mutex<LoginGuard>>,
}

impl AppState {
    /// State around a settings backend and the cookie signing key.
    pub fn new(api: Arc<dyn SettingsApi>, signing_key: [u8; 32]) -> Self {
        Self {
            api,
            sessions: Arc::new(SessionStore::new(signing_key)),
            guard: Arc::new(Mutex::new(LoginGuard::default())),
        }
    }
}

/// The HTTPS application router.
pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/", get(home))
        .route("/setup", get(setup_form).post(setup_submit))
        .route("/login", get(login_form).post(login_submit))
        .route("/logout", post(logout))
        .route("/network", get(network_form).post(network_submit))
        .route("/hostname", get(hostname_form).post(hostname_submit))
        .route("/healthz", get(healthz))
        .layer(middleware::from_fn_with_state(state.clone(), gate))
        .with_state(state)
}

/// Redirect-only router served on the HTTP listener: 308 every request to
/// the HTTPS origin derived from the `Host` header.
pub fn redirect_app(https_port: u16) -> Router {
    Router::new()
        .fallback(redirect_to_https)
        .with_state(https_port)
}

async fn redirect_to_https(State(https_port): State<u16>, request: Request) -> Response {
    let host = request
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");
    let host = match host.rsplit_once(':') {
        Some((name, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => name,
        _ => host,
    };
    let path = request.uri().path_and_query().map_or("/", |pq| pq.as_str());
    let target = if https_port == 443 {
        format!("https://{host}{path}")
    } else {
        format!("https://{host}:{https_port}{path}")
    };
    (StatusCode::PERMANENT_REDIRECT, [(LOCATION, target)]).into_response()
}

/// Whether `access` (the settings subtree) carries an admin password hash.
fn password_hash(access: &Value) -> Option<&str> {
    access
        .get("webAdmin")
        .and_then(|admin| admin.get("password_hash"))
        .and_then(Value::as_str)
}

/// 502 page for failed mosd calls.
fn bus_error(err: &anyhow::Error) -> Response {
    tracing::warn!(error = %err, "mosd call failed");
    (
        StatusCode::BAD_GATEWAY,
        page(
            "Error",
            html! { p { "The management daemon is unavailable." } },
        ),
    )
        .into_response()
}

/// Auth gate: routes every request into setup mode, login, or through.
///
/// - `/healthz` always passes.
/// - Setup mode (no admin password configured yet): only `/setup` passes,
///   everything else redirects there.
/// - Normal mode: `/login` and `/setup` pass (the setup handlers answer 409
///   or bounce to `/login` themselves); everything else requires a valid
///   session cookie or redirects to `/login`.
async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if path == "/healthz" {
        return next.run(request).await;
    }
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return bus_error(&err),
    };
    if password_hash(&access).is_none() {
        if path == "/setup" {
            return next.run(request).await;
        }
        return Redirect::to("/setup").into_response();
    }
    if path == "/login" || path == "/setup" {
        return next.run(request).await;
    }
    let authed = session::cookie_from_headers(request.headers())
        .is_some_and(|value| state.sessions.verify(&value));
    if authed {
        next.run(request).await
    } else {
        Redirect::to("/login").into_response()
    }
}

async fn healthz() -> &'static str {
    "ok"
}

/// Inline stylesheet shared by every page; no external assets.
const STYLE: &str = "\
body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#222}\
nav{display:flex;gap:1rem;align-items:center;border-bottom:1px solid #ccc;padding-bottom:.5rem;margin-bottom:1rem}\
nav form{margin-left:auto}\
fieldset{margin-bottom:1rem}\
pre{background:#f4f4f4;padding:.5rem;overflow-x:auto}\
.error{background:#fdd;border:1px solid #c00;padding:.5rem 1rem;margin-bottom:1rem}\
.saved{background:#dfd;border:1px solid #080;padding:.5rem 1rem;margin-bottom:1rem}";

/// Shared page shell; `nav` adds the pane navigation bar.
fn shell(title: &str, nav: bool, body: Markup) -> Html<String> {
    let markup = html! {
        (DOCTYPE)
        html {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { (title) " — mos" }
                style { (PreEscaped(STYLE)) }
            }
            body {
                @if nav {
                    nav {
                        a href="/" { "Status" }
                        a href="/network" { "Network" }
                        a href="/hostname" { "Hostname" }
                        form method="post" action="/logout" {
                            button type="submit" { "Logout" }
                        }
                    }
                }
                h1 { (title) }
                (body)
            }
        }
    };
    Html(markup.into_string())
}

/// Bare page without navigation (setup, login, error pages).
fn page(title: &str, body: Markup) -> Html<String> {
    shell(title, false, body)
}

/// Authenticated pane with the navigation bar.
fn pane(title: &str, body: Markup) -> Html<String> {
    shell(title, true, body)
}

fn error_box(message: &str) -> Markup {
    html! { div.error { (message) } }
}

fn saved_banner() -> Markup {
    html! { div.saved { "Settings saved." } }
}

/// `?saved=1` marker appended after a successful pane submit.
#[derive(serde::Deserialize)]
struct SavedQuery {
    saved: Option<String>,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HOSTNAME_RULES: &str =
    "Hostname must be 1-63 letters, digits or hyphens and must not start or end with a hyphen.";

/// `^[a-zA-Z0-9._-]{1,15}$`
fn valid_iface_name(name: &str) -> bool {
    (1..=15).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn valid_ipv4(address: &str) -> bool {
    let octets: Vec<&str> = address.split('.').collect();
    octets.len() == 4
        && octets.iter().all(|octet| {
            !octet.is_empty()
                && octet.len() <= 3
                && octet.bytes().all(|b| b.is_ascii_digit())
                && octet.parse::<u16>().is_ok_and(|value| value <= 255)
        })
}

/// Minimal `a.b.c.d/len` shape with in-range octets and prefix length.
fn valid_cidr(cidr: &str) -> bool {
    let Some((address, prefix)) = cidr.split_once('/') else {
        return false;
    };
    valid_ipv4(address)
        && !prefix.is_empty()
        && prefix.len() <= 2
        && prefix.bytes().all(|b| b.is_ascii_digit())
        && prefix.parse::<u8>().is_ok_and(|value| value <= 32)
}

/// `^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`
fn valid_hostname(name: &str) -> bool {
    let bytes = name.as_bytes();
    matches!(bytes.len(), 1..=63)
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
        && bytes[0] != b'-'
        && bytes[bytes.len() - 1] != b'-'
}

/// Interface form validation shared by `/network` and the setup wizard.
fn validate_iface(iface: &str, dhcp: bool, address: &str) -> Result<(), &'static str> {
    if !valid_iface_name(iface) {
        return Err("Interface name must be 1-15 characters of letters, digits, '.', '_' or '-'.");
    }
    if !dhcp && !valid_cidr(address) {
        return Err("Static address must be IPv4 CIDR notation, e.g. 192.168.1.10/24.");
    }
    Ok(())
}

/// JSON stored at `network.<iface>`: `{"dhcp": true}` or a static block with
/// `gateway` omitted when empty and `dns` always present (empty list ok).
fn iface_settings_value(dhcp: bool, address: &str, gateway: &str, dns: &str) -> Value {
    if dhcp {
        return serde_json::json!({ "dhcp": true });
    }
    let dns: Vec<String> = dns
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect();
    let mut static_ = serde_json::Map::new();
    static_.insert("address".to_string(), Value::String(address.to_string()));
    if !gateway.is_empty() {
        static_.insert("gateway".to_string(), Value::String(gateway.to_string()));
    }
    static_.insert("dns".to_string(), serde_json::json!(dns));
    serde_json::json!({ "dhcp": false, "static": static_ })
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct SetupForm {
    password: String,
    confirm: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    iface: String,
    dhcp: Option<String>,
    #[serde(default)]
    address: String,
    #[serde(default)]
    gateway: String,
    #[serde(default)]
    dns: String,
}

/// The dhcp/address/gateway/dns inputs shared by the network forms and the
/// setup wizard.
fn iface_fields(dhcp: bool, address: &str, gateway: &str, dns: &str) -> Markup {
    html! {
        p { label { input type="checkbox" name="dhcp" checked[dhcp]; " Use DHCP" } }
        p { label { "Static address (CIDR)" } " "
            input type="text" name="address" value=(address) placeholder="192.168.1.10/24"; }
        p { label { "Gateway (optional)" } " "
            input type="text" name="gateway" value=(gateway); }
        p { label { "DNS servers (comma-separated, optional)" } " "
            input type="text" name="dns" value=(dns); }
    }
}

async fn setup_form(State(state): State<AppState>) -> Response {
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return bus_error(&err),
    };
    if password_hash(&access).is_some() {
        return Redirect::to("/login").into_response();
    }
    let hostname = match state.api.get_settings("hostname").await {
        Ok(value) => value.as_str().unwrap_or_default().to_string(),
        Err(err) => return bus_error(&err),
    };
    page(
        "Welcome to mos",
        html! {
            p { "First-run setup: choose the admin password. Hostname and the initial network interface are optional." }
            form method="post" action="/setup" {
                fieldset {
                    legend { "Admin password" }
                    p { label { "Password (at least 8 characters)" } " "
                        input type="password" name="password" required minlength="8"; }
                    p { label { "Confirm password" } " "
                        input type="password" name="confirm" required minlength="8"; }
                }
                fieldset {
                    legend { "Hostname (optional)" }
                    p { label { "Hostname" } " "
                        input type="text" name="hostname" value=(hostname); }
                }
                fieldset {
                    legend { "Initial network interface (optional)" }
                    p { label { "Interface name (leave empty to skip)" } " "
                        input type="text" name="iface" placeholder="eth0"; }
                    (iface_fields(false, "", "", ""))
                }
                p { button type="submit" { "Save" } }
            }
        },
    )
    .into_response()
}

async fn setup_submit(State(state): State<AppState>, Form(form): Form<SetupForm>) -> Response {
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return bus_error(&err),
    };
    if password_hash(&access).is_some() {
        return (
            StatusCode::CONFLICT,
            page(
                "Error",
                html! { p { "The admin password is already set." } },
            ),
        )
            .into_response();
    }
    if form.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            page(
                "Error",
                html! { p { "Password must be at least 8 characters." } },
            ),
        )
            .into_response();
    }
    if form.password != form.confirm {
        return (
            StatusCode::BAD_REQUEST,
            page("Error", html! { p { "Passwords do not match." } }),
        )
            .into_response();
    }
    // Validate the optional sections up front so nothing is written on error.
    let hostname = form.hostname.trim();
    if !hostname.is_empty() && !valid_hostname(hostname) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            page("Error", html! { (error_box(HOSTNAME_RULES)) }),
        )
            .into_response();
    }
    let iface = form.iface.trim();
    let dhcp = form.dhcp.is_some();
    let address = form.address.trim();
    if !iface.is_empty()
        && let Err(message) = validate_iface(iface, dhcp, address)
    {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            page("Error", html! { (error_box(message)) }),
        )
            .into_response();
    }
    let hash = match auth::hash_password(&form.password) {
        Ok(hash) => hash,
        Err(err) => {
            tracing::error!(error = %err, "password hashing failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let value = serde_json::json!({ "password_hash": hash });
    if let Err(err) = state.api.set_settings("access.webAdmin", &value).await {
        return bus_error(&err);
    }
    if !hostname.is_empty() {
        let current = match state.api.get_settings("hostname").await {
            Ok(value) => value.as_str().unwrap_or_default().to_string(),
            Err(err) => return bus_error(&err),
        };
        if hostname != current
            && let Err(err) = state
                .api
                .set_settings("hostname", &Value::String(hostname.to_string()))
                .await
        {
            return bus_error(&err);
        }
    }
    if !iface.is_empty() {
        let value = iface_settings_value(dhcp, address, form.gateway.trim(), &form.dns);
        if let Err(err) = state
            .api
            .set_settings(&format!("network.{iface}"), &value)
            .await
        {
            return bus_error(&err);
        }
    }
    let cookie = state.sessions.create();
    (
        [(SET_COOKIE, session::session_cookie(&cookie))],
        Redirect::to("/"),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct LoginForm {
    password: String,
}

async fn login_form() -> Html<String> {
    page(
        "Sign in",
        html! {
            form method="post" action="/login" {
                p { label { "Admin password" } " "
                    input type="password" name="password" required; }
                p { button type="submit" { "Sign in" } }
            }
        },
    )
}

async fn login_submit(State(state): State<AppState>, Form(form): Form<LoginForm>) -> Response {
    if !state.guard.lock().expect("guard lock").check() {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            page(
                "Error",
                html! { p { "Too many failed logins; retry shortly." } },
            ),
        )
            .into_response();
    }
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return bus_error(&err),
    };
    let Some(hash) = password_hash(&access) else {
        return Redirect::to("/setup").into_response();
    };
    if auth::verify_password(hash, &form.password) {
        state.guard.lock().expect("guard lock").record_success();
        let cookie = state.sessions.create();
        (
            [(SET_COOKIE, session::session_cookie(&cookie))],
            Redirect::to("/"),
        )
            .into_response()
    } else {
        state.guard.lock().expect("guard lock").record_failure();
        (
            StatusCode::UNAUTHORIZED,
            page("Sign in", html! { p { "Wrong password." } }),
        )
            .into_response()
    }
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(value) = session::cookie_from_headers(&headers) {
        state.sessions.remove(&value);
    }
    (
        [(SET_COOKIE, session::clear_cookie())],
        Redirect::to("/login"),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Status pane
// ---------------------------------------------------------------------------

/// Seconds from the first field of `/proc/uptime` contents.
fn parse_uptime(contents: &str) -> Option<u64> {
    let secs: f64 = contents.split_whitespace().next()?.parse().ok()?;
    if secs.is_finite() && secs >= 0.0 {
        Some(secs as u64)
    } else {
        None
    }
}

/// `"3d 4h 12m"`-style rendering, dropping leading zero units.
fn humanize_uptime(secs: u64) -> String {
    let days = secs / 86_400;
    let hours = secs % 86_400 / 3_600;
    let minutes = secs % 3_600 / 60;
    if days > 0 {
        format!("{days}d {hours}h {minutes}m")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

async fn home(State(state): State<AppState>) -> Html<String> {
    let hostname = state.api.get_settings("hostname").await;
    let network = state.api.get_state("network").await;
    let uptime = std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|contents| parse_uptime(&contents));
    pane(
        "Status",
        html! {
            h2 { "System" }
            @match &hostname {
                Ok(value) => { p { "Hostname: " b { (value.as_str().unwrap_or("(unknown)")) } } }
                Err(err) => { (error_box(&format!("Hostname unavailable: {err}"))) }
            }
            @match uptime {
                Some(secs) => { p { "Uptime: " (humanize_uptime(secs)) } }
                None => { (error_box("Uptime unavailable.")) }
            }
            h2 { "Network state" }
            @match &network {
                Ok(Value::Object(map)) if map.is_empty() => { p { "No network state reported." } }
                Ok(Value::Object(map)) => {
                    ul {
                        @for (iface, details) in map {
                            li {
                                b { (iface) }
                                pre { (pretty(details)) }
                            }
                        }
                    }
                }
                Ok(other) => { pre { (pretty(other)) } }
                Err(err) => { (error_box(&format!("Network state unavailable: {err}"))) }
            }
        },
    )
}

// ---------------------------------------------------------------------------
// Network pane
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct NetworkForm {
    iface: String,
    dhcp: Option<String>,
    #[serde(default)]
    address: String,
    #[serde(default)]
    gateway: String,
    #[serde(default)]
    dns: String,
}

/// Display fields for one configured interface's form.
struct IfaceDisplay {
    dhcp: bool,
    address: String,
    gateway: String,
    dns: String,
}

fn iface_display(cfg: &Value) -> IfaceDisplay {
    let static_ = cfg.get("static");
    let field = |name: &str| {
        static_
            .and_then(|s| s.get(name))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    IfaceDisplay {
        dhcp: cfg.get("dhcp").and_then(Value::as_bool).unwrap_or(false),
        address: field("address"),
        gateway: field("gateway"),
        dns: static_
            .and_then(|s| s.get("dns"))
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
    }
}

fn network_page(network: &Value, banner: Option<Markup>) -> Html<String> {
    let empty = serde_json::Map::new();
    let ifaces = network.as_object().unwrap_or(&empty);
    pane(
        "Network",
        html! {
            @if let Some(banner) = banner { (banner) }
            @if ifaces.is_empty() { p { "No interfaces configured." } }
            @for (name, cfg) in ifaces {
                form method="post" action="/network" {
                    fieldset {
                        legend { (name) }
                        input type="hidden" name="iface" value=(name);
                        @let display = iface_display(cfg);
                        (iface_fields(display.dhcp, &display.address, &display.gateway, &display.dns))
                        p { button type="submit" { "Save" } }
                    }
                }
            }
            form method="post" action="/network" {
                fieldset {
                    legend { "Add interface" }
                    p { label { "Interface name" } " "
                        input type="text" name="iface" placeholder="eth0"; }
                    (iface_fields(false, "", "", ""))
                    p { button type="submit" { "Add" } }
                }
            }
        },
    )
}

async fn network_form(State(state): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match state.api.get_settings("network").await {
        Ok(network) => {
            let banner = query.saved.is_some().then(saved_banner);
            network_page(&network, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

async fn network_submit(State(state): State<AppState>, Form(form): Form<NetworkForm>) -> Response {
    let iface = form.iface.trim();
    let dhcp = form.dhcp.is_some();
    let address = form.address.trim();
    if let Err(message) = validate_iface(iface, dhcp, address) {
        let network = match state.api.get_settings("network").await {
            Ok(value) => value,
            Err(err) => return bus_error(&err),
        };
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            network_page(&network, Some(error_box(message))),
        )
            .into_response();
    }
    let value = iface_settings_value(dhcp, address, form.gateway.trim(), &form.dns);
    if let Err(err) = state
        .api
        .set_settings(&format!("network.{iface}"), &value)
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/network?saved=1").into_response()
}

// ---------------------------------------------------------------------------
// Hostname pane
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct HostnameForm {
    hostname: String,
}

fn hostname_page(current: &str, banner: Option<Markup>) -> Html<String> {
    pane(
        "Hostname",
        html! {
            @if let Some(banner) = banner { (banner) }
            form method="post" action="/hostname" {
                p { label { "Hostname" } " "
                    input type="text" name="hostname" value=(current) required; }
                p { button type="submit" { "Save" } }
            }
        },
    )
}

async fn hostname_form(State(state): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match state.api.get_settings("hostname").await {
        Ok(value) => {
            let current = value.as_str().unwrap_or_default().to_string();
            let banner = query.saved.is_some().then(saved_banner);
            hostname_page(&current, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

async fn hostname_submit(
    State(state): State<AppState>,
    Form(form): Form<HostnameForm>,
) -> Response {
    let hostname = form.hostname.trim();
    if !valid_hostname(hostname) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            hostname_page(hostname, Some(error_box(HOSTNAME_RULES))),
        )
            .into_response();
    }
    if let Err(err) = state
        .api
        .set_settings("hostname", &Value::String(hostname.to_string()))
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/hostname?saved=1").into_response()
}
