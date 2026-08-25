#!/usr/bin/env bash
# Cross-build mosd, apid, mos-mqttd and mos-mqtt-broker for one Rust target
# and verify the ELF.
#
#   bash mosd/hack/build-target.sh <rust-target> <elf-arch-substring>
#   bash mosd/hack/build-target.sh aarch64-unknown-linux-gnu aarch64
#   bash mosd/hack/build-target.sh x86_64-unknown-linux-gnu  x86-64
#
# The ELF check is per binary, not just the first: a target that silently
# produced a host-arch artifact for ONE crate would otherwise ship and fail at
# exec time on the device -- which is the same class of failure as building the
# wrong architecture entirely, but reported one binary later.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

TARGET="${1:?usage: build-target.sh <rust-target> <elf-arch>}"
ELF_ARCH="${2:?usage: build-target.sh <rust-target> <elf-arch>}"

cargo build --release --locked --target "${TARGET}" \
    -p mosd -p apid -p mos-mqttd -p mos-mqtt-broker

for name in mosd apid mos-mqttd mos-mqtt-broker; do
    BIN="$(pwd)/target/${TARGET}/release/${name}"
    if ! file -b "${BIN}" | grep -c "ELF 64-bit.*${ELF_ARCH}" >/dev/null; then
        echo "error: ${BIN} is not an ${ELF_ARCH} ELF: $(file -b "${BIN}")" >&2
        exit 1
    fi
    echo "${BIN}"
done
