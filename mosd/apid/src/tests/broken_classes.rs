//! `docs/design/api.md` §6.1's five failure classes, enumerated end to end,
//! with coverage asserted (§8.2 phase 4 acceptance 1).
//!
//! §8.2 phase 4: for each of §6.1's five classes, navigating to the reserved
//! prefix reaches a working UI and one control there deactivates the bundle.
//! *"The operator diagnoses nothing."*
//!
//! `super::the_escape_answers_identically_whatever_the_bundle_store_holds`
//! already states §6.3 as an invariance over bundle-store states, which is
//! stronger than any enumeration, and nothing here restates it. What an
//! invariance does not say is that each of §6.1's five specific failure modes
//! can be constructed at all, that the escape works from each, and that the
//! suite knows it exercised all five. That is this module.
//!
//! Two rules govern the shape:
//!
//! 1. *"5 passed"* and *"3 passed, 2 never ran"* are the same number, so a
//!    bare pass count is invariant across the defect it is supposed to detect.
//!    The facts are declared by identity, the set that actually ran is
//!    observed, the two are diffed, and a failure names what is missing and
//!    what is unexpected.
//!    `crate::startup::tests::no_hostile_store_can_stop_start_up` is the model.
//! 2. Several classes produce the same observable — the built-in UI — so a
//!    suite asserting only *"the built-in UI answered"* would pass with class
//!    3's construction silently failing and falling through to class 1's
//!    state. Each fact asserts the distinct state the mechanism reports for
//!    that class — the digest mismatch, the empty intersection with both sets
//!    named, the absent index, the file that will not open, the named "no
//!    custom bundle is active" answer — and the evidence strings are asserted
//!    pairwise distinct.
//!    `crate::assets::path::tests::each_guard_is_exercised_by_exactly_one_hostile_feature`
//!    is the model.
//!
//! Which layer each class is detected at is §6.1's own table: classes 1, 2 and
//! 4 are the asset router's, per request; classes 3 and 5 are start-up's, and
//! are driven through [`crate::startup::discover`], the entry point `main`
//! calls.

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::Path;

use super::*;
use crate::bundle::{CustomUi, Installed, Store};
use crate::startup::{self, BundleState, Reason, SERVED_API_VERSIONS};

/// The admin password every router below is driven with.
const PASSWORD: &str = "hunter2secret";

/// The custom bundle's index, so a page that is the bundle's is unmistakable.
const CUSTOM_INDEX: &str = "<!doctype html><title>custom</title>";

/// Two inner assets. §6.1 class 4's second half needs a sibling that must
/// **keep** serving while the first one does not.
const ASSET: (&str, &str) = ("assets/app.a1b2c3.js", "//broken-asset");
const SIBLING: (&str, &str) = ("assets/other.d4e5f6.js", "//sibling-asset");

// Fixtures

/// One demonstrated fact, carried by the name the coverage diff reports.
struct Fact {
    /// Declared by identity in `EXPECTED_FACTS`.
    id: &'static str,
    /// §6.1's class number, so the **classes** covered can be diffed too.
    class: u8,
    /// The distinct state the mechanism reported. Asserted pairwise distinct,
    /// so a class cannot pass for another class's reason.
    evidence: String,
}

/// Stage `files` as generation 1 and activate it **against `served`**.
///
/// `super::install_bundle` is this same operation against §2.1's served set.
/// Class 5 is the one class that has to activate against a *different* one — a
/// bundle built for an image this binary is not — because §5.3 refuses to
/// activate a bundle that does not intersect the set it is given, which is the
/// activation half of class 5 and `bundle.rs`'s test rather than this one's.
/// So the served set is a parameter here and nowhere else.
fn install_declaring(files: &[(&str, &str)], served: &[&str]) -> TempDir {
    let dir = TempDir::new().expect("temp bundle store");
    let store = Store::new(dir.path());
    let staging = store.staging_dir(1);
    for (relative, contents) in files {
        let path = staging.join(relative);
        fs::create_dir_all(path.parent().expect("staged parent")).expect("create staged parent");
        fs::write(path, contents).expect("write staged file");
    }
    store.activate(1, served).expect("activate the staged tree");
    dir
}

