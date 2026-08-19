//! HTTP routes: auth gate middleware, the first-run setup wizard, login and
//! logout flows, the status/network/hostname panes, the power pane and the
//! SSH pane.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Form, Query, Request, State};
use axum::http::header::{HOST, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use maud::{DOCTYPE, Markup, PreEscaped, html};
use mosd_settings::{AuthorizedKey, SettingsError, parse_authorized_key, validate_authorized_keys};
use serde_json::Value;
use sha2::{Digest, Sha256};

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
        .route("/power", get(power_form))
        // POST only, deliberately: no GET handler exists for either action, so
        // a browser prefetch, a crawler or a mis-clicked link cannot power the
        // appliance off.
        .route("/power/reboot", post(power_reboot))
        .route("/power/poweroff", post(power_poweroff))
        .route("/ssh", get(ssh_form))
        // POST only, for the same reason as the power actions above: no GET
        // handler exists for any of the four, so nothing that merely follows a
        // link can enable SSH, set a root password, or change the key list.
        .route("/ssh/enable", post(ssh_enable))
        .route("/ssh/password", post(ssh_password))
        .route("/ssh/keys/add", post(ssh_key_add))
        .route("/ssh/keys/remove", post(ssh_key_remove))
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
                        a href="/power" { "Power" }
                        a href="/ssh" { "SSH" }
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

// ---------------------------------------------------------------------------
// Power pane
// ---------------------------------------------------------------------------

/// A power action the pane can request of mosd.
#[derive(Clone, Copy)]
enum PowerAction {
    Reboot,
    PowerOff,
}

impl PowerAction {
    /// Path of the POST route performing this action.
    fn path(self) -> &'static str {
        match self {
            Self::Reboot => "/power/reboot",
            Self::PowerOff => "/power/poweroff",
        }
    }

    /// Exact value the confirmation control must submit. The submit button
    /// alone is not enough: the checkbox has to be ticked as well.
    fn confirm_token(self) -> &'static str {
        match self {
            Self::Reboot => "reboot",
            Self::PowerOff => "poweroff",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Reboot => "Reboot",
            Self::PowerOff => "Power off",
        }
    }

    /// Sentence shown next to the confirmation checkbox.
    fn confirmation(self) -> &'static str {
        match self {
            Self::Reboot => "Yes, reboot this appliance now.",
            Self::PowerOff => "Yes, power this appliance off now.",
        }
    }

    /// Sentence shown on the acknowledgement page.
    fn acknowledgement(self) -> &'static str {
        match self {
            Self::Reboot => {
                "Reboot requested. The appliance is going down; this page will stop responding shortly."
            }
            Self::PowerOff => {
                "Power-off requested. The appliance is shutting down and will need to be switched on by hand."
            }
        }
    }
}

/// The confirmation form for one action.
fn power_form_markup(action: PowerAction) -> Markup {
    html! {
        form method="post" action=(action.path()) {
            fieldset {
                legend { (action.label()) }
                p { label {
                    input type="checkbox" name="confirm" value=(action.confirm_token()) required;
                    " " (action.confirmation())
                } }
                p { button type="submit" { (action.label()) } }
            }
        }
    }
}

fn power_page(banner: Option<Markup>) -> Html<String> {
    pane(
        "Power",
        html! {
            @if let Some(banner) = banner { (banner) }
            p { "Rebooting is what activates a newly installed system slot. Both actions interrupt every service on this appliance." }
            (power_form_markup(PowerAction::Reboot))
            (power_form_markup(PowerAction::PowerOff))
        },
    )
}

async fn power_form() -> Html<String> {
    power_page(None)
}

/// Confirmation checkbox, absent when unticked.
#[derive(serde::Deserialize)]
struct ConfirmForm {
    #[serde(default)]
    confirm: String,
}

