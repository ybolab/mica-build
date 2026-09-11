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
    'docs/task/20260911-0145-b7-fresh-lifecycle-acceptance.md',
    'docs/plan/20260911-0145-b7-fresh-lifecycle-acceptance.md',
})


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


def pool_identity(pool: Path, arch: str, version: str) -> dict:
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
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')):
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
        require(a in (arch, 'all') and v.rsplit('+', 1)[-1] == version.rsplit('+', 1)[-1], 'architecture or package stamp')
        require(all(indexed[name][k] == parsed[k] for k in parsed), 'archive control/index mismatch')
        require(sum(len(row) == 6 and row[:3] == [p, v, a] and row[4:] == [sums[name], name] for row in manifest) == 1, 'manifest/control membership')
        packages.append(dict(package=p, version=v, architecture=a, archive=name, sha256=sums[name],
                             control_sha256=hashlib.sha256(control).hexdigest()))
    require(len(manifest) == len(packages) and len({p['package'] for p in packages}) == len(packages), 'mixed/duplicate pool')
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


def validate(record: dict, arch: str, epoch: int) -> dict:
    keys(record, 'schema package_source composition_source architecture root_epoch pool receipt_sha256 delta')
    require(record['schema'] == 'mos/source-lineage/v1' and record['architecture'] == arch, 'schema/architecture mismatch')
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
                and row['version'].rsplit('+', 1)[-1] == p['version'].rsplit('+', 1)[-1], 'package architecture/stamp mismatch')
        require(re.fullmatch(r'pool/[^/]+\.deb', row['archive']) is not None, 'archive path')
        hex_id(row['sha256']); hex_id(row['control_sha256'])
        require(pool['files'].get(row['archive']) == row['sha256'] and row['archive'] not in expected, 'pool archive mismatch')
        expected.add(row['archive'])
    require(set(pool['files']) == expected, 'lineage pool membership')
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
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        record = create(args.composition_source, args.package_source or args.composition_source,
                        args.pool, args.arch, args.epoch, args.receipt, args.receipt_sha256)
        args.output.write_bytes(canonical(record))
        print(record['package_source']['version'])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'source lineage refused: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