/// Make `path` an entry the asset router's `open` will refuse, and return the
/// name of the construction that actually took effect.
///
/// §6.1 class 4 names `EACCES` and `EIO`, and this suite has to exercise it
/// whether or not the test runner can override permissions: a process holding
/// `CAP_DAC_OVERRIDE` — root, which is how `mosd/hack/check.sh` is commonly
/// run — reads a `0o000` file straight through, so a mode-only fixture would
/// quietly test nothing there. A fixture that silently did not fire is
/// indistinguishable from one that did.
///
/// So the mode is set, the construction is verified with the same call the
/// mechanism makes, and if it did not take effect the entry is replaced by a
/// UNIX socket, which no uid can open for reading (`ENXIO`). The name is
/// returned and travels into the fact's evidence, so the record says which one
/// ran rather than implying `EACCES` either way.
///
/// The socket construction narrows one thing, stated because it changes which
/// arm of `assets::serve::respond` answers. For the index the arm is the same
/// either way: `serve_index` resolves the path and `serve_file`'s `fs::read`
/// fails. For an inner asset `serve.rs` gates on `file.is_file()`, which a
/// socket is not, so under a permission-overriding runner the 404 comes from
/// the not-a-regular-file miss rather than from a failed `open`. The
/// observable §6.1 specifies — 404 for that asset and nothing else changed —
/// is identical, and it is the observable this suite asserts.
fn will_not_open(path: &Path) -> &'static str {
    fs::set_permissions(path, fs::Permissions::from_mode(0o000)).expect("chmod 000");
    if fs::read(path).is_err() {
        return "mode 0o000, EACCES";
    }
    fs::remove_file(path).expect("remove the still-readable file");
    // Binding names the socket in the filesystem; dropping the listener closes
    // the descriptor and leaves the inode, which is the fixture.
    UnixListener::bind(path).expect("bind a socket in its place");
    assert!(
        fs::read(path).is_err(),
        "the class-4 fixture must not open: {}",
        path.display()
    );
    "a UNIX socket in its place, ENXIO"
}

/// The active generation, or `None`. Never an error: §6.1 forbids one.
fn active(store: &Store) -> Option<u64> {
    store.active_generation().expect("read `current`")
}

/// `status()` for a store with a bundle active, or a panic naming the fact.
fn custom(store: &Store, fact: &str) -> CustomUi {
    match store.status().expect("read the store") {
        Installed::Custom(ui) => ui,
        Installed::BuiltIn => panic!("{fact}: a bundle must still be active here"),
    }
}

/// A logged-in router over `bundle_root`.
async fn signed_in(bundle_root: &Path) -> (Router, String) {
    let router = test_app_serving(configured_tree(PASSWORD), bundle_root);
    let cookie = login(&router, PASSWORD).await;
    (router, cookie)
}

/// `GET path` with a browser's `Accept`, asserted 200, body returned.
async fn page(router: &Router, path: &str, cookie: &str, fact: &str) -> String {
    let response = request(router, "GET", path, Some(cookie), Some(BROWSER_ACCEPT)).await;
    assert_eq!(response.status(), StatusCode::OK, "{fact}: GET {path}");
    body_string(response).await
}

// The one documented action, performed identically for every class

