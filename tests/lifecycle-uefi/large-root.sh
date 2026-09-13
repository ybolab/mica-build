#!/bin/bash
# Compare fresh small/large complete systems; measure without reading the added payload at boot.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
root=${1:?current composed root required}
kernel=${2:?BSP kernel directory required}
certificate=${3:?content certificate required}
key=${4:?content key required}
init=${5:?compiled mica-init required}
shutdown=${6:?compiled mica-shutdown required}
work=$(mktemp -d "$PWD/_out/large-root.XXXXXX")
printf 'Evidence: %s\n' "$work"
bash tests/lifecycle-uefi/runtime-build.sh "$root" "$kernel" "$certificate" "$key" "$init" x64 "$shutdown" > "$work/small-build.log" 2>&1
small=$(tail -1 "$work/small-build.log")
mkdir "$work/tree"
docker run --rm --label ai-agent=true --network traefik -v "$work:/w" -v "$root:/root.img:ro" \
    ai-agent/mos-p2-lab unsquashfs -no-progress -f -d /w/tree /root.img > "$work/extract.log"
python3 - "$work/tree/usr/share/mica/large-root.dat" <<'PY'
import hashlib, sys
with open(sys.argv[1], 'xb') as output:
    for counter in range(384):
        output.write(hashlib.shake_256(b'mos-large-root-acceptance' + counter.to_bytes(4, 'little')).digest(1048576))
PY
docker run --rm --label ai-agent=true --network traefik -v "$work:/w" \
    ai-agent/mos-p2-lab mksquashfs /w/tree /w/large-source.img -noappend -all-root -comp zstd -no-progress > "$work/pack.log"
bash tests/lifecycle-uefi/runtime-build.sh "$work/large-source.img" "$kernel" "$certificate" "$key" "$init" x64 "$shutdown" > "$work/large-build.log" 2>&1
large=$(tail -1 "$work/large-build.log")
for size in small large; do
    evidence=${!size}
    for iteration in 1 2 3; do
        cp --reflink=auto --sparse=always "$evidence/image/factory-disk.img" "$evidence/image/disk.img"
        log="$work/$size-$iteration.log"
        timeout -k 10 330 docker run --rm --label ai-agent=true --network traefik \
            -v "$evidence:/w" -v "$PWD/tests/lifecycle-uefi:/harness:ro" \
            ai-agent/mos-p2-lab python3 /harness/timed-boot.py bash /harness/boot.sh image/disk.img writable 300 x64 > "$log" 2>&1
        grep -F FILE_AB_RUNTIME_PASS "$log"
        bash tests/lifecycle-uefi/shutdown-check.sh "$log"
        python3 tests/lifecycle-uefi/metrics.py "$log" > "$work/$size-$iteration.json"
    done
done
python3 - "$work" "$small" "$large" <<'PY'
import json, statistics, sys
from pathlib import Path
work, small, large = map(Path, sys.argv[1:])
result = {}
for name, fixture in [('small', small), ('large', large)]:
    runs = [json.loads((work/f'{name}-{n}.json').read_text()) for n in [1, 2, 3]]
    result[name] = {'rootImageBytes': (fixture/'root/rootfs.img').stat().st_size,
                    'medianEarlyInitMs': statistics.median(r['earlyInitElapsedMs'] for r in runs),
                    'medianRuntimeAcceptanceWallMs': statistics.median(r['runtimeAcceptanceWallMs'] for r in runs),
                    'maxEarlyInitRssKiB': max(r['earlyInitPeakRssKiB'] for r in runs), 'runs': runs,
                    'fixture': str(fixture)}
assert result['large']['rootImageBytes'] > result['small']['rootImageBytes'] + 350 * 1048576
(work/'measurements.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
PY
echo 'FILE_LARGE_ROOT_METRICS_PASS'
