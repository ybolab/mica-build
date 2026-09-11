"""Real Git and Debian pool proofs for explicit composition-only reuse."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
HELPER = REPO / 'rootfs/runtime/source-lineage.py'


def run(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=30)


class SourceLineageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.package = self.work / 'package'
        self.package.mkdir()
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1',
                        GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                        GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
                        GIT_AUTHOR_DATE='2020-01-02T00:00:00Z', GIT_COMMITTER_DATE='2020-01-02T00:00:00Z')
        for name in ['rootfs/build.sh', 'rootfs/runtime/source-lineage.py', 'build-env/deb/version.sh', 'build-env/images.env', 'boards/x64/board.env', 'rootfs/scripts/validate-public-meta.sh']:
            at = self.package / name
            at.parent.mkdir(parents=True, exist_ok=True)
            if (REPO / name).exists():
                shutil.copyfile(REPO / name, at)
        for name, text in {'.gitignore': '_out/\n', 'build-env/from.sh': '#!/bin/sh\nprintf \"fixture-image\\n\"\n', 'Makefile': '# fixture\n', 'pkgs/mosd/Cargo.toml': '[workspace]\n',
                           'pkgs/mosd/fixture/Cargo.toml': '[package]\nname = "fixture"\nversion = "0.1.0"\n',
                           'rootfs/runtime/compose.py': '# composition fixture\n', 'pkgs/mosd/Cargo.lock': '# frozen lock\n'}.items():
            at = self.package / name; at.parent.mkdir(parents=True, exist_ok=True); at.write_text(text)
        self.must('git', 'init', '-q', self.package)
        self.commit(self.package)
        self.commit_id = self.must('git', '-C', self.package, 'rev-parse', 'HEAD').strip()
        self.tree_id = self.must('git', '-C', self.package, 'rev-parse', 'HEAD^{tree}').strip()
        self.version = self.must('bash', self.package / 'build-env/deb/version.sh').strip()
        self.source = dict(commit=self.commit_id, tree=self.tree_id, epoch=1577923200, version=self.version)
        self.composition = self.work / 'composition'
        self.must('git', 'clone', '-q', self.package, self.composition)
        with (self.composition / 'rootfs/runtime/compose.py').open('a') as stream:
            stream.write('# approved composition correction\n')
        self.commit(self.composition)
        self.pool = self.composition / '_out/debs/amd64'
        (self.pool / 'pool').mkdir(parents=True)
        self.debroot = self.work / 'deb'
        (self.debroot / 'DEBIAN').mkdir(parents=True)
        (self.debroot / 'usr/bin').mkdir(parents=True)
        (self.debroot / 'usr/bin/fixture').write_text('fixture bytes\n')
        self.write_pool()
        self.native = self.work / 'mos-init'; self.native.write_bytes(b'unchanged native fixture')
        self.shutdown = self.work / 'mos-shutdown'; self.shutdown.write_bytes(b'unchanged shutdown fixture')
        self.receipt = self.work / 'receipt.json'
        self.freeze_receipt()
        self.bin = self.work / 'bin'; self.bin.mkdir()
        docker = self.bin / 'docker'
        docker.write_text('#!/bin/sh\nif [ \"$1\" = run ]; then while [ \"$1\" != bun ]; do shift; done; exec \"$@\"; fi\n[ "$1 $2 $3" = "image inspect sha256:' + 'a' * 64 + '" ] || exit 91\nprintf \'[{"Id":"sha256:' + 'a' * 64 + '","Architecture":"amd64"}]\\n\'\n')
        docker.chmod(0o755)
        self.env['PATH'] = str(self.bin) + ':' + self.env['PATH']

    def must(self, *args):
        result = run(*map(str, args), env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def commit(self, root):
        self.must('git', '-C', root, 'add', '.')
        self.must('git', '-C', root, 'commit', '-qm', 'Freeze source fixture')

    def write_pool(self, arch='amd64', version=None):
        version = version or self.version
        (self.debroot / 'DEBIAN/control').write_text(f'Package: mos-fixture\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: isolated package\n')
        self.archive = self.pool / 'pool/mos-fixture.deb'
        self.must('dpkg-deb', '--build', self.debroot, self.archive)
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        (self.pool / 'SHA256SUMS').write_text(digest + '  pool/mos-fixture.deb\n')
        (self.pool / 'Packages').write_text(f'Package: mos-fixture\nVersion: {version}\nArchitecture: {arch}\nFilename: pool/mos-fixture.deb\nSHA256: {digest}\n\n')
        (self.pool / 'manifest.txt').write_text(f'mos-fixture\t{version}\t{arch}\t1\t{digest}\tpool/mos-fixture.deb\n')

    def freeze_receipt(self):
        inputs = {}
        for name in ['build-env/deb/version.sh', 'build-env/images.env', 'pkgs/mosd/Cargo.lock']:
            mode, _, blob = self.must('git', '-C', self.package, 'ls-tree', 'HEAD', '--', name).split('\t')[0].split()
            inputs[name] = dict(mode=mode, blob=blob, sha256=hashlib.sha256((self.package / name).read_bytes()).hexdigest())
        files = {p.relative_to(self.pool).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in self.pool.rglob('*') if p.is_file()}
        native = dict(path=str(self.native), sha256=hashlib.sha256(self.native.read_bytes()).hexdigest())
        shutdown = dict(path=str(self.shutdown), sha256=hashlib.sha256(self.shutdown.read_bytes()).hexdigest())
        proof = self.work / 'producer.json'
        proof.write_text(json.dumps(dict(sourceCommit=self.commit_id, sourceTree=self.tree_id,
            inputFileSha256={k: v['sha256'] for k, v in inputs.items()},
            toolInputs={'fixture':dict(id='sha256:' + 'a' * 64, architecture='amd64')},
            outputs=[dict(path=str(self.pool / k), sha256=v) for k, v in files.items()], nativeOutputs=[native, shutdown])))
        self.receipt.write_text(json.dumps(dict(schema='mos/package-inputs/v1', source=self.source, architecture='amd64',
            inputs=inputs, tools=[dict(id='sha256:' + 'a' * 64, architecture='amd64')], files=files, native=[native, shutdown],
            evidence=[dict(path=str(proof), sha256=hashlib.sha256(proof.read_bytes()).hexdigest())])))
        self.receipt_sha = hashlib.sha256(self.receipt.read_bytes()).hexdigest()

    def invoke(self, explicit=True, root=None):
        self.output = self.work / 'lineage.json'
        argv = ['python3', str(HELPER), '--composition-source', str(root or self.composition), '--pool', str(self.pool),
                '--arch', 'amd64', '--epoch', '1577836800', '--output', str(self.output)]
        if explicit:
            argv += ['--package-source', str(self.package), '--receipt', str(self.receipt), '--receipt-sha256', self.receipt_sha]
        return run(*argv, env=self.env)

    def test_explicit_successor_and_disjoint_paths_are_deterministic(self):
        r = self.invoke(); self.assertEqual(r.returncode, 0, r.stderr)
        original = self.output.read_bytes(); record = json.loads(original)
        self.assertEqual(record['package_source'], self.source)
        self.assertNotEqual(record['composition_source']['commit'], self.commit_id)
        self.assertEqual([row['path'] for row in record['delta']], ['rootfs/runtime/compose.py'])
        other = self.work / 'other'
        self.must('git', 'clone', '-q', self.composition, other)
        r = self.invoke(root=other); self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.output.read_bytes(), original)
        self.assertNotIn(str(self.work).encode(), original)

    def test_exact_selector_and_fixture_delta_preserves_package_identity(self):
        paths = ['rootfs/runtime/select.py', 'tests/rootfs-runtime/selection_test.py']
        for name in paths:
            path = self.composition / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / name, path)
        self.commit(self.composition)
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(self.output.read_bytes())
        self.assertEqual(record['package_source'], self.source)
        self.assertEqual([row['path'] for row in record['delta']],
                         ['rootfs/runtime/compose.py', *paths])
        self.assertNotEqual(record['composition_source']['commit'], self.commit_id)

    def test_default_requires_same_source_stamp(self):
        r = self.invoke(explicit=False)
        self.assertNotEqual(r.returncode, 0); self.assertIn('stamp', r.stderr)
        r = self.invoke(explicit=False, root=self.package)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_exact_feature_resource_delta_preserves_package_identity(self):
        paths = ['rootfs/runtime/consumers.json', 'rootfs/debian/packages/dmsetup.json',
                 'rootfs/debian/packages/libdevmapper1.02.1.json']
        for name in paths:
            path = self.composition / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / name, path)
        self.commit(self.composition)
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(self.output.read_bytes())
        self.assertEqual(record['package_source'], self.source)
        self.assertEqual([row['path'] for row in record['delta']], sorted(['rootfs/runtime/compose.py', *paths]))

    def test_selector_delta_cannot_enter_a_package_context(self):
        producer = self.package / 'rootfs/packages-src/fixture/producer.env'
        producer.parent.mkdir(parents=True)
        producer.write_text('BUILD_CONTEXTS="runtime=rootfs/runtime"\n')
        self.commit(self.package)
        consumer = self.work / 'context-consumer'
        self.must('git', 'clone', '-q', self.package, consumer)
        shutil.copyfile(REPO / 'rootfs/runtime/select.py', consumer / 'rootfs/runtime/select.py')
        self.commit(consumer)
        spec = importlib.util.spec_from_file_location('source_lineage_context', HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        package, before = helper.identity(self.package)
        composition, after = helper.identity(consumer)
        with self.assertRaisesRegex(ValueError, 'composition path enters producer context: rootfs/runtime/select.py'):
            helper.delta(self.package, consumer, package, composition, before, after)

    def test_feature_resource_delta_cannot_enter_a_package_context(self):
        producer = self.package / 'rootfs/packages-src/fixture/producer.env'
        producer.parent.mkdir(parents=True)
        producer.write_text('BUILD_CONTEXTS="runtime=rootfs/runtime locks=rootfs/debian/packages"\n')
        self.commit(self.package)
        consumer = self.work / 'context-consumer'
        self.must('git', 'clone', '-q', self.package, consumer)
        spec = importlib.util.spec_from_file_location('source_lineage_context', HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        package, before = helper.identity(self.package)
        for name in ('rootfs/runtime/consumers.json', 'rootfs/debian/packages/dmsetup.json',
                     'rootfs/debian/packages/libdevmapper1.02.1.json'):
            with self.subTest(path=name):
                path = consumer / name
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO / name, path)
                self.commit(consumer)
                composition, after = helper.identity(consumer)
                with self.assertRaisesRegex(ValueError, 'composition path enters producer context:'):
                    helper.delta(self.package, consumer, package, composition, before, after)
                path.unlink()
                self.commit(consumer)

    def test_dirty_and_hidden_checkout_changes_refuse(self):
        path = self.package / 'build-env/images.env'
        self.must('git', '-C', self.package, 'update-index', '--assume-unchanged', 'build-env/images.env')
        path.write_text(path.read_text() + '\n# dirty tool pin\n')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('checkout bytes/mode', r.stderr)

    def test_package_input_and_lock_changes_refuse(self):
        for name in ['pkgs/mosd/Cargo.lock', 'build-env/images.env']:
            with self.subTest(path=name):
                at = self.composition / name; at.write_text(at.read_text() + '\n# changed input\n')
                self.commit(self.composition)
                r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('package-relevant', r.stderr)

    def test_nonancestor_refuses(self):
        self.must('git', '-C', self.composition, 'checkout', '--orphan', 'unrelated')
        self.commit(self.composition)
        r = self.invoke(); self.assertNotEqual(r.returncode, 0)

    def test_forged_receipt_epoch_version_source_refuses(self):
        original = json.loads(self.receipt.read_text())
        for key, value in [('epoch', 1), ('version', '0.1.0+git' + 'b' * 12 + '-1'), ('commit', 'b' * 40)]:
            with self.subTest(field=key):
                d = json.loads(json.dumps(original)); d['source'][key] = value
                self.receipt.write_text(json.dumps(d)); self.receipt_sha = hashlib.sha256(self.receipt.read_bytes()).hexdigest()
                r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('receipt source/version/epoch', r.stderr)

    def test_altered_archive_and_recomputed_indexes_refuse_frozen_receipt(self):
        (self.debroot / 'usr/bin/fixture').write_text('replaced payload\n'); self.write_pool()
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('frozen pool bytes', r.stderr)

    def test_altered_index_refuses_frozen_receipt(self):
        with (self.pool / 'Packages').open('a') as f: f.write('\n')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('frozen pool bytes', r.stderr)

    def test_wrong_architecture_and_stamp_refuse(self):
        for arch, version in [('arm64', self.version), ('amd64', '0.1.0+git' + 'b' * 12 + '-1')]:
            with self.subTest(arch=arch, version=version):
                self.write_pool(arch, version)
                r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('architecture or package stamp', r.stderr)

    def test_missing_and_unpinned_receipt_refuse(self):
        self.receipt.unlink()
        r = self.invoke(); self.assertNotEqual(r.returncode, 0)

    def test_actual_rootfs_caller_refuses_by_default_and_accepts_explicit_source(self):
        # Stop the real launcher before resolution/acquisition/container execution.
        # The DEBUG boundary exists only in this fixture's shell environment.
        boundary = self.work / 'boundary.sh'
        boundary.write_text("set -T\ntrap 'if [[ $BASH_COMMAND == RESOLVED=* ]]; then printf \"CALLER_BOUNDARY:%s:%s\\n\" \"$tree_version\" \"$tree_commit_date\"; exit 79; fi' DEBUG\n")
        meta = self.composition / '_out/meta'
        (meta / 'updates').mkdir(parents=True)
        shutil.copyfile(REPO / 'meta.example/updates/manifest.json', meta / 'updates/manifest.json')
        env = dict(self.env, BASH_ENV=str(boundary), MOS_BOARD='x64', MOS_META_DIR=str(meta))
        r = run('bash', str(self.composition / 'rootfs/build.sh'), env=env)
        self.assertNotEqual(r.returncode, 79); self.assertIn('stamp', r.stderr)
        env.update(MOS_ROOTFS_PACKAGE_SOURCE=str(self.package), MOS_ROOTFS_PACKAGE_RECEIPT=str(self.receipt),
                   MOS_ROOTFS_PACKAGE_RECEIPT_SHA256=self.receipt_sha)
        r = run('bash', str(self.composition / 'rootfs/build.sh'), env=env)
        self.assertEqual(r.returncode, 79, r.stderr)
        self.assertIn('CALLER_BOUNDARY:' + self.version + ':2020-01-02T00:00:00+00:00', r.stdout)
        record = json.loads((self.composition / '_out/x64/source-lineage.json').read_text())
        self.assertEqual(record['package_source'], self.source)


    def test_linked_worktree_verification_preserves_git_metadata(self):
        linked = self.work / 'linked'
        self.must('git', '-C', self.composition, 'worktree', 'add', '--detach', linked, 'HEAD')
        gitdir = Path(self.must('git', '-C', linked, 'rev-parse', '--absolute-git-dir').strip())
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in gitdir.iterdir() if p.is_file()}
        r = self.invoke(root=linked); self.assertEqual(r.returncode, 0, r.stderr)
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in gitdir.iterdir() if p.is_file()}
        self.assertEqual(before, after)

    def test_mode_only_package_change_refuses(self):
        (self.composition / 'pkgs/mosd/Cargo.lock').chmod(0o755); self.commit(self.composition)
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('package-relevant', r.stderr)

    def test_tool_and_native_receipt_changes_refuse(self):
        original = self.receipt.read_text()
        value = json.loads(original); value['tools'][0]['architecture'] = 'arm64'
        self.receipt.write_text(json.dumps(value)); self.receipt_sha = hashlib.sha256(self.receipt.read_bytes()).hexdigest()
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('actual tool identity', r.stderr)
        self.receipt.write_text(original); self.receipt_sha = hashlib.sha256(self.receipt.read_bytes()).hexdigest()
        self.native.write_bytes(b'replaced native')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('native bytes', r.stderr)

    def test_missing_checkout_and_dirty_composition_refuse(self):
        original = self.package; self.package = self.work / 'absent'
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('checkout missing', r.stderr)
        self.package = original
        (self.composition / 'untracked').write_text('dirty')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('dirty source', r.stderr)

    def test_pinned_receipt_and_evidence_changes_refuse(self):
        original = self.receipt.read_text()
        self.receipt.write_text(original + ' ')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('receipt digest', r.stderr)
        self.receipt.write_text(original)
        (self.work / 'producer.json').write_text('{}')
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('producer evidence changed', r.stderr)


    def test_allowed_consumer_mode_changes_and_deletions_refuse(self):
        path = self.composition / 'rootfs/runtime/compose.py'
        path.chmod(0o755); self.commit(self.composition)
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('type/mode', r.stderr)
        path.unlink(); self.commit(self.composition)
        r = self.invoke(); self.assertNotEqual(r.returncode, 0); self.assertIn('deletion/type/mode', r.stderr)
