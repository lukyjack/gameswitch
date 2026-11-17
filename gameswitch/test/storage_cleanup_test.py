import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import contextlib
import fcntl
import types

spec = importlib.util.spec_from_file_location('storage_cleanup', Path(__file__).parents[1] / 'deploy/storage-cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'isolated Linux root test required')
class StorageCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        cleanup.LIBRARY = base / 'libraries'
        cleanup.PRIVATE = base / 'private'
        cleanup.LIBRARY.mkdir(mode=0o755)
        cleanup.PRIVATE.mkdir(mode=0o700)
        (cleanup.PRIVATE / 'dayz').mkdir(mode=0o700)
        (cleanup.PRIVATE / 'dayz' / 'download').mkdir(mode=0o700)
        os.chown(cleanup.PRIVATE / 'dayz' / 'download', 1000, 1000)
        (cleanup.PRIVATE / 'steam-home').mkdir(mode=0o700)
        (cleanup.PRIVATE / 'steam-home' / 'login').write_text('preserve')
        self.old = cleanup.LIBRARY / 'dayz.previous.20261117T170126Z.18ede4e1'
        self.old.mkdir()
        (self.old / 'game.bin').write_bytes(b'data')
        (cleanup.LIBRARY / 'dayz').mkdir()
        (cleanup.LIBRARY / 'dayz' / 'server').mkdir()
        self.manifest = {'schema': 1, 'gameId': 'dayz', 'appId': '223350', 'ready': True, 'workshopIds': [], 'runtimeImage': 'gameswitch.invalid/dayz-runtime:1'}
        (cleanup.LIBRARY / 'dayz' / 'manifest.json').write_text(json.dumps(self.manifest))
        binary = cleanup.LIBRARY / 'dayz' / 'server' / 'DayZServer'
        binary.write_text('game')
        binary.chmod(0o755)
        (cleanup.LIBRARY / 'dayz' / 'game.bin').write_text('current')
        self.backups = base / 'backups'
        self.backups.mkdir()
        (self.backups / 'world').write_text('preserve')

    def tearDown(self):
        self.temp.cleanup()

    def test_preview_and_individual_delete_preserves_other_data(self):
        items = cleanup.snapshot()
        self.assertEqual({(i['kind'], i['id']) for i in items}, {
            ('cache', 'dayz'), ('previous', self.old.name)})
        old = next(item for item in items if item['kind'] == 'previous')
        cleanup.cleanup(old['kind'], old['id'], old['version'])
        self.assertFalse(self.old.exists())
        self.assertEqual((cleanup.LIBRARY / 'dayz' / 'game.bin').read_text(), 'current')
        self.assertTrue((self.backups / 'world').exists())
        self.assertTrue((cleanup.PRIVATE / 'steam-home' / 'login').exists())
        self.assertTrue((cleanup.PRIVATE / 'dayz' / 'download').exists())

    def test_invalid_path_and_stale_version_are_rejected(self):
        cache = next(item for item in cleanup.snapshot() if item['kind'] == 'cache')
        with self.assertRaises(cleanup.CleanupError):
            cleanup.cleanup('cache', '../../steam-home', cache['version'])
        with self.assertRaises(cleanup.CleanupError):
            cleanup.cleanup('cache', 'dayz', '0:0:0')
        self.assertTrue((cleanup.PRIVATE / 'dayz' / 'download').exists())

    def test_symlink_within_cache_never_removes_its_target(self):
        external = self.backups / 'world'
        cache_dir = cleanup.PRIVATE / 'dayz' / 'download'
        (cache_dir / 'linked').symlink_to(external)
        cache = next(item for item in cleanup.snapshot() if item['kind'] == 'cache')
        cleanup.cleanup(cache['kind'], cache['id'], cache['version'])
        self.assertEqual(external.read_text(), 'preserve')

    def test_mounted_path_is_refused(self):
        with self.assertRaises(cleanup.CleanupError):
            cleanup.tree_size(Path('/proc'), os.stat('/proc').st_dev)

    def test_invalid_current_library_keeps_previous_copy(self):
        old = next(item for item in cleanup.snapshot() if item['kind'] == 'previous')
        manifest = cleanup.LIBRARY / 'dayz' / 'manifest.json'
        invalid = [
            {},
            {**self.manifest, 'appId': 'wrong'},
            {**self.manifest, 'schema': True},
            {**self.manifest, 'workshopIds': ['12345;bad']},
            {**self.manifest, 'workshopIds': ['12345', '12345']},
            {**self.manifest, 'workshopIds': ['12345']},
            {**self.manifest, 'runtimeImage': 'other'},
        ]
        for value in invalid:
            with self.subTest(manifest=value):
                manifest.write_text(json.dumps(value))
                with self.assertRaises((cleanup.CleanupError, OSError)):
                    cleanup.cleanup(old['kind'], old['id'], old['version'])
                self.assertTrue(self.old.exists())
        manifest.write_text(json.dumps(self.manifest))
        binary = cleanup.LIBRARY / 'dayz' / 'server' / 'DayZServer'
        binary.unlink()
        with self.assertRaises((cleanup.CleanupError, OSError)):
            cleanup.cleanup(old['kind'], old['id'], old['version'])
        self.assertTrue(self.old.exists())

    def test_uid_1000_download_parent_and_child_are_supported(self):
        game = cleanup.PRIVATE / 'dayz'
        os.chown(game, 1000, 1000)
        item = next(item for item in cleanup.snapshot() if item['kind'] == 'cache')
        cleanup.cleanup(item['kind'], item['id'], item['version'])
        self.assertFalse((game / 'download').exists())
        self.assertTrue((cleanup.PRIVATE / 'steam-home' / 'login').exists())

    def test_symlink_manifest_is_not_followed(self):
        manifest = cleanup.LIBRARY / 'dayz' / 'manifest.json'
        manifest.unlink()
        manifest.symlink_to(self.backups / 'world')
        old = next(item for item in cleanup.snapshot() if item['kind'] == 'previous')
        with self.assertRaises((cleanup.CleanupError, OSError)):
            cleanup.cleanup(old['kind'], old['id'], old['version'])
        self.assertTrue(self.old.exists())

    def test_prepare_lock_blocks_preview_and_delete(self):
        fake = types.SimpleNamespace(preparation_marker=lambda _: contextlib.nullcontext(), assert_idle=lambda: None)
        lock = (cleanup.PRIVATE / 'prepare.lock').open('w')
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with mock.patch.object(cleanup.importlib.util, 'module_from_spec', return_value=fake), \
                 mock.patch.object(cleanup.importlib.machinery.SourceFileLoader, 'exec_module'), \
                 mock.patch.object(cleanup, 'assert_private_idle'):
                with self.assertRaises(cleanup.CleanupError):
                    cleanup.run({'type': 'cleanup-preview'})
        finally:
            lock.close()

    def test_preview_and_delete_through_locked_entrypoint(self):
        helper = Path(self.temp.name) / 'steam-library'
        helper.write_text('import contextlib\nclass LibraryError(Exception): pass\ndef preparation_marker(root): return contextlib.nullcontext()\ndef assert_idle(): pass\n')
        old_helper = cleanup.HELPER
        cleanup.HELPER = str(helper)
        try:
            with mock.patch.object(cleanup, 'assert_private_idle'):
                preview = cleanup.run({'type': 'cleanup-preview'})
                old = next(item for item in preview['items'] if item['kind'] == 'previous')
                result = cleanup.run({'type': 'cleanup-delete', 'kind': old['kind'], 'id': old['id'], 'version': old['version']})
            self.assertEqual(result, {'deleted': True})
            self.assertFalse(self.old.exists())
            self.assertTrue((cleanup.PRIVATE / 'steam-home' / 'login').exists())
        finally:
            cleanup.HELPER = old_helper

    def test_sigterm_unwinds_own_marker(self):
        script = r'''
import importlib.util, pathlib, signal, sys, time
spec = importlib.util.spec_from_file_location("cleanup", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.LIBRARY = pathlib.Path(sys.argv[2])
def interrupted(*args):
    raise module.CleanupError("interrupted")
signal.signal(signal.SIGTERM, interrupted)
try:
    with module.cleanup_marker("a" * 32):
        print("ready", flush=True)
        time.sleep(30)
except module.CleanupError:
    pass
'''
        child = subprocess.Popen([sys.executable, '-c', script, str(Path(cleanup.__file__)), str(cleanup.LIBRARY)], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            self.assertTrue((cleanup.LIBRARY / '.preparing').exists())
            child.terminate()
            child.wait(timeout=5)
            self.assertFalse((cleanup.LIBRARY / '.preparing').exists())
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdout.close()


if __name__ == '__main__':
    unittest.main()
