#!/usr/bin/env python3
"""Verify frozen package inputs before a composition-only source successor."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
# These consumers are outside producer contexts, workspaces and build helpers.
# A whole-tree delta check protects their transitive package inputs as well.
COMPOSITION_PATHS = frozenset({
    'rootfs/build.sh', 'rootfs/runtime/source-lineage.py',
    'rootfs/runtime/compose.py', 'rootfs/compose/90-pack.Dockerfile',
    'rootfs/compose/compose-capture.sh', 'rootfs/compose/compose-install.sh',
    'build/src/release-manifest.ts', 'build/src/release-manifest.test.ts',
    'tests/rootfs-runtime/source_lineage_test.py', 'tests/rootfs-runtime/composition_test.py',
    'tests/deb-package-gate.sh',
    'rootfs/runtime/select.py', 'tests/rootfs-runtime/selection_test.py',
    'rootfs/runtime/consumers.json',
    'rootfs/debian/packages/dmsetup.json', 'rootfs/debian/packages/libdevmapper1.02.1.json',
    'docs/task/20260911-0145-b7-fresh-lifecycle-acceptance.md',
    'docs/plan/20260911-0145-b7-fresh-lifecycle-acceptance.md',
})

# One reviewed producer transition, not a caller-extensible reuse policy.
JOIN_ORIGINAL = dict(commit='e176876b733d675d1e20b40b42628cd4e18b197d',
                     tree='7e8e8bc62b52f3d78263d717e186a07f0d3430a1', epoch=1789097968,
                     version='0.1.0+gite176876b733d-1')
JOIN_REBUILT = dict(commit='fb6c4597bb902f69d528bcdc3c8372f310c322b1',
                    tree='cbf2fa8ff2c8fc03534b218c952a511b6a6ba392', epoch=1789157855,
                    version='0.1.0+gitfb6c4597bb90-1')
JOIN_LEGACY_COMPOSITION = dict(commit='fdf8a480057b64073c9b9e15e399fca1b38d607d',
                               tree='7eed91c48aa9a00fc75d8661260aac78a004c00e', epoch=1789162665)
JOIN_DELTA_SHA = '25a8aa2051a6c6cc968554828a50a875781f9d5076f48127e2d295ab2110cbf1'
JOIN_POOL_SHA = 'de26c7fd9d4e5b76ae10aa166659e2d047ede56088a79fd46024fb419a5b4087'
JOIN_PRODUCTION_SHA = '3f1fe46df0aa7d686616288b655119baeccba12589951e121321388aa45f3f58'
JOIN_INPUTS_SHA = '3fa9b2060d685c5e4f0beeed48ef4045621ccf1fb94344f800aab0e2ea4cae3e'
JOIN_RECEIPTS = dict(original='fc79903fcd6dc8bf40191c5f4cdf4979d664dfd0315a53521d57af821f80d166',
                     native='175f2dbe31b08bde91f8cf5a15680c9ec7fb38d6c2e0bda46edff5f24e558d09',
                     deploy='267dff5433d4bc2b2a409a06e3019fd0f680f449c4866d60f8b3353b237a4683')
JOIN_NATIVE = {
    'mos-init': dict(bytes=1673848, sha256='738391aa650a58fb3819f52831f6affd57ddd17e357c2a161faaf39d800ec642'),
    'mos-shutdown': dict(bytes=2047144, sha256='d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35'),
}
JOIN_DEPLOY_SHA = '5c86a35df5ce3a495fdd8390f40a6e3d099fac4f10346e53783481ccda281168'
JOIN_DEPLOY_CONTROL = '43440d0b43a9e2ab31b1a9940dc072d5f83cc088bd5e0675089e61dd141f84b2'
JOIN_CONSUMERS = frozenset({
    'rootfs/runtime/consumers.json',
    'rootfs/runtime/source-lineage.py', 'rootfs/build.sh', 'build/src/release-manifest.ts',
    'tests/deb-package-gate.sh', 'tests/rootfs-runtime/source_lineage_test.py',
    'tests/rootfs-runtime/composition_test.py', 'build/src/release-manifest.test.ts',
    'docs/task/20260911-0145-b7-fresh-lifecycle-acceptance.md',
    'docs/plan/20260911-0145-b7-fresh-lifecycle-acceptance.md',
})


# This separately reviewed tool producer is not a composition-only exception.
BOOT_SOURCE = dict(commit='4716a2b2020737559fa8798c01fb37e3900ec6e6',
                   tree='cf419477827eb9441ad9c26eb4d18cbd5b303b30', epoch=1789163851)
BOOT_DELTA_SHA = '7980a20a82e540338b76dbd0eaf6ac99001aec6dc6545a8ac4ea99446a7aaf76'
BOOT_RECEIPT_SHA = 'af5bc012346a99d360612a1340df58de35265b9a7cc638d2286401b2a3ab7112'
BOOT_RESULT_SHA = 'd7acc26c71a82faf763e7fa36e564184cb5b95027a2a059af688746f709319b2'
BOOT_ROLE_SHA = 'a893b517c2a249afed8d34d323e6f5148aa55ec353c9956f5e422766d516b664'
BOOT_PRODUCER_PATHS = frozenset({'pkgs/mos-boot/build-tools.sh', 'pkgs/mos-boot/Dockerfile'})
BOOT_DIRECT_TEST = 'tests/boot-busybox-package-test.sh'


def require(ok: bool, message: str) -> None:
    if not ok:
        raise ValueError('source lineage: ' + message)


def keys(value: object, names: str) -> dict:
    require(isinstance(value, dict) and set(value) == set(names.split()), 'unknown or missing fields')
    return value


def pairs(items: list) -> dict:
    result = {}
    for key, value in items:
        require(key not in result, 'duplicate key: ' + key)
        result[key] = value
    return result


def load(path: Path) -> object:
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16 * 1024 * 1024, 'bounded regular input required')
    return json.loads(path.read_text(), object_pairs_hook=pairs)


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def hex_id(value: str, length: int = 64) -> str:
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(length) + '}', value), 'malformed digest')
    return value


def relative(value: str) -> str:
    require(isinstance(value, str) and value and not value.startswith('/')
            and all(p not in ('', '.', '..') for p in value.split('/'))
            and not re.search(r'[\x00-\x1f\x7f]', value), 'unsafe relative path')
    return value


def natural(value: int) -> None:
    require(type(value) is int and 0 <= value <= 0xffffffff, 'invalid epoch')


def command(args: list, cwd: Path | None = None) -> bytes:
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.PIPE, timeout=60, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


def git(root: Path, *args: str) -> bytes:
    return command(['git', '-C', str(root), *args])


def tree(root: Path, commit: str) -> dict:
    result = {}
    for entry in git(root, 'ls-tree', '-rz', commit).split(b'\0'):
        if entry:
            header, name = entry.split(b'\t', 1)
            mode, kind, blob = header.decode().split()
            require(kind == 'blob' and mode in ('100644', '100755', '120000'), 'unsupported Git object')
            result[name.decode()] = dict(mode=mode, blob=blob)
    return result


def identity(root: Path) -> tuple[dict, dict]:
    require(root.is_dir(), 'source checkout missing')
    require(not git(root, 'status', '--porcelain', '--untracked-files=all'), 'dirty source checkout')
    commit = git(root, 'rev-parse', 'HEAD').decode().strip()
    entries = tree(root, commit)
    for name, entry in entries.items():
        path = root / name
        require(path.parent.resolve().is_relative_to(root.resolve()), 'checkout parent escapes source')
        info = path.lstat()
        mode = '120000' if stat.S_ISLNK(info.st_mode) else ('100755' if info.st_mode & 0o111 else '100644')
        require(stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode), 'unsupported checkout node')
        data = os.readlink(path).encode() if mode == '120000' else path.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        require(dict(mode=mode, blob=blob) == entry, 'checkout bytes/mode changed: ' + name)
    return dict(commit=hex_id(commit, 40), tree=hex_id(git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(), 40),
                epoch=int(git(root, 'show', '-s', '--format=%ct', 'HEAD'))), entries


def delta(package_root: Path, composition_root: Path, package: dict, composition: dict, before: dict, after: dict) -> list:
    command(['git', '-C', str(composition_root), 'merge-base', '--is-ancestor', package['commit'], composition['commit']])
    changes = []
    for path in sorted(before.keys() | after.keys()):
        if before.get(path) != after.get(path):
            require(path in COMPOSITION_PATHS, 'package-relevant source changed: ' + path)
            require(after.get(path) is not None and after[path]['mode'] in ('100644', '100755')
                    and (before.get(path) is None or before[path]['mode'] == after[path]['mode']),
                    'composition file deletion/type/mode changed: ' + path)
            changes.append(dict(path=path, before=before.get(path), after=after.get(path)))
    # Producer primary/named COPY contexts must not acquire a permitted path.
    # Native hooks consume pkgs/ and build-env/, which the policy never permits.
    contexts = ['pkgs', 'build-env', 'rootfs/overlay']
    for path in before:
        if path.endswith('/producer.env'):
            contexts.append(str(Path(path).parent))
            text = (package_root / path).read_text()
            for value in re.findall(r'^BUILD_CONTEXTS="([^"]*)"$', text, re.M):
                contexts.extend(token.split('=', 1)[1] for token in value.split())
    for change in changes:
        require(not any(c == '.' or change['path'] == c or change['path'].startswith(c.rstrip('/') + '/') for c in contexts),
                'composition path enters producer context: ' + change['path'])
    return changes


def pool_identity(pool: Path, arch: str, version: str | dict) -> dict:
    require(arch in ('amd64', 'arm64'), 'invalid architecture')
    files = {p.relative_to(pool).as_posix(): sha(p) for p in sorted(pool.glob('pool/*.deb'))}
    require(files, 'empty pool')
    for name in ('Packages', 'SHA256SUMS', 'manifest.txt'):
        require((pool / name).is_file() and not (pool / name).is_symlink(), 'missing pool index')
        files[name] = sha(pool / name)
    sums = {}
    for line in (pool / 'SHA256SUMS').read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (pool/[^/]+\.deb)', line)
        require(match is not None and match[2] not in sums, 'invalid or duplicate pool checksum')
        sums[match[2]] = match[1]
    require(sums == {k: v for k, v in files.items() if k.startswith('pool/')}, 'archive checksum membership')
    packages = []
    indexed = {}
    for paragraph in (pool / 'Packages').read_text().strip().split('\n\n'):
        fields = {}
        key = None
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')):
                if isinstance(version, dict):
                    require(key is not None, 'joined index continuation')
                    fields[key] += '\n' + line
                continue
            key, value = line.split(': ', 1)
            require(key not in fields, 'duplicate package index field')
            fields[key] = value
        name = fields['Filename']
        require(name in sums and name not in indexed and fields['SHA256'] == sums[name], 'package index digest/membership')
        indexed[name] = fields
    require(set(indexed) == set(sums), 'package index archive set')
    manifest = []
    for line in (pool / 'manifest.txt').read_text().splitlines():
        if line and not line.startswith('#'):
            manifest.append(line.split('\t'))
    for name in sorted(sums):
        archive = pool / name
        require(archive.is_file() and not archive.is_symlink(), 'regular archive required')
        require(archive.stat().st_mtime_ns <= (pool / 'manifest.txt').stat().st_mtime_ns, 'stale pool index')
        control = command(['dpkg-deb', '--ctrl-tarfile', str(archive)])
        fields = command(['dpkg-deb', '-f', str(archive), 'Package', 'Version', 'Architecture']).decode().splitlines()
        parsed = dict(line.split(': ', 1) for line in fields)
        p, v, a = (parsed[k] for k in ('Package', 'Version', 'Architecture'))
        expected_version = version
        if isinstance(version, dict):
            require(p in version, 'unwitnessed package membership')
            expected_version = version[p]
        require(a in (arch, 'all') and v.rsplit('+', 1)[-1] == expected_version.rsplit('+', 1)[-1], 'architecture or package stamp')
        require(all(indexed[name][k] == parsed[k] for k in parsed), 'archive control/index mismatch')
        if isinstance(version, dict):
            # A forged Depends in Packages must not disagree with the real
            # archive merely because Package/Version/Architecture still agree.
            raw_control = command(['dpkg-deb', '-f', str(archive)]).decode()
            actual_fields = {}
            key = None
            for line in raw_control.splitlines():
                if line.startswith((' ', '\t')):
                    require(key is not None, 'joined control continuation')
                    actual_fields[key] += '\n' + line
                elif line:
                    key, value = line.split(': ', 1)
                    require(key not in actual_fields, 'duplicate joined archive control field')
                    actual_fields[key] = value
            index_fields = {k: v for k, v in indexed[name].items() if k not in ('Filename', 'Size', 'MD5sum', 'SHA1', 'SHA256')}
            require(index_fields == actual_fields, 'joined archive control/index fields')

        require(sum(len(row) == 6 and row[:3] == [p, v, a] and row[4:] == [sums[name], name] for row in manifest) == 1, 'manifest/control membership')
        packages.append(dict(package=p, version=v, architecture=a, archive=name, sha256=sums[name],
                             control_sha256=hashlib.sha256(control).hexdigest()))
    require(len(manifest) == len(packages) and len({p['package'] for p in packages}) == len(packages), 'mixed/duplicate pool')
    if isinstance(version, dict):
        require({p['package'] for p in packages} == set(version), 'witness package membership')
    return dict(files=dict(sorted(files.items())), packages=packages)


def frozen_receipt(path: Path | None, expected: str | None, root: Path, source: dict, entries: dict, arch: str, pool: dict) -> list:
    require(path is not None and expected is not None, 'explicit package source requires frozen receipt and SHA256')
    require(sha(path) == hex_id(expected), 'frozen receipt digest changed')
    receipt = keys(load(path), 'schema source architecture inputs tools files native evidence')
    require(receipt['schema'] == 'mos/package-inputs/v1' and receipt['source'] == source and receipt['architecture'] == arch,
            'frozen receipt source/version/epoch/architecture')
    require(receipt['files'] == pool['files'], 'frozen pool bytes changed')
    require(isinstance(receipt['inputs'], dict) and receipt['inputs'], 'missing producer input receipts')
    for name, row in receipt['inputs'].items():
        relative(name); keys(row, 'mode blob sha256')
        require(name in entries and {k: row[k] for k in ('mode', 'blob')} == entries[name]
                and sha(root / name) == hex_id(row['sha256']), 'producer input changed: ' + name)
    require('build-env/deb/version.sh' in receipt['inputs'] and 'build-env/images.env' in receipt['inputs'], 'missing version/tool inputs')
    require(isinstance(receipt['evidence'], list) and receipt['evidence'], 'missing frozen producer evidence')
    witnessed = set()
    input_hashes = {}
    native_hashes = set()
    witnessed_tools = {}
    for row in receipt['evidence']:
        keys(row, 'path sha256'); at = Path(row['path'])
        require(sha(at) == hex_id(row['sha256']), 'producer evidence changed')
        record = load(at)
        require(record.get('sourceCommit') == source['commit'] and record.get('sourceTree') == source['tree'], 'producer evidence source')
        require(record.get('packageVersion', source['version']) == source['version'], 'producer evidence version')
        for name, digest in record.get('inputFileSha256', {}).items():
            require(name not in input_hashes or input_hashes[name] == digest, 'conflicting producer inputs')
            input_hashes[name] = digest
        native_hashes.update(item['sha256'] for item in record.get('nativeOutputs', []))
        tools = list(record.get('toolInputs', {}).values())
        if 'packageTool' in record:
            tools.append(record['packageTool'])
        for tool in tools:
            image = tool.get('id', tool.get('imageId'))
            if image is None:
                require(re.search(r'@sha256:[a-f0-9]{64}$', tool['ref']), 'unpinned producer tool')
                actual = json.loads(command(['docker', 'image', 'inspect', tool['ref']]))
                require(len(actual) == 1 and actual[0]['Architecture'] == tool['architecture'], 'pinned tool platform')
                image = actual[0]['Id']
            witnessed_tools[image] = tool['architecture']
        for key in ('outputs', 'packageOutputs', 'poolIntegrity-after', 'indexOutputs', 'nativeOutputs'):
            for item in record.get(key, []):
                witnessed.add(item['sha256'])
    require(isinstance(receipt['tools'], list) and receipt['tools'], 'missing actual tools')
    seen_tools = {}
    for row in receipt['tools']:
        keys(row, 'id architecture'); require(re.fullmatch(r'sha256:[a-f0-9]{64}', row['id']) is not None, 'immutable tool identity')
        require(row['id'] not in seen_tools, 'duplicate tool')
        actual = json.loads(command(['docker', 'image', 'inspect', row['id']]))
        require(len(actual) == 1 and actual[0]['Id'] == row['id'] and actual[0]['Architecture'] == row['architecture'], 'actual tool identity changed')
        seen_tools[row['id']] = row['architecture']
    require(seen_tools == witnessed_tools, 'tool set differs from producer evidence')
    require({name: row['sha256'] for name, row in receipt['inputs'].items()} == input_hashes, 'unwitnessed or omitted producer inputs')
    require(set(pool['files'].values()) <= witnessed, 'pool not in frozen producer outputs')
    require(isinstance(receipt['native'], list) and receipt['native'], 'missing native receipts')
    require({Path(row['path']).name for row in receipt['native']} == {'mos-init', 'mos-shutdown'}
            and len(receipt['native']) == 2 and {row['sha256'] for row in receipt['native']} == native_hashes, 'native receipt set')
    for row in receipt['native']:
        keys(row, 'path sha256')
        require(sha(Path(row['path'])) == hex_id(row['sha256']) and row['sha256'] in witnessed, 'native bytes changed')
    return [expected]


def producer_inputs(root: Path, entries: dict) -> dict:
    """The reviewed primary/named contexts plus native PREPARE call chains."""
    hooks = {'deploy': 'pkgs/mos-deploy', 'mosd': 'pkgs/mosd', 'mqtt': 'pkgs/mosd',
             'podman': 'pkgs/podman', 's905x5m-bluetooth': 'boards/s905x5m'}
    result = {}
    for path in sorted(entries):
        if not path.endswith('/producer.env'):
            continue
        producer = Path(path).parent.name
        text = (root / path).read_text()
        contexts = [str(Path(path).parent), 'build-env', 'Makefile']
        for value in re.findall(r'^BUILD_CONTEXTS="([^"\n]*)"$', text, re.M):
            contexts.extend(relative(token.split('=', 1)[1]) for token in value.split())
        prepare = re.findall(r'^PREPARE="([^"\n]*)"$', text, re.M)
        require(len(prepare) <= 1, 'duplicate PREPARE')
        if prepare:
            require(producer in hooks and prepare == ['prepare.sh'], 'unreviewed PREPARE hook')
            contexts.append(hooks[producer])
        inputs = {name: row for name, row in entries.items()
                  if any(c == '.' or name == c or name.startswith(c + '/') for c in contexts)
                  or (name.startswith('pkgs/mosd/') and name.endswith('/Cargo.toml'))}
        require(inputs and path in inputs, 'empty producer inputs')
        result[producer] = dict(contexts=sorted(set(contexts)), prepare=prepare,
                                inputs=inputs, packages=re.findall(r'^PACKAGES="([^"\n]+)"$', text, re.M))
    require(len(result) == 15, 'reviewed producer set changed')
    return result


def join_delta(original_root: Path, rebuilt_root: Path, original: dict, rebuilt: dict,
               before: dict, after: dict) -> tuple[list, dict]:
    require(original == JOIN_ORIGINAL and rebuilt == JOIN_REBUILT, 'unreviewed producer sources')
    command(['git', '-C', str(rebuilt_root), 'merge-base', '--is-ancestor', original['commit'], rebuilt['commit']])
    changes = [dict(path=name, before=before.get(name), after=after.get(name))
               for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)]
    require(hashlib.sha256(canonical(changes)).hexdigest() == JOIN_DELTA_SHA, 'unreviewed producer delta')
    old_inputs, new_inputs = producer_inputs(original_root, before), producer_inputs(rebuilt_root, after)
    require(old_inputs.keys() == new_inputs.keys(), 'producer membership changed')
    proofs = {}
    changed_producers = set()
    for name, old in old_inputs.items():
        new = new_inputs[name]
        if old != new:
            changed_producers.add(name)
        for consumer in JOIN_CONSUMERS:
            require(consumer not in old['inputs'] and consumer not in new['inputs'], 'joined consumer enters PREPARE/context')
        proofs[name] = dict(source_commit=rebuilt['commit'] if name == 'deploy' else original['commit'],
                            before_sha256=hashlib.sha256(canonical(old)).hexdigest(),
                            after_sha256=hashlib.sha256(canonical(new)).hexdigest())
    require(changed_producers == {'deploy'}, 'unreviewed changed producer/PREPARE/context')
    # Assembly consumers and test/history changes belong to the reviewed delta,
    # but do not masquerade as package compiler inputs.
    for row in changes:
        path = row['path']
        require(path.startswith(('pkgs/mos-deploy/', 'tests/', 'docs/')) or path in COMPOSITION_PATHS
                or path in ('build/src/kernel-package.ts', 'build/src/kernel-payload.test.ts', 'pkgs/mos-boot/initramfs.sh'),
                'unattributed reviewed delta')
    return changes, proofs


def rebuilt_witness(path: Path, kind: str, root: Path, entries: dict) -> dict:
    # The fixed receipt digest identifies the reviewed execution; source, steps,
    # tools, input objects and actual output bytes still have to verify below.
    require(sha(path) == JOIN_RECEIPTS[kind], 'unreviewed or mutated producer witness')
    value = load(path)
    require(value['status'] == 'success' and value['exitCode'] == 0 and value['finishedAt']
            and value['activePid'] is None and value['activeStep'] is None, 'failed/incomplete producer witness')
    require(value['verifiedSource'] == {k: JOIN_REBUILT[k] for k in ('commit', 'tree', 'epoch')}
            and value['sourceCommit'] == JOIN_REBUILT['commit'] and value['sourceTree'] == JOIN_REBUILT['tree']
            and value['version'] == JOIN_REBUILT['version'] and value['sourceEpoch'] == JOIN_REBUILT['epoch'],
            'producer witness source/version/epoch')
    require(value['environment']['SOURCE_DATE_EPOCH'] == str(JOIN_REBUILT['epoch']), 'producer epoch input')
    expected = (['bash', 'pkgs/mos-deploy/hack/build-deb.sh', '--producer', 'boot', '--bins',
                 'mos-init mos-shutdown', '--arch', 'amd64', '--stage', value['outputDirectory']]
                if kind == 'native' else ['bash', 'build-env/deb/build.sh', '--producer', 'deploy', '--arch', 'amd64'])
    step_name = 'native-build' if kind == 'native' else 'deploy-build'
    require(sum(s['name'] == step_name and s['argv'] == expected and s['exitCode'] == 0 for s in value['steps']) == 1,
            'producer command/target/membership')
    for s in value['steps']:
        require(sha(Path(s['log'])) == hex_id(s['logSha256']), 'producer step log changed')
    if 'preparationReceipt' in value:
        require(sha(Path(value['preparationReceipt']['path'])) == hex_id(value['preparationReceipt']['sha256']), 'producer preparation evidence')
    for key in ('runner', 'wrapper'):
        require(sha(Path(value[key]['path'])) == hex_id(value[key]['sha256']), 'producer invocation bytes changed')
    tools = [value['toolIdentity']] if kind == 'native' else [value['tool-rust'], value['tool-deb']]
    for tool in tools:
        actual = json.loads(command(['docker', 'image', 'inspect', tool['id']]))
        require(len(actual) == 1 and actual[0]['Id'] == tool['id'] and actual[0]['Architecture'] == tool['architecture'] == 'amd64',
                'producer actual tool identity')
    for row in value.get('sourceInputs', []):
        relative_path = Path(row['path']).relative_to(value['sourceDirectory']).as_posix()
        require(relative_path in entries and sha(root / relative_path) == hex_id(row['sha256']), 'producer input bytes')
    outputs = value['outputs'] if kind == 'native' else value['packageOutputs']
    require(len(outputs) == (2 if kind == 'native' else 1), 'unexpected producer output membership')
    for row in outputs:
        at = Path(row['path']); info = at.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_size == row['bytes'] and sha(at) == hex_id(row['sha256']), 'producer output bytes')
        if kind == 'native':
            require(at.name in JOIN_NATIVE and {k: row[k] for k in ('bytes', 'sha256')} == JOIN_NATIVE[at.name]
                    and stat.S_IMODE(info.st_mode) == 0o755, 'native output identity/mode')
    if kind == 'native':
        require({Path(r['path']).name for r in outputs} == set(JOIN_NATIVE), 'missing native output')
    else:
        require(outputs[0]['sha256'] == JOIN_DEPLOY_SHA, 'rebuilt deploy output')
    return value


def production_identity(root: Path, entries: dict, native: dict, deploy: dict) -> dict:
    names = ['pkgs/mos-deploy/hack/build-deb.sh', 'pkgs/mos-deploy/Cargo.lock', 'pkgs/mos-deploy/Cargo.toml',
             'pkgs/mos-deploy/deb/deploy/producer.env', 'pkgs/mos-deploy/deb/deploy/prepare.sh',
             'pkgs/mos-deploy/deb/deploy/Dockerfile', 'build-env/from.sh', 'build-env/images.env']
    return dict(architecture='amd64', target='x86_64-unknown-linux-gnu',
                source=JOIN_REBUILT, epoch_input=JOIN_REBUILT['epoch'],
                inputs={name: dict(entries[name], sha256=sha(root / name)) for name in names},
                tools={'native': native['toolIdentity']['id'], 'deploy': deploy['tool-rust']['id'], 'packaging': deploy['tool-deb']['id']},
                native_bins=['mos-init', 'mos-shutdown'], deploy_bins=['mos-deploy'],
                cargo_flags=['--release', '--locked', '--target', 'x86_64-unknown-linux-gnu'],
                shutdown_target_flags=['-C', 'target-feature=+crt-static', '-C', 'strip=symbols'])


def validate_boot_role(role: dict) -> dict:
    keys(role, 'schema source approved_delta inputs unchanged_producers_sha256 source_readiness_sha256 receipt_sha256 production')
    require(hashlib.sha256(canonical(role)).hexdigest() == BOOT_ROLE_SHA,
            'boot-tools reviewed producer/source/input/output witness')
    require(role['receipt_sha256'] == BOOT_RECEIPT_SHA, 'boot-tools receipt')
    return role


def boot_witness(root: Path, rebuilt_root: Path, middle: dict, path: Path) -> tuple[dict, dict]:
    source, entries = identity(root)
    require(source == BOOT_SOURCE, 'unreviewed boot-tools source')
    command(['git', '-C', str(root), 'merge-base', '--is-ancestor', JOIN_REBUILT['commit'], source['commit']])
    changes = [dict(path=name, before=middle.get(name), after=entries.get(name))
               for name in sorted(middle.keys() | entries.keys()) if middle.get(name) != entries.get(name)]
    require(hashlib.sha256(canonical(changes)).hexdigest() == BOOT_DELTA_SHA, 'unreviewed boot-tools producer delta')
    require(all(row['path'] in JOIN_CONSUMERS | BOOT_PRODUCER_PATHS | {BOOT_DIRECT_TEST} for row in changes),
            'unexpected boot-tools producer/test attribution')
    original_inputs = producer_inputs(rebuilt_root, middle)
    require(original_inputs == producer_inputs(root, entries), 'boot-tools changes native/deploy/PREPARE inputs')
    require(sha(path) == BOOT_RECEIPT_SHA, 'unreviewed boot-tools output witness')
    output = keys(load(path), 'schema source target platform manifest config layers provenance payload inspection production producer_command aggregate_status aggregate_error build_exit_code collection_exit_code inputs collector')
    require(output['schema'] == 'mos/boot-tool-output/v1' and output['source'] == source
            and output['target'] == 'x64' and output['platform'] == 'linux/amd64'
            and output['build_exit_code'] == output['collection_exit_code'] == 0, 'boot-tools producer/collection result')
    for item in [*output['inputs'], output['production'], output['collector']]:
        keys(item, 'path bytes sha256')
        at = Path(item['path'])
        require(at.is_file() and not at.is_symlink() and at.stat().st_size == item['bytes']
                and sha(at) == hex_id(item['sha256']), 'boot-tools witness bytes')
    require(output['production']['sha256'] == BOOT_RESULT_SHA, 'boot-tools original production record')
    produced = load(Path(output['production']['path']))
    # The exact preserved recorder failed after a successful build and import.
    # Only this reviewed terminal is accepted; a failed producer is not.
    require(produced['exitCode'] == 1 and produced['status'] == output['aggregate_status'] == 'failure'
            and produced['error'] == output['aggregate_error'] == "'containerimage.config.digest'",
            'boot-tools original recorder disposition')
    require(produced['verifiedSource'] == source and produced['sourceCommit'] == source['commit']
            and produced['sourceTree'] == source['tree'] and produced['sourceEpoch'] == source['epoch'], 'boot-tools producer source')
    steps = {step['name']: step for step in produced['steps']}
    require(len(steps) == len(produced['steps']) == 10 and steps['boot-tools-build'] == output['producer_command']
            and steps['boot-tools-build']['argv'] == ['bash', 'pkgs/mos-boot/build-tools.sh', '--target', 'x64']
            and steps['boot-tools-build']['timeoutSeconds'] == 3600
            and steps['boot-tools-build']['exitCode'] == steps['actual-image-identity']['exitCode'] == 0,
            'boot-tools successful command/target/import')
    for step in produced['steps']:
        require(step['exitCode'] == step['expectedExit'] and sha(Path(step['log'])) == step['logSha256'], 'boot-tools production log')
    for name in ('runner', 'wrapper', 'sourceReadiness'):
        item = produced[name]
        require(sha(Path(item['path'])) == item['sha256'], 'boot-tools producer invocation/input')
    readiness = load(Path(produced['sourceReadiness']['path']))
    names = sorted(set(readiness['bootContext']) | set(readiness['protectedInputs']))
    inputs = {name: dict(entries[name], sha256=sha(root / name)) for name in names}
    require(all(inputs[name] == item for name, item in produced['sourceInputs'].items()), 'boot-tools source mode/blob/bytes')
    actual = json.loads(command(['docker', 'image', 'inspect', output['manifest']]))
    require(len(actual) == 1 and actual[0]['Id'] == output['manifest'] and actual[0]['Architecture'] == 'amd64'
            and actual[0]['Os'] == 'linux' and actual[0]['Config']['Labels']['mos.source.commit'] == source['commit']
            and actual[0]['Config']['Labels']['mos.source.tree'] == source['tree']
            and actual[0]['Config']['Labels']['mos.boot.target'] == 'x64'
            and actual[0]['RootFS']['Layers'] == [layer['diff_id'] for layer in output['layers']], 'boot-tools actual immutable image')
    for name, expected in output['payload'].items():
        at = path.parent / 'payload' / relative(name)
        require(at.parent.resolve().is_relative_to((path.parent / 'payload').resolve())
                and at.is_file() and not at.is_symlink() and at.stat().st_size == expected['bytes']
                and sha(at) == expected['sha256'], 'boot-tools actual payload bytes')
    role = dict(schema='mos/boot-tools-producer/v1', source=source, approved_delta=changes, inputs=inputs,
                unchanged_producers_sha256=hashlib.sha256(canonical(original_inputs)).hexdigest(),
                source_readiness_sha256=produced['sourceReadiness']['sha256'], receipt_sha256=BOOT_RECEIPT_SHA,
                production=dict(target='x64', platform='linux/amd64', manifest=output['manifest'], config=output['config'],
                                layers=output['layers'], provenance=output['provenance'], payload=output['payload'],
                                daemon_image=produced['resourceBefore']['image']))
    return validate_boot_role(role), entries


def validate_join(join: dict, pool: dict, original: dict, arch: str) -> dict:
    boot = join.get('schema') == 'mos/producer-join/boot-tools-v1'
    keys(join, 'schema rebuilt_source approved_delta producer_inputs original_pool witnesses mapping native production' + (' boot_tools' if boot else ''))
    if boot:
        validate_boot_role(join['boot_tools'])
    require(join['schema'] in ('mos/producer-join/v1', 'mos/producer-join/boot-tools-v1') and arch == 'amd64'
            and original == JOIN_ORIGINAL and join['rebuilt_source'] == JOIN_REBUILT, 'producer join source/architecture')
    require(join['witnesses'] == JOIN_RECEIPTS, 'producer join witnesses')
    require(hashlib.sha256(canonical(join['production'])).hexdigest() == JOIN_PRODUCTION_SHA, 'producer join tool/recipe/target/flags')
    require(hashlib.sha256(canonical(join['approved_delta'])).hexdigest() == JOIN_DELTA_SHA, 'producer join reviewed delta')
    require(hashlib.sha256(canonical(join['original_pool'])).hexdigest() == JOIN_POOL_SHA, 'producer join original pool')
    proofs = join['producer_inputs']; require(isinstance(proofs, dict) and len(proofs) == 15, 'producer join inputs')
    require(hashlib.sha256(canonical(proofs)).hexdigest() == JOIN_INPUTS_SHA, 'producer join input attribution')
    for name, row in proofs.items():
        keys(row, 'source_commit before_sha256 after_sha256')
        hex_id(row['before_sha256']); hex_id(row['after_sha256'])
        require(row['source_commit'] == (JOIN_REBUILT if name == 'deploy' else JOIN_ORIGINAL)['commit'], 'producer source attribution')
        require((row['before_sha256'] != row['after_sha256']) == (name == 'deploy'), 'producer reuse input equality')
    old = {r['package']: r for r in join['original_pool']['packages']}
    current = {r['package']: r for r in pool['packages']}
    require(len(current) == len(pool['packages']) and set(current) == set(old), 'joined package membership')
    expected_mapping = {name: (JOIN_REBUILT if name == 'mos-deploy' else JOIN_ORIGINAL)['commit'] for name in old}
    require(join['mapping'] == expected_mapping, 'joined package source mapping')
    for name, row in current.items():
        if name == 'mos-deploy':
            require(row['sha256'] == JOIN_DEPLOY_SHA and row['version'] == JOIN_REBUILT['version']
                    and row['architecture'] == 'amd64' and row['control_sha256'] == JOIN_DEPLOY_CONTROL
                    and row['archive'] == 'pool/mos-deploy_' + JOIN_REBUILT['version'] + '_amd64.deb', 'joined deploy identity')
        else:
            require(row == old[name], 'reused archive/control identity changed')
    require(join['native'] == JOIN_NATIVE, 'joined native exports')
    return join


def create_join(composition_root: Path, original_root: Path, pool: Path, arch: str, epoch: int,
                receipt: Path | None, receipt_sha: str | None, request: Path, request_sha: str) -> dict:
    require(sha(request) == hex_id(request_sha), 'join input digest')
    inputs = load(request)
    boot = inputs.get('schema') == 'mos/producer-join-inputs/boot-tools-v1'
    keys(inputs, 'schema original_pool rebuilt_source native_receipt deploy_receipt pool_files' + (' boot_source boot_receipt' if boot else ''))
    require(inputs['schema'] in ('mos/producer-join-inputs/v1', 'mos/producer-join-inputs/boot-tools-v1') and arch == 'amd64' and epoch == 1577836800, 'join input schema/architecture/epoch')
    rebuilt_root = Path(inputs['rebuilt_source'])
    c, after = identity(composition_root); p, before = identity(original_root); b, middle = identity(rebuilt_root)
    p['version'] = command(['bash', str(original_root / 'build-env/deb/version.sh')]).decode().strip()
    b['version'] = command(['bash', str(rebuilt_root / 'build-env/deb/version.sh')]).decode().strip()
    approved_delta, proofs = join_delta(original_root, rebuilt_root, p, b, before, middle)
    role = None
    if boot:
        boot_root = Path(inputs['boot_source'])
        role, boot_entries = boot_witness(boot_root, rebuilt_root, middle, Path(inputs['boot_receipt']))
        changes = delta(boot_root, composition_root, BOOT_SOURCE, c, boot_entries, after)
    else:
        changes = delta(rebuilt_root, composition_root, b, c, middle, after)
    require(all(row['path'] in JOIN_CONSUMERS for row in changes), 'unapproved joined consumer delta')
    original_pool = pool_identity(Path(inputs['original_pool']), arch, p['version'])
    require(receipt_sha == JOIN_RECEIPTS['original'], 'unreviewed original receipt')
    frozen_receipt(receipt, receipt_sha, original_root, p, before, arch, original_pool)
    native = rebuilt_witness(Path(inputs['native_receipt']), 'native', rebuilt_root, middle)
    deploy = rebuilt_witness(Path(inputs['deploy_receipt']), 'deploy', rebuilt_root, middle)
    versions = {r['package']: b['version'] if r['package'] == 'mos-deploy' else r['version'] for r in original_pool['packages']}
    joined_pool = pool_identity(pool, arch, versions)
    require(joined_pool['files'] == inputs['pool_files'], 'joined pool index/archive inputs changed')
    output = Path(deploy['packageOutputs'][0]['path'])
    actual = next(r for r in joined_pool['packages'] if r['package'] == 'mos-deploy')
    require(actual['control_sha256'] == hashlib.sha256(command(['dpkg-deb', '--ctrl-tarfile', str(output)])).hexdigest(), 'deploy control witness')
    join = dict(schema='mos/producer-join/v1', rebuilt_source=b, approved_delta=approved_delta,
                producer_inputs=proofs, original_pool=original_pool, witnesses=JOIN_RECEIPTS,
                mapping={name: (b if name == 'mos-deploy' else p)['commit'] for name in versions},
                native={Path(r['path']).name: {k: r[k] for k in ('bytes', 'sha256')} for r in native['outputs']},
                production=production_identity(rebuilt_root, middle, native, deploy))
    if role is not None:
        join.update(schema='mos/producer-join/boot-tools-v1', boot_tools=role)
    record = dict(schema='mos/source-lineage/join-v1', package_source=p, composition_source=c,
                  architecture=arch, root_epoch=epoch, pool=joined_pool,
                  receipt_sha256=sorted([*JOIN_RECEIPTS.values(), *([BOOT_RECEIPT_SHA] if boot else [])]), delta=changes, producer_join=join)
    return validate(record, arch, epoch)


def validate(record: dict, arch: str, epoch: int) -> dict:
    joined = record.get('schema') == 'mos/source-lineage/join-v1'
    keys(record, 'schema package_source composition_source architecture root_epoch pool receipt_sha256 delta' + (' producer_join' if joined else ''))
    require(record['schema'] in ('mos/source-lineage/v1', 'mos/source-lineage/join-v1') and record['architecture'] == arch, 'schema/architecture mismatch')
    require(arch in ('amd64', 'arm64'), 'invalid architecture')
    natural(record['root_epoch']); require(record['root_epoch'] == epoch, 'root epoch mismatch')
    p = keys(record['package_source'], 'commit tree epoch version')
    c = keys(record['composition_source'], 'commit tree epoch')
    for source in (p, c):
        hex_id(source['commit'], 40); hex_id(source['tree'], 40); natural(source['epoch'])
    require(isinstance(p['version'], str) and re.fullmatch(r'[0-9][A-Za-z0-9.~-]*\+git' + p['commit'][:12] + r'-[1-9][0-9]*', p['version']), 'package version/source stamp')
    require(isinstance(record['receipt_sha256'], list) and len(set(record['receipt_sha256'])) == len(record['receipt_sha256']), 'receipt digests')
    for digest in record['receipt_sha256']:
        hex_id(digest)
    require(p['commit'] == c['commit'] or record['receipt_sha256'], 'missing cross-source receipt')
    require(isinstance(record['delta'], list), 'invalid source delta')
    paths = []
    for row in record['delta']:
        keys(row, 'path before after'); require(row['path'] in COMPOSITION_PATHS, 'unapproved source delta')
        paths.append(row['path'])
        for entry in (row['before'], row['after']):
            if entry is not None:
                keys(entry, 'mode blob'); hex_id(entry['blob'], 40)
                require(entry['mode'] in ('100644', '100755', '120000'), 'invalid Git mode')
        require(row['after'] is not None and row['after']['mode'] in ('100644', '100755')
                and (row['before'] is None or row['before']['mode'] == row['after']['mode']), 'composition delta type/mode/deletion')
        require(row['before'] != row['after'], 'empty source delta')
    require(paths == sorted(set(paths)), 'duplicate/unsorted source delta')
    if p['commit'] == c['commit']:
        require(p['tree'] == c['tree'] and p['epoch'] == c['epoch'] and not paths, 'same-source identity mismatch')
    pool = keys(record['pool'], 'files packages')
    require(isinstance(pool['files'], dict) and isinstance(pool['packages'], list) and pool['packages'], 'empty lineage pool')
    for path, digest in pool['files'].items():
        relative(path); hex_id(digest)
    expected = {'Packages', 'SHA256SUMS', 'manifest.txt'}
    names = set()
    for row in pool['packages']:
        keys(row, 'package version architecture archive sha256 control_sha256')
        require(isinstance(row['package'], str) and re.fullmatch('[a-z0-9][a-z0-9+.-]+', row['package']) and row['package'] not in names, 'package name/duplicate')
        names.add(row['package'])
        require(row['architecture'] in (arch, 'all') and isinstance(row['version'], str)
                and row['version'].rsplit('+', 1)[-1] == (JOIN_REBUILT if joined and row['package'] == 'mos-deploy' else p)['version'].rsplit('+', 1)[-1], 'package architecture/stamp mismatch')
        require(re.fullmatch(r'pool/[^/]+\.deb', row['archive']) is not None, 'archive path')
        hex_id(row['sha256']); hex_id(row['control_sha256'])
        require(pool['files'].get(row['archive']) == row['sha256'] and row['archive'] not in expected, 'pool archive mismatch')
        expected.add(row['archive'])
    require(set(pool['files']) == expected, 'lineage pool membership')
    if joined:
        boot = record['producer_join'].get('schema') == 'mos/producer-join/boot-tools-v1'
        if not boot:
            require(c == JOIN_LEGACY_COMPOSITION, 'boot-tools witness omitted or downgraded')
        require(record['receipt_sha256'] == sorted([*JOIN_RECEIPTS.values(), *([BOOT_RECEIPT_SHA] if boot else [])])
                and epoch == 1577836800, 'join receipt/root epoch')
        require(all(path in JOIN_CONSUMERS for path in paths), 'unapproved joined consumer delta')
        validate_join(record['producer_join'], pool, p, arch)
    return record


def create(composition_root: Path, package_root: Path, pool: Path, arch: str, epoch: int, receipt: Path | None = None, receipt_sha: str | None = None) -> dict:
    c, after = identity(composition_root)
    p, before = identity(package_root)
    changes = delta(package_root, composition_root, p, c, before, after)
    p['version'] = command(['bash', str(package_root / 'build-env/deb/version.sh')]).decode().strip()
    pool_record = pool_identity(pool, arch, p['version'])
    receipts = []
    if package_root != composition_root or receipt is not None:
        receipts = frozen_receipt(receipt, receipt_sha, package_root, p, before, arch, pool_record)
    record = dict(schema='mos/source-lineage/v1', package_source=p, composition_source=c,
                  architecture=arch, root_epoch=epoch, pool=pool_record, receipt_sha256=receipts, delta=changes)
    return validate(record, arch, epoch)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--composition-source', type=Path, required=True)
    parser.add_argument('--package-source', type=Path)
    parser.add_argument('--pool', type=Path, required=True)
    parser.add_argument('--arch', required=True)
    parser.add_argument('--epoch', type=int, required=True)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--receipt-sha256')
    parser.add_argument('--producer-join', type=Path)
    parser.add_argument('--producer-join-sha256')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.producer_join is not None:
            require(args.package_source is not None, 'join requires original package source')
            record = create_join(args.composition_source, args.package_source, args.pool, args.arch, args.epoch,
                                 args.receipt, args.receipt_sha256, args.producer_join, args.producer_join_sha256)
        else:
            require(args.producer_join_sha256 is None, 'join digest without input')
            record = create(args.composition_source, args.package_source or args.composition_source,
                            args.pool, args.arch, args.epoch, args.receipt, args.receipt_sha256)
        args.output.write_bytes(canonical(record))
        print(record['package_source']['version'])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'source lineage refused: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
