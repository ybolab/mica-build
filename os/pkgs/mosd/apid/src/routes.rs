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
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
// `delete` is imported on its own line rather than folded into the routing
// import below. `docs/task/RFCT-210.md` quotes that line verbatim as the
// measurement behind its central negative -- apid had never served a write
// verb -- and a record of what was true is not edited by the change that makes
// it untrue.
use axum::routing::delete;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use maud::{DOCTYPE, Markup, PreEscaped, html};
use mosd_settings::{
    ApiToken, AuthorizedKey, BridgeConfig, IfaceKind, IfaceSettings, SettingsError, StaticConfig,
    VlanConfig, WireguardConfig, WireguardPeer, parse_authorized_key, quote_path_segment,
    validate_api_tokens, validate_authorized_keys,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::access_cache::AccessCache;
use crate::assets::mime::CacheClass;
use crate::assets::serve;
use crate::audit::{Audit, Source};
use crate::auth::{self, GuardStore};
use crate::bundle::Store;
use crate::redact;
use crate::session::{self, SessionStore};
use crate::settings_api::SettingsApi;
use crate::token;

/// Shared handler state.
#[derive(Clone)]
pub struct AppState {
    api: Arc<dyn SettingsApi>,
    sessions: Arc<SessionStore>,
    guard: Arc<GuardStore>,
    audit: Arc<Audit>,
    bundles: Arc<Store>,
    /// The gate's cache of the `access` subtree, kept honest by the
    /// `SettingsChanged` watcher (`bus_client::watch_settings_changed`) and
    /// by the two handlers that write under `access` themselves.
    access_cache: Arc<AccessCache>,
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
            access_cache: Arc::new(AccessCache::new()),
        }
    }

    /// The gate's access cache, for `main.rs` to hand to the
    /// `SettingsChanged` watcher, and for the tests that drive its
    /// subscription state by hand.
    pub(crate) fn access_cache(&self) -> &Arc<AccessCache> {
        &self.access_cache
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
                // POST only, and this pair is the case where that is not a
                // convention but a requirement: `SameSite=Lax` withholds the
                // session cookie from a cross-site form POST and PERMITS it on
                // a top-level cross-site GET navigation, so a GET mint would be
                // a permanent-credential factory reachable from any link an
                // operator clicks. No GET handler exists for either, and none
                // may ever be added -- not as a convenience, not as a redirect
                // target, not as a debugging affordance.
                .route(BUILTIN_TOKENS_LEAF, post(builtin_tokens_mint))
                .route(BUILTIN_TOKENS_REVOKE_LEAF, post(builtin_tokens_revoke))
                .fallback(builtin_not_found),
        )
        .route(BUILTIN_PATH, get(builtin_home))
        .route("/setup", get(setup_form).post(setup_submit))
        .route("/login", get(login_form).post(login_submit))
        .route("/logout", post(logout))
        .route("/password", get(password_form).post(password_submit))
        .route("/network", get(network_form).post(network_submit))
        // POST only, like the SSH key routes they mirror: no GET handler
        // exists, so nothing that merely follows a link can add or drop a
        // tunnel's far end.
        .route("/network/peers/add", post(network_peer_add))
        .route("/network/peers/remove", post(network_peer_remove))
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

/// §2.4 case 3's second, differently-scoped health endpoint.
///
/// Not `/healthz` and never a replacement for it: `/healthz` answers *"is
/// apid's listener up"* and this answers *"is this appliance manageable"*.
/// Both sentences are true and neither implies the other, which is why there
/// are two paths and not one.
const V1_HEALTH_PATH: &str = "/v1/health";

/// The live-state key the health route probes, and the value it reports as
/// `checkedAt`.
///
/// One bus call answers both questions §2.4 case 3 asks. It proves the round
/// trip — mosd serves this key by reading `/proc/uptime` at request time
/// (`docs/design/api.md` §2.2 item 3), so a value coming back means a real
/// exchange happened and not that a cached flag was read — and the value it
/// returns is the only clock on this appliance a health answer may be stamped
/// with, there being no trusted wall clock anywhere in the crate (§3.2's
/// expiry paragraph).
const HEALTH_PROBE_PATH: &str = "uptime";

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

/// §2.1's action route for a WireGuard key rotation, as
/// `docs/task/RFCT-200.md` §6 classifies it: a new route, and therefore
/// additive.
///
/// One spelling and not three, unlike the resource roots above: `{iface}` is a
/// single-segment parameter, which axum and OpenAPI spell the same way, so
/// there is nothing here for a test to hold together. The prefix and the leaf
/// exist separately because [`is_declared_api_route`] has to recognise the
/// shape without a router to ask.
/// §3.2's token collection and its item route.
///
/// The item route needs its prefix separately for the same reason the rotate
/// action does: [`is_declared_api_route`] has to recognise the shape with no
/// router to ask.
const V1_TOKENS_PATH: &str = "/v1/tokens";
const V1_TOKENS_PREFIX: &str = "/v1/tokens/";
const V1_TOKEN_ROUTE: &str = "/v1/tokens/{id}";

/// The dot-path the token collection lives at, which every envelope raised
/// about it names.
const API_TOKENS_PATH: &str = "access.apiTokens";

const V1_WIREGUARD_PREFIX: &str = "/v1/actions/wireguard/";
const V1_WIREGUARD_ROTATE_LEAF: &str = "/rotate-key";
const V1_WIREGUARD_ROTATE_ROUTE: &str = "/v1/actions/wireguard/{iface}/rotate-key";

/// Each root's three spellings as one tuple, for the test that holds them
/// together.
#[cfg(test)]
pub(crate) const SETTINGS_SPELLINGS: (&str, &str, &str) =
    (V1_SETTINGS_PREFIX, V1_SETTINGS_ROUTE, V1_SETTINGS_DOC);
#[cfg(test)]
pub(crate) const STATE_SPELLINGS: (&str, &str, &str) =
    (V1_STATE_PREFIX, V1_STATE_ROUTE, V1_STATE_DOC);

/// The error names mosd maps its `SettingsError` onto, and the five rows of
/// §2.4's table that name one. The first two are interface-scoped: the fdo
/// vocabulary has no name that separates a missing dot-path or a read-only
/// one from a bad value, so mosd coins its own for those and keeps the
/// standard names for everything else.
const MOSD_NOT_FOUND: &str = "com.mos.mosd1.Error.NotFound";
const MOSD_READ_ONLY: &str = "com.mos.mosd1.Error.ReadOnly";
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
        .route(V1_HEALTH_PATH, get(api_v1_health))
        .route(V1_SETTINGS_ROUTE, get(api_v1_settings))
        .route(V1_STATE_ROUTE, get(api_v1_state))
        .route(V1_CHANGE_PASSWORD_PATH, post(api_v1_change_password))
        // §3.2's token lifecycle. All three take a bearer token and nothing
        // else; the browser's way in is `POST /builtin/tokens`.
        .route(
            V1_TOKENS_PATH,
            get(api_v1_tokens_list).post(api_v1_tokens_mint),
        )
        .route(V1_TOKEN_ROUTE, delete(api_v1_tokens_revoke))
        // POST only, for the reason the power and SSH mutations are: no GET
        // handler exists, so nothing that merely follows a link can replace a
        // tunnel's identity.
        .route(V1_WIREGUARD_ROTATE_ROUTE, post(api_v1_wireguard_rotate))
        // §2.4's envelope on the methods those routes do not serve, declared
        // once for the subtree rather than route by route. It reaches exactly
        // the routes above — it rewrites the method-not-allowed fallback of
        // every `MethodRouter` already registered on *this* router — so the
        // twenty-six HTML paths and the asset router, both declared outside it,
        // keep answering as they do. It must stay below the last `.route`: a
        // route declared after it would not be reached.
        .method_not_allowed_fallback(api_method_not_allowed)
        .fallback(api_not_found)
}

/// §2.4's envelope for a method a declared route does not serve.
///
/// §2.4 states **one** shape for every failure on every `/api/v1/` route, and a
/// wrong method is a failure like any other. Without this the answer is axum's
/// own: a bare 405 with no body and no `Content-Type` at all — measured,
/// `docs/task/RFCT-212.md` §2 — so a client that parses the envelope on every
/// other failure had nothing to parse on this one.
///
/// The `Allow` header is left to axum deliberately. axum accumulates it from
/// the very `get`/`post` calls that declare each route above and attaches it to
/// whatever this handler returns unless the response already carries one, so
/// the header cannot name a method a route does not serve or omit one it does.
/// A hand-written `Allow` here would be a second opinion about the route table,
/// and second opinions drift.
///
/// `source` is `"apid"`: the router made this decision and no bus call was
/// made, so there is nothing mosd could be asked about it. There is no `path`
/// member for the same reason the not-found envelope has none — a wrong method
/// names no settings dot-path.
///
/// It is reached without an authentication check, which is what the shipped
/// tree already did: [`is_declared_api_route`] tests the path and not the
/// method, so the gate hands a wrong-method request on a declared path off just
/// as it hands off the right one. The status is 405 either way; this changes
/// what is in the body, not who may see it.
async fn api_method_not_allowed(method: Method, OriginalUri(uri): OriginalUri) -> Response {
    api_response(
        StatusCode::METHOD_NOT_ALLOWED,
        ApiError::apid(
            "method_not_allowed",
            format!("{method} is not a method {} serves", uri.path()),
        ),
    )
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
            || leaf == V1_HEALTH_PATH
            || leaf == V1_CHANGE_PASSWORD_PATH
            || leaf == V1_TOKENS_PATH
            || token_id(leaf).is_some()
            || resource_dot_path(leaf).is_some()
            || rotate_key_iface(leaf).is_some()
    })
}

