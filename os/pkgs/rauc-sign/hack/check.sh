#!/usr/bin/env bash
# The gate for this workspace. It exists because `rauc-sign` is no longer a
# member of the mosd workspace: PLAN-019 M3 gave it its own `[workspace]`, and
# from that moment `cargo clippy --workspace` and `cargo nextest run --workspace`
# run from mosd/ stopped reaching this crate. Without this script the code would
# ship unchecked with every other gate still green.
#
# Deliberately a line-for-line twin of mosd/hack/check.sh, in the same order.
# Two gate definitions that differ only in where they run should read as the
# same gate; a divergence should be visible as a diff, not hidden in phrasing.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo nextest run --workspace --locked

# `cargo nextest` does not execute doctests, so this is not a duplicate of the
# line above: without it, a broken doctest passes the gate silently.
cargo test --doc --workspace --locked
cargo deny check licenses bans advisories

echo "ALL CHECKS PASSED"
