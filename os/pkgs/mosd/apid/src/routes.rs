//! HTTP routes: auth gate middleware, the first-run setup wizard, login and
//! logout flows, the status/network/hostname panes, the power pane, the SSH
//! pane and §6.3's escape at the reserved `/builtin/` prefix. [`app`] is also
//! where `docs/design/api.md` §4.1's precedence lives, as the shape of the
//! router rather than as a check: declared routes, then the reserved `/api/`
//! and `/builtin/` subtrees, then the asset router as the fallback.
//!
//! Every page below is a `maud` `html!` expansion over one `&str` stylesheet
//! constant, which is §6.2's "the built-in UI is compiled into the binary"
//! stated as a property of this file: no `include_str!`, no `include_bytes!`,
//! no asset directory. §6.2 names dm-verity as the only protection on
//! `/usr/bin/apid` — `apid.service` has no `ProtectSystem=` — so an artifact
//! that is bytes in the binary is behind that protection and an artifact that
//! is files on disk would not be.

use std::net::IpAddr;
use std::sync::Arc;

use axum::extract::{Form, FromRequestParts, OriginalUri, Path, Query, Request, State};
use axum::http::header::{CACHE_CONTROL, HOST, LOCATION, RETRY_AFTER, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use maud::{DOCTYPE, Markup, PreEscaped, html};
use mosd_settings::{AuthorizedKey, SettingsError, parse_authorized_key, validate_authorized_keys};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::assets::mime::CacheClass;
use crate::assets::serve;
use crate::audit::{Audit, Source};
use crate::auth::{self, GuardStore};
use crate::bundle::Store;
use crate::redact;
use crate::session::{self, SessionStore};
use crate::settings_api::SettingsApi;

/// Shared handler state.
#[derive(Clone)]
pub struct AppState {
    api: Arc<dyn SettingsApi>,
    sessions: Arc<SessionStore>,
    guard: Arc<GuardStore>,
    audit: Arc<Audit>,
    bundles: Arc<Store>,
}

impl AppState {
    /// State around a settings backend and the cookie signing key.
    ///
    /// The bundle store is constructed here and reads nothing: §6.1 forbids
    /// bundle discovery before the listeners bind, and `Store::at_default` is
    /// a path and no syscall. Discovery and the start-up compatibility
    /// re-check are separate work.
    /// The backoff counter and the audit trail default to their
    /// non-persistent forms so that constructing state needs no filesystem;
    /// `with_persistence` is what production calls, and access.md §6's "a
    /// power cycle must not reset the clock" is that call, not this one.
    pub fn new(api: Arc<dyn SettingsApi>, signing_key: [u8; 32]) -> Self {
        Self {
            api,
            sessions: Arc::new(SessionStore::new(signing_key)),
            guard: Arc::new(GuardStore::ephemeral()),
            audit: Arc::new(Audit::journal_only()),
            bundles: Arc::new(Store::at_default()),
        }
    }

    /// Root the backoff counter and the audit ring in `state_dir`
    /// (`docs/design/access.md` §6).
    ///
    /// The directory must already exist — `main.rs` creates it before this is
    /// called, on the same path that holds the TLS material.
    pub fn with_persistence(mut self, state_dir: &std::path::Path) -> Self {
        self.guard = Arc::new(GuardStore::load(state_dir.join("login_guard.json")));
        self.audit = Arc::new(Audit::at(state_dir.to_path_buf()));
        self
    }

    /// The `/srv/ui` bundle store the asset router reads (§5.2).
    pub(crate) fn bundles(&self) -> &Store {
        &self.bundles
    }

    /// The audit sink, for the start-up path (`main.rs` hands it to bundle
    /// discovery so a staged custom UI's activation is recorded too).
    pub(crate) fn audit(&self) -> &Arc<Audit> {
        &self.audit
    }

    /// Root the bundle store somewhere else, for tests that install one.
    ///
    /// Test-only on purpose: §5.2 fixes the shipped location and nothing
    /// configures it.
    #[cfg(test)]
    pub fn with_bundle_root(mut self, root: impl Into<std::path::PathBuf>) -> Self {
        self.bundles = Arc::new(Store::new(root));
        self
    }
}

/// The HTTPS application router.
///
/// §4.1's precedence rule is this function's declaration order, and it is
/// total. Rules 1-3 are `.route`/`.nest` declarations and rule 4 is the
/// `.fallback`; axum matches declared routes before it consults a fallback, so
/// a bundle that ships a file at `api/v1/settings`, at `healthz` or at `login`
/// cannot capture any of them. No handler re-checks a prefix to make that
/// true.
pub fn app(state: AppState) -> Router {
    Router::new()
        // §4.1's single exception to rule 3: `/` is conditional — the active
        // bundle's index when one is active and readable, the built-in UI
        // otherwise. It stays conditional: §6.3 asks for exactly *one*
        // unconditional path to the built-in UI, and the reserved prefix
        // below is it.
        .route("/", get(serve::root))
        // §6.3 candidate (A), the way in: a reserved prefix the asset router
        // can never shadow. It is unshadowable for the same structural reason
        // `/api/` is — axum matches declared routes before it consults a
        // fallback — and for no other. Nothing under `assets/` checks for this
        // prefix, and nothing may: §4.1 asks for a rule the dispatch mechanism
        // enforces rather than one somebody can forget to write.
        //
        // The nest claims the whole subtree — `/builtin/index.html` and
        // `/builtin/assets/app.js` included — which is what §6.3 means by
        // burning a path prefix permanently; a prefix reserved for only some of
        // its paths is not reserved. The two spellings split across the nest
        // boundary, the same asymmetry `/api` has: the nest claims `/builtin`
        // (the nested router sees `/`) and not `/builtin/`, so the
        // trailing-slash spelling is declared outside it. Both must reach the
        // pane, an operator recovering a device should not have to get the
        // slash right, and the spelling the design document writes is the one
        // with it.
        .nest(
            BUILTIN,
            Router::new()
                .route("/", get(builtin_home))
                // POST only, matching the power and SSH mutations above: no GET
                // handler exists, so no prefetch, crawler or mis-clicked link
                // can deactivate a working custom UI.
                .route(BUILTIN_DEACTIVATE_LEAF, post(builtin_deactivate))
                .fallback(builtin_not_found),
        )
        .route(BUILTIN_PATH, get(builtin_home))
        .route("/setup", get(setup_form).post(setup_submit))
        .route("/login", get(login_form).post(login_submit))
        .route("/logout", post(logout))
        .route("/password", get(password_form).post(password_submit))
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
        .route("/containers", get(containers_form))
        .route("/containers/enable", post(containers_enable))
        .route("/mqtt", get(mqtt_form))
        .route("/mqtt/enable", post(mqtt_enable))
        .route("/healthz", get(healthz))
        // §4.1 rule 1: the whole `/api/` prefix, its own not-found handler
        // included. §2.1's two discovery routes are declared inside it and
        // every other path under it 404s, so no bundle can occupy the prefix
        // and no route under it can be reached by anything but a declaration
        // here.
        //
        // The explicit `/api/` route is not redundant. `nest` claims `/api`,
        // `/api/x` and `/api/x/y`, and not `/api/`; the difference is a
        // request that begins `/api/` reaching the asset router, which is
        // exactly what rule 1 forbids.
        .nest(API, api_router())
        .route("/api/", any(api_not_found))
        // §4.1 rule 4.
        .fallback(serve::fallback)
        .layer(middleware::from_fn_with_state(state.clone(), gate))
        .with_state(state)
}

/// The reserved subtree's own not-found handler (§4.1 rule 1, §4.2's "why
/// 404s inside `/api/` are the API's own").
///
/// §2.4's envelope, which is what makes a mistyped path a machine-readable
/// answer rather than an empty body.
async fn api_not_found(OriginalUri(uri): OriginalUri) -> Response {
    api_response(
        StatusCode::NOT_FOUND,
        ApiError::apid("not_found", format!("no API route at {}", uri.path())),
    )
}

// §2.1's API surface: the reserved subtree's declared routes, their bodies
// and the session check that guards them.

/// The reserved prefix, and the paths §2.1 declares under it.
///
/// The leaves are the paths as the nested router sees them; the OpenAPI
/// document composes them with the prefix through `context_path`, and
/// [`is_declared_api_route`] composes them to get what the gate sees. One
/// spelling each.
const API: &str = "/api";
const VERSIONS_PATH: &str = "/versions";
const V1_META_PATH: &str = "/v1/meta";

/// §2.3's actions namespace, with its one shipped verb. A password change is
/// an operation and not a resource — the namespace is named `actions`
/// precisely so no reader expects a `GET` to work there.
const V1_CHANGE_PASSWORD_PATH: &str = "/v1/actions/change-password";

/// §2.2's two read-only roots, in the three spellings they need.
///
/// The prefix is the shared one and the only one the gate predicate tests. The
/// other two exist because axum names a wildcard segment `{*path}` and OpenAPI
/// names a template parameter `{path}`, so the served path and the documented
/// path cannot be the same string; `the_resource_path_spellings_agree` holds
/// them to the prefix so they cannot drift apart.
const V1_SETTINGS_PREFIX: &str = "/v1/settings/";
const V1_SETTINGS_ROUTE: &str = "/v1/settings/{*path}";
const V1_SETTINGS_DOC: &str = "/v1/settings/{path}";
const V1_STATE_PREFIX: &str = "/v1/state/";
const V1_STATE_ROUTE: &str = "/v1/state/{*path}";
const V1_STATE_DOC: &str = "/v1/state/{path}";

/// Each root's three spellings as one tuple, for the test that holds them
/// together.
#[cfg(test)]
pub(crate) const SETTINGS_SPELLINGS: (&str, &str, &str) =
    (V1_SETTINGS_PREFIX, V1_SETTINGS_ROUTE, V1_SETTINGS_DOC);
#[cfg(test)]
pub(crate) const STATE_SPELLINGS: (&str, &str, &str) =
    (V1_STATE_PREFIX, V1_STATE_ROUTE, V1_STATE_DOC);

/// The fdo error names mosd maps its `SettingsError` onto, and the three rows
/// of §2.4's table that name one.
const FDO_INVALID_ARGS: &str = "org.freedesktop.DBus.Error.InvalidArgs";
const FDO_IO_ERROR: &str = "org.freedesktop.DBus.Error.IOError";
const FDO_FAILED: &str = "org.freedesktop.DBus.Error.Failed";

/// §2.4's `Retry-After` on the one class that carries it.
const RETRY_AFTER_SECONDS: &str = "5";

/// The major versions this build serves — §2.1's *served set*, which is an
/// array because it can legitimately have more than one member.
const SERVED_VERSIONS: [&str; 1] = ["v1"];

/// The member of the served set a client with no preference should use.
const CURRENT_VERSION: &str = "v1";

/// The reserved `/api` subtree: §2.1's declared routes, and the not-found
/// handler every other path under the prefix reaches.
///
/// Each route is declared here from the same constant its `utoipa::path`
/// attribute documents it under, so the served path and the documented path
/// are one string and cannot disagree.
fn api_router() -> Router<AppState> {
    Router::new()
        .route(VERSIONS_PATH, get(api_versions))
        .route(V1_META_PATH, get(api_v1_meta))
        .route(V1_SETTINGS_ROUTE, get(api_v1_settings))
        .route(V1_STATE_ROUTE, get(api_v1_state))
        .route(V1_CHANGE_PASSWORD_PATH, post(api_v1_change_password))
        .fallback(api_not_found)
}

/// Whether `path` is one of the API routes that answers for itself.
///
/// The gate hands exactly these off. `/api/versions` is unauthenticated by
/// design (§2.1) and `/api/v1/meta` answers §2.4's `not_authenticated`
/// envelope rather than the gate's HTML redirect (§3.1). Every other path
/// under the prefix is absent from this list and reaches the gate's own
/// logic unchanged.
fn is_declared_api_route(path: &str) -> bool {
    path.strip_prefix(API).is_some_and(|leaf| {
        leaf == VERSIONS_PATH
            || leaf == V1_META_PATH
            || leaf == V1_CHANGE_PASSWORD_PATH
            || resource_dot_path(leaf).is_some()
    })
}

/// The dot-path a leaf names, when the leaf is one of §2.2's two roots.
///
/// A root prefix with nothing after it names none. axum's `{*path}` wildcard
/// matches at least one character, so `/api/v1/settings` and
/// `/api/v1/settings/` reach the subtree's not-found handler, and this
/// predicate must hand off exactly what the router serves: a path the gate
/// releases to a route that does not exist would answer a 404 where an
/// unauthenticated caller is redirected.
fn resource_dot_path(leaf: &str) -> Option<&str> {
    let dot_path = leaf
        .strip_prefix(V1_SETTINGS_PREFIX)
        .or_else(|| leaf.strip_prefix(V1_STATE_PREFIX))?;
    (!dot_path.is_empty()).then_some(dot_path)
}

/// Every `/api/` response, in the one shape §4.3 gives them: JSON in both
/// directions (§2.1), and `no-store` on every outcome rather than only on the
/// failures.
fn api_response(status: StatusCode, body: impl serde::Serialize) -> Response {
    (
        status,
        [(CACHE_CONTROL, CacheClass::NoStore.header_value())],
        Json(body),
    )
        .into_response()
}

/// §2.4's envelope: the one shape every failure under `/api/` takes.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ApiError {
    error: ApiErrorDetail,
}