/// Validate the confirmation, then hand the action to mosd on a detached task.
///
/// The response is built and returned without awaiting the D-Bus call: on a
/// real appliance the machine may go down mid-call, and the operator should
/// get a page rather than a dropped connection.
fn power_submit(state: &AppState, action: PowerAction, confirm: &str) -> Response {
    if confirm != action.confirm_token() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            power_page(Some(error_box(
                "Tick the confirmation box before requesting a power action.",
            ))),
        )
            .into_response();
    }
    let api = state.api.clone();
    tokio::spawn(async move {
        let result = match action {
            PowerAction::Reboot => api.reboot().await,
            PowerAction::PowerOff => api.power_off().await,
        };
        if let Err(err) = result {
            tracing::error!(action = action.confirm_token(), error = %err, "power action failed");
        }
    });
    (
        StatusCode::ACCEPTED,
        page(action.label(), html! { p { (action.acknowledgement()) } }),
    )
        .into_response()
}

async fn power_reboot(State(state): State<AppState>, Form(form): Form<ConfirmForm>) -> Response {
    power_submit(&state, PowerAction::Reboot, &form.confirm)
}

async fn power_poweroff(State(state): State<AppState>, Form(form): Form<ConfirmForm>) -> Response {
    power_submit(&state, PowerAction::PowerOff, &form.confirm)
}

// ---------------------------------------------------------------------------
// Hostname submit
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSH pane
// ---------------------------------------------------------------------------

/// Settings dot-path of the stored authorized-key list.
const SSH_KEYS_PATH: &str = "access.ssh.authorizedKeys";

/// The sentence the pane has to carry, verbatim.
///
/// `AuthorizedKeysFile` is `%u`-expanded over one shared key list, so a key
/// added here logs in as root. An operator who adds a colleague's key expecting
/// an unprivileged shell would be handing out root, and a pane that says
/// nothing manufactures exactly that misunderstanding. A test asserts the
/// sentence renders, so a later refactor cannot quietly drop it.
const ROOT_KEY_NOTICE: &str = "Every authorized key is a root key.";

/// Exact value the transient-password confirmation control must submit, in the
/// same shape as the power actions' `confirm_token`.
const TRANSIENT_CONFIRM_TOKEN: &str = "set-transient-password";

/// Shortest transient password accepted, in bytes; mosd's own floor.
const MIN_TRANSIENT_PASSWORD_BYTES: usize = 8;

/// Longest transient password accepted, in bytes.
///
/// The 72 is not arbitrary, and it is deliberately tighter than mosd's own
/// bound: the transient password is hashed with bcrypt, and bcrypt reads only
/// the FIRST 72 BYTES of its input and silently ignores the rest. Accepting a
/// 100-character password would therefore mean the first 72 characters of it
/// also unlock the device — the operator would be running on a shorter secret
/// than the one they typed and believe in. Refusing the input is the only way
/// the pane avoids creating that surprise; truncating it silently would be the
/// same surprise with a different author.
const MAX_TRANSIENT_PASSWORD_BYTES: usize = 72;

/// OpenSSH fingerprint of a canonical `<type> <blob>` key line.
///
/// `SHA256:` followed by the unpadded base64 of the SHA-256 digest of the
/// **decoded** blob — the string `ssh-keygen -lf` prints, and the same value
/// mosd's sshd reconciler publishes. It is recomputed here rather than read
/// from the published state because the pane has to map the fingerprint an
/// operator clicks back onto the stored entry a removal rewrites, and the
/// published list carries no such handle. A test pins it against fingerprints
/// that came out of `ssh-keygen`, not against itself.
///
/// `None` when the line has no blob or the blob does not decode.
fn ssh_fingerprint(key: &str) -> Option<String> {
    let blob = key.split(' ').nth(1)?;
    let decoded = mosd_settings::decode_base64(blob)?;
    Some(format!(
        "SHA256:{}",
        mosd_settings::encode_base64_nopad(&Sha256::digest(&decoded))
    ))
}

/// The parser's own message, without the dot-path prefix its `Display` adds:
/// the operator is looking at a form field, not at a settings path.
fn key_error_message(err: &SettingsError) -> String {
    match err {
        SettingsError::Validation { message, .. } => message.clone(),
        other => other.to_string(),
    }
}