/// §8.2 phase 4 acceptance 1, carried out: *navigate to
/// `https://<device>/builtin/`, and use the one control there.*
///
/// Byte-identical code for all seven facts, which is the point — the operator
/// does not choose a different action per class, so neither does this. What it
/// deliberately does **not** assert is that the rendered page is the same
/// across classes: `super::the_escape_answers_identically_whatever_the_bundle_store_holds`
/// already asserts that as an invariance over store states, and a weaker
/// per-class restatement would look like more coverage and be less.
async fn one_documented_action(router: &Router, store: &Store, cookie: &str, fact: &str) {
    // (A), the way in. Both spellings, because an operator recovering a device
    // should not have to get a trailing slash right.
    for path in [ESCAPE_BARE, ESCAPE] {
        let body = page(router, path, cookie, fact).await;
        assert!(
            body.contains(BUILT_IN_PANE),
            "{fact}: {path} is not the binary's own page: {body}"
        );
        assert!(
            body.contains(ESCAPE_CONTROL),
            "{fact}: {path} is a way in without a way out: {body}"
        );
        assert!(
            !body.contains("<title>custom"),
            "{fact}: {path} answered with the bundle: {body}"
        );
    }

    // (B), the way out — one control, and both of its answers are the same
    // success. §6.3 requires an outcome that does not depend on what was
    // wrong, and "nothing was active" is not an error.
    let response = post_form(router, ESCAPE_DEACTIVATE, "", Some(cookie)).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "{fact}: the escape control must not fail"
    );
    let body = body_string(response).await;
    assert!(
        body.contains("has been deactivated") || body.contains("No custom UI was active"),
        "{fact}: the control must say what happened: {body}"
    );

    // The end state, and it is the same end state for every class: no pointer,
    // and `/` is the built-in UI with no restart.
    assert_eq!(active(store), None, "{fact}: `current` must be gone");
    let root = page(router, "/", cookie, fact).await;
    assert!(
        root.contains(BUILT_IN_PANE),
        "{fact}: `/` must be the built-in UI afterwards: {root}"
    );
    assert!(
        !root.contains("<title>custom"),
        "{fact}: `/` still serves the bundle: {root}"
    );
}

// §6.1 class 1 — no bundle installed

const FACT_1: &str = "class 1: no bundle installed, `current` absent";

/// *"This is not an error — it is the shipped state of every device."*
///
/// That it must not be **logged** as one is
/// `crate::startup::tests::an_absent_srv_ui_is_normal_operation_and_not_an_error`,
/// which captures the log and asserts no WARN and no ERROR; it is not repeated
/// here. What is asserted here is the answer itself: a named state, reached
/// through the entry point `main` calls, and the escape from it.
async fn class_1_no_bundle_installed() -> Fact {
    let dir = TempDir::new().expect("tempdir");
    let root = dir.path().join("srv-ui-that-was-never-created");
    assert!(!root.exists(), "{FACT_1}: the fixture must start absent");
    let store = Store::new(&root);

    let state = startup::discover(
        store.clone(),
        std::sync::Arc::new(crate::audit::Audit::journal_only()),
    )
    .await;
    assert_eq!(state, BundleState::BuiltIn, "{FACT_1}");
    assert_eq!(
        store.status().expect("read the store"),
        Installed::BuiltIn,
        "{FACT_1}: §5.3's read reports a named answer, not an absent one"
    );
    assert!(
        !root.exists(),
        "{FACT_1}: §5.2 — the root is created by the install path, never at start-up"
    );

    let (router, cookie) = signed_in(&root).await;
    one_documented_action(&router, &store, &cookie, FACT_1).await;

    Fact {
        id: FACT_1,
        class: 1,
        evidence: state.to_string(),
    }
}

// §6.1 class 2 — no `index.html`, or an index that is a directory

const FACT_2_ABSENT: &str = "class 2: a bundle whose `index.html` is absent";
const FACT_2_DIRECTORY: &str = "class 2: a bundle whose `index.html` is a directory";

