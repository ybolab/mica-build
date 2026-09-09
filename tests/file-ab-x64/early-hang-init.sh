#!/bin/bash
# Build a signed-fixture init that hangs after the production watchdog arm.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
out=$(realpath "${1:?existing output directory required}")
arch=${2:?architecture required}
case "$arch" in amd64) target=x86_64-unknown-linux-gnu;; arm64) target=aarch64-unknown-linux-gnu;; *) exit 1;; esac
test ! -e "$out/source"
mkdir "$out/source"
cp pkgs/mos-deploy/Cargo.toml pkgs/mos-deploy/Cargo.lock "$out/source/"
cp -a pkgs/mos-deploy/src "$out/source/src"
python3 - "$out/source/src/bin/mos-init.rs" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); source=p.read_text()
marker='    eprintln!("mos-init: boot watchdog armed");'
assert source.count(marker)==1
p.write_text(source.replace(marker, marker+'''
    if std::process::id() == 1 {
        eprintln!("FILE_AB_EARLY_HANG_TRIGGER: before SYSTEM and systemd");
        loop { std::thread::sleep(std::time::Duration::from_millis(10)); }
    }
'''))
PY
image=$(bash build-env/from.sh --arch=amd64 --ref LOCAL_MOS_BUILD_RUST)
timeout -k 20 1200 docker run --rm --label ai-agent=true --network traefik \
    -v "$out:/w" -v "$PWD/_out/cargo/registry:/usr/local/cargo/registry" \
    -v "$PWD/_out/cargo/git:/usr/local/cargo/git" -w /w/source \
    -e CARGO_TARGET_DIR=/w/target --entrypoint /bin/bash "$image" \
    -c 'set -euo pipefail; cargo build --release --locked --target "$1" --bin mos-init; cp "/w/target/$1/release/mos-init" /w/mos-init' _ "$target"
test -s "$out/mos-init"
echo "FILE_AB_EARLY_HANG_INIT_READY: $arch"
