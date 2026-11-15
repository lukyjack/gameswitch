#!/usr/bin/python3
"""A private, bounded PTY bridge for the fixed GameSwitch Steam setup helper.

There is no network listener or shell. Only the gameswitch Unix peer (or root)
can start one of two fixed preparations. Password/Guard input and terminal output
exist only in this process and the authenticated Unix connection, never a log.
"""
import base64
import contextlib
import errno
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import struct
import sys
import threading
import time
import unicodedata

try:
    import grp
    import pwd
    import fcntl
    import pty
    import termios
except ImportError:  # Pure protocol tests also run on the Windows workstation.
    grp = pwd = fcntl = pty = termios = None

SOCKET_PATH = Path('/run/gameswitch-steam-setup/control.sock')
HELPER = '/usr/local/bin/gameswitch-steam-library'
MAX_FRAME = 8192
MAX_INPUT_BYTES = 512
MAX_INPUTS = 120
MAX_SESSION_SECONDS = 2 * 60 * 60
MAX_CONNECTIONS = 4
TRUSTED_ENV = {
    'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'HOME': '/run/gameswitch-steam-setup',
    'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TERM': 'xterm-256color',
    'PYTHONDONTWRITEBYTECODE': '1',
}


class ProtocolError(Exception):
    """Only fixed reasons may be sent to the browser; never include raw data."""


def start_request(frame):
    if not isinstance(frame, dict) or set(frame) != {'type', 'gameId', 'workshopIds'} or frame.get('type') != 'start' or not isinstance(frame.get('gameId'), str) or frame['gameId'] not in {'arma3', 'dayz'}:
        raise ProtocolError('invalid_start')
    mods = frame['workshopIds']
    if not isinstance(mods, list) or len(mods) > 30 or any(not isinstance(item, str) or not re.fullmatch(r'[1-9][0-9]{4,19}', item) for item in mods) or len(set(mods)) != len(mods):
        raise ProtocolError('invalid_start')
    return frame['gameId'], list(mods)


def setup_argv(game, mods):
    game, mods = start_request({'type': 'start', 'gameId': game, 'workshopIds': mods})
    args = [HELPER, 'prepare', game]
    if mods:
        args.extend(['--workshop', ','.join(mods)])
    return args


def input_request(frame):
    if isinstance(frame, dict) and frame == {'type': 'cancel'}:
        return None
    if not isinstance(frame, dict) or set(frame) != {'type', 'data'} or frame.get('type') != 'input' or not isinstance(frame.get('data'), str):
        raise ProtocolError('invalid_input')
    data = frame['data']
    if any(unicodedata.category(char) == 'Cc' or char in '\u2028\u2029' for char in data):
        raise ProtocolError('invalid_input')
    try:
        encoded = data.encode('utf8')
    except UnicodeError:
        raise ProtocolError('invalid_input') from None
    if len(encoded) > MAX_INPUT_BYTES:
        raise ProtocolError('invalid_input')
    return encoded


def peer_allowed(credentials, gameswitch_uid):
    if not isinstance(credentials, bytes) or len(credentials) != struct.calcsize('3i'):
        return False
    _pid, uid, _gid = struct.unpack('3i', credentials)
    return uid in {0, gameswitch_uid}


class Frames:
    def __init__(self):
        self.pending = bytearray()

    def feed(self, data):
        self.pending.extend(data)
        frames = []
        while b'\n' in self.pending:
            offset = self.pending.index(b'\n')
            if offset > MAX_FRAME:
                raise ProtocolError('frame_too_large')
            raw = bytes(self.pending[:offset])
            del self.pending[:offset + 1]
            try:
                value = json.loads(raw.decode('utf8'))
            except (ValueError, UnicodeError, RecursionError):
                raise ProtocolError('invalid_json') from None
            if not isinstance(value, dict):
                raise ProtocolError('invalid_json')
            frames.append(value)
            if len(frames) > 32:
                raise ProtocolError('too_many_frames')
        if len(self.pending) > MAX_FRAME:
            raise ProtocolError('frame_too_large')
        return frames