/// The interface a leaf names, when the leaf is the rotate-key action.
///
/// The same obligation [`resource_dot_path`] carries: hand off exactly what
/// the router serves, and nothing else. axum's `{iface}` matches one segment,
/// so a name carrying a `/` is a path this predicate must not release — it
/// would reach the subtree's 404 where an unauthenticated caller is supposed
/// to be redirected.
///
/// An *empty* segment is released, unlike [`resource_dot_path`]'s empty
/// dot-path. The difference is not a preference: `{*path}` matches at least one
/// character and `{iface}` matches zero or more, so `.../wireguard//rotate-key`
/// is a path this router really serves — with an interface name mosd then
/// refuses as undeclared. Refusing it here instead would answer a redirect
/// where the route answers an envelope.
fn rotate_key_iface(leaf: &str) -> Option<&str> {
    let iface = leaf
        .strip_prefix(V1_WIREGUARD_PREFIX)?
        .strip_suffix(V1_WIREGUARD_ROTATE_LEAF)?;
    (!iface.contains('/')).then_some(iface)
}

/// The token id a leaf names, when the leaf is the collection's item route.
///
/// The same obligation [`resource_dot_path`] and [`rotate_key_iface`] carry:
/// hand off exactly what the router serves, and nothing else. An id carrying a
/// `/` is two segments and this route matches one, and an id that is empty is
/// not this route either -- measured, not assumed: `/api/v1/tokens/` reaches
/// the subtree's not-found handler, unlike `.../wireguard//rotate-key`, whose
/// empty segment is interior rather than trailing. Releasing either would
/// answer a 404 where an unauthenticated caller is supposed to be redirected.
fn token_id(leaf: &str) -> Option<&str> {
    let id = leaf.strip_prefix(V1_TOKENS_PREFIX)?;
    (!id.is_empty() && !id.contains('/')).then_some(id)
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
    responses(
        (status = 200, description = "The major API versions this device serves", body = ApiVersions),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
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
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
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

/// `GET /api/v1/health` (§2.4 case 3).
///
/// Two members always, and the other two by outcome: `checkedAt` on the
/// reachable answer and `detail` on the unreachable one, each omitted rather
/// than sent null. That is the rule the error envelope's own optional member
/// already follows, and for the same reason: a member present with a
/// meaningless value is worse than an absent one.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiHealth {
    /// Always `"ok"`. A request that got a body at all was served by an apid
    /// that is up, so there is no second value this member could take; it is
    /// on the wire so that a client reads one document rather than inferring
    /// half of it from the fact that a response arrived.
    apid: &'static str,
    /// `"ok"` when the probe below completed, `"unreachable"` when it did not.
    /// Two values and no third: §2.4 case 3 defines exactly these two shapes,
    /// and a health answer that needs a taxonomy is not one a monitor can act
    /// on.
    mosd: &'static str,
    /// Whole seconds since boot, at the moment the probe answered.
    ///
    /// A number and not a timestamp string. There is no trusted wall clock in
    /// this crate — §3.2's expiry paragraph is the argument, and `SessionStore`
    /// is the evidence, monotonic `Instant` throughout — so the only honest
    /// stamp is the appliance's own uptime, which is exactly what
    /// `GET /api/v1/state/uptime` already serves and is spelled the same way
    /// there: a bare JSON number of whole seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    checked_at: Option<u64>,
    /// Why the probe did not complete, in the words of whatever refused it.
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

/// Whether this appliance is manageable (§2.4 case 3).
///
/// **200 in both states, and that is the whole point of the route.** A dead
/// mosd is reported in the body and never as a status code: a 503 here would be
/// indistinguishable from this endpoint itself being down, which is the
/// confusion the route exists to remove. The client rule §2.4 states is
/// therefore exact — `/healthz` answers "is apid's listener up", this answers
/// "is this appliance manageable", and neither implies the other.
///
/// mosd is decided by **one real bus call**, never by a cached flag. That rules
/// out `access_cache` specifically: the cache exists so the auth gate can skip
/// a per-request `GetSettings("access")`, it is filled from a `SettingsChanged`
/// subscription, and it answers from apid's own memory. A health route served
/// from it would report `mosd: "ok"` for as long as the last fill survived,
/// which is precisely the failure — a monitor seeing a healthy device — that
/// §2.4 case 3 was written to prevent.
///
/// The call is `GetState("uptime")` rather than §2.4's suggested
/// `GetSettings("")`, and the swap is a deviation recorded in
/// `docs/task/RFCT-212.md` §3. It is still one call, which is what the section
/// asks for; it is cheaper than the call the section named, which is the reason
/// that section gave for naming it — mosd answers with a bare integer instead
/// of serialising the entire settings tree, password hash included, onto the
/// bus for a liveness ping; and it is the one call that also yields
/// `checkedAt`, so the alternative was two round trips to answer one question.
///
/// Authenticated, like every other `/api/v1/` route. The unauthenticated
/// listener-liveness question already has an answer at `/healthz`.
#[utoipa::path(
    get,
    path = V1_HEALTH_PATH,
    context_path = API,
    tag = "diagnostics",
    responses(
        (status = 200, description = "Whether this appliance is manageable. **200 in both states**: a dead mosd is reported as `mosd: \"unreachable\"` in the body, never as a status code", body = ApiHealth),
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_health(_session: ApiSession, State(state): State<AppState>) -> Response {
    let (mosd, checked_at, detail) = match state.api.get_state(HEALTH_PROBE_PATH).await {
        // Any answer that is not the number of seconds mosd documents is
        // classified with the failures rather than reported as health. `ok`
        // has to mean "the round trip completed and produced a usable answer";
        // a state key that came back the wrong shape did not.
        Ok(value) => match value.as_u64() {
            Some(seconds) => ("ok", Some(seconds), None),
            None => (
                "unreachable",
                None,
                Some(format!(
                    "mosd answered GetState(\"{HEALTH_PROBE_PATH}\") with {value}, which is not a count of seconds"
                )),
            ),
        },
        Err(err) => ("unreachable", None, Some(format!("{err:#}"))),
    };
    api_response(
        StatusCode::OK,
        ApiHealth {
            apid: "ok",
            mosd,
            checked_at,
            detail,
        },
    )
}

/// The body of a resource `GET`: the value at the dot-path, as mosd holds it.
///
/// Any JSON value, because a dot-path names a subtree, an array or a scalar
/// and §2.2's passthrough imposes no shape of its own. The string
/// `"<redacted>"` is a value a client can receive anywhere inside it: every
/// field named `psk`, `passwordHash`, `password_hash`, `hash` or `privateKey`,
/// at any depth
/// and inside arrays, carries that sentinel instead of its value, and so does
/// the whole body when the dot-path names one of those fields directly. It is
/// read-only — writing it back would destroy the credential — and phase 1
/// serves no write route to write it with. `privateKey` is on the same list;
/// no shipped schema has such a field, and the entry is the fail-closed guard
/// for the day one appears.
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
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 404, description = "The dot-path does not exist (`settings_not_found`)", body = ApiError),
        (status = 422, description = "mosd rejected the dot-path (`settings_rejected`)", body = ApiError),
        (status = 500, description = "mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
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
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 422, description = "mosd rejected the dot-path (`settings_rejected`), which is also the answer for a dot-path that does not exist", body = ApiError),
        (status = 500, description = "mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_state(
    _session: ApiSession,
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response {
    resource_response(state.api.get_state(&path).await, &path)
}

/// The body of a successful key rotation: the public half, and nothing else.
///
/// There is no `privateKey` member here and there will not be one. The private
/// half never leaves mosd — `docs/task/RFCT-200.md` §4 states *"there is no
/// read-back route for the private key, ever — not redacted-on-read;
/// nonexistent"* — so this struct is the whole of what a rotation can answer.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WireguardRotation {
    /// The new base64 X25519 public key, which is what the far end needs.
    public_key: String,
}

/// Rotate a WireGuard interface's private key (§2.1's action family).
///
/// An action and not a settings write, because there is no setting to write:
/// the key lives in a mode-0640 file on STATE that the settings tree does not
/// describe. mosd draws the new key, deletes the device holding the old one and
/// reconciles, so a caller that gets a 200 has a tunnel running on the key
/// whose public half it was just handed.
///
/// `iface` is passed to mosd unexamined. mosd owns the rule — the name must be
/// a declared `network` entry of kind `wireguard` — and it raises `InvalidArgs`
/// for anything else, which is classified as the same 422 a rejected settings
/// path gets. A second copy of that rule here could disagree with the first.
///
/// Prose and not an intra-doc link to the classifier, deliberately: `utoipa`
/// copies this comment into the published document, where a link would put an
/// apid symbol name in front of every client.
#[utoipa::path(
    post,
    path = V1_WIREGUARD_ROTATE_ROUTE,
    context_path = API,
    tag = "actions",
    params(("iface" = String, Path, description = "The `network` entry to rotate, which must be one of kind `wireguard`: `wg0`")),
    responses(
        (status = 200, description = "A new key was drawn; the body carries its public half", body = WireguardRotation),
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 422, description = "mosd refused the interface (`settings_rejected`): not a declared network entry, or not a WireGuard one", body = ApiError),
        (status = 500, description = "mosd failed to rotate (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_wireguard_rotate(
    _session: ApiSession,
    State(state): State<AppState>,
    Path(iface): Path<String>,
) -> Response {
    match state.api.rotate_wireguard_key(&iface).await {
        Ok(public_key) => api_response(StatusCode::OK, WireguardRotation { public_key }),
        // §2.4's `path` is the settings dot-path at fault, and this failure has
        // one: the entry whose kind mosd refused.
        Err(err) => bus_api_error(&err, &iface_settings_path(&iface)),
    }
}

// §3.2's token collection: the listing, the mint and the revocation.

/// One row of `GET /api/v1/tokens` (§3.2).
///
/// Three members and not four: the digest is not on this wire and neither is
/// the plaintext, which exists in exactly one response and never again.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ApiTokenSummary {
    /// The token's stable identity, which is also its `DELETE` path segment.
    /// Not secret: it is a lookup key, and §3.2 puts it on the wire for that.
    id: String,
    /// The operator's label, the only thing that tells one token from another.
    name: String,
    /// Seconds since the UNIX epoch as the device clock read them at the mint.
    ///
    /// **A label, never a deadline.** No unit on this image syncs a clock, so
    /// the reading may be wrong by any amount and 0 means the clock was unset.
    /// Tokens do not expire; revocation is the whole lifecycle (§3.2).
    created: u64,
}

/// `POST /api/v1/tokens` request body.
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub(crate) struct MintTokenRequest {
    /// The label the new token is listed under.
    name: String,
}

/// `POST /api/v1/tokens` response body: the one place a plaintext token
/// appears.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct MintedToken {
    /// The new token's identity, for a later `DELETE`.
    id: String,
    /// The label as it was submitted.
    name: String,
    /// The whole token, `mos_<id>_<secret>`.
    ///
    /// **It appears here and nowhere else, ever.** Only the SHA-256 digest is
    /// stored, so a token that is lost is replaced and never recovered -- the
    /// posture `access.device` already takes.
    token: String,
}