/// The envelope's payload.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ApiErrorDetail {
    /// Stable machine token, from an open set: a client that does not
    /// recognise it must fall back to the HTTP status class (§2.1).
    code: &'static str,
    /// Human-readable, and not for matching on.
    message: String,
    /// The side the failure came from.
    source: &'static str,
    /// The settings dot-path at fault (§2.4), when the failure names one.
    ///
    /// Optional, and omitted rather than sent empty: an unmatched route and a
    /// failed authentication name no dot-path, and a member present with a
    /// meaningless value is worse than an absent one.
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl ApiError {
    /// An envelope for a failure apid raised itself.
    fn apid(code: &'static str, message: String) -> Self {
        Self::new(code, message, "apid")
    }

    /// An envelope for a failure mosd raised, carrying mosd's own message.
    fn mosd(code: &'static str, message: String) -> Self {
        Self::new(code, message, "mosd")
    }

    fn new(code: &'static str, message: String, source: &'static str) -> Self {
        Self {
            error: ApiErrorDetail {
                code,
                message,
                source,
                path: None,
            },
        }
    }

    /// The same envelope, naming the settings dot-path at fault.
    fn at(mut self, path: &str) -> Self {
        self.error.path = Some(path.to_string());
        self
    }
}

/// `GET /api/versions` (§2.1's discovery table).
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ApiVersions {
    /// Every major version served. A client tests **membership** in this set;
    /// a client that reads only `current` concludes that a device it can talk
    /// to is one it cannot.
    versions: Vec<&'static str>,
    /// The member to use with no preference. Always a member of `versions`.
    current: &'static str,
}

/// `GET /api/v1/meta` (§2.1's discovery table).
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiMeta {
    /// The API major version this route belongs to.
    api: &'static str,
    /// mosd's settings schema version: the shape of the tree on disk, which
    /// moves independently of the API version and must never be conflated
    /// with it.
    settings_schema_version: u32,
    /// The daemon answering.
    daemon: &'static str,
}