/// Read the stored key list out of the `access.ssh` subtree.
///
/// An absent list is an empty list, but a list that is *present and
/// unreadable* is an error rather than an empty list: treating it as empty
/// would let an add or a remove overwrite keys the operator cannot see.
fn parse_key_list(ssh: &Value) -> anyhow::Result<Vec<AuthorizedKey>> {
    match ssh.get("authorizedKeys") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|err| anyhow::anyhow!("The stored authorized-key list is unreadable: {err}")),
    }
}

/// Everything the SSH pane renders, gathered before any markup is built.
struct SshView {
    /// `access.ssh.enabled` — what the operator asked for.
    enabled: bool,
    /// The stored key list; empty when it is absent or could not be read.
    keys: Vec<AuthorizedKey>,
    /// Live state published by mosd's sshd reconciler, absent when mosd has
    /// published none yet.
    state: Option<Value>,
    /// Why the key list or the live state could not be read, if either failed.
    problems: Vec<String>,
}

impl SshView {
    /// A boolean published by the sshd reconciler, `None` when the state is
    /// missing or carries something else at that key.
    fn flag(&self, key: &str) -> Option<bool> {
        self.state.as_ref()?.get(key)?.as_bool()
    }
}

/// Load the settings half and the live-state half of the pane.
///
/// A failure to read `access.ssh` is fatal to the pane (there is nothing to
/// show); a failure to read the live state is not, because the stored settings
/// and the key list are still worth showing and mosd may simply not have
/// reconciled yet.
async fn load_ssh_view(app: &AppState) -> anyhow::Result<SshView> {
    let ssh = app.api.get_settings("access.ssh").await?;
    let enabled = ssh.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    let mut problems = Vec::new();
    let keys = match parse_key_list(&ssh) {
        Ok(keys) => keys,
        Err(err) => {
            problems.push(err.to_string());
            Vec::new()
        }
    };
    let state = match app.api.get_state("sshd").await {
        Ok(value) => Some(value),
        Err(err) => {
            problems.push(format!("Live sshd state unavailable: {err}"));
            None
        }
    };
    Ok(SshView {
        enabled,
        keys,
        state,
        problems,
    })
}

/// Read the stored key list for a handler that is about to rewrite it.
async fn stored_keys(app: &AppState) -> anyhow::Result<Vec<AuthorizedKey>> {
    parse_key_list(&app.api.get_settings("access.ssh").await?)
}

/// Validate and write a rewritten key list.
async fn write_key_list(app: &AppState, keys: &[AuthorizedKey]) -> Response {
    // The same validator mosd runs before rendering the file, so a list this
    // pane accepts is a list the reconciler will accept too.
    if let Err(err) = validate_authorized_keys(keys) {
        return ssh_error(app, &key_error_message(&err)).await;
    }
    // Infallible: `AuthorizedKey` is a struct of strings with no map keys that
    // could collide.
    let value = serde_json::to_value(keys).expect("authorized keys serialize");
    if let Err(err) = app.api.set_settings(SSH_KEYS_PATH, &value).await {
        return bus_error(&err);
    }
    Redirect::to("/ssh?saved=1").into_response()
}

/// Re-render the pane with `message` in an error box, at 422.
async fn ssh_error(app: &AppState, message: &str) -> Response {
    match load_ssh_view(app).await {
        Ok(view) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            ssh_page(&view, Some(error_box(message))),
        )
            .into_response(),
        Err(err) => bus_error(&err),
    }
}

/// A tri-state flag from the published state; `None` is "unknown", never a
/// bare "no", because the two mean different things to an operator.
fn state_flag(value: Option<bool>, yes: &'static str, no: &'static str) -> &'static str {
    match value {
        Some(true) => yes,
        Some(false) => no,
        None => "unknown",
    }
}