/// §6.1 states class 2 in two shapes and both are constructed.
///
/// It is reachable only one way, and §6.1 says so: *"the tree was mutated
/// outside the install path"*, because §5.3 refuses to activate a bundle
/// without a regular `index.html`. So the index is broken **after** activation,
/// in the installed tree.
///
/// The mutation also moves the tree off its recorded digest, which is class 3
/// — at *the next start-up*, per §6.1's table, and never per request. This
/// demonstration therefore stays at the request layer and does not call
/// `startup::discover`, which is the same separation §6.1's "detected when"
/// column draws.
async fn class_2(fact: &'static str, break_index: fn(&Path)) -> Fact {
    let bundle = install_bundle(&[("index.html", CUSTOM_INDEX), ASSET]);
    let store = Store::new(bundle.path());
    let index = store.bundle_dir(1).join("index.html");
    fs::remove_file(&index).expect("remove the installed index");
    break_index(&index);

    let ui = custom(&store, fact);
    assert_eq!(ui.generation, 1, "{fact}");
    assert!(
        !ui.index_readable,
        "{fact}: the store must report the index as unreadable"
    );

    let (router, cookie) = signed_in(bundle.path()).await;

    // §4.2 condition 5: the built-in UI, "not a 404 and not a 500" — at `/`
    // and through the SPA fallback alike.
    for path in ["/", "/settings/network"] {
        let body = page(&router, path, &cookie, fact).await;
        assert!(
            body.contains(BUILT_IN_PANE),
            "{fact}: {path} must be the built-in UI: {body}"
        );
    }

    // The control that separates class 2 from class 1: the bundle **is** being
    // served. Without this, "the built-in UI answered" is satisfied by a store
    // with nothing in it.
    let response = request(
        &router,
        "GET",
        &format!("/{}", ASSET.0),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK, "{fact}: {}", ASSET.0);
    assert_eq!(body_string(response).await, ASSET.1, "{fact}");
    assert_eq!(
        active(&store),
        Some(1),
        "{fact}: the bundle is still active"
    );

    let shape = match fs::symlink_metadata(&index) {
        Err(_) => "absent".to_string(),
        Ok(meta) if meta.is_dir() => "a directory".to_string(),
        Ok(meta) => format!("{meta:?}"),
    };
    one_documented_action(&router, &store, &cookie, fact).await;

    Fact {
        id: fact,
        class: 2,
        evidence: format!("generation 1 active, index.html is {shape}, its assets still serve"),
    }
}

// §6.1 class 3 — a malformed or half-written bundle

const FACT_3: &str = "class 3: a malformed or half-written bundle, digest mismatch";

/// The digest recorded at activation, re-checked at start-up.
///
/// Constructed the way §6.1 says the class is actually reachable — *"an
/// operator writing into `/srv/ui` over a root shell"* — since activation is a
/// rename of a validated tree and the installer cannot produce it. Detected at
/// the next restart and **not** per request, which §6.1 states as a real cost
/// rather than papering over it, so this fact is driven through
/// `startup::discover` and not through a request.
async fn class_3_digest_mismatch() -> Fact {
    let bundle = install_bundle(&[("index.html", CUSTOM_INDEX)]);
    let store = Store::new(bundle.path());
    fs::write(store.bundle_dir(1).join("planted.js"), b"root shell").expect("plant a file");
    assert_eq!(active(&store), Some(1));

    let state = startup::discover(
        store.clone(),
        std::sync::Arc::new(crate::audit::Audit::journal_only()),
    )
    .await;
    let BundleState::Deactivated {
        generation,
        reasons,
        removed,
    } = &state
    else {
        panic!("{FACT_3}: a digest mismatch must deactivate, got {state}");
    };
    assert_eq!(*generation, 1, "{FACT_3}");
    assert!(
        *removed,
        "{FACT_3}: the pointer must actually have come down"
    );
    // The distinct outcome: no other class produces this reason.
    assert_eq!(reasons, &vec![Reason::DigestMismatch], "{FACT_3}");
    assert!(
        store.bundle_dir(1).is_dir(),
        "{FACT_3}: deactivate removes the pointer, never the tree"
    );

    let (router, cookie) = signed_in(bundle.path()).await;
    one_documented_action(&router, &store, &cookie, FACT_3).await;

    Fact {
        id: FACT_3,
        class: 3,
        evidence: state.to_string(),
    }
}

// §6.1 class 4 — files that will not open, in both directions

const FACT_4_INDEX: &str = "class 4: an unreadable `index.html` falls back to the built-in UI";
const FACT_4_ASSET: &str = "class 4: an unreadable inner asset is 404 and nothing else changes";