/// The served set, unauthenticated (§2.1).
///
/// It must be answerable before the caller holds a credential, which is why
/// the gate hands it off above its own `GetSettings` call: a factory-fresh
/// device has no `access.webAdmin` and redirects everything else to `/setup`,
/// and a UI that survived the update it is incompatible with has to be able
/// to say so. The response carries the served set and nothing else — no
/// hostname, no device id, no build string — because anyone who can reach the
/// listener can read it.
#[utoipa::path(
    get,
    path = VERSIONS_PATH,
    context_path = API,
    tag = "discovery",
    responses((status = 200, description = "The major API versions this device serves", body = ApiVersions)),
)]
pub(crate) async fn api_versions() -> Response {
    api_response(
        StatusCode::OK,
        ApiVersions {
            versions: SERVED_VERSIONS.to_vec(),
            current: CURRENT_VERSION,
        },
    )
}

/// What the caller is talking to, in detail (§2.1).
///
/// `settingsSchemaVersion` is read from `mosd_settings` and never copied: the
/// number a client uses to decide whether it understands a settings body has
/// exactly one source.
#[utoipa::path(
    get,
    path = V1_META_PATH,
    context_path = API,
    tag = "discovery",
    responses(
        (status = 200, description = "What this daemon is and which schema it speaks", body = ApiMeta),
        (status = 401, description = "No session cookie, or one that does not verify", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_meta(_session: ApiSession) -> Response {
    api_response(
        StatusCode::OK,
        ApiMeta {
            api: CURRENT_VERSION,
            settings_schema_version: mosd_settings::SCHEMA_VERSION,
            daemon: "apid",
        },
    )
}

/// The body of a resource `GET`: the value at the dot-path, as mosd holds it.
///
/// Any JSON value, because a dot-path names a subtree, an array or a scalar
/// and §2.2's passthrough imposes no shape of its own. The string
/// `"<redacted>"` is a value a client can receive anywhere inside it: every
/// field named `psk`, `passwordHash`, `password_hash` or `hash`, at any depth
/// and inside arrays, carries that sentinel instead of its value, and so does
/// the whole body when the dot-path names one of those fields directly. It is
/// read-only — writing it back would destroy the credential — and phase 1
/// serves no write route to write it with.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(transparent)]
pub(crate) struct ResourceValue(Value);

/// The settings tree at a dot-path (§2.2).
///
/// The dot-path IS the resource identifier: this answers exactly what
/// `GetSettings("<dot-path>")` returns, redacted. There is no second model
/// beside `mosd-settings`, so there is nothing for one to drift from.
#[utoipa::path(
    get,
    path = V1_SETTINGS_DOC,
    context_path = API,
    tag = "resources",
    params(("path" = String, Path, description = "The settings dot-path, verbatim: `hostname`, `access.ssh`, `wifi.ap`")),
    responses(
        (status = 200, description = "The value at the dot-path, redacted", body = ResourceValue),
        (status = 401, description = "No session cookie, or one that does not verify", body = ApiError),
        (status = 422, description = "mosd rejected the dot-path (`settings_rejected`), which is also the answer for a dot-path that does not exist", body = ApiError),
        (status = 500, description = "mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_settings(
    _session: ApiSession,
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response {
    resource_response(state.api.get_settings(&path).await, &path)
}

/// The live-state tree at a dot-path (§2.2).
///
/// A separate root and not a corner of the settings one, because mosd holds
/// two trees with different types, different mutability and different
/// lifetimes. `GET` only: there is no `SetState` on the bus to expose.
#[utoipa::path(
    get,
    path = V1_STATE_DOC,
    context_path = API,
    tag = "resources",
    params(("path" = String, Path, description = "The live-state dot-path, verbatim: `hostname`, `network`, `power`")),
    responses(
        (status = 200, description = "The value at the dot-path, redacted", body = ResourceValue),
        (status = 401, description = "No session cookie, or one that does not verify", body = ApiError),
        (status = 422, description = "mosd rejected the dot-path (`settings_rejected`), which is also the answer for a dot-path that does not exist", body = ApiError),
        (status = 500, description = "mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_state(
    _session: ApiSession,
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response {
    resource_response(state.api.get_state(&path).await, &path)
}

/// One answer shape for both roots: the value redacted, or §2.4's envelope
/// classified from what mosd said.
fn resource_response(value: anyhow::Result<Value>, path: &str) -> Response {
    match value {
        Ok(value) => api_response(StatusCode::OK, ResourceValue(redact::redact(value, path))),
        Err(err) => bus_api_error(&err, path),
    }
}

/// §2.4's table, applied to a failed mosd call.
///
/// The classification is translated and the message is not. mosd maps its
/// `SettingsError` onto three fdo error names and zbus carries the name back,
/// so the distinction exists all the way to here and only apid can lose it;
/// the message is mosd's own words because no phrasing apid could pre-write
/// would say which field was wrong.
///
/// The concrete `zbus::Error` is recovered by downcast: `bus_client.rs`
/// converts with `err.into()`, and that conversion stores the error rather
/// than flattening it, so the name is readable here.
fn bus_api_error(err: &anyhow::Error, path: &str) -> Response {
    tracing::warn!(error = %err, path, "mosd call failed");
    let (status, error) = match err.downcast_ref::<zbus::Error>() {
        Some(zbus::Error::MethodError(name, message, _)) => {
            // An fdo error with no message is still a classification; the name
            // is the most specific thing left to say.
            let message = message.clone().unwrap_or_else(|| name.to_string());
            match name.as_str() {
                FDO_INVALID_ARGS => (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    ApiError::mosd("settings_rejected", message),
                ),
                FDO_IO_ERROR => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ApiError::mosd("settings_io", message),
                ),
                FDO_FAILED => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ApiError::mosd("mosd_failed", message),
                ),
                _ => mosd_unreachable(err),
            }
        }
        _ => mosd_unreachable(err),
    };
    let mut response = api_response(status, error.at(path));
    // §2.4 gives `Retry-After` to exactly one class, and 503 is that class:
    // apid is up and answering, and the proxy cache is dropped after a failed
    // call so the next request reconnects.
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from_static(RETRY_AFTER_SECONDS));
    }
    response
}

/// §2.4's last row, which is exhaustive over everything the three above do not
/// name: the call could not be made at all. `source` is apid because this is a
/// statement about this server rather than about the request.
fn mosd_unreachable(err: &anyhow::Error) -> (StatusCode, ApiError) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        ApiError::apid("mosd_unreachable", format!("{err:#}")),
    )
}

/// Proof that the request carried a session cookie the store verifies.
///
/// An extractor and not middleware, and not the gate: it runs for exactly the
/// handlers that name it, so the reserved subtree's not-found handler and
/// `/api/versions` are untouched by it and no path-prefix test decides who is
/// guarded.
///
/// Its rejection is §2.4's envelope with a 401 and not the gate's redirect. A
/// client that follows that redirect lands on `GET /login`, which answers 200
/// with an HTML page, so a script reads the whole exchange as success (§3.1).
pub(crate) struct ApiSession;

impl FromRequestParts<AppState> for ApiSession {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if session::cookie_from_headers(&parts.headers)
            .is_some_and(|value| state.sessions.verify(&value))
        {
            return Ok(Self);
        }
        Err(api_response(
            StatusCode::UNAUTHORIZED,
            ApiError::apid(
                "not_authenticated",
                "no session cookie, or one that does not verify".to_string(),
            ),
        ))
    }
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

