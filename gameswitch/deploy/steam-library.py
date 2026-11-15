#!/usr/bin/env python3
"""Prepare root-controlled Arma/DayZ libraries without sharing Steam credentials.

Run from an interactive root SSH terminal. SteamCMD itself asks for passwords and
Steam Guard; Python never receives either. No game or panel service is stopped.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import uuid

try:
    import fcntl
except ImportError:  # Pure validation tests and --help also work on Windows.
    fcntl = None

IMAGE = "steamcmd/steamcmd:latest"
PRIVATE_ROOT = Path("/var/lib/gameswitch-steam-private")
LIBRARY_ROOT = Path("/var/lib/gameswitch-libraries")
STATE_FILE = Path("/var/lib/gameswitch/state.json")
UID = GID = 1000
GAMES = {
    "arma3": {"app": "233780", "workshop": "107410", "binary": "arma3server_x64"},
    "dayz": {"app": "223350", "workshop": "221100", "binary": "DayZServer"},
}
CACHE_NAMES = {".steam", ".local", ".cache", "steamapps", "appcache", "depotcache", "userdata", "config", "logs", "package", "dumps", "crashdumps", "steam"}
MAX_FILES = 500_000
MAX_BYTES = 250 * 1024 ** 3
MIN_FREE = 8 * 1024 ** 3


class LibraryError(Exception):
    """A fixed, safe operator-facing failure; never include raw Steam output."""


@contextlib.contextmanager
def preparation_marker(root):
    """Block new panel activations before checking for an already-started job."""
    marker = root / ".preparing"
    try:
        fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o644)
    except FileExistsError:
        raise LibraryError("Eine alte Einrichtungssperre existiert. Erst sicherstellen, dass keine Steam-Einrichtung läuft; dann als root /var/lib/gameswitch-libraries/.preparing entfernen und erneut starten.") from None
    original = os.fstat(fd)
    try:
        os.chmod(marker, 0o644)
        os.fsync(fd)
        os.close(fd)
        fd = None
        yield
    finally:
        if fd is not None:
            os.close(fd)
        try:
            current = marker.lstat()
        except FileNotFoundError:
            current = None
        if current is not None and current.st_dev == original.st_dev and current.st_ino == original.st_ino:
            marker.unlink()


def published_directory(directory, **options):
    directory.mkdir(mode=0o755, **options)
    if not stat.S_ISDIR(directory.lstat().st_mode):
        raise LibraryError("Die veröffentlichte Bibliothek enthält ein ungültiges Verzeichnis.")
    os.chmod(directory, 0o755)


def require_space(directory, additional=0):
    if shutil.disk_usage(directory).free < MIN_FREE + max(0, additional):
        raise LibraryError("Die Speicherreserve von 8 GiB wird unterschritten. Nur diese Steam-Einrichtung wird angehalten; vorhandene Spiele bleiben unverändert.")


def remove_setup_container(name):
    if not re.fullmatch(r"gameswitch-steam-prepare-(?:arma3|dayz)-[a-f0-9]{12}", name):
        raise LibraryError("Unzulässiger Name für den Einrichtungscontainer.")
    with contextlib.suppress(OSError):
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def run_steam_download(args, name, disk_root):
    """Inherit the auth TTY and guard disk capacity without capturing its data."""
    if not re.fullmatch(r"gameswitch-steam-prepare-(?:arma3|dayz)-[a-f0-9]{12}", name):
        raise LibraryError("Unzulässiger Name für den Einrichtungscontainer.")
    process = subprocess.Popen(args)
    try:
        while process.poll() is None:
            require_space(disk_root)
            time.sleep(2)
        return process.returncode
    except BaseException:
        remove_setup_container(name)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()  # Only this helper's Docker client process.
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        raise


def workshop_ids(value):
    values = [] if not value else value.split(",")
    if len(values) > 30 or len(values) != len(set(values)) or any(not re.fullmatch(r"[1-9][0-9]{4,19}", item) for item in values):
        raise LibraryError("Workshop: bis zu 30 eindeutige numerische Item-IDs, mit Kommas getrennt, angeben.")
    return values


def steam_script(game, username, mods):
    if game not in GAMES or not re.fullmatch(r"[A-Za-z0-9_]{2,64}", username):
        raise LibraryError("Bitte den Steam-Accountnamen mit Buchstaben, Ziffern oder Unterstrichen verwenden.")
    workshop_ids(",".join(mods))
    info = GAMES[game]
    lines = ["@ShutdownOnFailedCommand 1", "@NoPromptForPassword 0", "@sSteamCmdForcePlatformType linux", "force_install_dir /download/server", f'login "{username}"', "app_info_update 1", f'app_update {info["app"]} validate']
    lines.extend(f'workshop_download_item {info["workshop"]} {item} validate' for item in mods)
    return "\n".join(lines + ["quit", ""])


def docker_command(image_id, name, home, download, script):
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id) or not re.fullmatch(r"gameswitch-steam-prepare-[a-z0-9-]+", name):
        raise LibraryError("Docker-Abbild oder Einrichtungsname ist ungültig.")
    return ["docker", "run", "--rm", "--pull=never", "--name", name, "--log-driver=none", "-it", "--user", f"{UID}:{GID}", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--cpus=1.5", "--memory=1g", "--memory-swap=1g", "--pids-limit=256", "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=256m", "--workdir", "/download", "--env", "HOME=/steam-home", "--env", "XDG_DATA_HOME=/steam-home/.local/share", "--env", "USER=steam", "--mount", f"type=bind,source={home.as_posix()},target=/steam-home", "--mount", f"type=bind,source={download.as_posix()},target=/download", "--mount", f"type=bind,source={script.as_posix()},target=/installer.txt,readonly", image_id, "+runscript", "/installer.txt"]


def library_in_use(containers, library_root=LIBRARY_ROOT):
    root = library_root.as_posix().rstrip("/")
    for container in containers:
        for mount in container.get("Mounts", []):
            source = mount.get("Source", "")
            if isinstance(source, str) and (source == root or source.startswith(root + "/")):
                return True
    return False


def state_idle(state):
    return isinstance(state, dict) and isinstance(state.get("profiles"), list) and (state.get("job") is None or isinstance(state.get("job"), dict) and state["job"].get("status") in {"completed", "failed"})


def run_json(args):
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise LibraryError("Docker konnte nicht sicher abgefragt werden.") from None


def assert_idle():
    try:
        with STATE_FILE.open("r", encoding="utf8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        raise LibraryError("Panelzustand nicht lesbar; Bibliothekswechsel bleibt gesperrt.") from None
    if not state_idle(state):
        raise LibraryError("Eine Panelaktion läuft. Bitte zuerst deren Abschluss abwarten.")
    try:
        result = subprocess.run(["docker", "ps", "-q"], check=True, capture_output=True, text=True)
    except (OSError, subprocess.SubprocessError):
        raise LibraryError("Laufende Container konnten nicht geprüft werden.") from None
    ids = result.stdout.split()
    if len(ids) > 256 or any(not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in ids):
        raise LibraryError("Unklarer Containerzustand; Bibliothekswechsel bleibt gesperrt.")
    if ids and library_in_use(run_json(["docker", "inspect", *ids])):
        raise LibraryError("Eine vorbereitete Spielbibliothek wird verwendet. Laufendes Arma/DayZ zuerst regulär im Panel beenden.")


def checked_directory(directory, mode, owner=0):
    directory.mkdir(mode=mode, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise LibraryError("Ein Einrichtungsverzeichnis hat unsichere Rechte oder einen unerwarteten Besitzer.")
    os.chmod(directory, mode)


def private_child(directory):
    if not directory.exists():
        directory.mkdir(mode=0o700)
        os.chown(directory, UID, GID)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != UID or info.st_mode & 0o077:
        raise LibraryError("Der private Download-/Steam-Speicher hat unsichere Rechte.")


def regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise LibraryError("Die Bibliothek enthält Verknüpfungen oder nicht reguläre Dateien.")
    return info


def copy_tree(source, destination, *, lowercase=False, skip_cache=False, budget=None):
    """Copy without following links; reject case collisions and special files."""
    budget = {"files": 0, "bytes": 0} if budget is None else budget
    root_info = source.lstat()
    if not stat.S_ISDIR(root_info.st_mode):
        raise LibraryError("Ein Downloadverzeichnis fehlt oder ist eine Verknüpfung.")
    published_directory(destination, parents=True, exist_ok=False)
    seen = set()

    def visit(src, dst, depth):
        if depth > 48:
            raise LibraryError("Die Verzeichnisstruktur überschreitet die erlaubte Tiefe.")
        for entry in sorted(os.scandir(src), key=lambda item: item.name):
            name = entry.name
            if skip_cache and depth == 0 and (name.lower() in CACHE_NAMES or name.lower().startswith("ssfn") or name.lower() in {"config.vdf", "loginusers.vdf", "clientregistry.blob"}):
                continue
            if name in {".", ".."} or "\\" in name or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in name):
                raise LibraryError("Ein Dateiname enthält unsichere Zeichen.")
            target_name = name.lower() if lowercase else name
            target = dst / target_name
            relative = target.relative_to(destination).as_posix()
            if relative in seen:
                raise LibraryError("Dateinamen kollidieren nach der Linux-Kleinschreibung.")
            seen.add(relative)
            info = Path(entry.path).lstat()
            budget["files"] += 1
            if budget["files"] > MAX_FILES:
                raise LibraryError("Der Download enthält zu viele Dateien.")
            if stat.S_ISDIR(info.st_mode):
                published_directory(target)
                visit(Path(entry.path), target, depth + 1)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                budget["bytes"] += info.st_size
                if budget["bytes"] > MAX_BYTES:
                    raise LibraryError("Die Bibliothek überschreitet die erlaubte Gesamtgröße.")
                require_space(dst, info.st_size)
                with Path(entry.path).open("rb") as reader, target.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                os.chmod(target, 0o755 if info.st_mode & 0o111 else 0o644)
            else:
                raise LibraryError("Die Bibliothek enthält Verknüpfungen oder Spezialdateien.")
    visit(source, destination, 0)
    return budget


def collect_keys(mod):
    keys = mod / "keys"
    if keys.exists() and not keys.is_dir():
        raise LibraryError("Ein Mod besitzt ein ungültiges Schlüsselverzeichnis.")
    published_directory(keys, exist_ok=True)
    for item in list(mod.rglob("*.bikey")):
        info = regular_file(item)
        if info.st_size > 1024 * 1024:
            raise LibraryError("Ein Mod-Signaturschlüssel ist zu groß.")
        target = keys / item.name
        if target == item:
            continue
        if target.exists():
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(item.read_bytes()).digest():
                raise LibraryError("Ein Mod enthält widersprüchliche Signaturschlüssel.")
        else:
            require_space(keys, info.st_size)
            shutil.copyfile(item, target)
            os.chmod(target, 0o644)


def find_workshop(download, home, app_id, item_id):
    candidates = [download / "server/steamapps/workshop/content" / app_id / item_id, home / ".local/share/Steam/steamcmd/steamapps/workshop/content" / app_id / item_id, home / "Steam/steamapps/workshop/content" / app_id / item_id, home / ".local/share/Steam/steamapps/workshop/content" / app_id / item_id]
    for candidate in candidates:
        if candidate.exists():
            # Steam cache roots may have links, but no workshop-item tree or
            # parent within its content path may resolve outside private data.
            resolved = candidate.resolve()
            if not any(resolved.is_relative_to(root.resolve()) for root in (download, home)):
                raise LibraryError("Workshop-Inhalt liegt außerhalb des privaten Downloadspeichers.")
            if not candidate.is_symlink() and candidate.is_dir():
                return candidate
    raise LibraryError("Ein ausgewählter Workshop-Mod wurde nicht vollständig heruntergeladen.")


def add_steamclient(server, home):
    target = server / "linux64/steamclient.so"
    if target.is_file():
        regular_file(target)
        return
    for candidate in [home / ".local/share/Steam/steamcmd/linux64/steamclient.so", home / ".local/share/Steam/linux64/steamclient.so"]:
        if candidate.exists():
            info = regular_file(candidate)
            if not candidate.resolve().is_relative_to(home.resolve()):
                raise LibraryError("Steam-Laufzeitdatei liegt außerhalb des privaten Speichers.")
            published_directory(target.parent, exist_ok=True)
            require_space(target.parent, info.st_size)
            shutil.copyfile(candidate, target)
            os.chmod(target, 0o644)
            return
    raise LibraryError("Die native Steam-Laufzeitdatei wurde nicht gefunden.")


def verify_binary(server, game):
    if not stat.S_ISDIR(server.lstat().st_mode):
        raise LibraryError("Das Server-Downloadverzeichnis ist keine sichere reguläre Wurzel.")
    binary = server / GAMES[game]["binary"]
    info = regular_file(binary)
    with binary.open("rb") as handle:
        header = handle.read(4)
    if info.st_size <= 4 or header != b"\x7fELF":
        raise LibraryError("Der native Linux-Server wurde nicht vollständig heruntergeladen.")
    os.chmod(binary, 0o755)
    if game == "dayz" and not (server / "mpmissions/dayzOffline.chernarusplus").is_dir():
        raise LibraryError("Die benötigte DayZ-Chernarus-Mission fehlt.")


def publish(build, game, library_root=LIBRARY_ROOT):
    target = library_root / game
    previous = None
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if not stat.S_ISDIR(info.st_mode) or (hasattr(info, "st_uid") and info.st_uid != 0 and os.name != "nt") or info.st_mode & 0o022:
            raise LibraryError("Die bestehende Bibliothek hat unsichere Rechte.")
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        previous = library_root / f"{game}.previous.{stamp}.{uuid.uuid4().hex[:8]}"
        os.rename(target, previous)
    try:
        os.rename(build, target)
    except OSError:
        if previous is not None and not target.exists():
            os.rename(previous, target)
        raise LibraryError("Die vorbereitete Bibliothek konnte nicht atomar veröffentlicht werden.") from None
    return previous


def prepare(game, mods):
    if sys.platform != "linux" or not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise LibraryError("Diese Einrichtung muss als root direkt auf der Linux-VPS laufen.")
    if not sys.stdin.isatty() or not sys.stdout.isatty() or fcntl is None:
        raise LibraryError("Bitte ein interaktives SSH-Terminal öffnen; keine Passwörter über Pipes, Chat oder Dateien übergeben.")
    for ancestor in (Path("/var"), Path("/var/lib")):
        info = ancestor.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise LibraryError("Unsicherer übergeordneter Bibliothekspfad.")
    checked_directory(PRIVATE_ROOT, 0o700)
    checked_directory(LIBRARY_ROOT, 0o755)
    lock_fd = os.open(PRIVATE_ROOT / "prepare.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(lock_fd, "r+") as lock, contextlib.ExitStack() as preparation:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise LibraryError("Unsichere Einrichtungssperre.")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LibraryError("Eine Steam-Einrichtung läuft bereits.") from None
        preparation.enter_context(preparation_marker(LIBRARY_ROOT))
        assert_idle()
        if shutil.disk_usage(LIBRARY_ROOT).free < 40 * 1024 ** 3:
            raise LibraryError("Für Download, neue Bibliothek und Reserve sind mindestens 40 GiB freier Speicher nötig.")
        image = run_json(["docker", "image", "inspect", IMAGE])[0].get("Id", "")
        home = PRIVATE_ROOT / "steam-home"
        private_child(home)
        game_private = PRIVATE_ROOT / game
        checked_directory(game_private, 0o700)
        download = game_private / "download"
        private_child(download)
        print("Steam-Anmeldung erfolgt ausschließlich in diesem privaten SSH-Terminal.")
        print("SteamCMD fragt Passwort und gegebenenfalls Steam Guard selbst ab; sie werden nicht an GameSwitch übergeben.")
        username = input("Steam-Accountname: ").strip()
        contents = steam_script(game, username, mods)
        script = game_private / f"install-{uuid.uuid4().hex}.txt"
        script_fd = os.open(script, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(script_fd, "w", encoding="utf8", newline="\n") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(script, UID, GID)
        container = f"gameswitch-steam-prepare-{game}-{uuid.uuid4().hex[:12]}"
        build = None
        try:
            # Inherit the TTY. Neither Python nor Docker's log driver captures
            # password/Guard input or the interactive Steam login session.
            result = run_steam_download(docker_command(image, container, home, download, script), container, LIBRARY_ROOT)
            if result != 0:
                raise LibraryError("SteamCMD wurde nicht erfolgreich beendet; bisherige Bibliothek bleibt erhalten.")
            script.unlink()
            raw = download / "server"
            verify_binary(raw, game)
            estimate = sum(item.stat().st_size for item in raw.rglob("*") if item.is_file() and not item.is_symlink())
            if shutil.disk_usage(LIBRARY_ROOT).free < estimate + MIN_FREE:
                raise LibraryError("Für Veröffentlichung und Reserve ist zu wenig Speicher frei.")
            build = Path(tempfile.mkdtemp(prefix=f".{game}-build-", dir=LIBRARY_ROOT))
            os.chmod(build, 0o755)
            budget = copy_tree(raw, build / "server", skip_cache=True)
            add_steamclient(build / "server", home)
            verify_binary(build / "server", game)
            published_directory(build / "mods")
            for item_id in mods:
                source = find_workshop(download, home, GAMES[game]["workshop"], item_id)
                destination = build / "mods" / item_id
                before = budget["files"]
                copy_tree(source, destination, lowercase=True, budget=budget)
                if budget["files"] == before:
                    raise LibraryError("Ein ausgewählter Workshop-Mod ist leer.")
                collect_keys(destination)
            manifest = {"schema": 1, "gameId": game, "appId": GAMES[game]["app"], "ready": True, "workshopIds": mods, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")}
            with (build / "manifest.json").open("x", encoding="utf8") as handle:
                json.dump(manifest, handle, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(build / "manifest.json", 0o644)
            assert_idle()
            previous = publish(build, game)
            build = None
            print(f"{game}: native Serverdateien und {len(mods)} Workshop-Mod(s) vorbereitet.")
            print("Der tatsächliche Spielstart und Spielerbeitritt werden gesondert geprüft.")
            if previous:
                print("Die vorherige Bibliothek bleibt als geschützte Rückfallkopie erhalten.")
        finally:
            with contextlib.suppress(OSError):
                script.unlink(missing_ok=True)
            # Only this helper's random, fixed-prefix container is ever removed.
            remove_setup_container(container)
            if build is not None and build.parent == LIBRARY_ROOT and build.name.startswith(f".{game}-build-"):
                shutil.rmtree(build)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Geschützte Steam-Bibliothek vorbereiten; Anmeldung nur im interaktiven SSH-Terminal.")
    sub = parser.add_subparsers(dest="action", required=True)
    command = sub.add_parser("prepare", help="Arma 3 oder DayZ herunterladen und ohne Steam-Zugangsdaten bereitstellen")
    command.add_argument("game", choices=sorted(GAMES))
    command.add_argument("--workshop", default="", metavar="ID,ID", help="Bis zu 30 eindeutige Workshop-Item-IDs; keine Collection-IDs")
    args = parser.parse_args(argv)
    try:
        prepare(args.game, workshop_ids(args.workshop))
        return 0
    except (LibraryError, KeyboardInterrupt, EOFError) as error:
        message = str(error) if isinstance(error, LibraryError) else "Einrichtung abgebrochen; bisherige Bibliothek bleibt erhalten."
        print(message, file=sys.stderr)
        return 1
    except (OSError, ValueError, subprocess.SubprocessError):
        print("Einrichtung fehlgeschlagen. Private Dateirechte, Speicherplatz und Docker prüfen; bisherige Bibliothek bleibt erhalten.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