/// The half that falls back. *"The fallback trigger is the index."*
async fn class_4_unreadable_index() -> Fact {
    let bundle = install_bundle(&[("index.html", CUSTOM_INDEX), ASSET]);
    let store = Store::new(bundle.path());
    let how = will_not_open(&store.bundle_dir(1).join("index.html"));

    let ui = custom(&store, FACT_4_INDEX);
    assert!(!ui.index_readable, "{FACT_4_INDEX}");

    let (router, cookie) = signed_in(bundle.path()).await;
    let body = page(&router, "/", &cookie, FACT_4_INDEX).await;
    assert!(
        body.contains(BUILT_IN_PANE),
        "{FACT_4_INDEX}: `/` must be the built-in UI: {body}"
    );

    // The two controls that stop this passing as class 1 or as class 3: the
    // bundle is still being served, and it is still **active** — an index that
    // will not open is not a deactivation trigger anywhere in §6.1.
    let response = request(
        &router,
        "GET",
        &format!("/{}", ASSET.0),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK, "{FACT_4_INDEX}");
    assert_eq!(body_string(response).await, ASSET.1, "{FACT_4_INDEX}");
    assert_eq!(
        active(&store),
        Some(1),
        "{FACT_4_INDEX}: the bundle must still be active"
    );

    one_documented_action(&router, &store, &cookie, FACT_4_INDEX).await;

    Fact {
        id: FACT_4_INDEX,
        class: 4,
        evidence: format!(
            "generation 1 active, index.html will not open ({how}), `/` is the built-in UI"
        ),
    }
}

/// The half that does not. *"A UI missing one image is still a working UI."*
///
/// This is the direction a suite is most likely to omit, and omitting it would
/// leave the suite passing against an implementation that swapped the whole UI
/// out on any unreadable file. So the second half is asserted explicitly: a
/// sibling asset is requested afterwards and required to succeed, and `/` is
/// required to be the bundle's own index and not the built-in UI.
async fn class_4_unreadable_inner_asset() -> Fact {
    let bundle = install_bundle(&[("index.html", CUSTOM_INDEX), ASSET, SIBLING]);
    let store = Store::new(bundle.path());
    let how = will_not_open(&store.bundle_dir(1).join(ASSET.0));

    let (router, cookie) = signed_in(bundle.path()).await;

    let response = request(
        &router,
        "GET",
        &format!("/{}", ASSET.0),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "{FACT_4_ASSET}: the unreadable asset is 404"
    );
    assert!(
        body_string(response).await.is_empty(),
        "{FACT_4_ASSET}: §4.2 — a miss has an empty body"
    );

    // "and nothing else changes", asserted rather than assumed.
    let response = request(
        &router,
        "GET",
        &format!("/{}", SIBLING.0),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "{FACT_4_ASSET}: the rest of the bundle must still serve"
    );
    assert_eq!(body_string(response).await, SIBLING.1, "{FACT_4_ASSET}");

    let root = page(&router, "/", &cookie, FACT_4_ASSET).await;
    assert_eq!(
        root, CUSTOM_INDEX,
        "{FACT_4_ASSET}: `/` must still be the bundle's own index"
    );
    assert_eq!(
        active(&store),
        Some(1),
        "{FACT_4_ASSET}: the bundle must still be active"
    );

    one_documented_action(&router, &store, &cookie, FACT_4_ASSET).await;

    Fact {
        id: FACT_4_ASSET,
        class: 4,
        evidence: format!(
            "generation 1 active, {} will not open ({how}) and is 404, {} still 200, `/` is the bundle's index",
            ASSET.0, SIBLING.0
        ),
    }
}

// §6.1 class 5 — renders perfectly, cannot talk to any API version served

const FACT_5: &str = "class 5: the declared range and the served set have no member in common";