/// Every token this device holds, without the halves that are secrets (§3.2).
#[utoipa::path(
    get,
    path = V1_TOKENS_PATH,
    context_path = API,
    tag = "tokens",
    responses(
        (status = 200, description = "The stored tokens: `id`, `name` and `created`, never the digest and never the plaintext", body = Vec<ApiTokenSummary>),
        (status = 401, description = "No bearer API token, or one this device does not hold (`not_authenticated`). A session cookie is not a credential on this route", body = ApiError),
        (status = 500, description = "The stored list could not be read as a token list (`settings_invalid`), or mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_tokens_list(
    _bearer: ApiBearer,
    State(state): State<AppState>,
) -> Response {
    match stored_tokens(&state).await {
        Ok(tokens) => api_response(
            StatusCode::OK,
            tokens
                .into_iter()
                .map(|entry| ApiTokenSummary {
                    id: entry.id,
                    name: entry.name,
                    created: entry.created,
                })
                .collect::<Vec<_>>(),
        ),
        Err(response) => *response,
    }
}

/// Mint a token (§3.2).
///
/// **A bearer token is the only credential this route takes**, and the
/// bootstrap is a path rather than an exception: the first token is minted
/// through `POST /builtin/tokens`, a form post outside the `v1` contract.
/// Leaving the mint here and letting it take a cookie was considered and
/// rejected by name in §3.2, because it would put a permanent-credential
/// factory inside the one surface §3.3 makes its strongest statement about.
#[utoipa::path(
    post,
    path = V1_TOKENS_PATH,
    context_path = API,
    tag = "tokens",
    request_body = MintTokenRequest,
    responses(
        (status = 201, description = "The token was created; the body carries the plaintext, which is not recoverable afterwards", body = MintedToken),
        (status = 400, description = "The body is not JSON, or not this shape (`request_invalid`)", body = ApiError),
        (status = 401, description = "No bearer API token, or one this device does not hold (`not_authenticated`). A session cookie is not a credential on this route", body = ApiError),
        (status = 409, description = "The device already holds the maximum number of tokens (`token_limit_reached`); revoke one first", body = ApiError),
        (status = 422, description = "The name is empty, over 256 bytes, or holds a control character (`validation_failed`)", body = ApiError),
        (status = 500, description = "The stored list could not be read as a token list (`settings_invalid`), no free id was drawn (`mint_failed`), or mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_tokens_mint(
    _bearer: ApiBearer,
    State(state): State<AppState>,
    body: Result<Json<MintTokenRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(rejection) => {
            return api_response(
                StatusCode::BAD_REQUEST,
                ApiError::apid("request_invalid", rejection.body_text()),
            );
        }
    };
    let mut tokens = match stored_tokens(&state).await {
        Ok(tokens) => tokens,
        Err(response) => return *response,
    };
    // The cap is answered here and not only by the store. The validator makes
    // a full list a hard refusal, and without this check the caller meets that
    // refusal as a failed write -- a 500 about mosd -- rather than as an answer
    // about the request they made. 409 and not 422: the body is well formed and
    // nothing about it is wrong, and what refuses it is the collection's
    // current state, which is the condition §2.4 already spends 409 on.
    if tokens.len() >= mosd_settings::MAX_TOKENS {
        return api_response(
            StatusCode::CONFLICT,
            ApiError::apid(
                "token_limit_reached",
                format!(
                    "this device already holds the maximum of {} API tokens; revoke one before minting another",
                    mosd_settings::MAX_TOKENS
                ),
            )
            .at(API_TOKENS_PATH),
        );
    }
    let Some(minted) = token::mint(&tokens) else {
        return api_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::apid(
                "mint_failed",
                "no free token id was drawn; nothing was written".to_string(),
            )
            .at(API_TOKENS_PATH),
        );
    };
    tokens.push(ApiToken {
        id: minted.id.clone(),
        name: request.name.clone(),
        hash: minted.hash,
        created: device_clock_seconds(),
    });
    if let Err(response) = write_tokens(&state, &tokens).await {
        return *response;
    }
    api_response(
        StatusCode::CREATED,
        MintedToken {
            id: minted.id,
            name: request.name,
            token: minted.wire,
        },
    )
}

/// Revoke one token, identified by its id (§3.2).
///
/// Identity is the id and never a list position, for the reason the SSH key
/// pane records about fingerprints: an index is meaningful only against the
/// list the caller last read, and a concurrent mint slides it onto a different
/// entry. Revocation takes effect on the next request, because the token set is
/// read per request from the `access` subtree.
#[utoipa::path(
    delete,
    path = V1_TOKEN_ROUTE,
    context_path = API,
    tag = "tokens",
    params(("id" = String, Path, description = "The token id, as `POST /api/v1/tokens` returned it: 1 to 64 lowercase hex characters")),
    responses(
        (status = 204, description = "The token was revoked; it stops being accepted on the next request"),
        (status = 401, description = "No bearer API token, or one this device does not hold (`not_authenticated`). A session cookie is not a credential on this route", body = ApiError),
        (status = 404, description = "No stored token carries that id (`settings_not_found`). Well-formed and absent, which is a different answer from malformed", body = ApiError),
        (status = 422, description = "The id is not a token id at all (`validation_failed`)", body = ApiError),
        (status = 500, description = "The stored list could not be read as a token list (`settings_invalid`), or mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
    ),
)]
pub(crate) async fn api_v1_tokens_revoke(
    _bearer: ApiBearer,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    // Malformed and absent are different answers and must not share a status
    // (`docs/task/RFCT-210.md` §2.4). An id that is not an id could never name
    // an entry, so a 404 here would send the caller looking for a token they
    // deleted instead of at the URL they typed.
    if !mosd_settings::is_api_token_id(&id) {
        return api_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::apid(
                "validation_failed",
                "a token id is 1 to 64 lowercase hex characters".to_string(),
            )
            .at(API_TOKENS_PATH),
        );
    }
    let mut tokens = match stored_tokens(&state).await {
        Ok(tokens) => tokens,
        Err(response) => return *response,
    };
    let Some(index) = tokens.iter().position(|entry| entry.id == id) else {
        return item_not_found(API_TOKENS_PATH, &id);
    };
    tokens.remove(index);
    if let Err(response) = write_tokens(&state, &tokens).await {
        return *response;
    }
    (
        StatusCode::NO_CONTENT,
        [(CACHE_CONTROL, CacheClass::NoStore.header_value())],
    )
        .into_response()
}

/// §2.4's envelope for the condition every API collection item route shares: a
/// well-formed identifier that names no item.
///
/// One shared function and not one per handler, which is what
/// `docs/task/RFCT-210.md` §2.4 requires of this rule: a collection route added
/// later inherits the 404 by reaching for this, rather than by remembering a
/// decision, and the 422 beside it stays reserved for an identifier that is not
/// well formed at all.
///
/// The HTML panes answer **422** for the same condition, deliberately and on
/// the record. Its paired test is
/// `the_builtin_revoke_pane_answers_422_where_the_api_answers_404`.
fn item_not_found(collection: &str, identifier: &str) -> Response {
    api_response(
        StatusCode::NOT_FOUND,
        ApiError::apid(
            "settings_not_found",
            format!("no item of `{collection}` is identified by `{identifier}`"),
        )
        .at(collection),
    )
}

/// The stored token list, or the envelope for whatever prevented reading it.
///
/// The read is direct rather than from the gate's `access` cache: this is the
/// read half of a read-modify-write, and the freshest list is the one least
/// likely to drop somebody else's entry.
async fn stored_tokens(state: &AppState) -> Result<Vec<ApiToken>, Box<Response>> {
    let access = match state.api.get_settings("access").await {
        Ok(value) => value,
        Err(err) => return Err(Box::new(bus_api_error(&err, API_TOKENS_PATH))),
    };
    parse_tokens(&access).map_err(|err| {
        Box::new(api_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::apid(
                "settings_invalid",
                format!("the stored token list could not be read: {err}"),
            )
            .at(API_TOKENS_PATH),
        ))
    })
}