/// The transient-password form, in the same confirmation shape as the power
/// actions: a required checkbox whose value is the token the handler insists
/// on, so the submit button alone cannot set a root password.
fn transient_password_form() -> Markup {
    html! {
        form method="post" action="/ssh/password" {
            fieldset {
                legend { "Transient root password" }
                p { "This password lasts until the next reboot. The next boot clears it, so it is a way in for one session, not a credential to keep; persistent access is by the authorized keys below." }
                p { label { "Password (8 to 72 bytes)" } " "
                    input type="password" name="password" required minlength="8" maxlength="72"; }
                p { label {
                    input type="checkbox" name="confirm" value=(TRANSIENT_CONFIRM_TOKEN) required;
                    " Yes, allow password login as root until the next reboot."
                } }
                p { button type="submit" { "Set password" } }
            }
        }
    }
}

/// One stored key, as fingerprint and comment only.
fn key_entry_markup(entry: &AuthorizedKey) -> Markup {
    html! {
        li {
            @match ssh_fingerprint(&entry.key) {
                Some(fingerprint) => {
                    code { (fingerprint) }
                    @if let Some(comment) = &entry.comment { " " (comment) }
                    form method="post" action="/ssh/keys/remove" {
                        input type="hidden" name="identifier" value=(fingerprint);
                        button type="submit" { "Remove" }
                    }
                }
                // No fingerprint means the blob does not decode, which nothing
                // that went through this pane can produce. Such an entry gets
                // no Remove button rather than a button carrying the key text:
                // the pane never puts key material on the page, and a settings
                // file hand-edited into this state is edited back the same way.
                None => {
                    "(key with no readable fingerprint)"
                    @if let Some(comment) = &entry.comment { " " (comment) }
                }
            }
        }
    }
}

fn ssh_page(view: &SshView, banner: Option<Markup>) -> Html<String> {
    let effective = view.flag("passwordAuthentication");
    let requested = view.flag("passwordAuthenticationRequested");
    let transient_active = view.flag("transientPasswordActive");
    pane(
        "SSH",
        html! {
            @if let Some(banner) = banner { (banner) }
            @for problem in &view.problems { (error_box(problem)) }
            p { b { (ROOT_KEY_NOTICE) } " sshd is pointed at one shared key list for every account, so a key added below logs in as root — adding a colleague's key grants them root on this appliance, not an unprivileged shell." }

            h2 { "Service" }
            p { "SSH: " b { (if view.enabled { "enabled" } else { "disabled" }) } }
            p { "Password authentication: " b { (state_flag(effective, "yes", "no")) } }
            @if requested == Some(true) && effective == Some(false) {
                p { "Password authentication is switched on in settings but off in sshd: it stays off until a transient root password is set, because the root account ships with no password and offering an authentication method that cannot succeed helps nobody." }
            }
            p { "Transient root password: " b { (state_flag(transient_active, "active until the next reboot", "not set")) } }

            form method="post" action="/ssh/enable" {
                fieldset {
                    legend { "Service" }
                    p { label { input type="checkbox" name="enabled" checked[view.enabled]; " Enable SSH" } }
                    p { button type="submit" { "Save" } }
                }
            }

            (transient_password_form())

            h2 { "Authorized keys" }
            @if view.keys.is_empty() {
                p { "No authorized keys. Nobody can log in by key until one is added." }
            } @else {
                ul {
                    @for entry in &view.keys { (key_entry_markup(entry)) }
                }
            }
            form method="post" action="/ssh/keys/add" {
                fieldset {
                    legend { "Add a key" }
                    p { "One public key line, as " code { "ssh-keygen" } " prints it: " code { "<type> <base64> [comment]" } ". The comment is a label only; it does not restrict what the key can do." }
                    p { input type="text" name="key" size="80" required; }
                    p { button type="submit" { "Add key" } }
                }
            }
        },
    )
}