class InputRedactor:
    """Suppress accidental terminal/program echo, including split UTF-8 chunks."""
    def __init__(self):
        self.values = []
        self.pending = b''

    def remember(self, data):
        if data and data not in self.values:
            self.values.append(bytes(data))
            self.values.sort(key=len, reverse=True)

    def feed(self, data, final=False):
        current = self.pending + data
        out = bytearray()
        index = 0
        while index < len(current):
            suffix = current[index:]
            # A complete short input may also be the beginning of a longer
            # input. Delay it across reads rather than exposing the suffix of
            # the longer value after an early short replacement.
            extending = any(len(value) > len(suffix) and value.startswith(suffix) for value in self.values)
            if extending:
                if final:
                    out.extend(b'[Eingabe verborgen]')
                    index = len(current)
                break
            match = next((value for value in self.values if current.startswith(value, index)), None)
            if match is not None:
                out.extend(b'[Eingabe verborgen]')
                index += len(match)
                continue
            if any(value.startswith(suffix) for value in self.values):
                if final:
                    out.extend(b'[Eingabe verborgen]')
                    index = len(current)
                break
            out.append(current[index])
            index += 1
        self.pending = current[index:]
        return bytes(out)


def send_frame(conn, frame):
    # Every caller supplies a fixed schema. Never serialize an exception object.
    encoded = json.dumps(frame, ensure_ascii=True, separators=(',', ':')).encode('ascii') + b'\n'
    if len(encoded) > MAX_FRAME:
        raise ProtocolError('frame_too_large')
    conn.sendall(encoded)


def send_output(conn, data):
    for offset in range(0, len(data), 4096):
        send_frame(conn, {'type': 'output', 'data': base64.b64encode(data[offset:offset + 4096]).decode('ascii')})


def spawn_helper(args):
    if pty is None:
        raise ProtocolError('unsupported_host')
    master, slave = pty.openpty()
    try:
        # Set terminal attributes before execution. posix_spawn avoids running
        # Python in a forked multithreaded process. Opening the slave after
        # setsid makes it the new session's controlling terminal.
        attrs = termios.tcgetattr(slave)
        attrs[3] &= ~(termios.ECHO | termios.ECHONL)
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
        actions = [(os.POSIX_SPAWN_OPEN, 0, os.ttyname(slave), os.O_RDWR, 0),
                   (os.POSIX_SPAWN_DUP2, 0, 1), (os.POSIX_SPAWN_DUP2, 0, 2)]
        pid = os.posix_spawn(HELPER, args, TRUSTED_ENV, file_actions=actions, setsid=True)
    except BaseException:
        os.close(master)
        raise
    finally:
        os.close(slave)
    os.set_blocking(master, False)
    return pid, master


def own_group_signal(pid, sig):
    # The spawned PTY child leads its own session/process group.
    # Never signal by command name, UID, Docker label or a user-supplied PID.
    if not isinstance(pid, int) or pid <= 1 or pid == os.getpid():
        raise ProtocolError('invalid_child')
    try:
        if os.getpgid(pid) != pid:
            raise ProtocolError('invalid_child')
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def reap(pid):
    try:
        child, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return 0
    return os.waitstatus_to_exitcode(status) if child else None


def cancel_child(pid):
    own_group_signal(pid, signal.SIGINT)
    deadline = time.monotonic() + 18
    while time.monotonic() < deadline:
        result = reap(pid)
        if result is not None:
            return result
        time.sleep(.05)
    own_group_signal(pid, signal.SIGTERM)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = reap(pid)
        if result is not None:
            return result
        time.sleep(.05)
    own_group_signal(pid, signal.SIGKILL)
    with contextlib.suppress(ChildProcessError):
        os.waitpid(pid, 0)
    return 130


