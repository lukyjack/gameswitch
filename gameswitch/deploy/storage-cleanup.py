#!/usr/bin/env python3
"""Remove only explicitly selected obsolete Steam libraries or download caches."""
import contextlib
import fcntl
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys

LIBRARY = Path('/var/lib/gameswitch-libraries')
PRIVATE = Path('/var/lib/gameswitch-steam-private')
HELPER = '/usr/local/bin/gameswitch-steam-library'
OLD_NAME = re.compile(r'^(arma3|dayz)\.previous\.[0-9]{8}T[0-9]{6}Z\.[a-f0-9]{8}$')
MAX_FILES = 500000
GAME_UID = GAME_GID = 1000


class CleanupError(Exception):
    pass


@contextlib.contextmanager
def cleanup_marker(token):
    if not re.fullmatch(r'[a-f0-9]{32}', token):
        raise CleanupError('invalid_request')
    marker = LIBRARY / '.preparing'
    temporary = LIBRARY / f'.cleanup-{os.getpid()}-{token}'
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
    original = os.fstat(fd)
    try:
        content = f'cleanup:{os.getpid()}:{token}\n'.encode('ascii')
        if os.write(fd, content) != len(content):
            raise CleanupError('unsafe_marker')
        os.fsync(fd)
        os.close(fd)
        fd = None
        # Linking publishes an already-written token atomically and refuses
        # an existing Steam marker; a killed child cannot leave a blank marker.
        os.link(temporary, marker, follow_symlinks=False)
        temporary.unlink()
        yield
    finally:
        if fd is not None:
            os.close(fd)
        for item in (marker, temporary):
            try:
                current = item.lstat()
            except FileNotFoundError:
                continue
            if (current.st_dev, current.st_ino) == (original.st_dev, original.st_ino):
                item.unlink()


def trusted_dir(path, *, private=False):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise CleanupError('unsafe_directory')
    return info


def trusted_game_directory(path):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
            or (info.st_uid, info.st_gid) not in {(0, 0), (GAME_UID, GAME_GID)}):
        raise CleanupError('unsafe_directory')
    return info


def trusted_download(path):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
            or (info.st_uid, info.st_gid) != (GAME_UID, GAME_GID)):
        raise CleanupError('unsafe_directory')
    return info


def trusted_file(path, *, executable=False, max_size=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
                or info.st_nlink != 1 or not info.st_size
                or executable and not info.st_mode & 0o111
                or max_size is not None and info.st_size > max_size):
            raise CleanupError('unsafe_current')
        if max_size is not None:
            return os.read(fd, max_size + 1)
    finally:
        os.close(fd)


def require_current(game):
    current = LIBRARY / game
    trusted_dir(current)
    trusted_dir(current / 'server')
    raw = trusted_file(current / 'manifest.json', max_size=16384)
    if len(raw) > 16384:
        raise CleanupError('unsafe_current')
    active = json.loads(raw)
    if not isinstance(active, dict):
        raise CleanupError('unsafe_current')
    mods = active.get('workshopIds')
    if (active.get('gameId') != game or type(active.get('schema')) is not int or active.get('schema') != 1 or active.get('ready') is not True
            or active.get('appId') != {'arma3': '233780', 'dayz': '223350'}[game]
            or not isinstance(mods, list) or len(mods) > 30
            or any(not isinstance(item, str) or not re.fullmatch(r'[1-9][0-9]{4,19}', item) for item in mods)
            or len(set(mods)) != len(mods)
            or game == 'dayz' and active.get('runtimeImage') != 'gameswitch.invalid/dayz-runtime:1'):
        raise CleanupError('unsafe_current')
    trusted_file(current / 'server' / ('arma3server_x64' if game == 'arma3' else 'DayZServer'), executable=True)
    if mods:
        trusted_dir(current / 'mods')
        for mod in mods:
            trusted_dir(current / 'mods' / mod)


def tree_size(path, root_device):
    target = os.path.abspath(path)
    # Bind mounts can have the same device number. Refuse any mounted path
    # under the candidate, including same-device bind mounts.
    with open('/proc/self/mountinfo', encoding='utf8') as mounts:
        for line in mounts:
            fields = line.split(' ', 6)
            if len(fields) < 5:
                raise CleanupError('unsafe_mounts')
            mount = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), fields[4])
            if os.path.commonpath((target, mount)) == target:
                raise CleanupError('unsafe_mounts')
    total = count = 0
    def failed_walk(_error):
        raise CleanupError('unsafe_tree')
    for root, dirs, files in os.walk(path, followlinks=False, onerror=failed_walk):
        parent = os.lstat(root)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_dev != root_device:
            raise CleanupError('unsafe_tree')
        for name in dirs + files:
            item = os.lstat(os.path.join(root, name))
            count += 1
            if count > MAX_FILES or item.st_dev != root_device:
                raise CleanupError('unsafe_tree')
            if stat.S_ISDIR(item.st_mode) or stat.S_ISREG(item.st_mode) or stat.S_ISLNK(item.st_mode):
                total += item.st_blocks * 512
            else:
                raise CleanupError('unsafe_tree')
    return total