async fn ssh_form(State(app): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match load_ssh_view(&app).await {
        Ok(view) => {
            let banner = query.saved.is_some().then(saved_banner);
            ssh_page(&view, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

/// The enable toggle; absent when unticked.
#[derive(serde::Deserialize)]
struct SshEnableForm {
    enabled: Option<String>,
}

async fn ssh_enable(State(app): State<AppState>, Form(form): Form<SshEnableForm>) -> Response {
    let enabled = form.enabled.is_some();
    if let Err(err) = app
        .api
        .set_settings("access.ssh.enabled", &Value::Bool(enabled))
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/ssh?saved=1").into_response()
}

#[derive(serde::Deserialize)]
struct SshPasswordForm {
    #[serde(default)]
    confirm: String,
    #[serde(default)]
    password: String,
}

/// Bounds and forbidden bytes for a transient password.
///
/// No message echoes the password, and no branch here logs it: the only place
/// it goes is the D-Bus call.
fn validate_transient_password(password: &str) -> Result<(), String> {
    if password.len() < MIN_TRANSIENT_PASSWORD_BYTES {
        return Err(format!(
            "Password must be at least {MIN_TRANSIENT_PASSWORD_BYTES} bytes."
        ));
    }
    if password.len() > MAX_TRANSIENT_PASSWORD_BYTES {
        return Err(format!(
            "Password must be at most {MAX_TRANSIENT_PASSWORD_BYTES} bytes: it is hashed with bcrypt, which reads only the first {MAX_TRANSIENT_PASSWORD_BYTES} bytes, so a longer one would be silently shortened to that."
        ));
    }
    if password.contains(['\0', '\n', '\r']) {
        return Err("Password must not contain a NUL, newline or carriage return.".to_string());
    }
    Ok(())
}

/// Set a transient root password.
///
/// The password is never written into the settings tree and never logged: it
/// is read out of the form, checked, handed to mosd, and dropped.
async fn ssh_password(State(app): State<AppState>, Form(form): Form<SshPasswordForm>) -> Response {
    if form.confirm != TRANSIENT_CONFIRM_TOKEN {
        return ssh_error(
            &app,
            "Tick the confirmation box before setting a transient root password.",
        )
        .await;
    }
    if let Err(message) = validate_transient_password(&form.password) {
        return ssh_error(&app, &message).await;
    }
    if let Err(err) = app.api.set_transient_root_password(&form.password).await {
        return bus_error(&err);
    }
    Redirect::to("/ssh?saved=1").into_response()
}

#[derive(serde::Deserialize)]
struct SshKeyAddForm {
    #[serde(default)]
    key: String,
}

async fn ssh_key_add(State(app): State<AppState>, Form(form): Form<SshKeyAddForm>) -> Response {
    // Handed to the shared parser exactly as submitted. Nothing is trimmed:
    // a leading or trailing space is one of the things that parser exists to
    // reject, and trimming here would accept a line mosd would not.
    let parsed = match parse_authorized_key(&form.key) {
        Ok(parsed) => parsed,
        Err(err) => return ssh_error(&app, &key_error_message(&err)).await,
    };
    let mut keys = match stored_keys(&app).await {
        Ok(keys) => keys,
        Err(err) => return ssh_error(&app, &err.to_string()).await,
    };
    keys.push(parsed);
    write_key_list(&app, &keys).await
}

#[derive(serde::Deserialize)]
struct SshKeyRemoveForm {
    #[serde(default)]
    identifier: String,
}

/// Remove one key, identified by fingerprint or by exact canonical key text.
///
/// Never by list index: an index is only meaningful against the list the
/// operator was looking at, so a key added or removed by another session
/// between the render and the submit would slide it onto a different key and
/// delete something nobody asked to delete. A fingerprint names one key
/// wherever it has moved to.
///
/// An identifier matching nothing is an error, not a silent success: "removed"
/// when nothing was removed is how an operator ends up believing access was
/// withdrawn while the key still grants root.
async fn ssh_key_remove(
    State(app): State<AppState>,
    Form(form): Form<SshKeyRemoveForm>,
) -> Response {
    let mut keys = match stored_keys(&app).await {
        Ok(keys) => keys,
        Err(err) => return ssh_error(&app, &err.to_string()).await,
    };
    let found = keys.iter().position(|entry| {
        entry.key == form.identifier
            || ssh_fingerprint(&entry.key).as_deref() == Some(form.identifier.as_str())
    });
    let Some(index) = found else {
        return ssh_error(
            &app,
            "No authorized key matches that fingerprint. The list may have changed since this page was loaded; reload it and try again.",
        )
        .await;
    };
    keys.remove(index);
    write_key_list(&app, &keys).await
}