/// The token list inside an `access` subtree.
///
/// An absent list is an empty list -- the model omits the field entirely when
/// nothing is stored -- but a list that is present and unreadable is an error
/// and never an empty list, for the reason the SSH key list gives: treating it
/// as empty would let a mint or a revoke overwrite tokens the operator cannot
/// see.
fn parse_tokens(access: &Value) -> Result<Vec<ApiToken>, serde_json::Error> {
    match access.get("apiTokens") {
        Some(value) => serde_json::from_value(value.clone()),
        None => Ok(Vec::new()),
    }
}

/// Validate and write a rewritten token list.
///
/// Read-modify-write of the whole array, because the dot-path syntax has no
/// array indexing -- the same pattern the SSH key pane uses. **Two concurrent
/// mints lose one token, silently**: both read the list, both append to their
/// own copy, and the second write wins. It is recorded and not fixed; §3.2
/// names it as a cost inherited from the tree, and the alternative is a locking
/// scheme this codebase does not have.
async fn write_tokens(state: &AppState, tokens: &[ApiToken]) -> Result<(), Box<Response>> {
    // The same validator mosd runs, so a list this route accepts is one the
    // store will accept too. Its message names an entry index and never echoes
    // a digest or an id.
    if let Err(err) = validate_api_tokens(tokens) {
        return Err(Box::new(api_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::apid("validation_failed", key_error_message(&err)).at(API_TOKENS_PATH),
        )));
    }
    // Infallible: `ApiToken` is a struct of scalars with no map keys to collide.
    let value = serde_json::to_value(tokens).expect("api tokens serialize");
    if let Err(err) = state.api.set_settings(API_TOKENS_PATH, &value).await {
        return Err(Box::new(bus_api_error(&err, API_TOKENS_PATH)));
    }
    // apid knows its own `access` write happened, so the gate's cache is
    // dropped here rather than waiting for the `SettingsChanged` round trip.
    // The bearer check reads the same subtree, and this is what makes a
    // revocation take effect on the next request.
    state.access_cache.invalidate();
    Ok(())
}

/// The device clock in seconds since the UNIX epoch, saturating at 0.
///
/// A label and never a deadline; see [`ApiTokenSummary::created`]. A clock
/// before the epoch reads 0 rather than failing a mint, because an untrusted
/// clock must not decide whether the operator may hold a credential.
fn device_clock_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
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
/// `SettingsError` onto five error names — two interface-scoped, three fdo —
/// and zbus carries the name back, so the distinction exists all the way to
/// here and only apid can lose it; the message is mosd's own words because no
/// phrasing apid could pre-write would say which field was wrong.
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
                MOSD_NOT_FOUND => (
                    StatusCode::NOT_FOUND,
                    ApiError::mosd("settings_not_found", message),
                ),
                MOSD_READ_ONLY => (
                    StatusCode::CONFLICT,
                    ApiError::mosd("settings_read_only", message),
                ),
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

/// Proof that the request carried a credential these routes accept.
///
/// **Two of them, by PLAN-023 Amendment 1's ruling (option 1,
/// dual-credential):** a bearer API token, or the browser session cookie every
/// route naming this extractor already shipped accepting. The bearer is what
/// §3.1 asks for; the cookie stays because removing it here would break a
/// client that exists, and this milestone is additive. A later named milestone
/// removes the cookie, and §3.2's "only accepted credential" sentence is true
/// from that milestone rather than from this one.
///
/// The type keeps its name through that change of meaning, deliberately: the
/// name is quoted by `docs/design/api.md` §1.2, §2.4 and §3.1, which the
/// cutover milestone rewrites as one piece. Renaming it here would leave the
/// document quoting a symbol that is gone while still describing cookie-only
/// authentication.
///
/// [`ApiBearer`] is the stricter sibling, and the token routes take that one.
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
        // The cookie first, because it costs no bus call: the bearer check
        // needs the `access` subtree and this one needs nothing.
        if session::cookie_from_headers(&parts.headers)
            .is_some_and(|value| state.sessions.verify(&value))
        {
            return Ok(Self);
        }
        if bearer_is_stored(state, &parts.headers).await {
            return Ok(Self);
        }
        Err(not_authenticated(
            "no session cookie, or one that does not verify, and no bearer API token this device holds",
        ))
    }
}

/// Proof that the request carried a bearer API token, and not merely a session.
///
/// The boundary drawn inside Amendment 1, and the reason it is not a
/// contradiction of it: the amendment preserves the credentials of routes that
/// **already shipped**, and the three token routes had not. §3.2 rejects a
/// cookie-accepting mint by name, because it would put a permanent-credential
/// factory inside the one surface §3.3 makes its strongest statement about, and
/// there is no back-compatibility argument for a route that does not exist yet.
///
/// The bootstrap is a path rather than an exception: an operator holding only a
/// browser mints their first token at `POST /builtin/tokens` and revokes at
/// `POST /builtin/tokens/revoke`, neither of which is an `/api/v1/` route.
pub(crate) struct ApiBearer;

impl FromRequestParts<AppState> for ApiBearer {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if bearer_is_stored(state, &parts.headers).await {
            return Ok(Self);
        }
        Err(not_authenticated(
            "this route accepts a bearer API token only; a session cookie is not a credential here, and a browser mints its first token at POST /builtin/tokens",
        ))
    }
}

/// §2.4's 401, in whichever wording the rejecting extractor owes.
fn not_authenticated(message: &str) -> Response {
    api_response(
        StatusCode::UNAUTHORIZED,
        ApiError::apid("not_authenticated", message.to_string()),
    )
}

/// Whether the request carries a bearer token this device stores (§3.2).
///
/// **Not rate limited, and it must not become so.** The secret is 256 bits of
/// `OsRng` and is not guessable online, while a shared counter here would let
/// anyone holding a bad token lock out every script on the appliance. The login
/// backoff ([`auth::GuardStore`]) stays scoped to the password path, which is
/// where a human-chosen secret is.
async fn bearer_is_stored(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(presented) = token::bearer_from_headers(headers) else {
        return false;
    };
    // The subtree the gate already reads, which is why §3.2 put the list under
    // `access` rather than beside it: no second round trip per request.
    let access = match access_settings(state).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(error = %err, "reading `access` for a bearer check failed");
            return false;
        }
    };
    // A stored list that does not parse authenticates nobody, which errs
    // closed -- the opposite of the read the token routes do, where the same
    // condition is an error rather than an empty list because a write follows.
    token::verify(&parse_tokens(&access).unwrap_or_default(), presented)
}

/// The `access` subtree: from the gate's cache when it is provably fresh, and
/// from mosd otherwise.
///
/// The generation is snapshotted BEFORE the direct read so a change signalled
/// while the read was in flight discards the fill rather than caching a
/// possibly-pre-change snapshot.
async fn access_settings(state: &AppState) -> anyhow::Result<Value> {
    if let Some(value) = state.access_cache.get() {
        return Ok(value);
    }
    let generation = state.access_cache.generation();
    let value = state.api.get_settings("access").await?;
    state.access_cache.fill(generation, value.clone());
    Ok(value)
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

    // The unauthenticated path's read, served from the cache when — and only
    // when — the SettingsChanged subscription is live (`access_cache`'s
    // lockout rule).
    let access = match access_settings(&state).await {
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
///
/// DHCP off with an empty address is an interface with **no** addressing, not
/// an error. It used to be one, and it stopped being one when bridges became
/// expressible: a bridge port *must* carry neither `dhcp` nor `static`
/// (`os/pkgs/mosd/mosd/src/reconciler/network.rs:483-487`), and it must be a
/// declared entry before a bridge may name it, so a pane that insisted on an
/// address made a bridge unbuildable through the form. An address that is
/// present and not a CIDR is still refused.
fn validate_iface(iface: &str, dhcp: bool, address: &str) -> Result<(), &'static str> {
    if !valid_iface_name(iface) {
        return Err("Interface name must be 1-15 characters of letters, digits, '.', '_' or '-'.");
    }
    if !dhcp && !address.is_empty() && !valid_cidr(address) {
        return Err("Static address must be IPv4 CIDR notation, e.g. 192.168.1.10/24.");
    }
    Ok(())
}

/// The settings path of `iface`'s entry, with the name quoted when it carries
/// a dot: a VLAN named `eth0.100` is `network."eth0.100"`, not three segments.
fn iface_settings_path(iface: &str) -> String {
    format!("network.{}", quote_path_segment(iface))
}

/// A comma-separated form field as the list it spells, blanks dropped.
///
/// The idiom the `dns` field has always used, reused for bridge ports and a
/// peer's allowed IPs rather than teaching the pane a second list notation.
fn comma_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect()
}

/// A text field as `Some(trimmed)`, or `None` when it is blank.
fn optional_field(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// A numeric field as `Some(number)`, `None` when blank, and `Err` when it is
/// neither.
///
/// An unparseable number is an error rather than a silent `None`: dropping a
/// listen port the operator typed would leave a tunnel listening on a
/// kernel-chosen port and say nothing about it.
fn parse_optional_u16(value: &str) -> Result<Option<u16>, ()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    value.parse::<u16>().map(Some).map_err(|_| ())
}

/// The addressing half of an entry: the static block, or none at all.
fn addressing(dhcp: bool, address: &str, gateway: &str, dns: &str) -> Option<StaticConfig> {
    if dhcp || address.is_empty() {
        return None;
    }
    Some(StaticConfig {
        address: address.to_string(),
        gateway: optional_field(gateway),
        dns: comma_list(dns),
    })
}

