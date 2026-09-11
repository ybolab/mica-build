"""Exercise the final packing entry against real small installed trees."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
import unittest

from selection_test import SelectionTest, elf

REPO = Path(__file__).resolve().parents[2]
COMPOSE = REPO / 'rootfs/runtime/compose.py'


class CompositionTest(unittest.TestCase):
    def setUp(self):
        self.f = SelectionTest()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        self.inputs = f.base / 'inputs'
        self.inputs.mkdir()
        shutil.copytree(f.db, self.inputs / 'info')
        shutil.copyfile(f.manifest, self.inputs / 'manifest.tsv')
        shutil.copyfile(f.packages, self.inputs / 'selected.pkgs')
        (self.inputs / 'upstream.tsv').write_text('libfixture\t1\tamd64\t' + 'a' * 64 + '\thttps://example.invalid/library.deb\tmos-system\nunused\t1\tall\t' + 'b' * 64 + '\thttps://example.invalid/unused.deb\tbase\n')
        (self.inputs / 'Packages').write_text('Package: mos-system\nVersion: 1\nArchitecture: all\nFilename: pool/mos-system.deb\nSHA256: ' + 'c' * 64 + '\n\n')
        (self.inputs / 'sources.tsv').write_text('mos-system\tmos-system\t1\nlibfixture\tfixture-source\t1\nunused\tunused\t1\n')
        (self.inputs / 'alternatives').mkdir()
        (self.inputs / 'enablement').mkdir()
        (self.inputs / 'preset-removed.tsv').write_text('')
        f.write('/usr/share/mos/manifest.tsv', f.manifest.read_bytes())
        f.rules['consumers']['mos-system']['roots'].append({'paths': ['/usr/share/mos', '/usr/share/mos/manifest.tsv'], 'kind': 'resource', 'reason': 'shipping inventory', 'generated': 'runtime composition'})
        # An unselected executable is an operator omission, even when owned.
        f.root.joinpath('usr/bin/unselected').unlink()
        f.rules_path.write_text(json.dumps(f.rules))
        self.debug = f.base / 'debug'
        self.debug.mkdir()
        (self.debug / 'manifest.tsv').write_text('#path\tbuild-id\tdebug\tbytes-before\tbytes-after\tsha256-after\n')

    def command(self, action, **options):
        argv = [sys.executable, str(COMPOSE), action]
        for name, value in options.items():
            argv += ['--' + name.replace('_', '-'), str(value)]
        return subprocess.run(argv, capture_output=True, text=True, timeout=15)

    def capture(self):
        (self.inputs / 'alternative-names.txt').write_text(''.join(p.name + '\n' for p in sorted((self.inputs / 'alternatives').iterdir())))
        (self.inputs / 'enablement-names.txt').write_text(''.join(p.name + '\n' for p in sorted((self.inputs / 'enablement').glob('*.dsh-also'))))
        r = self.command('snapshot', root=self.f.root, output=self.inputs / 'configured.json')
        self.assertEqual(r.returncode, 0, r.stderr)

    def compose(self):
        return self.command('compose', root=self.f.root, output=self.f.out, inputs=self.inputs,
                            rules=self.f.rules_path, arch='amd64', epoch=1000000000,
                            debug=self.debug, report=self.f.report)

    def test_pack_entry_selects_real_paths_and_metadata(self):
        self.capture()
        self.f.write('/var/lib/dpkg/status', b'build database')
        self.f.write('/mos-compose/archive.deb', b'build archive')
        self.f.write('/.debian-extra/bootstrap', b'bootstrap')
        self.f.write('/usr/lib/udev/hwdb.bin', b'hwdb')
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        report = json.loads(self.f.report.read_text())
        self.assertTrue(self.f.out.joinpath('usr/bin/app').is_file())
        for path in ['var/lib/dpkg', 'mos-compose', '.debian-extra', 'usr/lib/udev/hwdb.bin', 'usr/lib/debug', 'usr/lib/modules/modules.dep']:
            self.assertFalse(self.f.out.joinpath(path).exists(), path)
        self.assertEqual(os.readlink(self.f.out / 'etc/systemd/system-generators/systemd-ssh-generator'), '/dev/null')
        self.assertEqual(os.readlink(self.f.out / 'var/log/wtmp'), '/run/mos/wtmp')
        self.assertEqual((self.f.out / 'var/lib/seed').stat().st_ino, (self.f.out / 'var/lib/seed-alias').stat().st_ino)
        self.assertEqual((self.f.out / 'var/lib/seed').stat().st_uid, 123)
        self.assertEqual(os.getxattr(self.f.out / 'var/lib/seed', 'user.fixture'), b'value')
        self.assertEqual(os.getxattr(self.f.out / 'usr/bin/captool', 'security.capability'), os.getxattr(self.f.root / 'usr/bin/captool', 'security.capability'))
        self.assertNotIn('unused\t', (self.f.out / 'usr/share/mos/manifest.tsv').read_text())
        self.assertEqual({p['package'] for p in report['provenance']['build_packages']}, {'mos-system', 'libfixture', 'unused'})
        self.assertEqual({p['package'] for p in report['provenance']['shipped_packages']}, {'mos-system', 'libfixture'})
        self.assertLess(report['measurements']['unique_file_bytes'], report['measurements']['apparent_file_bytes'])
        self.assertEqual(report['measurements']['runtime_allocation'], 'pending B7 guest evidence')
        check = subprocess.run([sys.executable, str(REPO / 'rootfs/runtime/select.py'), 'verify', '--root', str(self.f.out), '--report', str(self.f.report)], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_missing_required_path_is_not_filtered(self):
        self.capture()
        self.f.root.joinpath('usr/bin/app').unlink()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('missing path', r.stderr)
        self.assertFalse(self.f.report.exists())

    def test_missing_archive_identity_refuses(self):
        self.capture()
        (self.inputs / 'upstream.tsv').write_text('')
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('archive identity', r.stderr)
        self.assertFalse(self.f.report.exists())

    def test_surviving_operator_omission_refuses(self):
        self.capture()
        self.f.write('/usr/bin/unselected', elf(), 0o755)
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('operator executable omitted: /usr/bin/unselected', r.stderr)
        self.assertFalse(self.f.report.exists())

    def test_post_transform_hash_and_debug_counterpart(self):
        self.capture()
        before = hashlib.sha256(self.f.root.joinpath('usr/bin/app').read_bytes()).hexdigest()
        self.f.write('/usr/bin/app', elf(), 0o755)
        after = hashlib.sha256(self.f.root.joinpath('usr/bin/app').read_bytes()).hexdigest()
        debug = self.debug / '.build-id/ab/cd.debug'
        debug.parent.mkdir(parents=True)
        debug.write_bytes(b'fixture symbols')
        (self.debug / 'manifest.tsv').write_text(f'/usr/bin/app\tabcd\t.build-id/ab/cd.debug\t2048\t2048\t{after}\n')
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        provenance = json.loads(self.f.report.read_text())['provenance']['files']['/usr/bin/app']
        self.assertEqual(provenance['configured']['sha256'], before)
        self.assertEqual(provenance['final']['sha256'], after)
        self.assertEqual(provenance['debug']['sha256'], hashlib.sha256(debug.read_bytes()).hexdigest())

    def test_debug_mismatch_refuses(self):
        self.capture()
        (self.debug / 'manifest.tsv').write_text('/usr/bin/app\tabcd\t.build-id/ab/cd.debug\t2048\t2048\t' + '0' * 64 + '\n')
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('debug counterpart', r.stderr)
        self.assertFalse(self.f.report.exists())

    def test_explicit_residue_rule_is_refused(self):
        self.f.write('/var/lib/dpkg/status', b'build database')
        self.f.rules['consumers']['mos-system']['roots'].append({'paths': ['/var/lib/dpkg', '/var/lib/dpkg/status'], 'kind': 'resource', 'reason': 'invalid build-state root', 'generated': 'fixture'})
        self.f.rules_path.write_text(json.dumps(self.f.rules))
        self.capture()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('build residue selected', r.stderr)
        self.assertFalse(self.f.report.exists())

    def test_transfer_compares_hardlinks_and_capabilities(self):
        self.capture()
        copy = self.f.base / 'transferred'
        copy.mkdir()
        archive = self.f.base / 'tree.tar'
        subprocess.run(['tar', '-C', str(self.f.root), '--numeric-owner', '--xattrs', '--xattrs-include=*', '-cf', str(archive), '.'], check=True)
        subprocess.run(['tar', '-C', str(copy), '--same-owner', '--xattrs', '--xattrs-include=*', '-xf', str(archive)], check=True)
        r = self.command('compare', root=copy, snapshot=self.inputs / 'configured.json')
        self.assertEqual(r.returncode, 0, r.stderr)
        alias = copy / 'var/lib/seed-alias'
        saved = copy / 'var/lib/seed'
        alias.unlink()
        shutil.copy2(saved, alias)
        os.chown(alias, 123, 456)
        r = self.command('compare', root=copy, snapshot=self.inputs / 'configured.json')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('transfer changed', r.stderr)

    def test_native_alternative_capture_retains_exact_alias(self):
        self.f.link('/usr/bin/fixture-alias', '/etc/alternatives/fixture-alias')
        self.f.link('/etc/alternatives/fixture-alias', '/usr/bin/helper')
        (self.inputs / 'alternatives/fixture-alias').write_text('Name: fixture-alias\nLink: /usr/bin/fixture-alias\nStatus: auto\nBest: /usr/bin/helper\nValue: /usr/bin/helper\n\nAlternative: /usr/bin/helper\nPriority: 1\n')
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.readlink(self.f.out / 'etc/alternatives/fixture-alias'), '/usr/bin/helper')

    def test_native_enablement_retains_configured_link(self):
        link = '/etc/systemd/system/multi-user.target.wants/fixture.service'
        target = '/usr/lib/systemd/system/fixture.service'
        self.f.write(target, b'[Service]\nExecStart=/usr/bin/helper\n')
        self.f.link(link, target)
        self.f.capture_ownership()
        native = self.f.db / 'mos-system.list'
        native.write_text(native.read_text().replace(link + '\n', ''))
        shutil.copyfile(native, self.inputs / 'info/mos-system.list')
        (self.inputs / 'enablement/fixture.service.dsh-also').write_text(link + '\n')
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.readlink(self.f.out / link[1:]), target)

    def test_lost_configured_enablement_refuses(self):
        link = '/etc/systemd/system/multi-user.target.wants/fixture.service'
        self.f.link(link, '/usr/bin/helper')
        (self.inputs / 'enablement/fixture.service.dsh-also').write_text(link + '\n')
        self.capture()
        self.f.root.joinpath(link[1:]).unlink()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('missing path', r.stderr)

    def test_preset_removal_uses_exact_record_and_retained_policy(self):
        link = '/etc/systemd/system/multi-user.target.wants/fixture.service'
        policy = '/usr/lib/systemd/system-preset/fixture.preset'
        self.f.write(policy, b'disable fixture.service\n')
        self.f.link(link, '/usr/bin/helper')
        self.f.capture_ownership()
        native = self.f.db / 'mos-system.list'
        native.write_text(native.read_text().replace(link + '\n', ''))
        shutil.copyfile(native, self.inputs / 'info/mos-system.list')
        (self.inputs / 'enablement/fixture.service.dsh-also').write_text(link + '\n')
        self.capture()
        self.f.root.joinpath(link[1:]).unlink()
        (self.inputs / 'preset-removed.tsv').write_text(link + '\t' + policy + '\n')
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.f.out.joinpath(link[1:]).is_symlink())
        self.assertEqual(self.f.out.joinpath(policy[1:]).read_bytes(), b'disable fixture.service\n')

    def test_alternative_manual_slave_needs_exact_install_exclusion(self):
        self.f.link('/usr/bin/fixture-alias', '/etc/alternatives/fixture-alias')
        self.f.link('/etc/alternatives/fixture-alias', '/usr/bin/helper')
        (self.inputs / 'alternatives/fixture-alias').write_text('Name: fixture-alias\nLink: /usr/bin/fixture-alias\nSlaves:\n fixture-alias.1.gz /usr/share/man/man1/fixture-alias.1.gz\nStatus: auto\nBest: /usr/bin/helper\nValue: /usr/bin/helper\n\nAlternative: /usr/bin/helper\nPriority: 1\nSlaves:\n fixture-alias.1.gz /usr/share/man/man1/helper.1.gz\n')
        (self.inputs / 'dpkg-slim.conf').write_text('path-exclude /usr/share/man/*\n')
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.f.out.joinpath('usr/share/man').exists())

    def test_current_policy_resources_survive_final_composition(self):
        anchors = ['/etc/systemd/system/mos-load-extensions.service',
                   '/etc/systemd/system/usr-local-lib-systemd-system.mount',
                   '/etc/systemd/system/etc-containers-systemd.mount',
                   '/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf',
                   '/etc/tmpfiles.d/mos-var.conf']
        for path in anchors:
            self.f.write(path, (REPO / 'rootfs/overlay' / path[1:]).read_bytes())
        self.f.rules['consumers']['mos-system']['roots'].append({'paths': anchors, 'kind': 'resource', 'reason': 'current policy resources'})
        self.f.rules_path.write_text(json.dumps(self.f.rules))
        self.f.capture_ownership()
        shutil.copyfile(self.f.db / 'mos-system.list', self.inputs / 'info/mos-system.list')
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        for path in anchors:
            self.assertEqual(self.f.out.joinpath(path[1:]).read_bytes(), (REPO / 'rootfs/overlay' / path[1:]).read_bytes())

    def public_metadata(self, marker=None):
        producer = 'rootfs/build.sh public-meta staging; compose-install.sh meta_install'
        rules = json.loads((REPO / 'rootfs/runtime/consumers.json').read_text())
        rule = next(r for r in rules['consumers']['mos-system']['roots'] if r.get('generated') == producer)
        self.f.rules['consumers']['mos-system']['roots'].append(rule)
        self.f.rules_path.write_text(json.dumps(self.f.rules))
        self.f.write('/usr/share/mos/meta/updates/manifest.json', (REPO / 'meta.example/updates/manifest.json').read_bytes())
        if marker is not None:
            self.f.write('/usr/share/mos/meta/GENERATED', marker)

    def test_current_public_manifest_and_conditional_marker_survive(self):
        self.public_metadata(b'DEVELOPMENT-GRADE\nDOMAINS=boot verity updates\n')
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        report = json.loads(self.f.report.read_text())
        for path in ['/usr/share/mos/meta/updates/manifest.json', '/usr/share/mos/meta/GENERATED']:
            self.assertEqual(self.f.out.joinpath(path.lstrip('/')).read_bytes(), self.f.root.joinpath(path.lstrip('/')).read_bytes())
            provenance = report['provenance']['files'][path]
            self.assertEqual(provenance['configured']['sha256'], provenance['final']['sha256'])
            self.assertEqual(provenance['generators'], ['rootfs/build.sh public-meta staging; compose-install.sh meta_install'])
            self.assertEqual(provenance['final']['mode'], 0o644)

    def test_absent_public_marker_stays_absent(self):
        self.public_metadata()
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.f.out.joinpath('usr/share/mos/meta/GENERATED').exists())

    def test_changed_or_lost_public_input_refuses(self):
        self.public_metadata(b'DEVELOPMENT-GRADE\nDOMAINS=boot\n')
        self.capture()
        self.f.root.joinpath('usr/share/mos/meta/GENERATED').unlink()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('public metadata', r.stderr)

    def test_public_manifest_tamper_refuses(self):
        self.public_metadata()
        self.capture()
        self.f.write('/usr/share/mos/meta/updates/manifest.json', b'{}')
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('public metadata', r.stderr)

    def test_empty_installed_public_marker_refuses(self):
        self.public_metadata(b'')
        self.capture()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('public metadata', r.stderr)

    def test_uncaptured_public_metadata_refuses(self):
        self.f.write('/usr/share/mos/meta/fixture.json', b'{}')
        self.capture()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('undeclared public metadata: /usr/share/mos/meta/fixture.json', r.stderr)

    def test_unknown_public_metadata_directory_refuses(self):
        self.public_metadata()
        self.f.root.joinpath('usr/share/mos/meta/unapproved').mkdir()
        self.capture()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('undeclared public metadata: /usr/share/mos/meta/unapproved', r.stderr)

    def test_missing_native_producer_capture_refuses(self):
        (self.inputs / 'enablement/fixture.service.dsh-also').write_text('/etc/systemd/system/fixture.service\n')
        self.capture()
        (self.inputs / 'enablement/fixture.service.dsh-also').unlink()
        r = self.compose()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('captured native outputs changed: enablement', r.stderr)

    def test_allocated_bytes_measure_the_selected_destination(self):
        sparse = self.f.root / 'var/lib/sparse'
        with sparse.open('wb') as stream:
            stream.seek(1024 * 1024)
            stream.write(b'x')
        self.f.rules['consumers']['mos-system']['roots'].append({'paths': ['/var/lib/sparse'], 'kind': 'resource', 'reason': 'sparse fixture', 'generated': 'fixture'})
        self.f.rules_path.write_text(json.dumps(self.f.rules))
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        report = json.loads(self.f.report.read_text())
        groups = {r['hardlink'] for r in report['files'] if r['type'] == 'file'}
        actual = sum(self.f.out.joinpath(p.lstrip('/')).stat().st_blocks * 512 for p in groups)
        self.assertEqual(report['measurements']['allocated_file_bytes'], actual)

    def test_packed_measurement_binds_prefix_and_complete_image(self):
        self.capture()
        r = self.compose()
        self.assertEqual(r.returncode, 0, r.stderr)
        data, hashes = b'fixture compressed root', b'fixture verity hash bytes'
        (self.f.base / 'rootfs-verity.img').write_bytes(data + hashes)
        (self.f.base / 'rootfs-verity.env').write_text(f'SQUASHFS_BYTES={len(data)}\nIMAGE_BYTES={len(data + hashes)}\n')
        r = self.command('measure-packed', root=self.f.out, out=self.f.base)
        self.assertEqual(r.returncode, 0, r.stderr)
        m = json.loads(self.f.report.read_text())['measurements']
        self.assertEqual(m['squashfs']['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(m['verity_image']['sha256'], hashlib.sha256(data + hashes).hexdigest())
        self.f.out.joinpath('usr/bin/app').write_bytes(b'changed')
        r = self.command('measure-packed', root=self.f.out, out=self.f.base)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('metadata or bytes changed', r.stderr)

    def test_current_transform_exclusions_are_exact(self):
        f = self.f
        with (f.db / 'mos-system.list').open('a') as stream:
            stream.write('/usr/bin/systemd-hwdb\n/usr/sbin/pam_getenv\n')
        f.rules['consumers']['mos-system']['roots'].append({'paths': ['/usr/bin/systemd-hwdb', '/usr/sbin/pam_getenv', '/usr/bin/app'], 'packages': ['mos-system'], 'kind': 'executable', 'reason': 'approved transformation survivors'})
        r = f.command()
        self.assertEqual(r.returncode, 0, r.stderr)
        shutil.rmtree(f.out)
        f.report.unlink()
        with (f.db / 'mos-system.list').open('a') as stream:
            stream.write('/usr/bin/required-new-tool\n')
        f.rules['consumers']['mos-system']['roots'][-1]['paths'].append('/usr/bin/required-new-tool')
        r = f.command()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('required-new-tool', r.stderr)

    def test_actual_docker_pack_uses_final_selection(self):
        dockerfile = (REPO / 'rootfs/compose/90-pack.Dockerfile').read_text()
        selection = dockerfile.index('python3 /mos-runtime/compose.py compose')
        squash = dockerfile.index('sh /mos-scripts/pack-squashfs.sh')
        self.assertLess(selection, squash)
        self.assertIn('RUN --network=none', dockerfile[:selection].rsplit('\n#', 1)[-1])
        self.assertIn('COPY --from=pack /runtime/ /', dockerfile)
        self.assertIn('rootfs-report.runtime.json', dockerfile)
        self.assertIn('mksquashfs /runtime ', (REPO / 'rootfs/scripts/pack-squashfs.sh').read_text())


if __name__ == '__main__':
    unittest.main()