/// 503 page for failed mosd calls, with `Retry-After` — the same status and
/// header the API path answers for the same condition (`mosd_unreachable`):
/// the failure is this server declining to serve, not a malformed answer from
/// an upstream, so one outage reports one way on both surfaces.
fn bus_error(err: &anyhow::Error) -> Response {
    tracing::warn!(error = %err, "mosd call failed");
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(RETRY_AFTER, HeaderValue::from_static(RETRY_AFTER_SECONDS))],
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
/// - The declared `/api/` routes always pass: they answer for themselves, in
///   §2.4's envelope rather than in HTML.
/// - Setup mode (no admin password configured yet): only `/setup` passes,
///   everything else redirects there.
/// - Normal mode: `/login` and `/setup` pass (the setup handlers answer 409
///   or bounce to `/login` themselves); everything else requires a valid
///   session cookie or redirects to `/login`.
async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if path == "/healthz" || is_declared_api_route(path) {
        return next.run(request).await;
    }

    // The session check comes before the bus call, and the ordering is the
    // point. It is sound because a live session already implies the device is
    // out of setup mode: a session is minted in exactly two places —
    // `login_submit`, only after `password_hash` returned `Some` and verified
    // against it, and `setup_submit`, only after the `access.webAdmin` write
    // that creates the hash has succeeded — and no route removes a hash, so
    // "session verifies" cannot coexist with "no admin password is configured".
    // An unset-password operation, if one is ever added, has to clear the
    // session table in the same step or it invalidates this short-circuit.
    //
    // It buys two things. The gate is layered onto every route, so without it
    // an authenticated page load costs one system-bus round trip per request --
    // fine for one server-rendered pane, not fine once a custom UI bundle (§4)
    // serves dozens of static assets per page, none of which need mosd. And a
    // static asset still serves while mosd is down, which is the reasoning §6.1
    // applies to a broken bundle: a failure in one part must not take the
    // surface that reports it with it.
    if session::cookie_from_headers(request.headers())
        .is_some_and(|value| state.sessions.verify(&value))
    {
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
    // The session was already checked above, so reaching here means there
    // isn't a valid one.
    Redirect::to("/login").into_response()
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
                        a href="/password" { "Password" }
                        a href="/power" { "Power" }
                        a href="/ssh" { "SSH" }
                        a href="/containers" { "Containers" }
                        a href="/mqtt" { "MQTT" }
                        // §6.3's discoverability cost, closed where it is
                        // actually paid: *"(A) only helps an operator who knows
                        // the URL"*. A logged-in operator whose custom UI is
                        // broken still reaches every declared pane, so the
                        // prefix is one click from all of them.
                        a href=(BUILTIN_PATH) { "Built-in UI" }
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

// Validation

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

// Setup wizard

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

async fn setup_submit(
    State(state): State<AppState>,
    Source(source): Source,
    Form(form): Form<SetupForm>,
) -> Response {
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
    // Off the async workers for the same reason login verification is:
    // argon2id costs real CPU per call, by design.
    let password = form.password.clone();
    let hash = match tokio::task::spawn_blocking(move || auth::hash_password(&password))
        .await
        .unwrap_or_else(|err| Err(anyhow::anyhow!("password hashing task: {err}")))
    {
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
    // Recorded once the admin password exists, which is the moment the device
    // leaves setup mode; the optional hostname/network writes below are
    // ordinary settings edits, not access-control events.
    state.audit.record("setup", "completed", &source);
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

// Login / logout

#[derive(serde::Deserialize)]
struct LoginForm {
    password: String,
}

/// The sign-in page.
///
/// It names §6.3's prefix, because it is the first built-in page an operator
/// with a broken custom UI reaches: the gate bounces every unauthenticated
/// request here, whatever the bundle is doing. The nav on every authenticated
/// pane covers the other half. The mosd-unavailable page §6.3 cites is the
/// wrong surface for this: it is reached only when a mosd call fails, which a
/// broken bundle does not cause.
async fn login_form() -> Html<String> {
    page(
        "Sign in",
        html! {
            form method="post" action="/login" {
                p { label { "Admin password" } " "
                    input type="password" name="password" required; }
                p { button type="submit" { "Sign in" } }
            }
            p {
                "If this appliance is showing a custom interface that does not work, "
                "sign in and go to " a href=(BUILTIN_PATH) { (BUILTIN_PATH) }
                " — the built-in interface is served there whatever state the custom \
                 one is in, and it can switch back to it."
            }
        },
    )
}

async fn login_submit(
    State(state): State<AppState>,
    Source(source): Source,
    Form(form): Form<LoginForm>,
) -> Response {
    // Admission charges the attempt (see `LoginGuard::begin_attempt`): check
    // and charge happen under one lock acquisition, so concurrent submissions
    // cannot share one backoff window. An attempt that reaches neither branch
    // below — a bus error, a device still in setup mode — stays charged,
    // which errs closed and costs a legitimate operator one step on the curve
    // at worst.
    //
    // The locks recover from poisoning rather than propagating it: a panic
    // while holding this counter must not convert every later login into a
    // panic of its own, which would be a permanent denial of management the
    // backoff curve itself refuses to arm.
    if !state.guard.begin_attempt() {
        state.audit.record("login", "throttled", &source);
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
    // argon2id is CPU-bound by design; run inline it would pin one async
    // worker thread per attempt, and a burst of submissions could stall every
    // other request the daemon is serving. A panic in the closure surfaces as
    // a failed verification: closed, never open.
    let hash = hash.to_string();
    let password = form.password;
    let verified = tokio::task::spawn_blocking(move || auth::verify_password(&hash, &password))
        .await
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "password verification task failed");
            false
        });
    if verified {
        state.guard.record_success();
        state.audit.record("login", "success", &source);
        let cookie = state.sessions.create();
        (
            [(SET_COOKIE, session::session_cookie(&cookie))],
            Redirect::to("/"),
        )
            .into_response()
    } else {
        // Counted at admission; this only restarts the earned window from the
        // outcome, so the verification's duration does not eat into the wait.
        state.guard.confirm_failure();
        state.audit.record("login", "wrong-password", &source);
        (
            StatusCode::UNAUTHORIZED,
            page("Sign in", html! { p { "Wrong password." } }),
        )
            .into_response()
    }
}

async fn logout(
    State(state): State<AppState>,
    Source(source): Source,
    headers: HeaderMap,
) -> Response {
    if let Some(value) = session::cookie_from_headers(&headers) {
        state.sessions.remove(&value);
        state.audit.record("logout", "ok", &source);
    }
    (
        [(SET_COOKIE, session::clear_cookie())],
        Redirect::to("/login"),
    )
        .into_response()
}

// Password change

/// The change-password form fields.
#[derive(serde::Deserialize)]
struct PasswordForm {
    current: String,
    password: String,
    confirm: String,
}

/// Why one password-change attempt failed, before either surface words it.
///
/// One outcome set for both surfaces: the HTML pane and the API route differ
/// in how they answer, not in what can happen.
enum PasswordChangeError {
    /// The current password did not verify; nothing was written.
    WrongCurrent,
    /// The new password is under the same floor the setup wizard enforces;
    /// nothing was written.
    TooShort,
    /// Hashing the new password failed.
    Hashing(anyhow::Error),
    /// A mosd call failed.
    Bus(anyhow::Error),
}

/// Verify the current admin password, write the new hash through the settings
/// tree, and drop every session except the acting one.
///
/// The current password is demanded even though the caller holds a session: a
/// session is a browser artifact that outlives the moment the password was
/// typed, and an unattended browser must not be enough to rotate the sole
/// credential on the management surface.
///
/// The invalidation and the write belong in one step. The gate's
/// short-circuit comment says an unset-password operation "has to clear the
/// session table in the same step", and replacing the hash is the same
/// reasoning: a session minted under the old credential proves possession of
/// nothing any more. The acting session is the one exception — it just proved
/// possession of the current password — or the operator would be signed out
/// by their own success.
async fn change_password(
    state: &AppState,
    source: &str,
    acting_session: Option<&str>,
    current: &str,
    new: &str,
) -> Result<(), PasswordChangeError> {
    if new.len() < 8 {
        return Err(PasswordChangeError::TooShort);
    }
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return Err(PasswordChangeError::Bus(err)),
    };
    let Some(hash) = password_hash(&access) else {
        // Unreachable through either surface: both sit behind a verified
        // session, and no session can coexist with an unset password (see
        // `gate`). Refusing is still better than writing a first hash from a
        // route whose contract is rotation.
        return Err(PasswordChangeError::Bus(anyhow::anyhow!(
            "no admin password is configured"
        )));
    };
    // Off the async workers for the same reason login verification is:
    // argon2id costs real CPU per call, by design. A panic in the closure
    // surfaces as a failed verification: closed, never open.
    let hash = hash.to_string();
    let password = current.to_string();
    let verified = tokio::task::spawn_blocking(move || auth::verify_password(&hash, &password))
        .await
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "password verification task failed");
            false
        });
    if !verified {
        state.audit.record("password", "wrong-password", source);
        return Err(PasswordChangeError::WrongCurrent);
    }
    let password = new.to_string();
    let hash = tokio::task::spawn_blocking(move || auth::hash_password(&password))
        .await
        .unwrap_or_else(|err| Err(anyhow::anyhow!("password hashing task: {err}")))
        .map_err(PasswordChangeError::Hashing)?;
    let value = serde_json::json!({ "password_hash": hash });
    if let Err(err) = state.api.set_settings("access.webAdmin", &value).await {
        return Err(PasswordChangeError::Bus(err));
    }
    // The write happened; every other session goes with the old credential.
    // No cookie on the request keeps nothing, which errs closed.
    state
        .sessions
        .remove_all_except(acting_session.unwrap_or(""));
    state.audit.record("password", "changed", source);
    Ok(())
}