/// A `physical` entry with the given addressing: what the setup wizard's one
/// interface field makes, and the shape every v6 tree held.
fn physical_iface_settings(dhcp: bool, address: &str, gateway: &str, dns: &str) -> IfaceSettings {
    IfaceSettings {
        kind: IfaceKind::Physical,
        dhcp,
        static_: addressing(dhcp, address, gateway, dns),
        vlan: None,
        bridge: None,
        wireguard: None,
    }
}

/// The entry a submitted network form describes, or the message to show.
///
/// Exactly one kind block is ever set, and it is the one the submitted `kind`
/// names: the form renders all four groups at once (see [`kind_fields`]), so a
/// value left in another group's box must not reach the tree. That makes the
/// reconciler's *"is kind X but carries a Y block"* rule
/// (`os/pkgs/mosd/mosd/src/reconciler/network.rs:341-364`) unreachable from
/// this path rather than merely checked on it.
///
/// `peers` is passed in rather than read off the form: the save form carries no
/// peer fields, so a rewritten entry keeps the peer list the tree already
/// holds. Dropping it would disconnect every far end because somebody changed a
/// listen port.
fn iface_settings_from_form(
    form: &NetworkForm,
    peers: Vec<WireguardPeer>,
) -> Result<IfaceSettings, String> {
    let kind_name_submitted = form.kind.trim();
    let Some(kind) = parse_kind(kind_name_submitted) else {
        return Err(format!(
            "{kind_name_submitted:?} is not an interface kind; it must be physical, vlan, bridge or wireguard."
        ));
    };
    let dhcp = form.dhcp.is_some();
    let address = form.address.trim();
    validate_iface(form.iface.trim(), dhcp, address)?;
    let mut cfg = physical_iface_settings(dhcp, address, form.gateway.trim(), &form.dns);
    cfg.kind = kind;
    match kind {
        IfaceKind::Physical => {}
        IfaceKind::Vlan => {
            let parent = form.vlan_parent.trim();
            if parent.is_empty() {
                return Err(
                    "A VLAN needs a parent: the name of the declared interface it sits on."
                        .to_string(),
                );
            }
            // Bounded by the type and by nothing else here. networkd's own
            // range is narrower, and the reconciler does not check it either
            // (`os/pkgs/mosd/mosd/src/reconciler/network.rs:565-568` renders
            // `Id=` from a `u16`), so a bound invented in this file would
            // refuse a tree the boundary accepts.
            let Ok(id) = form.vlan_id.trim().parse::<u16>() else {
                return Err("A VLAN id must be a whole number from 0 to 65535.".to_string());
            };
            cfg.vlan = Some(VlanConfig {
                parent: parent.to_string(),
                id,
            });
        }
        IfaceKind::Bridge => {
            cfg.bridge = Some(BridgeConfig {
                ports: comma_list(&form.bridge_ports),
            });
        }
        IfaceKind::Wireguard => {
            let Ok(listen_port) = parse_optional_u16(&form.listen_port) else {
                return Err(
                    "A WireGuard listen port must be a whole number from 0 to 65535.".to_string(),
                );
            };
            cfg.wireguard = Some(WireguardConfig { listen_port, peers });
        }
    }
    Ok(cfg)
}

/// True when `value` parses as an IP address with an optional `/prefix`.
///
/// An echo of the reconciler's `is_ip_or_cidr`
/// (`os/pkgs/mosd/mosd/src/reconciler/network.rs:272-288`), for the reason
/// `validate_static` states about the address field: apid checks on its write
/// path so the operator gets a readable error, and the reconciler checks again
/// because the settings file is writable without apid. Deliberately not
/// [`valid_cidr`], which is IPv4-only and belongs to the older address field.
fn is_ip_or_cidr(value: &str) -> bool {
    let (addr, prefix) = match value.split_once('/') {
        Some((addr, prefix)) => (addr, Some(prefix)),
        None => (value, None),
    };
    let Ok(addr) = addr.parse::<IpAddr>() else {
        return false;
    };
    match prefix {
        None => true,
        Some(prefix) => prefix
            .parse::<u8>()
            .is_ok_and(|p| p <= if addr.is_ipv4() { 32 } else { 128 }),
    }
}

/// True when `value` is the `host:port` a peer's `endpoint` has to be.
///
/// The same echo, of `is_host_port`
/// (`os/pkgs/mosd/mosd/src/reconciler/network.rs:377-397`).
fn is_host_port(value: &str) -> bool {
    let Some((host, port)) = value.rsplit_once(':') else {
        return false;
    };
    if port.parse::<u16>().is_err() {
        return false;
    }
    if let Some(inner) = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        return inner.parse::<std::net::Ipv6Addr>().is_ok();
    }
    !host.is_empty()
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

/// Length of the base64 spelling of a 32-byte key, padding included.
const WIREGUARD_KEY_LEN: usize = 44;

/// Whether `value` is the base64 X25519 key a peer's `publicKey` has to be.
///
/// The echo of `wgkeys::is_key` (`os/pkgs/mosd/mosd/src/wgkeys.rs:288-291`),
/// which decodes with the standard alphabet's *padded* spelling; the length
/// test is what pins that, because [`mosd_settings::decode_base64`] also
/// accepts the unpadded form and an echo that accepted more than the boundary
/// would hand the operator a form error from the daemon instead of from the
/// field.
fn is_wireguard_key(value: &str) -> bool {
    value.len() == WIREGUARD_KEY_LEN
        && mosd_settings::decode_base64(value).is_some_and(|bytes| bytes.len() == 32)
}

/// The reconciler's peer rules, echoed for a readable form error.
///
/// A rejected peer is named by its index and never by its key, for the reason
/// the reconciler states: an operator who pasted a *private* key into the field
/// would otherwise find it in the error text.
fn validate_peers(iface: &str, peers: &[WireguardPeer]) -> Result<(), String> {
    for (index, peer) in peers.iter().enumerate() {
        if !is_wireguard_key(&peer.public_key) {
            return Err(format!(
                "network.{iface} peer {index} has a public key that is not a WireGuard key: it must be 32 bytes spelled in base64."
            ));
        }
        for allowed in &peer.allowed_ips {
            if !is_ip_or_cidr(allowed) {
                return Err(format!(
                    "network.{iface} peer {index} allowed IP {allowed:?} is not an IP address or CIDR."
                ));
            }
        }
        if let Some(endpoint) = &peer.endpoint
            && !is_host_port(endpoint)
        {
            return Err(format!(
                "network.{iface} peer {index} endpoint {endpoint:?} is not host:port."
            ));
        }
    }
    Ok(())
}

/// The reconciler's relational rules, echoed over the whole candidate subtree.
///
/// Echoed and not forked. `validate_network`
/// (`os/pkgs/mosd/mosd/src/reconciler/network.rs:454-505`) stays the boundary
/// — it runs on every apply, including the ones that never went through apid —
/// and this runs first so the operator reads which field is wrong instead of a
/// 502 from a failed bus call.
///
/// It is checked over the *candidate* tree rather than over the one entry being
/// written, because every rule here is about two entries at once: a VLAN and
/// its parent, a bridge and its ports. Editing `eth1` to take an address is
/// refused when `br0` claims it, which no check confined to `eth1` could see.
fn validate_entries(entries: &NetworkEntries) -> Result<(), String> {
    for (iface, cfg) in entries {
        if let Some(wireguard) = &cfg.wireguard {
            validate_peers(iface, &wireguard.peers)?;
        }
    }
    // Which bridge claimed each port, so a second claim on one port is an
    // error rather than a race between two `Bridge=` lines for one file.
    let mut claimed_by: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
    for (iface, cfg) in entries {
        if let Some(vlan) = &cfg.vlan
            && !entries.contains_key(&vlan.parent)
        {
            return Err(format!(
                "network.{iface} has VLAN parent {:?}, which is not a declared network entry.",
                vlan.parent
            ));
        }
        let Some(bridge) = &cfg.bridge else {
            continue;
        };
        for port in &bridge.ports {
            let Some(port_cfg) = entries.get(port) else {
                return Err(format!(
                    "network.{iface} has bridge port {port:?}, which is not a declared network entry."
                ));
            };
            if port_cfg.dhcp || port_cfg.static_.is_some() {
                return Err(format!(
                    "network.{port} is a port of bridge {iface} and must not carry addressing of its own."
                ));
            }
            if let Some(other) = claimed_by.insert(port, iface) {
                return Err(format!(
                    "network.{port} is claimed as a port by both bridge {other} and bridge {iface}."
                ));
            }
        }
    }
    Ok(())
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
    // The device just left setup mode, and the gate must not keep believing
    // otherwise from a cached pre-write snapshot: drop the cache now rather
    // than waiting for the SettingsChanged round trip.
    state.access_cache.invalidate();
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
        // The wizard's one interface is always physical: it has no kind
        // control, and a device being set up for the first time has no other
        // entry for a VLAN parent or a bridge port to name.
        let settings = physical_iface_settings(dhcp, address, form.gateway.trim(), &form.dns);
        let value = serde_json::to_value(&settings).expect("interface settings serialize");
        if let Err(err) = state
            .api
            .set_settings(&iface_settings_path(iface), &value)
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
    // apid knows its own access write happened, so the gate's cache is
    // dropped here rather than waiting for the SettingsChanged round trip:
    // the next unauthenticated request re-reads and cannot be answered from
    // a pre-change snapshot.
    state.access_cache.invalidate();
    // The write happened; every other session goes with the old credential.
    // No cookie on the request keeps nothing, which errs closed.
    state
        .sessions
        .remove_all_except(acting_session.unwrap_or(""));
    state.audit.record("password", "changed", source);
    Ok(())
}

