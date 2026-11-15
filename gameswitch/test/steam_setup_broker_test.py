"""Pure protocol tests plus Linux-only PTY checks, without Steam or Docker."""
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import struct
import sys
import tempfile
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('gameswitch_steam_broker', Path(__file__).resolve().parents[1] / 'deploy/steam-setup-broker.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class SteamSetupBrokerTests(unittest.TestCase):
    def test_start_request_accepts_only_fixed_games_and_numeric_mods(self):
        self.assertEqual(broker.setup_argv('arma3', ['450814997']), [broker.HELPER, 'prepare', 'arma3', '--workshop', '450814997'])
        self.assertEqual(broker.setup_argv('dayz', []), [broker.HELPER, 'prepare', 'dayz'])
        for value in [None, [], {}, {'type': 'start', 'gameId': [], 'workshopIds': []},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': [], 'command': '/bin/sh'},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': ['12345;exit']},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': ['12345', '12345']},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': [12345]},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': [[12345]]},
                      {'type': 'start', 'gameId': 'dayz', 'workshopIds': [str(10000 + index) for index in range(31)]}]:
            with self.assertRaises(broker.ProtocolError):
                broker.start_request(value)

    def test_input_preserves_spaces_and_unicode_but_rejects_control_and_oversize(self):
        self.assertEqual(broker.input_request({'type': 'input', 'data': '  Pass wörd  '}), '  Pass wörd  '.encode())
        self.assertEqual(broker.input_request({'type': 'input', 'data': ''}), b'')
        self.assertIsNone(broker.input_request({'type': 'cancel'}))
        for value in ['a\ncommand', '\r', '\t', '\x00', '\x03', '\x1b', '\x7f', '\u0085', '\u2028', '\u2029', 'x' * 513, 'é' * 257, '\ud800']:
            with self.assertRaises(broker.ProtocolError):
                broker.input_request({'type': 'input', 'data': value})
        for value in [{'type': 'input', 'data': 1}, {'type': 'input', 'data': 'x', 'pid': 1}, {'type': 'cancel', 'pid': 1}]:
            with self.assertRaises(broker.ProtocolError):
                broker.input_request(value)

    def test_frames_handle_fragments_and_bounded_invalid_json_without_reflection(self):
        frames = broker.Frames()
        self.assertEqual(frames.feed(b'{"type":"in'), [])
        self.assertEqual(frames.feed(b'put","data":"secret"}\n'), [{'type': 'input', 'data': 'secret'}])
        for raw in [b'x' * (broker.MAX_FRAME + 1), b'x' * (broker.MAX_FRAME + 1) + b'\n', b'PRIVATE_SECRET\n', b'\xff\n', b'null\n', b'[]\n', b'[' * 1500 + b'0' + b']' * 1500 + b'\n']:
            with self.assertRaises(broker.ProtocolError) as failure:
                broker.Frames().feed(raw)
            self.assertNotIn('PRIVATE', str(failure.exception))
        with self.assertRaises(broker.ProtocolError):
            broker.Frames().feed(b'{}\n' * 33)

    def test_only_exact_gameswitch_uid_or_root_can_connect(self):
        self.assertTrue(broker.peer_allowed(struct.pack('3i', 100, 988, 988), 988))
        self.assertTrue(broker.peer_allowed(struct.pack('3i', 100, 0, 0), 988))
        self.assertFalse(broker.peer_allowed(struct.pack('3i', 100, 1000, 988), 988))
        self.assertFalse(broker.peer_allowed(b'988', 988))

    def test_redaction_handles_split_echo_utf8_prefix_overlap_and_final_partial(self):
        redactor = broker.InputRedactor()
        redactor.remember(b'abc')
        redactor.remember(b'abcdef')
        self.assertEqual(redactor.feed(b'Login: abc'), b'Login: ')
        self.assertEqual(redactor.feed(b'def done\n'), b'[Eingabe verborgen] done\n')
        redactor.remember('Pässword'.encode())
        self.assertEqual(redactor.feed(b'Password: P\xc3'), b'Password: ')
        self.assertEqual(redactor.feed(b'\xa4ssword\n'), b'[Eingabe verborgen]\n')
        self.assertEqual(redactor.feed(b'Prefix ab'), b'Prefix ')
        self.assertEqual(redactor.feed(b'', final=True), b'[Eingabe verborgen]')
        self.assertEqual(redactor.pending, b'')

    def test_terminal_output_is_bounded_base64_frames(self):
        conn = mock.Mock()
        data = b'A' * 12000
        broker.send_output(conn, data)
        decoded = []
        for call in conn.sendall.call_args_list:
            frame = call.args[0]
            self.assertLessEqual(len(frame), broker.MAX_FRAME)
            message = json.loads(frame)
            self.assertEqual(message['type'], 'output')
            decoded.append(base64.b64decode(message['data']))
        self.assertEqual(b''.join(decoded), data)

    def test_cancel_targets_only_own_saved_process_group(self):
        with mock.patch.object(broker.os, 'getpgid', return_value=99123, create=True), mock.patch.object(broker.os, 'killpg', create=True) as kill, mock.patch.object(broker, 'reap', return_value=130):
            self.assertEqual(broker.cancel_child(99123), 130)
            kill.assert_called_once_with(99123, signal.SIGINT)
        for pid, group in [(1, 1), (os.getpid(), os.getpid()), (99123, 55)]:
            with mock.patch.object(broker.os, 'getpgid', return_value=group, create=True), mock.patch.object(broker.os, 'killpg', create=True) as kill:
                with self.assertRaises(broker.ProtocolError):
                    broker.own_group_signal(pid, signal.SIGINT)
                kill.assert_not_called()

    def test_busy_or_malformed_sessions_never_spawn_or_log_private_payload(self):
        for busy in [False, True]:
            service = broker.Broker(988)
            service.connections.acquire()
            if busy:
                service.active.acquire()
            conn = mock.Mock()
            conn.getsockopt.return_value = struct.pack('3i', 100, 988, 988)
            conn.recv.return_value = json.dumps({'type': 'start', 'gameId': 'arma3', 'workshopIds': []}).encode() + b'\n' if busy else b'PRIVATE_PASSWORD_NOT_JSON\n'
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.object(broker.socket, 'SO_PEERCRED', 17, create=True), mock.patch.object(broker, 'spawn_helper') as spawn, contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                service.handle(conn)
            spawn.assert_not_called()
            records = b''.join(call.args[0] for call in conn.sendall.call_args_list)
            self.assertNotIn(b'PRIVATE_PASSWORD', records)
            self.assertEqual(json.loads(records)['reason'], 'busy' if busy else 'invalid_json')
            self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')

    def test_unexpected_socket_exception_is_never_logged_or_reflected(self):
        service = broker.Broker(988)
        service.connections.acquire()
        conn = mock.Mock()
        conn.getsockopt.side_effect = RuntimeError('PRIVATE_SESSION_SECRET')
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(broker.socket, 'SO_PEERCRED', 17, create=True), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            service.handle(conn)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')
        self.assertEqual(json.loads(conn.sendall.call_args.args[0]), {'type': 'error', 'reason': 'setup_unavailable'})

    @unittest.skipUnless(sys.platform == 'linux', 'A controlling PTY requires Linux')
    def test_real_pty_is_controlling_echo_disabled_and_child_can_be_cancelled(self):
        with tempfile.TemporaryDirectory(prefix='gameswitch-pty-test-') as temp:
            helper = Path(temp) / 'helper.py'
            helper.write_text('#!/usr/bin/python3\nimport os,sys,termios\na=termios.tcgetattr(0)\nprint("READY:%s:%s:%s"%(os.isatty(0),os.getsid(0)==os.getpid(),bool(a[3]&termios.ECHO)),flush=True)\ntry:\n input("Input: ")\n print("DONE",flush=True)\nexcept KeyboardInterrupt:\n sys.exit(130)\n')
            helper.chmod(0o755)
            with mock.patch.object(broker, 'HELPER', str(helper)):
                pid, master = broker.spawn_helper([str(helper), 'prepare', 'arma3'])
            try:
                data = bytearray()
                deadline = time.monotonic() + 3
                while b'Input: ' not in data and time.monotonic() < deadline:
                    try:
                        data.extend(os.read(master, 4096))
                    except BlockingIOError:
                        time.sleep(.01)
                self.assertIn(b'READY:True:True:False', data)
                self.assertIn(b'Input: ', data)
                code = broker.cancel_child(pid)
                pid = None
                self.assertNotEqual(code, 0)
            finally:
                if pid is not None:
                    broker.cancel_child(pid)
                os.close(master)


if __name__ == '__main__':
    unittest.main()