fn password_page(banner: Option<Markup>) -> Html<String> {
    pane(
        "Password",
        html! {
            @if let Some(banner) = banner { (banner) }
            p { "Changing the admin password signs every other session out. The session making the change stays signed in." }
            form method="post" action="/password" {
                fieldset {
                    legend { "Change the admin password" }
                    p { label { "Current password" } " "
                        input type="password" name="current" required; }
                    p { label { "New password (at least 8 characters)" } " "
                        input type="password" name="password" required minlength="8"; }
                    p { label { "Confirm new password" } " "
                        input type="password" name="confirm" required minlength="8"; }
                }
                p { button type="submit" { "Change password" } }
            }
        },
    )
}

async fn password_form(Query(query): Query<SavedQuery>) -> Html<String> {
    password_page(query.saved.is_some().then(saved_banner))
}

async fn password_submit(
    State(state): State<AppState>,
    Source(source): Source,
    headers: HeaderMap,
    Form(form): Form<PasswordForm>,
) -> Response {
    if form.password != form.confirm {
        return (
            StatusCode::BAD_REQUEST,
            password_page(Some(error_box("Passwords do not match."))),
        )
            .into_response();
    }
    let acting = session::cookie_from_headers(&headers);
    match change_password(
        &state,
        &source,
        acting.as_deref(),
        &form.current,
        &form.password,
    )
    .await
    {
        Ok(()) => Redirect::to("/password?saved=1").into_response(),
        Err(PasswordChangeError::WrongCurrent) => (
            StatusCode::UNAUTHORIZED,
            password_page(Some(error_box("Wrong current password."))),
        )
            .into_response(),
        Err(PasswordChangeError::TooShort) => (
            StatusCode::BAD_REQUEST,
            password_page(Some(error_box("Password must be at least 8 characters."))),
        )
            .into_response(),
        Err(PasswordChangeError::Hashing(err)) => {
            tracing::error!(error = %err, "password hashing failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(PasswordChangeError::Bus(err)) => bus_error(&err),
    }
}

/// `POST /api/v1/actions/change-password` request body.
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangePasswordRequest {
    /// The password being replaced, verified before anything is written.
    current_password: String,
    /// The replacement; at least 8 characters.
    new_password: String,
}

/// The same operation as `POST /password`, answering §2.4's envelope instead
/// of HTML. 204 on success: the outcome is the state change, and there is
/// nothing to say about it that the status does not.
#[utoipa::path(
    post,
    path = V1_CHANGE_PASSWORD_PATH,
    context_path = API,
    tag = "actions",
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "The password was changed; every session except the calling one was dropped"),
        (status = 400, description = "The body is not JSON, or not this shape (`request_invalid`)", body = ApiError),
        (status = 401, description = "No session cookie, or one that does not verify", body = ApiError),
        (status = 403, description = "The current password does not verify (`wrong_password`)", body = ApiError),
        (status = 422, description = "The new password is shorter than 8 characters (`validation_failed`)", body = ApiError),
        (status = 500, description = "Hashing failed (`hashing_failed`), or mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_change_password(
    _session: ApiSession,
    State(state): State<AppState>,
    Source(source): Source,
    headers: HeaderMap,
    body: Result<Json<ChangePasswordRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        // §2.4's envelope rather than axum's plain-text rejection.
        Err(rejection) => {
            return api_response(
                StatusCode::BAD_REQUEST,
                ApiError::apid("request_invalid", rejection.body_text()),
            );
        }
    };
    let acting = session::cookie_from_headers(&headers);
    match change_password(
        &state,
        &source,
        acting.as_deref(),
        &request.current_password,
        &request.new_password,
    )
    .await
    {
        Ok(()) => (
            StatusCode::NO_CONTENT,
            [(CACHE_CONTROL, CacheClass::NoStore.header_value())],
        )
            .into_response(),
        Err(PasswordChangeError::WrongCurrent) => api_response(
            StatusCode::FORBIDDEN,
            ApiError::apid(
                "wrong_password",
                "the current password does not verify".to_string(),
            ),
        ),
        Err(PasswordChangeError::TooShort) => api_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::apid(
                "validation_failed",
                "the new password must be at least 8 characters".to_string(),
            ),
        ),
        Err(PasswordChangeError::Hashing(err)) => {
            tracing::error!(error = %err, "password hashing failed");
            api_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiError::apid("hashing_failed", format!("{err:#}")),
            )
        }
        Err(PasswordChangeError::Bus(err)) => bus_api_error(&err, "access.webAdmin"),
    }
}

// Status pane

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

/// The status pane's body, shared by `/`'s built-in branch and §6.3's escape.
///
/// It reads mosd and `/proc/uptime` and nothing under `/srv/ui`. That is
/// the property §6.3 rests candidate (A) on — *"the built-in handlers do not
/// read `/srv/ui` at all, so no bundle state — absent, corrupt, unreadable,
/// wrong version — can affect them"* — and it is why §6.1's five classes do not
/// need enumerating here: a handler that never consults the bundle store cannot
/// branch on which class occurred.
async fn status_body(state: &AppState) -> Markup {
    let hostname = state.api.get_settings("hostname").await;
    let network = state.api.get_state("network").await;
    let uptime = std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|contents| parse_uptime(&contents));
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
    }
}

/// `GET /` fell through to the built-in UI (§4.2 condition 5, §6.1 classes
/// 1-4), and this is the pane it renders.
///
/// Unchanged by §6.3's prefix, deliberately. `/` is conditional and stays
/// conditional; the escape control belongs on the pane that is reachable
/// *unconditionally*, which is [`builtin_home`] and not this one.
pub(crate) async fn home(State(state): State<AppState>) -> Html<String> {
    pane("Status", status_body(&state).await)
}

// §6.3's escape: the built-in UI at a reserved prefix, and the control that
// deactivates a custom UI.

/// §6.3 candidate (A)'s prefix, without its trailing slash.
///
/// §6.3 calls it `/builtin/` illustratively; this is the spelling fixed for the
/// implementation, and it is the one the design document already uses, so the
/// documented action — *go to `https://<device>/builtin/`* — needs no
/// translation. It costs the prefix permanently: no bundle can serve anything
/// at or under it, which §6.3 names as (A)'s price and accepts.
const BUILTIN: &str = "/builtin";

/// The prefix as it is written to an operator, and as it is linked.
const BUILTIN_PATH: &str = "/builtin/";

/// The deactivate route, as declared *inside* the nest.
const BUILTIN_DEACTIVATE_LEAF: &str = "/deactivate";

/// The deactivate route as a client sees it.
const BUILTIN_DEACTIVATE: &str = "/builtin/deactivate";