/// The sentence `docs/task/RFCT-210.md` §3 fixed for this pane, verbatim.
///
/// Token revocation on a password change stays **out**, ratified there: it
/// would destroy N credentials the operator cannot see at the moment they act,
/// with no confirmation, no count and no undo, because a token is shown once at
/// the mint and never again. The cost of keeping it is that *"I changed my
/// password" is not a containment action*, and this is the whole obligation
/// §3.2 states and never assigns to a milestone. Asserted byte for byte by
/// `the_password_pane_carries_the_ratified_token_sentence`, because a
/// paraphrase would quietly drop the containment advice that is the point of
/// it.
const PASSWORD_TOKEN_NOTICE: &str = "API tokens are not affected. Changing this password signs other browsers out, but every API token keeps working. If you are changing this password because you think someone else has access, revoke your API tokens as well, and check the SSH authorized keys — every one of them is a root key.";

fn password_page(banner: Option<Markup>) -> Html<String> {
    pane(
        "Password",
        html! {
            @if let Some(banner) = banner { (banner) }
            p { "Changing the admin password signs every other session out. The session making the change stays signed in." }
            p { (PASSWORD_TOKEN_NOTICE) }
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
        (status = 401, description = "No accepted credential: neither a bearer API token this device holds nor a session cookie that verifies (`not_authenticated`)", body = ApiError),
        (status = 403, description = "The current password does not verify (`wrong_password`)", body = ApiError),
        (status = 422, description = "The new password is shorter than 8 characters (`validation_failed`)", body = ApiError),
        (status = 500, description = "Hashing failed (`hashing_failed`), or mosd failed to answer (`settings_io`, `mosd_failed`)", body = ApiError),
        (status = 503, description = "The call to mosd could not be made (`mosd_unreachable`); carries `Retry-After`", body = ApiError),
        (status = 405, description = "A method this route does not serve (`method_not_allowed`); carries `Allow`", body = ApiError),
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
/// It reads mosd and nothing under `/srv/ui`. That is
/// the property §6.3 rests candidate (A) on — *"the built-in handlers do not
/// read `/srv/ui` at all, so no bundle state — absent, corrupt, unreadable,
/// wrong version — can affect them"* — and it is why §6.1's five classes do not
/// need enumerating here: a handler that never consults the bundle store cannot
/// branch on which class occurred.
///
/// Uptime comes through `get_state` like every other system fact — mosd
/// serves it fresh at read time — and not from a `/proc` reader here, which
/// would contradict the crate's own rule that mosd owns every system fact
/// (`settings_api.rs`).
async fn status_body(state: &AppState) -> Markup {
    let hostname = state.api.get_settings("hostname").await;
    let network = state.api.get_state("network").await;
    let uptime = state
        .api
        .get_state("uptime")
        .await
        .ok()
        .and_then(|value| value.as_u64());
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

/// §3.2's bootstrap: the mint and its sibling revoke, as declared *inside* the
/// nest and as a client sees them.
///
/// Under the reserved prefix and not beside it, because §3.2 puts them there:
/// they are the built-in UI's own controls, they carry no JSON, and they are
/// not part of the `v1` contract §2.1 versions.
const BUILTIN_TOKENS_LEAF: &str = "/tokens";
const BUILTIN_TOKENS: &str = "/builtin/tokens";
const BUILTIN_TOKENS_REVOKE_LEAF: &str = "/tokens/revoke";
const BUILTIN_TOKENS_REVOKE: &str = "/builtin/tokens/revoke";

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
    builtin_page(&state, None).await
}

/// The built-in pane, with `banner` above the token section when a mint or a
/// revoke has something to say about itself.
async fn builtin_page(state: &AppState, banner: Option<Markup>) -> Html<String> {
    let status = status_body(state).await;
    let tokens = pane_tokens(state).await;
    pane(
        "Status",
        html! {
            (status)
            (tokens_section(&tokens, banner))
            (escape_section())
        },
    )
}

/// The stored token list for the pane, or the reason it could not be read.
///
/// A failed read degrades to a message and never to a failed page: §6.1's rule
/// is that a failure in one part must not take the surface that reports it with
/// it, and this pane is §6.3's escape.
async fn pane_tokens(state: &AppState) -> Result<Vec<ApiToken>, String> {
    let access = state
        .api
        .get_settings("access")
        .await
        .map_err(|err| format!("{err:#}"))?;
    parse_tokens(&access).map_err(|err| err.to_string())
}

/// §8.1's capability (iii): the mint pane, and the revoke beside it.
///
/// The revoke is here rather than left to the API because §3.2 asks for the
/// capability *in full*: an operator holding only a browser has to be able to
/// revoke a leaked token without first holding another one.
fn tokens_section(tokens: &Result<Vec<ApiToken>, String>, banner: Option<Markup>) -> Markup {
    html! {
        h2 { "API tokens" }
        @if let Some(banner) = banner { (banner) }
        p {
            "A token authenticates a script against " code { "/api/v1/" } " with an "
            code { "Authorization: Bearer" } " header. It is shown once, when it is \
             created, and only its digest is kept — a token that is lost is \
             replaced, never recovered. Tokens do not expire; revoking one is \
             the whole of its lifecycle, and it stops working on the next \
             request."
        }
        @match tokens {
            Err(message) => { (error_box(&format!("The stored token list could not be read: {message}"))) }
            Ok(tokens) if tokens.is_empty() => { p { "No API tokens are stored." } }
            Ok(tokens) => {
                ul {
                    @for entry in tokens {
                        li {
                            b { (entry.name) } " — " code { (entry.id) }
                            form method="post" action=(BUILTIN_TOKENS_REVOKE) {
                                input type="hidden" name="id" value=(entry.id);
                                button type="submit" { "Revoke" }
                            }
                        }
                    }
                }
            }
        }
        @match tokens {
            Ok(tokens) if tokens.len() >= mosd_settings::MAX_TOKENS => {
                (error_box(&format!(
                    "This device holds the maximum of {} API tokens. Revoke one before creating another.",
                    mosd_settings::MAX_TOKENS
                )))
            }
            _ => {
                form method="post" action=(BUILTIN_TOKENS) {
                    fieldset {
                        legend { "Create an API token" }
                        p { label { "Name" } " " input type="text" name="name" required; }
                        p { button type="submit" { "Create token" } }
                    }
                }
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct TokenMintForm {
    #[serde(default)]
    name: String,
}

/// `POST /builtin/tokens` — §3.2's bootstrap, and the only mint a browser can
/// reach.
///
/// The first token cannot be minted with a token, and the resolution is a path
/// rather than an exception to `/api/v1/tokens`' bearer-only rule: this route
/// is a form post under §6.3's reserved prefix, authenticated by the session
/// cookie, answering with an HTML page that displays the plaintext once. It
/// carries no JSON and it is not part of the `v1` contract, so a change to it
/// is a change to the HTML surface, which §8.1 already establishes carries no
/// version promise.
///
/// What this costs, named in §3.2 and true here: **no token can be created on a
/// device whose built-in UI is broken.** That is the situation §6 exists for,
/// and it makes the token lifecycle a dependent of §6's escape.
async fn builtin_tokens_mint(
    State(state): State<AppState>,
    Form(form): Form<TokenMintForm>,
) -> Response {
    let tokens = match pane_tokens(&state).await {
        Ok(tokens) => tokens,
        Err(message) => return builtin_error(&state, &message).await,
    };
    if tokens.len() >= mosd_settings::MAX_TOKENS {
        return builtin_error(
            &state,
            &format!(
                "This device already holds the maximum of {} API tokens. Revoke one before creating another.",
                mosd_settings::MAX_TOKENS
            ),
        )
        .await;
    }
    let Some(minted) = token::mint(&tokens) else {
        return builtin_error(&state, "No free token id was drawn; nothing was written.").await;
    };
    let mut tokens = tokens;
    tokens.push(ApiToken {
        id: minted.id.clone(),
        name: form.name.clone(),
        hash: minted.hash,
        created: device_clock_seconds(),
    });
    // The API envelope this returns is discarded and the pane speaks for
    // itself: a browser handed §2.4's JSON would render it as text.
    if let Err(response) = write_tokens(&state, &tokens).await {
        let status = response.status();
        return builtin_error(&state, &token_write_message(status)).await;
    }
    minted_page(&form.name, &minted.id, &minted.wire).into_response()
}

#[derive(serde::Deserialize)]
struct TokenRevokeForm {
    #[serde(default)]
    id: String,
}

/// `POST /builtin/tokens/revoke` — §8.1's capability (iii) in full.
///
/// An id matching nothing is **422** here and **404** on
/// `DELETE /api/v1/tokens/{id}`, and the split is on the record
/// (`docs/task/RFCT-210.md` §2.4): this response body is a re-rendered pane, no
/// consumer on this surface reads the status, and the condition really is the
/// re-submit-the-form one — the list may have changed since the page was
/// loaded. Its paired test is
/// `the_builtin_revoke_pane_answers_422_where_the_api_answers_404`.
async fn builtin_tokens_revoke(
    State(state): State<AppState>,
    Form(form): Form<TokenRevokeForm>,
) -> Response {
    let mut tokens = match pane_tokens(&state).await {
        Ok(tokens) => tokens,
        Err(message) => return builtin_error(&state, &message).await,
    };
    let Some(index) = tokens.iter().position(|entry| entry.id == form.id) else {
        return builtin_error(
            &state,
            "No stored token carries that identifier. The list may have changed since this page was loaded; reload it and try again.",
        )
        .await;
    };
    let name = tokens.remove(index).name;
    if let Err(response) = write_tokens(&state, &tokens).await {
        let status = response.status();
        return builtin_error(&state, &token_write_message(status)).await;
    }
    builtin_page(
        &state,
        Some(html! { div.saved { "The token " b { (name) } " has been revoked. It stops working on the next request." } }),
    )
    .await
    .into_response()
}

/// What a failed token write is told to the operator, from the status the API
/// path would have answered.
///
/// The pane cannot show §2.4's envelope, and it must not guess: the status is
/// the one thing the shared write path already decided.
fn token_write_message(status: StatusCode) -> String {
    format!("The token list could not be written ({status}). Nothing was changed.")
}

/// The one page a plaintext token ever appears on.
fn minted_page(name: &str, id: &str, wire: &str) -> Html<String> {
    pane(
        "API token",
        html! {
            div.saved { "The token " b { (name) } " has been created." }
            p {
                "This is the only time it is shown. Only its digest is stored, so if \
                 this is lost the token has to be replaced rather than recovered."
            }
            p { "Identifier: " code { (id) } }
            pre { (wire) }
            p {
                "Send it as " code { "Authorization: Bearer <token>" } " on "
                code { "/api/v1/" } " requests."
            }
            p { a href=(BUILTIN_PATH) { "Back to the built-in interface" } }
        },
    )
}

/// Re-render the built-in pane with `message` in an error box, at 422.
///
/// The same shape `ssh_error` uses, and the same status, which is the HTML half
/// of the split recorded on [`builtin_tokens_revoke`].
async fn builtin_error(state: &AppState, message: &str) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        builtin_page(state, Some(error_box(message))).await,
    )
        .into_response()
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

/// The `network` settings subtree, as a map of typed entries.
///
/// Parsed into `mosd_settings` types rather than read out of the JSON by key,
/// so the pane renders exactly the schema mosd deserializes and a field this
/// file misspells is a compile error rather than a blank input.
type NetworkEntries = std::collections::BTreeMap<String, IfaceSettings>;

/// The kinds the pane offers, in the order the `<select>` lists them.
///
/// `physical` first because it is the default and the only kind a v6 tree ever
/// had; the three virtual kinds follow in the order `docs/task/RFCT-200.md` §2
/// introduces them.
const IFACE_KINDS: [IfaceKind; 4] = [
    IfaceKind::Physical,
    IfaceKind::Vlan,
    IfaceKind::Bridge,
    IfaceKind::Wireguard,
];

/// The spelling a kind has in the settings file and in the form.
///
/// The same four strings `mosd`'s reconciler uses, because they are what
/// `IfaceKind`'s `rename_all = "lowercase"` serializes; a fifth spelling here
/// would be a form that writes a kind mosd cannot read.
fn kind_name(kind: IfaceKind) -> &'static str {
    match kind {
        IfaceKind::Physical => "physical",
        IfaceKind::Vlan => "vlan",
        IfaceKind::Bridge => "bridge",
        IfaceKind::Wireguard => "wireguard",
    }
}

/// The kind `name` spells, or `None` when it spells none of them.
///
/// An empty string is `physical`: the setup wizard's interface form carries no
/// kind control at all, and an absent kind means the default everywhere else
/// in the schema.
fn parse_kind(name: &str) -> Option<IfaceKind> {
    if name.is_empty() {
        return Some(IfaceKind::Physical);
    }
    IFACE_KINDS
        .into_iter()
        .find(|kind| kind_name(*kind) == name)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkForm {
    iface: String,
    /// Absent from the setup wizard's form, which only ever makes a physical
    /// interface; empty there and read as `physical`.
    #[serde(default)]
    kind: String,
    dhcp: Option<String>,
    #[serde(default)]
    address: String,
    #[serde(default)]
    gateway: String,
    #[serde(default)]
    dns: String,
    #[serde(default)]
    vlan_parent: String,
    #[serde(default)]
    vlan_id: String,
    #[serde(default)]
    bridge_ports: String,
    #[serde(default)]
    listen_port: String,
}

/// One peer, as the add form submits it.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerAddForm {
    iface: String,
    public_key: String,
    #[serde(default)]
    allowed_ips: String,
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    persistent_keepalive: String,
}

/// A peer named for removal.
///
/// By public key, the way the SSH pane removes by fingerprint: a peer's public
/// key is a stable handle that is public by definition, so it can sit in a
/// hidden field without putting anything secret on the page. An index would
/// name a different peer the moment two browser tabs disagree about the list.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerRemoveForm {
    iface: String,
    public_key: String,
}

/// Everything the network pane renders, gathered before any markup is built.
struct NetworkView {
    /// The entries that parsed, keyed by interface name.
    entries: NetworkEntries,
    /// Names present in the tree whose bodies did not parse. They are listed
    /// so an operator can see that the pane is not showing everything, and
    /// they get no form: a form rendered from a body this code could not read
    /// would write back a guess.
    unreadable: Vec<String>,
    /// Live state published by mosd's network reconciler, absent when mosd has
    /// published none yet.
    state: Option<Value>,
    /// Why the settings or the live state could not be read, if either failed.
    problems: Vec<String>,
}

impl NetworkView {
    /// The live-state object mosd published for `iface`.
    fn live(&self, iface: &str) -> Option<&Value> {
        self.state.as_ref()?.get(iface)
    }

    /// A string field of `iface`'s live-state object.
    fn live_str(&self, iface: &str, field: &str) -> Option<&str> {
        self.live(iface)?.get(field)?.as_str()
    }
}

/// Split the `network` subtree into the entries that parse and the names that
/// do not.
///
/// Per entry and not whole-subtree, because the two failure modes are
/// different: one hand-edited body must not blank out every other interface's
/// form. A body that does not parse is named and skipped.
fn parse_network(network: &Value) -> (NetworkEntries, Vec<String>) {
    let empty = serde_json::Map::new();
    let mut entries = NetworkEntries::new();
    let mut unreadable = Vec::new();
    for (name, body) in network.as_object().unwrap_or(&empty) {
        match serde_json::from_value::<IfaceSettings>(body.clone()) {
            Ok(cfg) => {
                entries.insert(name.clone(), cfg);
            }
            Err(_) => unreadable.push(name.clone()),
        }
    }
    (entries, unreadable)
}

/// Load the settings half and the live-state half of the pane.
///
/// A failure to read `network` is fatal to the pane (there is nothing to
/// show); a failure to read the live state is not, because the stored
/// configuration is still worth showing and mosd may simply not have
/// reconciled yet. The same split `load_ssh_view` makes.
async fn load_network_view(app: &AppState) -> anyhow::Result<NetworkView> {
    let network = app.api.get_settings("network").await?;
    let (entries, unreadable) = parse_network(&network);
    let mut problems = Vec::new();
    let state = match app.api.get_state("network").await {
        Ok(value) => Some(value),
        Err(err) => {
            problems.push(format!("Live network state unavailable: {err}"));
            None
        }
    };
    Ok(NetworkView {
        entries,
        unreadable,
        state,
        problems,
    })
}

/// The peers of `iface`, read for a handler that is about to rewrite them.
///
/// Read at submit time rather than carried through the form: a peer list in a
/// hidden field is a list two tabs can fight over, and the peer routes rewrite
/// exactly one interface's list.
async fn stored_peers(app: &AppState, iface: &str) -> anyhow::Result<Vec<WireguardPeer>> {
    let network = app.api.get_settings("network").await?;
    let (entries, _) = parse_network(&network);
    Ok(entries
        .get(iface)
        .and_then(|cfg| cfg.wireguard.as_ref())
        .map(|wireguard| wireguard.peers.clone())
        .unwrap_or_default())
}

/// Re-render the pane with `message` in an error box, at 422.
async fn network_error(app: &AppState, message: &str) -> Response {
    match load_network_view(app).await {
        Ok(view) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            network_page(&view, Some(error_box(message))),
        )
            .into_response(),
        Err(err) => bus_error(&err),
    }
}

/// The dot-path of `iface`'s peer list, with the name quoted when it carries a
/// dot: a tunnel named `wg.0` is `network."wg.0".wireguard.peers`.
fn peers_settings_path(iface: &str) -> String {
    format!("{}.wireguard.peers", iface_settings_path(iface))
}

/// Display fields for one configured interface's form.
struct IfaceDisplay {
    dhcp: bool,
    address: String,
    gateway: String,
    dns: String,
}

fn iface_display(cfg: &IfaceSettings) -> IfaceDisplay {
    let static_ = cfg.static_.as_ref();
    IfaceDisplay {
        dhcp: cfg.dhcp,
        address: static_.map(|s| s.address.clone()).unwrap_or_default(),
        gateway: static_.and_then(|s| s.gateway.clone()).unwrap_or_default(),
        dns: static_.map(|s| s.dns.join(", ")).unwrap_or_default(),
    }
}

/// Render the typed inputs for every kind at once, with the current values
/// filled in.
///
/// All four groups are always in the markup rather than hidden behind the
/// selected kind, because this pane ships no JavaScript (§6.2 compiles the
/// built-in UI into the binary as markup and one stylesheet) and a group that
/// only appears after a reload cannot be filled in on the same visit. The
/// handler reads only the group the submitted kind names, so a value left in
/// another group's box is never written.
fn kind_fields(kind: IfaceKind, cfg: Option<&IfaceSettings>) -> Markup {
    let vlan = cfg.and_then(|cfg| cfg.vlan.as_ref());
    let bridge = cfg.and_then(|cfg| cfg.bridge.as_ref());
    let wireguard = cfg.and_then(|cfg| cfg.wireguard.as_ref());
    html! {
        p { label { "Kind" } " "
            select name="kind" {
                @for candidate in IFACE_KINDS {
                    option value=(kind_name(candidate)) selected[candidate == kind] {
                        (kind_name(candidate))
                    }
                }
            }
        }
        p { label { "VLAN parent (kind vlan)" } " "
            input type="text" name="vlanParent"
                value=(vlan.map_or("", |vlan| vlan.parent.as_str())) placeholder="eth0"; }
        p { label { "VLAN id (kind vlan)" } " "
            input type="text" name="vlanId"
                value=(vlan.map_or(String::new(), |vlan| vlan.id.to_string())) placeholder="100"; }
        p { label { "Bridge ports (kind bridge, comma-separated)" } " "
            input type="text" name="bridgePorts"
                value=(bridge.map_or(String::new(), |bridge| bridge.ports.join(", "))) placeholder="eth1, eth2"; }
        p { label { "WireGuard listen port (kind wireguard, optional)" } " "
            input type="text" name="listenPort"
                value=(wireguard.and_then(|wg| wg.listen_port).map_or(String::new(), |port| port.to_string()))
                placeholder="51820"; }
    }
}

/// The live-state facts mosd published for one interface.
///
/// `kind` and, for a tunnel, `publicKey`: the two fields M5 added to the
/// per-interface state object. There is no private key here and no route that
/// would produce one — the public half is what the far end needs and is public
/// by definition.
fn live_state_markup(view: &NetworkView, iface: &str) -> Markup {
    html! {
        @if let Some(live) = view.live(iface) {
            p {
                "Live: kind " b { (view.live_str(iface, "kind").unwrap_or("unknown")) }
                @if let Some(file) = view.live_str(iface, "file") { ", unit " code { (file) } }
                @if live.get("dhcp").and_then(Value::as_bool) == Some(true) { ", DHCP" }
            }
            @if let Some(public_key) = view.live_str(iface, "publicKey") {
                p { "Public key: " code { (public_key) } }
                p { "The private half is on this device in a file only systemd-networkd can read. It is never shown here, never in the API, and there is no route that returns one." }
            }
        } @else {
            p { "Live: mosd has published no state for this interface yet." }
        }
    }
}

/// One tunnel's peer list, with a remove control per peer and an add form.
fn peers_markup(iface: &str, wireguard: Option<&WireguardConfig>) -> Markup {
    let peers = wireguard.map_or(&[][..], |wireguard| wireguard.peers.as_slice());
    html! {
        h3 { "Peers of " (iface) }
        @if peers.is_empty() {
            p { "No peers. A tunnel with no peers is a link that could never carry a packet, and the reconciler renders it but nothing reaches the far end." }
        } @else {
            ul {
                @for peer in peers {
                    li {
                        code { (peer.public_key) }
                        @if !peer.allowed_ips.is_empty() { " → " (peer.allowed_ips.join(", ")) }
                        @if let Some(endpoint) = &peer.endpoint { " via " (endpoint) }
                        @if let Some(keepalive) = peer.persistent_keepalive { " keepalive " (keepalive) "s" }
                        form method="post" action="/network/peers/remove" {
                            input type="hidden" name="iface" value=(iface);
                            input type="hidden" name="publicKey" value=(peer.public_key);
                            button type="submit" { "Remove" }
                        }
                    }
                }
            }
        }
        form method="post" action="/network/peers/add" {
            fieldset {
                legend { "Add a peer to " (iface) }
                input type="hidden" name="iface" value=(iface);
                p { label { "Public key (base64, 32 bytes)" } " "
                    input type="text" name="publicKey" size="60" required; }
                p { label { "Allowed IPs (comma-separated)" } " "
                    input type="text" name="allowedIps" placeholder="10.8.0.0/24"; }
                p { label { "Endpoint (optional, host:port)" } " "
                    input type="text" name="endpoint" placeholder="vpn.example.net:51820"; }
                p { label { "Persistent keepalive seconds (optional)" } " "
                    input type="text" name="persistentKeepalive" placeholder="25"; }
                p { button type="submit" { "Add peer" } }
            }
        }
    }
}

fn network_page(view: &NetworkView, banner: Option<Markup>) -> Html<String> {
    pane(
        "Network",
        html! {
            @if let Some(banner) = banner { (banner) }
            @for problem in &view.problems { (error_box(problem)) }
            @for name in &view.unreadable {
                (error_box(&format!(
                    "network.{name} holds a body this pane cannot read, so it is not shown and not editable here. Fix it in the settings file."
                )))
            }
            @if view.entries.is_empty() { p { "No interfaces configured." } }
            @for (name, cfg) in &view.entries {
                form method="post" action="/network" {
                    fieldset {
                        legend { (name) }
                        input type="hidden" name="iface" value=(name);
                        @let display = iface_display(cfg);
                        (iface_fields(display.dhcp, &display.address, &display.gateway, &display.dns))
                        (kind_fields(cfg.kind, Some(cfg)))
                        (live_state_markup(view, name))
                        p { button type="submit" { "Save" } }
                    }
                }
                @if cfg.kind == IfaceKind::Wireguard {
                    (peers_markup(name, cfg.wireguard.as_ref()))
                }
            }
            form method="post" action="/network" {
                fieldset {
                    legend { "Add interface" }
                    p { label { "Interface name" } " "
                        input type="text" name="iface" placeholder="eth0"; }
                    (iface_fields(false, "", "", ""))
                    (kind_fields(IfaceKind::Physical, None))
                    p { button type="submit" { "Add" } }
                }
            }
        },
    )
}

async fn network_form(State(state): State<AppState>, Query(query): Query<SavedQuery>) -> Response {
    match load_network_view(&state).await {
        Ok(view) => {
            let banner = query.saved.is_some().then(saved_banner);
            network_page(&view, banner).into_response()
        }
        Err(err) => bus_error(&err),
    }
}

async fn network_submit(State(state): State<AppState>, Form(form): Form<NetworkForm>) -> Response {
    let iface = form.iface.trim().to_string();
    let view = match load_network_view(&state).await {
        Ok(view) => view,
        Err(err) => return bus_error(&err),
    };
    // The peers this form does not carry. A save that dropped them would
    // silently disconnect every far end because the operator changed a listen
    // port.
    let peers = view
        .entries
        .get(&iface)
        .and_then(|cfg| cfg.wireguard.as_ref())
        .map(|wireguard| wireguard.peers.clone())
        .unwrap_or_default();
    let cfg = match iface_settings_from_form(&form, peers) {
        Ok(cfg) => cfg,
        Err(message) => return network_error(&state, &message).await,
    };
    // The candidate tree, not the one entry: every relational rule below is
    // about two entries at once.
    let mut candidate = view.entries.clone();
    candidate.insert(iface.clone(), cfg.clone());
    if let Err(message) = validate_entries(&candidate) {
        return network_error(&state, &message).await;
    }
    // Infallible: `IfaceSettings` is a struct of scalars, strings and vectors
    // with no map keys that could collide.
    let value = serde_json::to_value(&cfg).expect("interface settings serialize");
    if let Err(err) = state
        .api
        .set_settings(&iface_settings_path(&iface), &value)
        .await
    {
        return bus_error(&err);
    }
    Redirect::to("/network?saved=1").into_response()
}

async fn network_peer_add(
    State(state): State<AppState>,
    Form(form): Form<PeerAddForm>,
) -> Response {
    let iface = form.iface.trim().to_string();
    let peer = WireguardPeer {
        public_key: form.public_key.trim().to_string(),
        allowed_ips: comma_list(&form.allowed_ips),
        endpoint: optional_field(&form.endpoint),
        persistent_keepalive: match parse_optional_u16(&form.persistent_keepalive) {
            Ok(value) => value,
            Err(()) => {
                return network_error(
                    &state,
                    "Persistent keepalive must be a whole number of seconds from 0 to 65535.",
                )
                .await;
            }
        },
    };
    let mut peers = match stored_peers(&state, &iface).await {
        Ok(peers) => peers,
        Err(err) => return bus_error(&err),
    };
    if peers
        .iter()
        .any(|other| other.public_key == peer.public_key)
    {
        return network_error(
            &state,
            "That public key is already a peer of this tunnel. Remove it first to change it.",
        )
        .await;
    }
    peers.push(peer);
    write_peers(&state, &iface, &peers).await
}

async fn network_peer_remove(
    State(state): State<AppState>,
    Form(form): Form<PeerRemoveForm>,
) -> Response {
    let iface = form.iface.trim().to_string();
    let public_key = form.public_key.trim();
    let mut peers = match stored_peers(&state, &iface).await {
        Ok(peers) => peers,
        Err(err) => return bus_error(&err),
    };
    let before = peers.len();
    peers.retain(|peer| peer.public_key != public_key);
    if peers.len() == before {
        return network_error(
            &state,
            "No peer of this tunnel has that public key; the list may have changed since the page was loaded.",
        )
        .await;
    }
    write_peers(&state, &iface, &peers).await
}

/// Validate and write a rewritten peer list.
///
/// The same shape `write_key_list` has for the SSH pane: the reconciler's own
/// rule is echoed here for a readable error, and the write goes to the peer
/// list's own dot-path rather than rewriting the whole entry.
async fn write_peers(app: &AppState, iface: &str, peers: &[WireguardPeer]) -> Response {
    if let Err(message) = validate_peers(iface, peers) {
        return network_error(app, &message).await;
    }
    // Infallible: a peer is a struct of strings and integers.
    let value = serde_json::to_value(peers).expect("wireguard peers serialize");
    if let Err(err) = app
        .api
        .set_settings(&peers_settings_path(iface), &value)
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