class Broker:
    def __init__(self, gameswitch_uid):
        self.gameswitch_uid = gameswitch_uid
        self.active = threading.Lock()
        self.connections = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self.stopping = threading.Event()

    def handle(self, conn):
        pid = master = None
        locked = False
        selector = None
        try:
            conn.settimeout(5)
            if not peer_allowed(conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')), self.gameswitch_uid):
                raise ProtocolError('forbidden_peer')
            frames = Frames()
            deadline = time.monotonic() + 10
            initial = []
            while not initial and time.monotonic() < deadline:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                initial = frames.feed(chunk)
            if len(initial) != 1:
                raise ProtocolError('invalid_start')
            game, mods = start_request(initial[0])
            locked = self.active.acquire(blocking=False)
            if not locked:
                raise ProtocolError('busy')
            pid, master = spawn_helper(setup_argv(game, mods))
            send_frame(conn, {'type': 'started'})
            selector = selectors.DefaultSelector()
            selector.register(conn, selectors.EVENT_READ, 'connection')
            selector.register(master, selectors.EVENT_READ, 'terminal')
            redactor = InputRedactor()
            expires = time.monotonic() + MAX_SESSION_SECONDS
            inputs = []
            total_inputs = 0
            terminal_closed = False
            while not self.stopping.is_set():
                if time.monotonic() >= expires:
                    raise ProtocolError('session_timeout')
                for key, _events in selector.select(.25):
                    if key.data == 'connection':
                        chunk = conn.recv(4096)
                        if not chunk:
                            return
                        for frame in frames.feed(chunk):
                            value = input_request(frame)
                            if value is None:
                                code = cancel_child(pid)
                                pid = None
                                send_frame(conn, {'type': 'exit', 'code': code})
                                return
                            now = time.monotonic()
                            inputs = [when for when in inputs if now - when < 60]
                            total_inputs += 1
                            if len(inputs) >= 30 or total_inputs > MAX_INPUTS:
                                raise ProtocolError('input_limit')
                            inputs.append(now)
                            redactor.remember(value)
                            data = value + b'\n'
                            # Valid input is at most513bytes and the PTY is
                            # drained continuously. Partial writes fail closed.
                            if os.write(master, data) != len(data):
                                raise ProtocolError('terminal_unavailable')
                    else:
                        try:
                            data = os.read(master, 4096)
                        except OSError as error:
                            if error.errno != errno.EIO:
                                raise
                            data = b''
                        if data:
                            send_output(conn, redactor.feed(data))
                        else:
                            selector.unregister(master)
                            terminal_closed = True
                code = reap(pid)
                if code is not None:
                    pid = None
                    # Drain trailing PTY output after child exit before the
                    # completion event. It remains bounded by each read.
                    if not terminal_closed:
                        while True:
                            try:
                                data = os.read(master, 4096)
                            except (BlockingIOError, OSError):
                                break
                            if not data:
                                break
                            send_output(conn, redactor.feed(data))
                    send_output(conn, redactor.feed(b'', final=True))
                    send_frame(conn, {'type': 'exit', 'code': code})
                    return
        except ProtocolError as error:
            with contextlib.suppress(OSError, ProtocolError):
                send_frame(conn, {'type': 'error', 'reason': str(error)})
        except Exception:
            with contextlib.suppress(OSError, ProtocolError):
                send_frame(conn, {'type': 'error', 'reason': 'setup_unavailable'})
        finally:
            if pid is not None:
                with contextlib.suppress(OSError, ProtocolError):
                    cancel_child(pid)
            if selector is not None:
                selector.close()
            if master is not None:
                with contextlib.suppress(OSError):
                    os.close(master)
            conn.close()
            if locked:
                self.active.release()
            self.connections.release()

    def serve(self):
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise ProtocolError('unsupported_host')
        directory = SOCKET_PATH.parent
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o027:
            raise ProtocolError('unsafe_runtime_directory')
        if SOCKET_PATH.exists() or SOCKET_PATH.is_symlink():
            existing = SOCKET_PATH.lstat()
            if not stat.S_ISSOCK(existing.st_mode) or existing.st_uid != 0:
                raise ProtocolError('unsafe_socket')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                try:
                    probe.connect(str(SOCKET_PATH))
                except OSError as error:
                    if error.errno != errno.ECONNREFUSED:
                        raise ProtocolError('socket_in_use') from None
                else:
                    raise ProtocolError('socket_in_use')
            SOCKET_PATH.unlink()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(SOCKET_PATH))
            os.chown(SOCKET_PATH, 0, grp.getgrnam('gameswitch').gr_gid)
            os.chmod(SOCKET_PATH, 0o660)
            server.listen(MAX_CONNECTIONS)
            server.settimeout(.5)
            original = SOCKET_PATH.lstat()
            try:
                while not self.stopping.is_set():
                    try:
                        conn, _address = server.accept()
                    except socket.timeout:
                        continue
                    if not self.connections.acquire(blocking=False):
                        conn.close()
                        continue
                    try:
                        threading.Thread(target=self.handle, args=(conn,), daemon=True).start()
                    except RuntimeError:
                        conn.close()
                        self.connections.release()
            finally:
                self.stopping.set()
                deadline = time.monotonic() + 40
                while self.active.locked() and time.monotonic() < deadline:
                    time.sleep(.05)
                with contextlib.suppress(FileNotFoundError):
                    current = SOCKET_PATH.lstat()
                    if current.st_dev == original.st_dev and current.st_ino == original.st_ino:
                        SOCKET_PATH.unlink()


def main():
    try:
        if pwd is None:
            raise ProtocolError('unsupported_host')
        broker = Broker(pwd.getpwnam('gameswitch').pw_uid)
        signal.signal(signal.SIGTERM, lambda *_args: broker.stopping.set())
        signal.signal(signal.SIGINT, lambda *_args: broker.stopping.set())
        broker.serve()
        return 0
    except (ProtocolError, OSError, KeyError):
        # Fixed failure only. Never print a traceback or a raw exception.
        print('GameSwitch Steam setup broker unavailable.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