/// `GET /builtin` and `GET /builtin/` — the one unconditional path to the
/// built-in UI.
///
/// This is today's status pane plus §6.3 candidate (B)'s control, and (A) and
/// (B) together are what §6.3 chooses: (A) alone is *"a way in, not a way
/// out"*, and (B) alone *"presupposes the access that may be broken"*. One
/// documented action reaches this page whatever went wrong, and one click on it
/// deactivates the bundle, so the operator never has to diagnose anything,
/// which is the test §6.3 opens with.
async fn builtin_home(State(state): State<AppState>) -> Html<String> {
    let status = status_body(&state).await;
    pane(
        "Status",
        html! {
            (status)
            (escape_section())
        },
    )
}

/// Candidate (B), rendered unconditionally.
///
/// The control is not shown only when a bundle looks active. Deciding that
/// would mean reading `/srv/ui` from the one handler whose value is that it
/// never does, and an operator who found the button missing would be back to
/// diagnosing why — which is exactly the failure §6.3's opening test names.
/// A deactivate with nothing active is a no-op that says so.
fn escape_section() -> Markup {
    html! {
        h2 { "Custom UI" }
        p {
            "This page is the appliance's built-in interface, compiled into "
            code { "/usr/bin/apid" } " itself. It is served here whatever state a \
             custom UI is in — none installed, half-written, unreadable, or \
             rendering but unable to talk to this appliance."
        }
        form method="post" action=(BUILTIN_DEACTIVATE) {
            fieldset {
                legend { "Deactivate the custom UI" }
                p {
                    "This removes " code { "/srv/ui/current" } ", the pointer to the \
                     active bundle. Afterwards " code { "/" } " serves this built-in \
                     interface, and it keeps doing so across a reboot. The bundle's \
                     files are left on disk, so it can be made active again later."
                }
                p { button type="submit" { "Deactivate the custom UI" } }
            }
        }
    }
}

/// `POST /builtin/deactivate` — §5.3's *deactivate*, which §5.3 already calls
/// *"the same operation as §6.3's escape, which is why it is specified here
/// rather than invented there."*
///
/// [`Store::deactivate`] is called and nothing is reimplemented. Its `bool` is
/// whether a pointer was there to remove; both values are the same success,
/// because §6.3 requires an outcome that does not depend on what was wrong.
async fn builtin_deactivate(State(state): State<AppState>, Source(source): Source) -> Response {
    match state.bundles().deactivate() {
        Ok(removed) => {
            tracing::info!(removed, "custom UI deactivated from the built-in escape");
            // "no-op" and "deactivated" are distinct on purpose: the trail
            // should say whether a custom UI actually stopped being served.
            state.audit.record(
                "custom-ui",
                if removed { "deactivated" } else { "no-op" },
                &source,
            );
            pane(
                "Custom UI",
                html! {
                    div.saved {
                        @if removed {
                            "The custom UI has been deactivated."
                        } @else {
                            "No custom UI was active. Nothing changed."
                        }
                    }
                    p {
                        "The appliance now serves this built-in interface at "
                        code { "/" } ", and will keep doing so after a reboot."
                    }
                    p { a href="/" { "Go to the site root" } }
                },
            )
            .into_response()
        }
        // The pointer is on DATA and this is a root process, so a failure here
        // is a filesystem the daemon cannot write. The page names the shell
        // equivalent rather than leaving the operator with nothing: §6.3 is
        // explicit that a shell is the escape of last resort, and equally
        // explicit that it is only available if it was arranged in advance.
        Err(err) => {
            tracing::error!(error = %err, "deactivating the custom UI failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                pane(
                    "Custom UI",
                    html! {
                        (error_box("The pointer to the active custom UI could not be removed."))
                        p {
                            "Over a shell the same operation is "
                            code { "rm /srv/ui/current" } "."
                        }
                    },
                ),
            )
                .into_response()
        }
    }
}

/// The reserved prefix's own not-found handler.
///
/// The nest claims the whole subtree, so this is what answers
/// `/builtin/index.html` and `/builtin/assets/app.js` — paths a bundle may
/// really contain. Answering them from the binary rather than letting them fall
/// through is the reservation: a prefix that is reserved for some of its paths
/// is not reserved. It is HTML rather than §2.4's JSON envelope because this
/// subtree is a user interface and not an API, and it names the escape, which
/// is the whole reason the operator is here.
async fn builtin_not_found(OriginalUri(uri): OriginalUri) -> Response {
    (
        StatusCode::NOT_FOUND,
        page(
            "Not found",
            html! {
                p { "There is no built-in page at " code { (uri.path()) } "." }
                p {
                    "The built-in interface is at " a href=(BUILTIN_PATH) { (BUILTIN_PATH) }
                    ". It is served by the appliance itself and is reachable whatever \
                     state a custom UI is in."
                }
            },
        ),
    )
        .into_response()
}

// Network pane

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

// Hostname pane

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

// Power pane

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
fn power_submit(state: &AppState, action: PowerAction, confirm: &str, source: &str) -> Response {
    if confirm != action.confirm_token() {
        state
            .audit
            .record(action.confirm_token(), "unconfirmed", source);
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            power_page(Some(error_box(
                "Tick the confirmation box before requesting a power action.",
            ))),
        )
            .into_response();
    }
    // Recorded before the request is dispatched, and the sink fsyncs each
    // line: the two audited actions here are the ones immediately followed by
    // the machine going down, so a line written after the call could be the
    // line that never reaches the disk.
    state
        .audit
        .record(action.confirm_token(), "requested", source);
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

async fn power_reboot(
    State(state): State<AppState>,
    Source(source): Source,
    Form(form): Form<ConfirmForm>,
) -> Response {
    power_submit(&state, PowerAction::Reboot, &form.confirm, &source)
}

async fn power_poweroff(
    State(state): State<AppState>,
    Source(source): Source,
    Form(form): Form<ConfirmForm>,
) -> Response {
    power_submit(&state, PowerAction::PowerOff, &form.confirm, &source)
}

// Hostname submit

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

// SSH pane

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
/// the first 72 bytes of its input and silently ignores the rest. Accepting a
/// 100-character password would therefore mean the first 72 characters of it
/// also unlock the device — the operator would be running on a shorter secret
/// than the one they typed and believe in. Refusing the input is the only way
/// the pane avoids creating that surprise; truncating it silently would be the
/// same surprise with a different author.
const MAX_TRANSIENT_PASSWORD_BYTES: usize = 72;

/// OpenSSH fingerprint of a canonical `<type> <blob>` key line.
///
/// `SHA256:` followed by the unpadded base64 of the SHA-256 digest of the
/// decoded blob — the string `ssh-keygen -lf` prints, and the same value
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
/// An absent list is an empty list, but a list that is present and unreadable
/// is an error rather than an empty list: treating it as empty
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

/// Everything the container pane renders, gathered before any markup is built.
struct ContainerView {
    /// `container.enabled` -- what the operator asked for.
    enabled: bool,
    /// Live state published by mosd's container reconciler, absent when mosd
    /// has published none yet.
    state: Option<Value>,
    /// Why the settings or the live state could not be read, if either failed.
    problems: Vec<String>,
}

impl ContainerView {
    /// A string field of the published live state.
    fn text(&self, key: &str) -> Option<&str> {
        self.state.as_ref()?.get(key)?.as_str()
    }

    /// A list field of the published live state, as displayable strings.
    fn list(&self, key: &str) -> Vec<String> {
        self.state
            .as_ref()
            .and_then(|state| state.get(key))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }
}

async fn load_container_view(app: &AppState) -> anyhow::Result<ContainerView> {
    let container = app.api.get_settings("container").await?;
    let enabled = container
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut problems = Vec::new();
    let state = match app.api.get_state("container").await {
        Ok(value) => Some(value),
        Err(err) => {
            problems.push(format!("Live container state unavailable: {err}"));
            None
        }
    };
    Ok(ContainerView {
        enabled,
        state,
        problems,
    })
}