/// *"Every file-level check passes. Every asset returns 200 ... nothing is
/// wrong with the filesystem."*
///
/// Constructed as §6.1's A/B case, which is *"the only moment at which anything
/// on the device is in a position to notice"*: the bundle was activated against
/// the API an earlier image served (`v0`), the rootfs was replaced, and this
/// binary serves [`SERVED_API_VERSIONS`]. The intersection is empty, which is
/// §6.1's sole trigger, and the log line and the state name **both** sets —
/// *"recording the served set in the log line is what makes the two
/// distinguishable after the fact."*
///
/// The renders-perfectly half is asserted first, from a request: if `/` did not
/// serve the bundle's own index, this fixture would be some other class wearing
/// class 5's name.
async fn class_5_no_common_api_version() -> Fact {
    let manifest = r#"{"name":"demo","version":"1.0",
        "immutableDir":"assets","apiVersions":["v0"]}"#;
    let bundle = install_declaring(
        &[
            ("index.html", CUSTOM_INDEX),
            ("mos-ui.json", manifest),
            ASSET,
        ],
        &["v0"],
    );
    let store = Store::new(bundle.path());
    let (router, cookie) = signed_in(bundle.path()).await;

    assert_eq!(
        page(&router, "/", &cookie, FACT_5).await,
        CUSTOM_INDEX,
        "{FACT_5}: class 5 means the UI renders"
    );
    let response = request(
        &router,
        "GET",
        &format!("/{}", ASSET.0),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "{FACT_5}: every asset 200s"
    );
    assert!(
        custom(&store, FACT_5).index_readable,
        "{FACT_5}: every file-level check passes"
    );

    let state = startup::discover(
        store.clone(),
        std::sync::Arc::new(crate::audit::Audit::journal_only()),
    )
    .await;
    let BundleState::Deactivated {
        generation,
        reasons,
        removed,
    } = &state
    else {
        panic!("{FACT_5}: an empty intersection must deactivate, got {state}");
    };
    assert_eq!(*generation, 1, "{FACT_5}");
    assert!(*removed, "{FACT_5}");
    // The distinct outcome, and both sets by name.
    assert_eq!(
        reasons,
        &vec![Reason::Incompatible {
            declared: vec!["v0".to_string()],
            served: SERVED_API_VERSIONS
                .iter()
                .map(|v| (*v).to_string())
                .collect(),
        }],
        "{FACT_5}"
    );
    assert!(
        store.bundle_dir(1).is_dir(),
        "{FACT_5}: deactivate is not delete"
    );

    one_documented_action(&router, &store, &cookie, FACT_5).await;

    Fact {
        id: FACT_5,
        class: 5,
        evidence: state.to_string(),
    }
}

// The suite, and the coverage assertion that makes its count mean anything

/// Every fact this suite must demonstrate, declared by identity.
///
/// Seven facts over five classes: §6.1 states class 2 in two shapes — *"a
/// bundle with no `index.html`, **or whose index is a directory**"* — and
/// class 4 has two different correct answers, which is the whole of its
/// asymmetry.
const EXPECTED_FACTS: [&str; 7] = [
    FACT_1,
    FACT_2_ABSENT,
    FACT_2_DIRECTORY,
    FACT_3,
    FACT_4_INDEX,
    FACT_4_ASSET,
    FACT_5,
];

