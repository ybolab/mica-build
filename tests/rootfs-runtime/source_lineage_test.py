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

    def joined_validation_fixture(self):
        """Small real-pool fixture; only the approved policy anchors are replaced.

        The actual immutable production anchors are exercised by the separate
        recorded CLI/input gate, not authorized by these fixture constants.
        """
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('joined_validation', HELPER)
        h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
        original = h.pool_identity(self.pool, 'amd64', self.version)
        old_deploy = dict(original['packages'][0], package='mos-deploy', archive='pool/old-deploy.deb')
        original['packages'].append(old_deploy); original['files'][old_deploy['archive']] = old_deploy['sha256']
        rebuilt = dict(commit='b' * 40, tree='c' * 40, epoch=1577923300, version='0.1.0+git' + 'b' * 12 + '-1')
        new_deploy = dict(old_deploy, version=rebuilt['version'], archive='pool/mos-deploy_' + rebuilt['version'] + '_amd64.deb', sha256='d' * 64)
        pool = json.loads(json.dumps(original)); pool['packages'][-1] = new_deploy
        del pool['files']['pool/old-deploy.deb']; pool['files'][new_deploy['archive']] = new_deploy['sha256']
        proofs = {name: dict(source_commit=rebuilt['commit'] if name == 'deploy' else self.commit_id,
                            before_sha256='1' * 64, after_sha256=('2' if name == 'deploy' else '1') * 64)
                  for name in ['deploy', *['fixture' + str(i) for i in range(14)]]}
        receipts = dict(original='3' * 64, native='4' * 64, deploy='5' * 64)
        native = {name: dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                  for name, data in [('mos-init', self.native.read_bytes()), ('mos-shutdown', self.shutdown.read_bytes())]}
        canonical_sha = lambda v: hashlib.sha256(h.canonical(v)).hexdigest()
        join = dict(schema='mos/producer-join/v1', rebuilt_source=rebuilt, approved_delta=[], producer_inputs=proofs,
                    original_pool=original, witnesses=receipts, mapping={'mos-fixture': self.commit_id, 'mos-deploy': rebuilt['commit']}, native=native, production={'fixture': True})
        record = dict(schema='mos/source-lineage/join-v1', package_source=self.source,
                      composition_source=dict(commit='e' * 40, tree='f' * 40, epoch=1577923400),
                      architecture='amd64', root_epoch=1577836800, pool=pool, receipt_sha256=sorted(receipts.values()), delta=[], producer_join=join)
        fixture_policy = patch.multiple(h, JOIN_ORIGINAL=self.source, JOIN_REBUILT=rebuilt,
            JOIN_PRODUCTION_SHA=canonical_sha({'fixture': True}), JOIN_POOL_SHA=canonical_sha(original), JOIN_INPUTS_SHA=canonical_sha(proofs), JOIN_DELTA_SHA=canonical_sha([]),
            JOIN_RECEIPTS=receipts, JOIN_DEPLOY_SHA=new_deploy['sha256'], JOIN_DEPLOY_CONTROL=new_deploy['control_sha256'], JOIN_NATIVE=native)
        return h, json.loads(json.dumps(record)), fixture_policy

    def test_join_record_keeps_separate_sources_pool_shape_and_native(self):
        h, record, policy = self.joined_validation_fixture()
        with policy:
            self.assertEqual(h.validate(record, 'amd64', 1577836800), record)
            self.assertEqual(set(record['pool']), {'files', 'packages'})
            self.assertNotEqual(record['package_source'], record['producer_join']['rebuilt_source'])
            self.assertEqual(set(record['producer_join']['native']), {'mos-init', 'mos-shutdown'})
            self.assertNotIn(str(self.work).encode(), h.canonical(record))

    def test_join_record_refuses_mapping_witness_source_and_byte_mutations(self):
        mutations = {
            'wrong-source': lambda r: r['producer_join']['mapping'].__setitem__('mos-fixture', 'b' * 40),
            'missing-mapping': lambda r: r['producer_join']['mapping'].pop('mos-deploy'),
            'extra-mapping': lambda r: r['producer_join']['mapping'].__setitem__('mos-extra', 'b' * 40),
            'old-archive': lambda r: r['pool']['packages'][0].__setitem__('sha256', '9' * 64),
            'old-control': lambda r: r['pool']['packages'][0].__setitem__('control_sha256', '9' * 64),
            'deploy-control': lambda r: r['pool']['packages'][-1].__setitem__('control_sha256', '9' * 64),
            'deploy-version': lambda r: r['pool']['packages'][-1].__setitem__('version', self.version),
            'duplicate-archive': lambda r: r['pool']['packages'].append(r['pool']['packages'][0]),
            'wrong-architecture': lambda r: r.__setitem__('architecture', 'arm64'),
            'missing-native': lambda r: r['producer_join']['native'].pop('mos-shutdown'),
            'native-bytes': lambda r: r['producer_join']['native']['mos-init'].__setitem__('sha256', '9' * 64),
            'receipt': lambda r: r['producer_join']['witnesses'].__setitem__('deploy', '9' * 64),
            'failed-witness': lambda r: r['producer_join']['witnesses'].__setitem__('status', 'failure'),
            'epoch': lambda r: r['producer_join']['rebuilt_source'].__setitem__('epoch', 1),
            'delta': lambda r: r['producer_join']['approved_delta'].append(dict(path='pkgs/mosd/Cargo.lock', before=None, after=None)),
            'tool': lambda r: r['producer_join']['production'].__setitem__('tool', 'wrong'),
            'prepare': lambda r: r['producer_join']['producer_inputs']['fixture0'].__setitem__('after_sha256', '9' * 64),
            'unknown': lambda r: r['producer_join'].__setitem__('approved', True),
            'consumer': lambda r: r['delta'].append(dict(path='rootfs/runtime/consumers.json', before=None, after=dict(mode='100644', blob='1' * 40))),
            'root-epoch': lambda r: r.__setitem__('root_epoch', 1),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                h, record, policy = self.joined_validation_fixture(); mutate(record)
                with policy, self.assertRaises((ValueError, KeyError)):
                    h.validate(record, record['architecture'], record['root_epoch'])

    def test_join_input_json_rejects_duplicate_and_unknown_schema_keys(self):
        h, record, policy = self.joined_validation_fixture()
        at = self.work / 'duplicate.json'; at.write_text('{"schema":1,"schema":2}')
        with self.assertRaisesRegex(ValueError, 'duplicate key'):
            h.load(at)
        record['ignored'] = True
        with policy, self.assertRaisesRegex(ValueError, 'unknown or missing'):
            h.validate(record, 'amd64', 1577836800)

    def test_join_witness_rejects_failed_incomplete_and_missing_native(self):
        from unittest.mock import patch
        h, _, _ = self.joined_validation_fixture()
        log = self.work / 'build.log'; log.write_text('producer completed\n')
        log_sha = hashlib.sha256(log.read_bytes()).hexdigest()
        for path in (self.native, self.shutdown):
            path.chmod(0o755)
        outputs = [dict(path=str(p), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                   for p in (self.native, self.shutdown)]
        native = {Path(p['path']).name: {k: p[k] for k in ('bytes', 'sha256')} for p in outputs}
        witness = dict(status='success', exitCode=0, finishedAt='recorded', activePid=None, activeStep=None,
                       verifiedSource={k: h.JOIN_REBUILT[k] for k in ('commit', 'tree', 'epoch')},
                       sourceCommit=h.JOIN_REBUILT['commit'], sourceTree=h.JOIN_REBUILT['tree'],
                       sourceEpoch=h.JOIN_REBUILT['epoch'], version=h.JOIN_REBUILT['version'],
                       environment={'SOURCE_DATE_EPOCH': str(h.JOIN_REBUILT['epoch'])}, outputDirectory=str(self.work),
                       runner=dict(path=str(log), sha256=log_sha), wrapper=dict(path=str(log), sha256=log_sha),
                       toolIdentity=dict(id='sha256:' + 'a' * 64, architecture='amd64'), outputs=outputs,
                       steps=[dict(name='native-build', exitCode=0, log=str(log), logSha256=log_sha,
                                   argv=['bash', 'pkgs/mos-deploy/hack/build-deb.sh', '--producer', 'boot', '--bins',
                                         'mos-init mos-shutdown', '--arch', 'amd64', '--stage', str(self.work)])])
        cases = {
            'valid': lambda w: None,
            'failed': lambda w: w.__setitem__('status', 'failure'),
            'exit': lambda w: w.__setitem__('exitCode', 1),
            'incomplete': lambda w: w.__setitem__('activePid', 123),
            'missing-native': lambda w: w['outputs'].pop(),
            'wrong-command': lambda w: w['steps'][0]['argv'].__setitem__(6, 'mos-init'),
            'wrong-output': lambda w: w['outputs'][0].__setitem__('sha256', '9' * 64),
            'wrong-tool': lambda w: w['toolIdentity'].__setitem__('architecture', 'arm64'),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                value = json.loads(json.dumps(witness)); mutate(value)
                path = self.work / (name + '.json'); path.write_text(json.dumps(value))
                # Trust this fixture receipt only; exercise validation beyond its digest.
                with patch.multiple(h, JOIN_RECEIPTS={'native': hashlib.sha256(path.read_bytes()).hexdigest()}, JOIN_NATIVE=native), \
                        patch.dict(os.environ, PATH=self.env['PATH']):
                    if name == 'valid':
                        self.assertEqual(h.rebuilt_witness(path, 'native', self.package, {}), value)
                    else:
                        with self.assertRaises(ValueError):
                            h.rebuilt_witness(path, 'native', self.package, {})

    def test_startup_native_witness_preserves_exact_source_inputs_and_membership(self):
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('startup_witness', HELPER)
        h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
        digest = lambda value: hashlib.sha256(h.canonical(value)).hexdigest()
        bind = lambda p: dict(path=str(p), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        source = dict(commit='438c9551ec751fcb346881541752a7596f10cb15', tree='775874cfdce2ef40b7f51ae3090c6c6706a5deae', epoch=1789167215, version='0.1.0+git438c9551ec75-1')
        for p in (self.native, self.shutdown): p.chmod(0o755)
        outputs = [bind(p) for p in (self.native, self.shutdown)]
        native = {Path(p['path']).name: {k: p[k] for k in ('bytes', 'sha256')} for p in outputs}
        paths = ['build-env/from.sh', 'build-env/images.env', 'pkgs/mosd/Cargo.lock']
        source_inputs = [bind(self.package / p) for p in paths]
        relative_inputs = [dict(row, path=p) for row, p in zip(source_inputs, paths)]
        log = self.work / 'startup.log'; log.write_text('successful fixture execution\n')
        evidence = [bind(log)]
        execution = self.work / 'startup-execution.json'
        execution.write_text(json.dumps(dict(nativeRuntime=dict(exit=0, end='finished', removed=True),
            production=dict(source=source['commit'], tree=source['tree'], epoch=source['epoch'], clean=True, producer='boot',
                architecture='amd64', target='x86_64-unknown-linux-gnu', bins=['mos-init', 'mos-shutdown'],
                image='sha256:' + 'a' * 64, checkout=str(self.package), outputs=outputs,
                flags=['-C', 'target-feature=+crt-static', '-C', 'strip=symbols']), nativeEvidence=evidence)))
        witness = dict(schema='mos/startup-producer-witness/v1', status='success', exitCode=0, finishedAt='finished', activePid=None, activeStep=None,
            verifiedSource={k: source[k] for k in ('commit', 'tree', 'epoch')}, sourceCommit=source['commit'], sourceTree=source['tree'], sourceEpoch=source['epoch'], version=source['version'],
            sourceDirectory=str(self.package), environment={'SOURCE_DATE_EPOCH': str(source['epoch'])}, outputDirectory=str(self.work),
            runner=bind(log), wrapper=bind(log), toolIdentity=dict(id='sha256:' + 'a' * 64, architecture='amd64'), outputs=outputs,
            sourceInputs=source_inputs, executionReceipt=bind(execution), evidence=evidence,
            steps=[dict(name='native-build', exitCode=0, log=str(log), logSha256=evidence[0]['sha256'], stderr=str(log), stderrSha256=evidence[0]['sha256'],
                argv=['bash', 'pkgs/mos-deploy/hack/build-deb.sh', '--producer', 'boot', '--bins', 'mos-init mos-shutdown', '--arch', 'amd64', '--stage', str(self.work)])])
        mutations = {
            'valid': lambda w: None,
            'failed': lambda w: w.__setitem__('status', 'failure'),
            'nonzero': lambda w: w.__setitem__('exitCode', 1),
            'running': lambda w: w.__setitem__('activePid', 1),
            'source': lambda w: w.__setitem__('sourceCommit', 'f' * 40),
            'tree': lambda w: w.__setitem__('sourceTree', 'f' * 40),
            'epoch': lambda w: w['environment'].__setitem__('SOURCE_DATE_EPOCH', '1'),
            'version': lambda w: w.__setitem__('version', self.version),
            'tool': lambda w: w['toolIdentity'].__setitem__('architecture', 'arm64'),
            'command': lambda w: w['steps'][0]['argv'].__setitem__(6, 'mos-init'),
            'duplicate-step': lambda w: w['steps'].append(w['steps'][0]),
            'missing-native': lambda w: w['outputs'].pop(),
            'extra-native': lambda w: w['outputs'].append(w['outputs'][0]),
            'duplicate-native': lambda w: w['outputs'].__setitem__(1, w['outputs'][0]),
            'native-bytes': lambda w: w['outputs'][0].__setitem__('sha256', '9' * 64),
            'missing-input': lambda w: w['sourceInputs'].pop(),
            'extra-input': lambda w: w['sourceInputs'].append(w['sourceInputs'][0]),
            'input-bytes': lambda w: w['sourceInputs'][0].__setitem__('sha256', '9' * 64),
            'missing-evidence': lambda w: w['evidence'].clear(),
            'execution': lambda w: w['executionReceipt'].__setitem__('sha256', '9' * 64),
            'stderr': lambda w: w['steps'][0].__setitem__('stderrSha256', '9' * 64),
            'unknown': lambda w: w.__setitem__('waiver', True),
        }
        entries = h.tree(self.package, self.commit_id)
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                value = json.loads(json.dumps(witness)); mutate(value)
                at = self.work / (name + '-startup.json'); at.write_text(json.dumps(value))
                # Only fixed review anchors are replaced; all structure, source,
                # input/output bytes and terminal checks execute normally.
                with patch.multiple(h, create=True, STARTUP_NATIVE_RECEIPT=bind(at)['sha256'], STARTUP_NATIVE=native,
                    STARTUP_NATIVE_INPUTS_SHA=digest(relative_inputs), STARTUP_NATIVE_DELIVERY_SHA=bind(execution)['sha256'], STARTUP_RUST_IMAGE='sha256:' + 'a' * 64), \
                    patch.dict(os.environ, PATH=self.env['PATH']):
                    if name == 'valid': self.assertEqual(h.rebuilt_witness(at, 'startup-native', self.package, entries), value)
                    else:
                        with self.assertRaises(ValueError): h.rebuilt_witness(at, 'startup-native', self.package, entries)

    def test_joined_package_gate_refuses_duplicate_options_before_work(self):
        result = run('bash', str(REPO / 'tests/deb-package-gate.sh'), '--joined-inputs', 'one',
                     '--joined-inputs', 'two', '--receipt', 'three', '--receipt-sha256', 'four',
                     '--package-source', 'five', '--pool', str(self.pool), '--work', str(self.work / 'gate'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('duplicate or empty', result.stderr)
        self.assertFalse((self.work / 'gate').exists())

    def test_package_gate_consumer_cannot_enter_a_prepare_context(self):
        producer = self.package / 'rootfs/packages-src/fixture/producer.env'
        producer.parent.mkdir(parents=True)
        producer.write_text('BUILD_CONTEXTS="checks=tests"\nPREPARE="prepare.sh"\n')
        self.commit(self.package)
        consumer = self.work / 'gate-consumer'; self.must('git', 'clone', '-q', self.package, consumer)
        path = consumer / 'tests/deb-package-gate.sh'; path.parent.mkdir(parents=True)
        shutil.copyfile(REPO / 'tests/deb-package-gate.sh', path); self.commit(consumer)
        spec = importlib.util.spec_from_file_location('gate_context', HELPER)
        h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
        before_source, before = h.identity(self.package); after_source, after = h.identity(consumer)
        with self.assertRaisesRegex(ValueError, 'composition path enters producer context'):
            h.delta(self.package, consumer, before_source, after_source, before, after)

    def test_joined_pool_checks_each_witness_version_without_changing_default(self):
        spec = importlib.util.spec_from_file_location('joined_pool', HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        versions = {'mos-fixture': self.version}
        with (self.pool / 'Packages').open('a') as stream:
            stream.write('Maintainer: Fixture <fixture@example.invalid>\nDescription: isolated package\n')
        # The fields belong to the same paragraph, as in a real APT index.
        index = self.pool / 'Packages'
        index.write_text(index.read_text().replace('\n\nMaintainer:', '\nMaintainer:'))
        result = helper.pool_identity(self.pool, 'amd64', versions)
        self.assertEqual(result['packages'][0]['version'], self.version)
        with self.assertRaisesRegex(ValueError, 'stamp'):
            helper.pool_identity(self.pool, 'amd64', {'mos-fixture': '0.1.0+git' + 'b' * 12 + '-1'})
        with self.assertRaisesRegex(ValueError, 'membership'):
            helper.pool_identity(self.pool, 'amd64', {})
        with self.assertRaisesRegex(ValueError, 'membership'):
            helper.pool_identity(self.pool, 'amd64', {**versions, 'mos-extra': self.version})
        with self.assertRaisesRegex(ValueError, 'stamp'):
            helper.pool_identity(self.pool, 'amd64', '0.1.0+git' + 'b' * 12 + '-1')
        original = index.read_text()
        for addition in ('Depends: mos-system (= forged)\n', ' description mutation\n'):
            index.write_text(original.rstrip() + '\n' + addition + '\n')
            with self.assertRaisesRegex(ValueError, 'control/index'):
                helper.pool_identity(self.pool, 'amd64', versions)
        index.write_text(original)

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

class StartupInputContractTest(unittest.TestCase):
    """Direct fixed-contract failures; real source identities have a separate gate."""

    def setUp(self):
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('startup_inputs', HELPER)
        self.h = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.h)
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.old, self.new = (Path(self.temp.name) / n for n in ('old', 'new'))
        self.old.mkdir(); self.new.mkdir()
        self.removed = b'os-boot-busybox-package-test:\n\tbash tests/boot-busybox-package-test.sh\n\n'
        self.before = b'# fixture\n' + self.removed
        self.after = b'# fixture\n'
        self.hash = lambda v: hashlib.sha256(v).hexdigest()
        self.binding = lambda b, mode='100644': dict(mode=mode, blob=hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest(), bytes=len(b), sha256=self.hash(b))
        readers = {}
        for path in ('version.sh', 'build.sh', 'producers.sh', 'preflight.sh', 'repo.sh'):
            name = 'build-env/deb/' + path
            content = b'for p in "${REPO_ROOT}/Makefile"; do [ -e "$p" ] || exit 1; done\n'
            readers[name] = self.binding(content, '100755')
            for root in (self.old, self.new):
                at = root / name; at.parent.mkdir(parents=True, exist_ok=True); at.write_bytes(content); at.chmod(0o755)
        (self.old / 'Makefile').write_bytes(self.before); (self.new / 'Makefile').write_bytes(self.after)
        selected = {'board-x64': ['mos-board-x64'], 'deploy': ['mos-deploy'], 'mosd': ['mosd', 'mos-apid'],
                    'mqtt': ['mos-mqttd', 'mos-mqtt-broker'], 'podman': ['mos-podman'], 'bluetooth': ['mos-bluetooth'],
                    'busybox': ['mos-busybox'], 'ca-trust': ['mos-ca-trust'], 'profile': ['mos-profile-dev', 'mos-profile-prod'],
                    'system': ['mos-system'], 'wifi': ['mos-wifi', 'mos-wifi-ap']}
        unselected = {'board-cx3576': ['mos-board-cx3576'], 'board-s905x5m': ['mos-bm201-front-panel', 'mos-board-s905x5m', 'mos-s905x5m-wifi', 'mos-s905x5m-wireless'],
                      's905x5m-bluetooth': ['mos-s905x5m-bluetooth'], 'board-virt-arm64': ['mos-board-virt-arm64']}
        self.packages = sorted(p for ps in selected.values() for p in ps)
        self.maps = []
        for root, makefile in ((self.old, self.before), (self.new, self.after)):
            maps = {}
            for name, packages in (selected | unselected).items():
                env = 'fixtures/' + name + '/producer.env'
                content = ('ARCHES="' + ('arm64' if name in unselected else 'amd64') + '"\nPACKAGES="' + ' '.join(packages) + '"\n').encode()
                at = root / env; at.parent.mkdir(parents=True, exist_ok=True); at.write_bytes(content)
                entries = {'Makefile': {k: self.binding(makefile)[k] for k in ('mode', 'blob')}, env: {k: self.binding(content)[k] for k in ('mode', 'blob')}}
                entries.update({p: {k: v[k] for k in ('mode', 'blob')} for p, v in readers.items()})
                maps[name] = dict(contexts=['Makefile', 'build-env', 'fixtures/' + name], prepare=[], packages=[' '.join(packages)], inputs=entries)
            self.maps.append(maps)
        self.policy = patch.multiple(self.h, STARTUP_MAKEFILES=[self.binding(self.before), self.binding(self.after)], STARTUP_READERS=readers,
                                     STARTUP_MAP_SHAS=[self.hash(self.h.canonical(v)) for v in self.maps])
        self.policy.start(); self.addCleanup(self.policy.stop)

    def invoke(self):
        return self.h.startup_input_contract(self.old, self.new, *self.maps, self.packages)

    def test_complete_maps_keep_makefile_hashes_and_unselected_attribution(self):
        proof = self.invoke()
        self.assertEqual(len(proof['producers']), 15)
        self.assertEqual(proof['selected_packages'], self.packages)
        for name, row in proof['producers'].items():
            self.assertEqual(row['before'], self.maps[0][name])
            self.assertEqual(row['after'], self.maps[1][name])
            self.assertNotEqual(row['before_sha256'], row['after_sha256'])
            if name.startswith('board-') and name != 'board-x64' or name == 's905x5m-bluetooth':
                self.assertEqual(row['qualification'], 'recorded-unselected-not-qualified')
                self.assertIsNone(row['source_commit'])

    def test_makefile_and_reader_refusals(self):
        for change in ('extra-hunk', 'mode', 'missing', 'symlink', 'reader-content', 'reader-mode'):
            with self.subTest(change=change):
                at = self.new / ('build-env/deb/build.sh' if change.startswith('reader') else 'Makefile')
                content, mode = at.read_bytes(), at.stat().st_mode & 0o777
                try:
                    if change in ('extra-hunk', 'reader-content'): at.write_bytes(content + b'# changed\n')
                    elif change in ('mode', 'reader-mode'): at.chmod(0o644 if change.startswith('reader') else 0o755)
                    elif change == 'missing': at.unlink()
                    else:
                        at.unlink(); at.symlink_to(self.old / 'Makefile')
                    with self.assertRaises((ValueError, OSError)): self.invoke()
                finally:
                    if at.is_symlink(): at.unlink()
                    at.write_bytes(content); at.chmod(mode)

    def test_map_context_prepare_selection_and_declaration_refusals(self):
        import copy
        changes = {
            'selected-input': lambda m: m['wifi']['inputs'].__setitem__('other', dict(mode='100644', blob='a' * 40)),
            'reader-map': lambda m: m['mosd']['inputs']['build-env/deb/build.sh'].__setitem__('blob', 'b' * 40),
            'prepare': lambda m: m['mosd'].__setitem__('prepare', ['different.sh']),
            'context': lambda m: m['wifi']['contexts'].append('other'),
            'missing-map': lambda m: m.pop('board-virt-arm64'),
            'extra-map': lambda m: m.__setitem__('extra', copy.deepcopy(m['wifi'])),
            'arm-membership': lambda m: m['board-cx3576'].__setitem__('packages', ['mos-other']),
            'missing-makefile': lambda m: m['wifi']['inputs'].pop('Makefile'),
        }
        original = copy.deepcopy(self.maps[1])
        for name, mutate in changes.items():
            with self.subTest(change=name):
                self.maps[1] = copy.deepcopy(original); mutate(self.maps[1])
                with self.assertRaises(ValueError): self.invoke()
        self.maps[1] = original
        for change in ('arm-selected', 'duplicate-selected', 'missing-selected', 'changed-arches'):
            with self.subTest(change=change):
                packages = self.packages[:]; env = self.new / 'fixtures/board-cx3576/producer.env'; content = env.read_bytes()
                try:
                    if change == 'arm-selected': self.packages.append('mos-board-cx3576')
                    elif change == 'duplicate-selected': self.packages.append('mosd')
                    elif change == 'missing-selected': self.packages.pop()
                    else: env.write_bytes(content.replace(b'arm64', b'amd64'))
                    with self.assertRaises(ValueError): self.invoke()
                finally: self.packages = packages; env.write_bytes(content)

    def test_startup_sources_and_each_reviewed_delta_leg_are_fixed(self):
        from unittest.mock import patch
        h = self.h
        before = {'fixture': dict(mode='100644', blob='1' * 40)}
        middle = {'fixture': dict(mode='100644', blob='2' * 40)}
        after = {'fixture': dict(mode='100644', blob='3' * 40)}
        leg = lambda a, b: [dict(path='fixture', before=a['fixture'], after=b['fixture'])]
        with patch.object(h, 'command', return_value=b''), patch.object(h, 'tree', return_value=middle), \
             patch.object(h, 'producer_inputs', side_effect=lambda root, entries: self.maps[root == self.new]), \
             patch.multiple(h, JOIN_DELTA_SHA=self.hash(h.canonical(leg(before, middle))),
                            STARTUP_DELTA_SHA=self.hash(h.canonical(leg(middle, after)))):
            delta, proof = h.startup_join_delta(self.old, self.new, h.JOIN_ORIGINAL, h.STARTUP_REBUILT, before, after, self.packages)
            self.assertEqual(set(delta), {'original_to_shutdown', 'shutdown_to_startup'})
            self.assertEqual(proof['selected_packages'], self.packages)
            for change in ('original-source', 'rebuilt-source', 'first-leg', 'second-leg'):
                with self.subTest(change=change):
                    original, rebuilt = dict(h.JOIN_ORIGINAL), dict(h.STARTUP_REBUILT)
                    first, last = dict(before), dict(after)
                    if change == 'original-source': original['epoch'] += 1
                    elif change == 'rebuilt-source': rebuilt['commit'] = h.JOIN_REBUILT['commit']
                    elif change == 'first-leg': first['extra'] = dict(mode='100644', blob='4' * 40)
                    else: last['extra'] = dict(mode='100644', blob='4' * 40)
                    with self.assertRaises(ValueError): h.startup_join_delta(self.old, self.new, original, rebuilt, first, last, self.packages)

@unittest.skipUnless(os.environ.get('MOS_TEST_STARTUP_RECORD'), 'requires actual startup production fixture')
class StartupAdmissionTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('startup_admission', HELPER)
        self.h = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.h)
        self.record = self.h.load(Path(os.environ['MOS_TEST_STARTUP_RECORD']))

    def test_actual_startup_record_is_admitted_with_four_exact_witness_roles(self):
        self.assertEqual(self.h.validate(self.record, 'amd64', 1577836800), self.record)
        self.assertEqual(len(self.record['receipt_sha256']), 4)

    def test_actual_startup_record_refuses_source_witness_map_pool_and_default_mutations(self):
        cases = {
            'source': lambda r: r['producer_join']['rebuilt_source'].__setitem__('epoch', 1),
            'native': lambda r: r['producer_join']['native']['mos-init'].__setitem__('bytes', 1),
            'missing-witness': lambda r: r['producer_join']['witnesses'].pop('boot_tools'),
            'extra-witness': lambda r: r['producer_join']['witnesses'].__setitem__('extra', '1' * 64),
            'failed-witness': lambda r: r['producer_join']['witnesses'].__setitem__('deploy', '0' * 64),
            'duplicate-receipt': lambda r: r['receipt_sha256'].append(r['receipt_sha256'][0]),
            'false-attribution': lambda r: r['producer_join']['mapping'].__setitem__('mosd', '0' * 40),
            'prepare': lambda r: r['producer_join']['producer_inputs']['producers']['deploy']['after']['prepare'].append('other.sh'),
            'missing-map': lambda r: r['producer_join']['producer_inputs']['producers'].pop('board-cx3576'),
            'extra-map': lambda r: r['producer_join']['producer_inputs']['producers'].__setitem__('extra', {}),
            'read-contract': lambda r: r['producer_join']['producer_inputs']['makefile_read_contract'].__setitem__('use', 'evaluate'),
            'tool': lambda r: r['producer_join']['production']['boot_tools'].__setitem__('image', 'sha256:' + '0' * 64),
            'lock': lambda r: r['producer_join']['production']['deploy'].__setitem__('inputs_sha256', '0' * 64),
            'leg': lambda r: r['producer_join']['approved_delta']['shutdown_to_startup'].pop(),
            'archive': lambda r: r['pool']['packages'][0].__setitem__('control_sha256', '0' * 64),
            'index': lambda r: r['pool']['files'].__setitem__('Packages', '0' * 64),
            'old-role': lambda r: r['producer_join'].__setitem__('schema', 'mos/producer-join/v1'),
            'default': lambda r: r.__setitem__('schema', 'mos/source-lineage/v1'),
            'unapproved-consumer': lambda r: r['delta'].append(dict(path='pkgs/mos-deploy/Cargo.lock', before=None, after=dict(mode='100644', blob='1' * 40))),
            'arch': lambda r: r.__setitem__('architecture', 'arm64'),
        }
        for name, mutate in cases.items():
            with self.subTest(case=name):
                changed = json.loads(json.dumps(self.record)); mutate(changed)
                with self.assertRaises(ValueError): self.h.validate(changed, 'amd64', 1577836800)

    @unittest.skipUnless(os.environ.get('MOS_TEST_STARTUP_WITNESSES'), 'requires actual successor witnesses')
    def test_actual_successor_receipts_and_mutations(self):
        from unittest.mock import patch
        directory = Path(os.environ['MOS_TEST_STARTUP_WITNESSES'])
        for kind, filename in [('deploy', 'deploy.json'), ('boot_tools', 'boot-tools.json')]:
            path = directory / filename; value = self.h.load(path); root = Path(value['sourceDirectory'])
            entries = self.h.tree(root, self.h.STARTUP_REBUILT['commit'])
            self.assertEqual(self.h.startup_successor_witness(path, kind, root, entries), value)
            mutations = {
                'status': lambda v: v.__setitem__('status', 'failure'),
                'exit': lambda v: v.__setitem__('exitCode', 1),
                'source': lambda v: v['source'].__setitem__('commit', self.h.JOIN_REBUILT['commit']),
                'role': lambda v: v.__setitem__('kind', 'native'),
                'missing-input': lambda v: v['sourceInputs'].pop(),
                'duplicate-input': lambda v: v['sourceInputs'].append(v['sourceInputs'][0]),
                'input-mode': lambda v: v['sourceInputs'][0].__setitem__('mode', '120000'),
                'command': lambda v: v['argv'].append('--unreviewed'),
                'missing-evidence': lambda v: v['evidence'][0].__setitem__('path', '/nonexistent/startup-witness'),
                'changed-output': lambda v: v['outputs'][0].__setitem__('bytes', 1),
                'duplicate-evidence': lambda v: v['evidence'].append(v['evidence'][0]),
            }
            with tempfile.TemporaryDirectory(dir=REPO / '.tmp') as temp:
                altered = Path(temp) / filename
                for name, mutate in mutations.items():
                    with self.subTest(kind=kind, mutation=name):
                        changed = json.loads(json.dumps(value)); mutate(changed)
                        altered.write_bytes(self.h.canonical(changed))
                        with self.assertRaises(ValueError): self.h.startup_successor_witness(altered, kind, root, entries)
                        # Move only the outer digest in this unit fixture to
                        # exercise semantic and actual-file guards underneath.
                        pins = dict(self.h.STARTUP_RECEIPTS, **{kind: self.h.sha(altered)})
                        with patch.object(self.h, 'STARTUP_RECEIPTS', pins):
                            with self.assertRaises((ValueError, OSError)):
                                self.h.startup_successor_witness(altered, kind, root, entries)