/// The consequence of switching this on, stated specifically.
///
/// The pane must say so *"not as a generic warning, but as the specific
/// consequence"*. mos does not build rootless, so there is
/// no user-namespace boundary between a container and the device: a container
/// runs with root's capabilities. Saying "containers may be a security risk"
/// would be true, useless, and would let an operator agree with it without
/// learning anything.
const CONTAINER_ROOT_NOTICE: &str = "Containers on this device run as root. Rootless mode is not built, so a container is not confined to an unprivileged user: anything that can write a .container file into the Quadlet directory can run code with root's capabilities on this appliance.";

fn containers_page(view: &ContainerView, banner: Option<Markup>) -> Html<String> {
    let files = view.list("quadletFiles");
    let units = view.list("generatedUnits");
    let stopped = view.list("stoppedUnits");
    pane(
        "Containers",
        html! {
            @if let Some(banner) = banner { (banner) }
            @for problem in &view.problems { (error_box(problem)) }
            p { b { (CONTAINER_ROOT_NOTICE) } }

            h2 { "Engine" }
            p { "Containers: " b { (if view.enabled { "enabled" } else { "disabled" }) } }
            @if let Some(state) = view.text("quadletMountState") {
                p { "Quadlet directory: " b { (state) } " (" code { "/etc/containers/systemd" } ")" }
            }
            p {
                "mos does not orchestrate containers. It provides the engine and turns "
                code { ".container" } " files into systemd units; what runs, in what order, and how "
                "containers reach each other is described in " code { "docs/design/containers.md" } "."
            }

            form method="post" action="/containers/enable" {
                fieldset {
                    legend { "Engine" }
                    p { label { input type="checkbox" name="enabled" checked[view.enabled]; " Enable containers" } }
                    p { button type="submit" { "Save" } }
                }
            }

            h2 { "Quadlet files" }
            @if !view.enabled {
                p {
                    "Not listed while containers are disabled: the directory is not mounted, so what is "
                    "on persistent storage is not what the generator would read. Enable the engine to see it."
                }
            } @else if files.is_empty() {
                p { "No " code { ".container" } " files. Nothing to run." }
            } @else {
                ul { @for f in &files { li { code { (f) } } } }
                @if units.is_empty() {
                    p {
                        b { "Files are present but no unit was generated." }
                        " Quadlet parsed the directory and produced nothing, which usually means a "
                        "syntax error in one of the files above. " code { "journalctl -u systemd-generator" }
                        " on the device carries the parse error."
                    }
                }
            }

            @if !units.is_empty() {
                h2 { "Generated units" }
                ul { @for u in &units { li { code { (u) } } } }
            }
            @if !stopped.is_empty() {
                h2 { "Stopped by the last change" }
                ul { @for u in &stopped { li { code { (u) } } } }
            }
        },
    )
}

