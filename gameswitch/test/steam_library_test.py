"""Run with python3 -B -m unittest discover -s gameswitch/test -p steam_library_test.py."""
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("gameswitch_steam_library", Path(__file__).resolve().parents[1] / "deploy/steam-library.py")
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)


class SteamLibraryTests(unittest.TestCase):
    def setUp(self):
        # Fixtures may live on a small /tmp tmpfs. Capacity behavior has its own
        # explicit low-space tests; unrelated filesystem checks need ample disk.
        disk = mock.patch.object(library.shutil, "disk_usage", return_value=types.SimpleNamespace(free=500 * 1024 ** 3))
        disk.start()
        self.addCleanup(disk.stop)

    def test_workshop_ids_and_steam_username_cannot_introduce_commands(self):
        self.assertEqual(library.workshop_ids("1559212036,1564026768"), ["1559212036", "1564026768"])
        self.assertEqual(library.workshop_ids(""), [])
        for value in ["1;quit", "12345,12345", "0", "12345\nquit", "12345,", ",12345", ",".join(str(10000 + i) for i in range(31))]:
            with self.assertRaises(library.LibraryError):
                library.workshop_ids(value)
        for name in ["user\nquit", 'user"password', "user name", "$(whoami)", "a"]:
            with self.assertRaises(library.LibraryError):
                library.steam_script("dayz", name, [])

    def test_preparation_marker_covers_success_and_failure_without_overwriting_old_marker(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            root = Path(temp)
            marker = root / ".preparing"
            with library.preparation_marker(root):
                self.assertTrue(marker.is_file())
            self.assertFalse(marker.exists())
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                with library.preparation_marker(root):
                    self.assertTrue(marker.is_file())
                    raise RuntimeError("fixture")
            self.assertFalse(marker.exists())
            marker.write_text("existing-marker-not-overwritten")
            with self.assertRaises(library.LibraryError):
                with library.preparation_marker(root):
                    self.fail("A stale marker must block instead of being overwritten")
            self.assertEqual(marker.read_text(), "existing-marker-not-overwritten")

    def test_low_disk_guard_removes_only_its_own_download_container_without_capturing_tty(self):
        process = mock.Mock()
        process.poll.return_value = None
        name = "gameswitch-steam-prepare-dayz-" + "a" * 12
        with mock.patch.object(library.subprocess, "Popen", return_value=process) as spawn, mock.patch.object(library.subprocess, "run") as run, mock.patch.object(library.shutil, "disk_usage", return_value=types.SimpleNamespace(free=library.MIN_FREE - 1)):
            with self.assertRaises(library.LibraryError):
                library.run_steam_download(["docker", "run", "fixture"], name, Path("/fixture"))
            self.assertEqual(spawn.call_args, mock.call(["docker", "run", "fixture"]))
            self.assertEqual(run.call_args.args[0], ["docker", "rm", "-f", name])
            process.wait.assert_called_once_with(timeout=10)
            process.terminate.assert_not_called()
            process.kill.assert_not_called()
            with self.assertRaises(library.LibraryError):
                library.remove_setup_container("e6ee86f3c1464a6a")
            self.assertEqual(run.call_count, 1)

    def test_copy_reserves_space_for_each_file_and_rejects_before_creating_it(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            root = Path(temp)
            raw = root / "raw"
            raw.mkdir()
            (raw / "fixture").write_bytes(b"fixture")
            with mock.patch.object(library.shutil, "disk_usage", return_value=types.SimpleNamespace(free=library.MIN_FREE + 1)):
                with self.assertRaises(library.LibraryError):
                    library.copy_tree(raw, root / "ready")
            self.assertFalse((root / "ready/fixture").exists())

    @unittest.skipIf(os.name == "nt", "Published Linux mode checks require POSIX permissions")
    def test_published_mods_keys_and_runtime_directories_remain_readable_under_umask077(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            root = Path(temp)
            old_mask = os.umask(0o077)
            try:
                build = root / "build"
                build.mkdir()
                library.published_directory(build / "mods")
                mod = build / "mods/12345"
                mod.mkdir()
                (mod / "fixture.bikey").write_bytes(b"public-key")
                library.collect_keys(mod)
                home = root / "home"
                runtime = home / ".local/share/Steam/steamcmd/linux64"
                runtime.mkdir(parents=True)
                (runtime / "steamclient.so").write_bytes(b"fixture")
                server = build / "server"
                server.mkdir()
                library.add_steamclient(server, home)
                for folder in [build / "mods", mod / "keys", server / "linux64"]:
                    self.assertEqual(folder.stat().st_mode & 0o777, 0o755, str(folder))
                self.assertEqual((server / "linux64/steamclient.so").stat().st_mode & 0o777, 0o644)
            finally:
                os.umask(old_mask)

    def test_steam_script_only_specifies_user_and_known_apps_not_a_password(self):
        text = library.steam_script("dayz", "FixtureUser", ["1559212036"])
        self.assertIn('@NoPromptForPassword 0\n', text)
        self.assertIn('login "FixtureUser"\n', text)
        self.assertIn("app_update 223350 validate\n", text)
        self.assertIn("workshop_download_item 221100 1559212036 validate\n", text)
        self.assertIn("app_update 233780 validate", library.steam_script("arma3", "FixtureUser", []))
        self.assertNotIn("1042420", text)
        self.assertNotIn("password =", text)
        self.assertNotIn("anonymous", text)

    def test_docker_argv_never_transmits_login_and_keeps_auth_outside_game_mounts(self):
        args = library.docker_command("sha256:" + "a" * 64, "gameswitch-steam-prepare-dayz-fixture", Path("/private/home"), Path("/private/download"), Path("/private/script"))
        self.assertIn("--log-driver=none", args)
        self.assertIn("--pull=never", args)
        self.assertIn("--read-only", args)
        self.assertIn("--cap-drop=ALL", args)
        self.assertIn("--security-opt=no-new-privileges:true", args)
        self.assertIn("--memory=1g", args)
        self.assertIn("--memory-swap=1g", args)
        self.assertIn("--cpus=1.5", args)
        self.assertIn("--pids-limit=256", args)
        self.assertIn("1000:1000", args)
        self.assertIn("XDG_DATA_HOME=/steam-home/.local/share", args)
        self.assertIn("type=bind,source=/private/script,target=/installer.txt,readonly", args)
        for forbidden in ["FixtureUser", "password", "steam_guard", "docker.sock", "--privileged", "--network=host", "gameswitch-libraries"]:
            self.assertNotIn(forbidden, " ".join(args))
        self.assertEqual(args[-2:], ["+runscript", "/installer.txt"])
        with self.assertRaises(library.LibraryError):
            library.docker_command("untrusted/image:latest", "gameswitch-steam-prepare-fixture", Path("/p"), Path("/d"), Path("/s"))

    def test_dayz_runtime_image_adds_native_libraries_and_cannot_be_pulled_from_a_registry(self):
        self.assertEqual(library.DAYZ_RUNTIME_IMAGE, "gameswitch.invalid/dayz-runtime:1")
        dockerfile = library.DAYZ_RUNTIME_DOCKERFILE
        self.assertTrue(dockerfile.startswith(f"FROM {library.IMAGE}\n"))
        for package in ["libcurl4t64", "libcap2", "--no-install-recommends"]:
            self.assertIn(package, dockerfile)
        for forbidden in ["COPY", "ADD", "curl http", "wget", "password"]:
            self.assertNotIn(forbidden, dockerfile)
        image = "sha256:" + "b" * 64
        with mock.patch.object(library.subprocess, "run") as run, mock.patch.object(library, "run_json", return_value=[{"Id": image}]):
            self.assertEqual(library.build_runtime_image(), image)
        args = run.call_args.args[0]
        self.assertEqual(args, ["docker", "build", "--quiet", "--tag", library.DAYZ_RUNTIME_IMAGE, "-"])
        self.assertEqual(run.call_args.kwargs["input"], dockerfile)
        with mock.patch.object(library.subprocess, "run", side_effect=library.subprocess.CalledProcessError(1, "docker")):
            with self.assertRaises(library.LibraryError):
                library.build_runtime_image()

    def test_dayz_runtime_check_is_isolated_and_reports_only_library_names(self):
        image = "sha256:" + "c" * 64
        args = library.runtime_check_command(image, Path("/var/lib/gameswitch-libraries/.dayz-build-x/server"))
        for flag in ["--network=none", "--read-only", "--cap-drop=ALL", "--pull=never", "--log-driver=none", "1000:1000", "LD_LIBRARY_PATH=/srv:/srv/linux64"]:
            self.assertIn(flag, args)
        self.assertIn("type=bind,source=/var/lib/gameswitch-libraries/.dayz-build-x/server,target=/srv,readonly", args)
        self.assertEqual(args[-3:], ["/usr/bin/ldd", image, "/srv/DayZServer"])
        with self.assertRaises(library.LibraryError):
            library.runtime_check_command("dayz-runtime:latest", Path("/srv"))
        output = "\tlinux-vdso.so.1 (0x00007ffd)\n\tlibcurl.so.4 => not found\n\tlibcap.so.2 => not found\n\t$(evil) => not found\n\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6\n"
        self.assertEqual(library.missing_libraries(output), ["libcap.so.2", "libcurl.so.4", "unbekannt"])
        server = Path("/srv")
        complete = types.SimpleNamespace(returncode=0, stdout="\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6\n", stderr="")
        with mock.patch.object(library.subprocess, "run", return_value=complete):
            library.verify_runtime(server, image)
        incomplete = types.SimpleNamespace(returncode=0, stdout=output, stderr="")
        with mock.patch.object(library.subprocess, "run", return_value=incomplete):
            with self.assertRaisesRegex(library.LibraryError, "libcurl.so.4"):
                library.verify_runtime(server, image)
        broken = types.SimpleNamespace(returncode=1, stdout="", stderr="not a dynamic executable")
        with mock.patch.object(library.subprocess, "run", return_value=broken):
            with self.assertRaises(library.LibraryError):
                library.verify_runtime(server, image)

    def test_running_library_binds_and_unknown_lifecycle_state_block_publication(self):
        self.assertTrue(library.library_in_use([{"Mounts": [{"Source": "/var/lib/gameswitch-libraries/arma3"}]}]))
        self.assertTrue(library.library_in_use([{"Mounts": [{"Source": "/var/lib/gameswitch-libraries/dayz/server"}]}]))
        self.assertFalse(library.library_in_use([{"Mounts": [{"Source": "/var/lib/pufferpanel/servers/minecraft"}]}]))
        self.assertFalse(library.library_in_use([{"Mounts": [{"Source": "/var/lib/gameswitch-libraries-evil/dayz"}]}]))
        for state in [{}, {"profiles": [], "job": {"status": "running"}}, {"profiles": [], "job": {}}, {"profiles": [], "job": {"status": "unrecognised"}}]:
            self.assertFalse(library.state_idle(state))
        for job in [None, {"status": "completed"}, {"status": "failed"}]:
            self.assertTrue(library.state_idle({"profiles": [], "job": job}))

    def test_server_copy_excludes_steam_authentication_cache_and_preserves_native_case(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            source = base / "raw"
            source.mkdir()
            (source / "DayZServer").write_bytes(b"\x7fELFfixture-native")
            (source / "steamapps").mkdir()
            (source / "steamapps/auth-ticket").write_text("Fixture_secret_not_for_game")
            (source / "config").mkdir()
            (source / "config/loginusers.vdf").write_text("Fixture_secret_not_for_game")
            (source / "ssfn1234").write_text("Fixture_secret_not_for_game")
            library.copy_tree(source, base / "published", skip_cache=True)
            self.assertTrue((base / "published/DayZServer").is_file())
            self.assertNotIn("dayzserver", [entry.name for entry in (base / "published").iterdir()])
            self.assertFalse((base / "published/steamapps").exists())
            self.assertFalse((base / "published/config").exists())
            self.assertFalse((base / "published/ssfn1234").exists())

    def test_mod_copy_normalizes_case_and_collects_regular_signing_keys(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            source = base / "mod"
            (source / "Addons").mkdir(parents=True)
            (source / "Addons/Example.PBO").write_bytes(b"fixture")
            (source / "Example.BIKEY").write_bytes(b"public-signing-key")
            library.copy_tree(source, base / "ready", lowercase=True)
            library.collect_keys(base / "ready")
            self.assertEqual((base / "ready/addons/example.pbo").read_bytes(), b"fixture")
            self.assertEqual((base / "ready/keys/example.bikey").read_bytes(), b"public-signing-key")
            self.assertFalse((base / "ready/keys/example.bikey").is_symlink())

    def test_key_content_conflict_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            mod = Path(temp)
            (mod / "keys").mkdir()
            (mod / "nested").mkdir()
            (mod / "keys/example.bikey").write_bytes(b"trusted")
            (mod / "nested/example.bikey").write_bytes(b"different")
            with self.assertRaises(library.LibraryError):
                library.collect_keys(mod)

    def test_hardlinks_are_not_published(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            raw = base / "raw"
            raw.mkdir()
            target = raw / "first"
            target.write_bytes(b"fixture")
            try:
                os.link(target, raw / "hardlink")
            except OSError:
                self.skipTest("Hardlinks unavailable")
            with self.assertRaises(library.LibraryError):
                library.copy_tree(raw, base / "ready")

    def test_symlinks_are_not_published(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            raw = base / "raw"
            raw.mkdir()
            target = base / "outside"
            target.write_bytes(b"private")
            try:
                (raw / "escape").symlink_to(target)
            except OSError:
                self.skipTest("Symlink creation unavailable")
            with self.assertRaises(library.LibraryError):
                library.copy_tree(raw, base / "ready")

    @unittest.skipIf(os.name == "nt", "Requires a case-sensitive filesystem")
    def test_case_collisions_and_special_files_are_not_published(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            raw = base / "raw"
            raw.mkdir()
            (raw / "Mod.PBO").write_bytes(b"one")
            (raw / "mod.pbo").write_bytes(b"two")
            with self.assertRaises(library.LibraryError):
                library.copy_tree(raw, base / "ready", lowercase=True)
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            base = Path(temp)
            raw = base / "raw"
            raw.mkdir()
            os.mkfifo(raw / "pipe")
            with self.assertRaises(library.LibraryError):
                library.copy_tree(raw, base / "ready")

    def test_only_complete_native_linux_binary_and_dayz_mission_are_accepted(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            server = Path(temp)
            (server / "DayZServer").write_bytes(b"MZ-windows-not-native")
            with self.assertRaises(library.LibraryError):
                library.verify_binary(server, "dayz")
            (server / "DayZServer").write_bytes(b"\x7fELFfixture")
            with self.assertRaises(library.LibraryError):
                library.verify_binary(server, "dayz")
            (server / "mpmissions/dayzOffline.chernarusplus").mkdir(parents=True)
            library.verify_binary(server, "dayz")

    @unittest.skipIf(os.name == "nt", "Publication ownership/mode checks target Linux")
    def test_publication_keeps_previous_library_and_rolls_back_on_rename_failure(self):
        with tempfile.TemporaryDirectory(prefix="gameswitch-library-test-") as temp:
            root = Path(temp)
            target = root / "dayz"
            target.mkdir(mode=0o755)
            (target / "old").write_text("safe")
            new = root / ".dayz-build-fixture"
            new.mkdir()
            (new / "new").write_text("new")
            previous = library.publish(new, "dayz", root)
            self.assertEqual((previous / "old").read_text(), "safe")
            self.assertEqual((target / "new").read_text(), "new")
            failing = root / ".dayz-build-second"
            failing.mkdir()
            original_rename = library.os.rename

            def rename(source, destination):
                if source == failing:
                    raise OSError("fixture rename failure")
                return original_rename(source, destination)

            with mock.patch.object(library.os, "rename", side_effect=rename):
                with self.assertRaises(library.LibraryError):
                    library.publish(failing, "dayz", root)
            self.assertEqual((target / "new").read_text(), "new")


if __name__ == "__main__":
    unittest.main()