/// §8.2 phase 4 acceptance 1: for **each** of §6.1's five classes, one
/// documented action reaches a working UI and one control there deactivates
/// the bundle — and the suite knows it exercised all five.
#[tokio::test]
async fn every_one_of_6_1s_five_classes_reaches_the_escape_and_is_deactivated_from_it() {
    let facts = [
        class_1_no_bundle_installed().await,
        class_2(FACT_2_ABSENT, |_| {}).await,
        class_2(FACT_2_DIRECTORY, |index| {
            fs::create_dir(index).expect("put a directory where the index was");
        })
        .await,
        class_3_digest_mismatch().await,
        class_4_unreadable_index().await,
        class_4_unreadable_inner_asset().await,
        class_5_no_common_api_version().await,
    ];

    // Coverage, part 1: the facts that ran, diffed against the facts declared.
    // Never a count — "7 passed" and "5 passed, 2 never ran" are the same
    // number, and only this diff can tell them apart.
    let expected: BTreeSet<&str> = EXPECTED_FACTS.into_iter().collect();
    let observed: BTreeSet<&str> = facts.iter().map(|fact| fact.id).collect();
    let missing: Vec<&&str> = expected.difference(&observed).collect();
    let unexpected: Vec<&&str> = observed.difference(&expected).collect();
    assert!(
        missing.is_empty() && unexpected.is_empty(),
        "§6.1 facts demonstrated: missing {missing:?}, unexpected {unexpected:?}"
    );

    // Coverage, part 2: §8.2 phase 4 counts **classes**, not facts, and asks
    // for all five. Derived from what ran, diffed the same way.
    let expected_classes: BTreeSet<u8> = (1..=5).collect();
    let covered: BTreeSet<u8> = facts.iter().map(|fact| fact.class).collect();
    let missing: Vec<&u8> = expected_classes.difference(&covered).collect();
    let unexpected: Vec<&u8> = covered.difference(&expected_classes).collect();
    assert!(
        missing.is_empty() && unexpected.is_empty(),
        "§6.1 classes exercised: missing {missing:?}, unexpected {unexpected:?}"
    );

    // Distinct outcomes: no two facts may rest on the same observation, or a
    // fact whose construction silently failed could pass for another's reason.
    // Reported by naming the collision, not by comparing lengths.
    let mut collisions = Vec::new();
    for (i, fact) in facts.iter().enumerate() {
        for other in &facts[i + 1..] {
            if fact.evidence == other.evidence {
                collisions.push(format!("{} and {}: {}", fact.id, other.id, fact.evidence));
            }
        }
    }
    assert!(
        collisions.is_empty(),
        "two facts rest on the same observation, so one could pass for the \
         other's reason: {collisions:?}"
    );
}

/// §6.1's negative control for class 5, and the reason it matters more here
/// than anywhere else in the document: *"An escape hatch that fires on the
/// wrong condition is worse than one that does not exist, because the operator
/// will trust it."*
///
/// A bundle declaring `["v0", "v1"]` intersects the served set in `v1` and
/// stays active through the real entry point. That rules out a check written
/// as set equality, or as "declared must be a subset of served".
///
/// One case this layer cannot rule out. §2.1's
/// dual-major case — a bundle matching only a served member that is *not*
/// `current` — needs a served set with more than one member, and this binary's
/// is `["v1"]` (`startup::SERVED_API_VERSIONS`). `startup::evaluate` takes the
/// set as a parameter for exactly this reason but is private to that module,
/// and `SERVED_API_VERSIONS` is the mechanism under test rather than something
/// this suite may edit. So the dual-major case is
/// `crate::startup::tests::a_bundle_matching_only_the_outgoing_major_stays_active`,
/// which constructs `["v1", "v2"]` with `current` = `v2` and asserts the
/// bundle survives — cited here rather than restated in a weaker form.
#[tokio::test]
async fn a_bundle_that_intersects_the_served_set_is_not_deactivated() {
    let manifest = r#"{"name":"demo","version":"1.0",
        "immutableDir":"assets","apiVersions":["v0","v1"]}"#;
    let bundle = install_declaring(
        &[("index.html", CUSTOM_INDEX), ("mos-ui.json", manifest)],
        SERVED_API_VERSIONS,
    );
    let store = Store::new(bundle.path());

    let state = startup::discover(
        store.clone(),
        std::sync::Arc::new(crate::audit::Audit::journal_only()),
    )
    .await;
    assert!(
        matches!(state, BundleState::Active { generation: 1, .. }),
        "a non-empty intersection is not a deactivation trigger, however \
         partial; got {state}"
    );
    assert_eq!(active(&store), Some(1));

    // And it is still the bundle that answers `/`, which is what "stays
    // active" is worth to an operator.
    let (router, cookie) = signed_in(bundle.path()).await;
    assert_eq!(
        page(&router, "/", &cookie, "the intersecting bundle").await,
        CUSTOM_INDEX
    );
}
