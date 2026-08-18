#!/usr/bin/env bash
# Cross-build the mosd release binary for aarch64 (Debian bookworm rootfs).
# Needs the aarch64-unknown-linux-gnu rust target and aarch64-linux-gnu-gcc
# (linker configured in mosd/.cargo/config.toml).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

cargo build --release --locked --target aarch64-unknown-linux-gnu -p mosd

BIN="$(pwd)/target/aarch64-unknown-linux-gnu/release/mosd"
if ! file -b "$BIN" | grep -q 'ELF 64-bit.*aarch64'; then
    echo "error: $BIN is not an aarch64 ELF: $(file -b "$BIN")" >&2
    exit 1
fi
echo "$BIN"