async fn containers_form(State(app): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match load_container_view(&app).await {
        Ok(view) => {
            let banner = query.saved.is_some().then(saved_banner);
            containers_page(&view, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

/// The enable toggle; absent when unticked.
#[derive(serde::Deserialize)]
struct ContainerEnableForm {
    enabled: Option<String>,
}

async fn containers_enable(
    State(app): State<AppState>,
    Form(form): Form<ContainerEnableForm>,
) -> Response {
    let enabled = form.enabled.is_some();
    if let Err(err) = app
        .api
        .set_settings("container.enabled", &Value::Bool(enabled))
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/containers?saved=1").into_response()
}

// The MQTT pane

/// The two units mosd's mqtt reconciler drives, named here because the pane
/// selects their published state out of the `units` array by name.
///
/// These must match `BROKER_UNIT` and `BRIDGE_UNIT` in
/// `mosd/mosd/src/reconciler/mqtt.rs`; the reconciler's
/// `the_published_shape_is_the_contract_with_the_apid_pane` asserts both names
/// appear in what it publishes.
const MQTT_BROKER_UNIT: &str = "mos-mqtt-broker.service";
const MQTT_BRIDGE_UNIT: &str = "mos-mqttd.service";

/// Everything the MQTT pane renders, gathered before any markup is built.
///
/// The live state this reads is published by mosd's mqtt reconciler
/// (`mosd/mosd/src/reconciler/mqtt.rs`) and is nested, not flat:
/// `listen.address`, `listen.port`, `auth.enabled`, and a `units` array of one
/// object per unit the reconciler drives. The pane adapts to that shape rather
/// than the reconciler flattening itself for the pane, because the live state
/// mirrors the settings subtree it applied (`mqtt.listen.address` in settings,
/// `listen.address` in state), because it is published as bus items where
/// `/mqtt/listen/address` is the idiomatic path shape, and because `units` has
/// to be an array: the reconciler drives two units and a flat `activeState`
/// cannot say whose state it is. Every entry carries its own `unit`,
/// `activeState` and `unitFileState`, so the broker is the entry named
/// `mos-mqtt-broker.service` and the bridge the one named `mos-mqttd.service`,
/// and neither needs a key of its own.
///
/// Every field is optional here: a key the reconciler has not published renders
/// as "unknown" and never as a default, because a listen address on this page
/// is a claim about what the broker is actually bound to. apid and mosd are
/// separate crates talking over a bus, so no shared type holds the two ends
/// together; what does is a pair of tests — the reconciler asserts its exact
/// published key set and names this file as the consumer, and this crate's
/// fixture is a verbatim copy of the reconciler's own expectation. Without that
/// pair each side tests itself against a shape it invented, and both stay green
/// while disagreeing.
struct MqttView {
    /// `mqtt.enabled` -- what the operator asked for.
    enabled: bool,
    /// Live state published by mosd's mqtt reconciler, absent when mosd has
    /// published none yet.
    state: Option<Value>,
    /// Why the settings or the live state could not be read, if either failed.
    problems: Vec<String>,
}

impl MqttView {
    /// A value from the published live state, addressed by its path down the
    /// nested tree: `["listen", "address"]` reads `listen.address`.
    fn at(&self, path: &[&str]) -> Option<&Value> {
        path.iter()
            .try_fold(self.state.as_ref()?, |value, key| value.get(key))
    }

    /// A string field of the published live state.
    fn text(&self, path: &[&str]) -> Option<&str> {
        self.at(path)?.as_str()
    }

    /// A boolean field of the published live state.
    fn flag(&self, path: &[&str]) -> Option<bool> {
        self.at(path)?.as_bool()
    }

    /// The published listen port.
    fn port(&self) -> Option<u64> {
        self.at(&["listen", "port"])?.as_u64()
    }

    /// One entry of the published `units` array, selected by its `unit` field.
    ///
    /// By name, never by index. The array is ordered broker-then-bridge today
    /// and nothing promises it stays that way; an index would still return a
    /// unit on the day that order changed, and the page would report the
    /// bridge's state under the broker's name with no test anywhere failing.
    fn unit(&self, name: &str) -> Option<&Value> {
        self.at(&["units"])?
            .as_array()?
            .iter()
            .find(|unit| unit.get("unit").and_then(Value::as_str) == Some(name))
    }

    /// A field of one published unit; "unknown" when the reconciler has
    /// published no such unit, or no such field on it.
    fn unit_field(&self, name: &str, field: &str) -> &str {
        self.unit(name)
            .and_then(|unit| unit.get(field))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    }

    /// Whether the broker unit is in systemd's `failed` state.
    ///
    /// This is how a listen address the broker cannot use reaches the
    /// operator. Nothing rejects such a value -- not the reconciler, not this
    /// pane -- because rejecting it would make the master switch depend on
    /// `listen` being valid, and the two are separate settings. The
    /// broker takes the value, fails to parse it and exits, and the only
    /// evidence is the unit state. A pane that showed "enabled" and stopped
    /// there would be reporting the operator's request back to them as though
    /// it were an outcome.
    fn broker_failed(&self) -> bool {
        self.unit_field(MQTT_BROKER_UNIT, "activeState") == "failed"
    }

    /// The same for the bridge, which fails for its own reasons and has its
    /// own journal.
    fn bridge_failed(&self) -> bool {
        self.unit_field(MQTT_BRIDGE_UNIT, "activeState") == "failed"
    }

    /// Whether the published listener would accept a connection from off this
    /// device without asking for a password.
    ///
    /// The same rule the broker itself applies -- not loopback, and auth off
    /// -- so the pane and the journal describe the same configuration the same
    /// way. An address the pane cannot parse is not reported as off-host: the
    /// broker fails to start on one it cannot parse, and guessing would put a
    /// security claim on the page that nothing measured.
    ///
    /// This drives a warning and nothing else; refusing to save on it would
    /// couple the switch to the listener. See [`MQTT_SEPARATE_CONFIG_NOTICE`].
    fn off_host_unauthenticated(&self) -> bool {
        let Some(address) = self
            .text(&["listen", "address"])
            .and_then(|address| address.parse::<IpAddr>().ok())
        else {
            return false;
        };
        !address.is_loopback() && self.flag(&["auth", "enabled"]) == Some(false)
    }
}

async fn load_mqtt_view(app: &AppState) -> anyhow::Result<MqttView> {
    let mqtt = app.api.get_settings("mqtt").await?;
    let enabled = mqtt
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut problems = Vec::new();
    let state = match app.api.get_state("mqtt").await {
        Ok(value) => Some(value),
        Err(err) => {
            problems.push(format!("Live MQTT state unavailable: {err}"));
            None
        }
    };
    Ok(MqttView {
        enabled,
        state,
        problems,
    })
}

/// The consequence of this switch existing, in the terms the container pane
/// set: the specific behaviour change, not a generic caution.
///
/// The switch defaults to false, so updating a fielded device to this image
/// stops a unit that was running before the update. That is the fact an
/// operator needs on the page. "MQTT is disabled by default" would be true and
/// would let them read straight past it; what they have to know is that
/// something they had is now off, and why nothing that worked has broken.
const MQTT_UPDATE_NOTICE: &str = "Updating to this image stops the MQTT bridge until this switch is turned on. mos-mqttd ran on every earlier image and does not run here while MQTT is off. Nothing that worked has stopped working: no shipped image ever carried a broker for the bridge to reach, so the bridge has never once connected and has only ever retried.";

/// Why nothing on this page refuses to save.
///
/// The switch does not couple to the listener: it never refuses to enable
/// MQTT because the bind is not loopback or authentication is off. The pane is
/// where an operator would otherwise assume the switch checks them, so the
/// pane is where it says that it does not.
const MQTT_SEPARATE_CONFIG_NOTICE: &str = "The listen address, the port and authentication are configured separately from this switch, and this switch does not validate them. No combination of them makes it refuse to save, and none of them makes the broker refuse to start: a broker open to a trusted segment is a configuration an operator is allowed to choose, so mos warns about it rather than preventing it.";

/// The exposure, stated as what it lets a stranger do.
const MQTT_OPEN_LISTENER_WARNING: &str = "This broker accepts unauthenticated connections from the network. It is bound off loopback with authentication disabled, so any host that can reach that address can publish and subscribe on this device without a password.";

/// A failed broker, and where the reason is.
///
/// The pane cannot say why it failed -- it has a unit state and not the
/// journal -- so it says where the reason is instead of guessing at one. The
/// commonest cause is a listen address that is not an IP address, because the
/// broker binds an interface and does not resolve names, but naming that as
/// the cause here would be a diagnosis the pane has not made.
const MQTT_BROKER_FAILED_NOTICE: &str = "The broker unit has failed: MQTT is switched on, but mos-mqtt-broker.service is not running and the bridge has nothing to connect to. Run journalctl -u mos-mqtt-broker on the device for the reason it exited.";

/// The same for the other half of the switch, with its own journal.
///
/// The switch drives both units, so both can fail, and they fail for
/// unrelated reasons -- the bridge's are about the cloud endpoint it dials and
/// not about the listener. Folding the two into one notice would send an
/// operator to the wrong journal half the time.
const MQTT_BRIDGE_FAILED_NOTICE: &str = "The bridge unit has failed: MQTT is switched on, but mos-mqttd.service is not running, so nothing is being carried between this device and the cloud. Run journalctl -u mos-mqttd on the device for the reason it exited.";

fn mqtt_page(view: &MqttView, banner: Option<Markup>) -> Html<String> {
    let address = view.text(&["listen", "address"]).unwrap_or("unknown");
    let port = view
        .port()
        .map_or_else(|| "unknown".to_string(), |port| port.to_string());
    // Each unit's own state, pulled out of the `units` array by name -- see
    // `MqttView::unit`.
    let broker = view.unit_field(MQTT_BROKER_UNIT, "activeState");
    let bridge = view.unit_field(MQTT_BRIDGE_UNIT, "activeState");
    pane(
        "MQTT",
        html! {
            @if let Some(banner) = banner { (banner) }
            @for problem in &view.problems { (error_box(problem)) }
            p { b { (MQTT_UPDATE_NOTICE) } }

            h2 { "Switch" }
            p { "MQTT: " b { (if view.enabled { "enabled" } else { "disabled" }) } }
            // What the switch was asked to do, and what came of it, are two
            // different facts and the pane reports both: "enabled" above is
            // the request, the unit states are the outcome. Both units,
            // because the switch drives both -- a page carrying only the
            // broker would leave an operator with MQTT "on", a healthy broker
            // and no way to see that the bridge had died.
            p {
                "Broker unit: " b { (broker) }
                " (" code { (MQTT_BROKER_UNIT) } ", unit file "
                (view.unit_field(MQTT_BROKER_UNIT, "unitFileState")) ")"
            }
            p {
                "Bridge unit: " b { (bridge) }
                " (" code { (MQTT_BRIDGE_UNIT) } ", unit file "
                (view.unit_field(MQTT_BRIDGE_UNIT, "unitFileState")) ")"
            }
            @if view.broker_failed() { (error_box(MQTT_BROKER_FAILED_NOTICE)) }
            @if view.bridge_failed() { (error_box(MQTT_BRIDGE_FAILED_NOTICE)) }
            p {
                "One switch drives both halves: the broker (" code { (MQTT_BROKER_UNIT) }
                ") and the bridge (" code { (MQTT_BRIDGE_UNIT) } "). Turning it off stops both, "
                "and there is no setting that runs one without the other."
            }

            form method="post" action="/mqtt/enable" {
                fieldset {
                    legend { "Switch" }
                    p { label { input type="checkbox" name="enabled" checked[view.enabled]; " Enable MQTT" } }
                    p { button type="submit" { "Save" } }
                }
            }

            h2 { "Listener" }
            p { "Listen address: " b { (address) } }
            p { "Listen port: " b { (port) } }
            p { "Authentication: " b { (state_flag(view.flag(&["auth", "enabled"]), "enabled", "disabled")) } }
            @if view.enabled && view.off_host_unauthenticated() {
                (error_box(MQTT_OPEN_LISTENER_WARNING))
            }
            p { (MQTT_SEPARATE_CONFIG_NOTICE) }
        },
    )
}

async fn mqtt_form(State(app): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match load_mqtt_view(&app).await {
        Ok(view) => {
            let banner = query.saved.is_some().then(saved_banner);
            mqtt_page(&view, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

/// The enable toggle; absent when unticked.
#[derive(serde::Deserialize)]
struct MqttEnableForm {
    enabled: Option<String>,
}

async fn mqtt_enable(State(app): State<AppState>, Form(form): Form<MqttEnableForm>) -> Response {
    let enabled = form.enabled.is_some();
    // One path, and deliberately only one: the switch writes nothing about the
    // listener or about authentication, so saving it can never rewrite a
    // decision the operator made elsewhere.
    if let Err(err) = app
        .api
        .set_settings("mqtt.enabled", &Value::Bool(enabled))
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/mqtt?saved=1").into_response()
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
async fn ssh_password(
    State(app): State<AppState>,
    Source(source): Source,
    Form(form): Form<SshPasswordForm>,
) -> Response {
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
    // The event carries who opened a password channel and from where — and
    // deliberately nothing about the password itself.
    app.audit.record("transient-password", "set", &source);
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
