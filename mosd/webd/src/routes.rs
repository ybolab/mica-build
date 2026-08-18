//! HTTP routes: auth gate middleware, setup/login/logout flows, and the
//! placeholder home page.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Form, Request, State};
use axum::http::header::{HOST, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use maud::{DOCTYPE, Markup, html};
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

/// Shared page shell.
fn page(title: &str, body: Markup) -> Html<String> {
    let markup = html! {
        (DOCTYPE)
        html {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { (title) " — mos" }
            }
            body {
                h1 { (title) }
                (body)
            }
        }
    };
    Html(markup.into_string())
}

#[derive(serde::Deserialize)]
struct SetupForm {
    password: String,
    confirm: String,
}

async fn setup_form(State(state): State<AppState>) -> Response {
    match state.api.get_settings("access").await {
        Ok(access) if password_hash(&access).is_some() => Redirect::to("/login").into_response(),
        Ok(_) => page(
            "Set admin password",
            html! {
                form method="post" action="/setup" {
                    p { label { "Password (at least 8 characters)" } " "
                        input type="password" name="password" required minlength="8"; }
                    p { label { "Confirm password" } " "
                        input type="password" name="confirm" required minlength="8"; }
                    p { button type="submit" { "Save" } }
                }
            },
        )
        .into_response(),
        Err(err) => bus_error(&err),
    }
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
    let cookie = state.sessions.create();
    (
        [(SET_COOKIE, session::session_cookie(&cookie))],
        Redirect::to("/"),
    )
        .into_response()
}

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

/// Placeholder home page; later tasks replace it with the real panes.
async fn home(State(state): State<AppState>) -> Html<String> {
    let hostname = match state.api.get_settings("hostname").await {
        Ok(Value::String(name)) => name,
        _ => "(unavailable)".to_string(),
    };
    let daemon_state = match state.api.get_state("").await {
        Ok(value) => value.to_string(),
        Err(_) => "(unavailable)".to_string(),
    };
    page(
        "mos",
        html! {
            p { "Hostname: " (hostname) }
            nav {
                a href="/hostname" { "Hostname" } " | "
                a href="/network" { "Network" } " | "
                form method="post" action="/logout" style="display:inline" {
                    button type="submit" { "Sign out" }
                }
            }
            h2 { "Daemon state" }
            pre { (daemon_state) }
        },
    )
}