def candidates():
    trusted_dir(LIBRARY)
    trusted_dir(PRIVATE, private=True)
    result = []
    for game in ('arma3', 'dayz'):
        parent = PRIVATE / game
        if parent.exists():
            trusted_game_directory(parent)
            if (parent / 'download').exists():
                trusted_download(parent / 'download')
                result.append(('cache', game, parent, 'download'))
    for name in sorted(os.listdir(LIBRARY)):
        if OLD_NAME.fullmatch(name):
            result.append(('previous', name, LIBRARY, name))
    if len(result) > 50:
        raise CleanupError('too_many_candidates')
    return result


def snapshot():
    result = []
    for kind, name, parent, leaf in candidates():
        info = (parent / leaf).lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_dev != parent.stat().st_dev:
            raise CleanupError('unsafe_tree')
        result.append({'kind': kind, 'id': name, 'bytes': tree_size(parent / leaf, info.st_dev),
                       'version': f'{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}'})
    return result


def cleanup(kind, name, version):
    entries = [entry for entry in candidates() if entry[:2] == (kind, name)]
    if len(entries) != 1:
        raise CleanupError('not_found')
    _, _, parent, leaf = entries[0]
    if kind == 'previous':
        game = OLD_NAME.fullmatch(name).group(1)
        require_current(game)
    info = (parent / leaf).lstat()
    if not stat.S_ISDIR(info.st_mode) or f'{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}' != version:
        raise CleanupError('changed')
    tree_size(parent / leaf, info.st_dev)
    if not shutil.rmtree.avoids_symlink_attacks:
        raise CleanupError('unsupported_host')
    fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        again = os.stat(leaf, dir_fd=fd, follow_symlinks=False)
        if (again.st_dev, again.st_ino, again.st_mtime_ns) != (info.st_dev, info.st_ino, info.st_mtime_ns):
            raise CleanupError('changed')
        shutil.rmtree(leaf, dir_fd=fd)
    finally:
        os.close(fd)


def assert_private_idle():
    result = subprocess.run(['docker', 'ps', '-q'], capture_output=True, text=True, check=True, timeout=10)
    ids = result.stdout.split()
    if len(ids) > 256 or any(not re.fullmatch(r'[a-f0-9]{12,64}', item) for item in ids):
        raise CleanupError('unsafe_containers')
    if not ids:
        return
    result = subprocess.run(['docker', 'inspect', *ids], capture_output=True, text=True, check=True, timeout=15)
    for container in json.loads(result.stdout):
        for mount in container.get('Mounts', []):
            source = mount.get('Source', '')
            if isinstance(source, str) and (source == str(PRIVATE) or source.startswith(str(PRIVATE) + '/')):
                raise CleanupError('busy')


def run(request, marker_token=None):
    if os.geteuid() != 0:
        raise CleanupError('unsupported_host')
    loader = importlib.machinery.SourceFileLoader('gameswitch_steam_library', HELPER)
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    trusted_dir(PRIVATE, private=True)
    lock_fd = os.open(PRIVATE / 'prepare.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise CleanupError('unsafe_lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CleanupError('busy') from None
        with cleanup_marker(marker_token or secrets.token_hex(16)):
            try:
                module.assert_idle()
            except module.LibraryError:
                raise CleanupError('busy') from None
            assert_private_idle()
            if request == {'type': 'cleanup-preview'}:
                usage = shutil.disk_usage(LIBRARY)
                return {'items': snapshot(), 'disk': {'total': usage.total, 'free': usage.free}}
            if (set(request) != {'type', 'kind', 'id', 'version'} or request.get('type') != 'cleanup-delete'
                    or request.get('kind') not in ('cache', 'previous') or not isinstance(request.get('id'), str)
                    or not isinstance(request.get('version'), str) or not re.fullmatch(r'[0-9]+:[0-9]+:[0-9]+', request['version'])):
                raise CleanupError('invalid_request')
            cleanup(request['kind'], request['id'], request['version'])
            return {'deleted': True}


if __name__ == '__main__':
    try:
        def interrupted(_signum, _frame):
            raise CleanupError('interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        envelope = json.loads(sys.stdin.readline(8193))
        if not isinstance(envelope, dict) or set(envelope) != {'request', 'markerToken'}:
            raise CleanupError('invalid_request')
        print(json.dumps({'ok': True, **run(envelope['request'], envelope['markerToken'])}))
    except Exception as error:
        reason = 'busy' if isinstance(error, CleanupError) and str(error) == 'busy' else 'cleanup_unavailable'
        print(json.dumps({'ok': False, 'reason': reason}))
        sys.exit(1)
