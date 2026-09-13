#!/bin/bash
# Build a signed-fixture init that hangs after the production watchdog arm.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
out=$(realpath "${1:?existing output directory required}")
arch=${2:?architecture required}
case "$arch" in amd64) target=x86_64-unknown-linux-gnu;; arm64) target=aarch64-unknown-linux-gnu;; *) exit 1;; esac
test ! -e "$out/source"
mkdir "$out/source"
# The source the pinned mica-lifecycle archives were built from, checked out
# at the locked commit: the fault variant differs from the shipped mica-init
# by one injected hang and nothing else.
bash build-env/deb/source.sh mica-deploy
src=_out/src/mica-deploy
cp "$src/Cargo.toml" "$src/Cargo.lock" "$out/source/"
cp -a "$src/src" "$out/source/src"
cp -a "$src/lifecycle-sys" "$out/source/lifecycle-sys"
cp -a "$src/tests" "$out/source/tests"
python3 - "$out/source/src/bin/mica-init.rs" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); source=p.read_text()
marker='    eprintln!("mica-init: boot watchdog armed");'
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
    -c 'set -euo pipefail; cargo build --release --locked --target "$1" --bin mica-init --config "target.$1.rustflags=[\"-C\",\"target-feature=+crt-static\",\"-C\",\"strip=symbols\"]"; cp "/w/target/$1/release/mica-init" /w/mica-init' _ "$target"
test -s "$out/mica-init"
echo "FILE_AB_EARLY_HANG_INIT_READY: $arch"
