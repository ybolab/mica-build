#!/usr/bin/env bash
# Cross-build the mosd and webd release binaries for aarch64 (Debian bookworm
# rootfs). Needs the aarch64-unknown-linux-gnu rust target and
# aarch64-linux-gnu-gcc (linker configured in mosd/.cargo/config.toml).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

cargo build --release --locked --target aarch64-unknown-linux-gnu -p mosd -p webd

for name in mosd webd; do
    BIN="$(pwd)/target/aarch64-unknown-linux-gnu/release/$name"
    if ! file -b "$BIN" | grep -q 'ELF 64-bit.*aarch64'; then
        echo "error: $BIN is not an aarch64 ELF: $(file -b "$BIN")" >&2
        exit 1
    fi
    echo "$BIN"
done
