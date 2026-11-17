# Hosting-Vorbereitung für den Netcup-VPS

Diese Anleitung beschreibt den Betrieb auf einem einzelnen VPS. Die konkrete Zieladresse bleibt in der lokalen SSH-Konfiguration. Private Schlüssel und Root-Passwörter gehören niemals ins Repository. GitHub Actions ist auf Wunsch des Eigentümers deaktiviert; Builds und Tests laufen lokal oder direkt auf dem VPS.

## Aufbau

- Linux-VPS, 8 vCPU, 16 GB RAM; Betriebssystem und Updates zuerst klären.
- PufferPanel aus **diesem Fork** auf Loopback, Docker für Spiele. Die neue Backup-Schnittstelle ist Voraussetzung.
- GameSwitch als eigener Systembenutzer ohne Docker-Rechte, nur auf `127.0.0.1:3001`.
- HTTPS-Reverse-Proxy vor GameSwitch; Verwaltung bevorzugt zusätzlich auf VPN beschränken.
- Nur benötigte Spielports veröffentlichen. Minecraft nutzt typischerweise TCP 25565, GMod TCP und UDP 27015. Arma 3 verwendet fünf aufeinanderfolgende UDP-Ports, standardmäßig 2302–2306. DayZ verwendet UDP vom Spielport bis Spielport + 2 und einen separaten Query-Port, standardmäßig 27016. Für den Parallelbetrieb von Arma 3 und DayZ müssen sich ihre UDP-Portbereiche unterscheiden, etwa mit 2312–2314 für DayZ. PufferPanel 8080 und SFTP 5657 bleiben administrativ erreichbar.

## GameSwitch bauen

```sh
cd /opt/gameswitch/gameswitch
npm ci
npm test
npm run build
npm prune --omit=dev
```

Node.js 24 oder neuer verwenden. Quellcode und `dist` gehören einem administrativen Benutzer; der Dienst darf nur sein Datenverzeichnis schreiben. Im Deployment nur benötigten Anwendungscode bereitstellen, keine `.git`-Historie oder privaten SSH-Schlüssel. Der Dienst erhält keinen Docker-Socket.

## Laufzeit anbinden

Für einen privaten Zugriff ohne Domain kann der Dienst alternativ ausschließlich über einen SSH-Tunnel betrieben werden: `PUBLIC_ORIGIN=http://127.0.0.1:3001`, `HOST=127.0.0.1` und ausdrücklich `ALLOW_LOOPBACK_HTTP_OVER_SSH=true` setzen. Diese Ausnahme wird für andere Listener-/Origin-Adressen abgelehnt. Der Transport vom Rechner zur VPS ist durch SSH verschlüsselt; HTTP bleibt auf beiden Enden im Loopback. Ohne diesen expliziten Modus erfordert Produktion eine HTTPS-Origin. Mit [Open-Panel.ps1](../deploy/Open-Panel.ps1) öffnet der Besitzer unter Windows den Zugang über seinen bestehenden, hostgeprüften SSH-Alias. Der lokale Port darf nicht gleichzeitig von einer Entwicklungsvorschau belegt sein.

PufferPanel entsprechend seiner [Dokumentation](https://docs.pufferpanel.com/en/3.x/installing.html) vorbereiten und den Daemon aus diesem Fork bauen. Das Root-Dockerfile enthält den Upstream-Build, benötigt eine passende Go-Toolchain und baut auch das ursprüngliche Panel. Eine unveränderte offizielle PufferPanel-Binary enthält die Backup-Korrektur nicht.

Ein eigenes OAuth2-Clientkonto für GameSwitch anlegen. Es benötigt Servererstellung, Definitionen, Installation, Start/Stop, Status, Konsole und Backup/Wiederherstellung. Seine Zugangsdaten gehören ausschließlich in eine geschützte lokale Umgebungsdatei. Das Konto ist aufgrund der Servererstellung privilegiert; keinen Client eines persönlichen Hauptkontos wiederverwenden.

Beispiel `/etc/gameswitch/gameswitch.env` (Berechtigung `0600`, keine echten Werte ins Repository):

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
PUBLIC_ORIGIN=https://panel.example.com
DATA_DIR=/var/lib/gameswitch
RUNTIME_MODE=pufferpanel
PUFFERPANEL_URL=http://127.0.0.1:8080
PUFFERPANEL_CLIENT_ID=EIGENER_CLIENT
PUFFERPANEL_CLIENT_SECRET=EIGENES_GEHEIMNIS
PUFFERPANEL_NODE_ID=0
HOST_CPU_CORES=8
HOST_MEMORY_MB=16384
RESERVED_MEMORY_MB=3072
GAME_UID=1000
GAME_GID=1000
```

UID/GID müssen zur Dienstidentität des PufferPanel-Daemons und zum Besitzer der Serververzeichnisse auf dem Testhost passen: PufferPanel als unprivilegierten Benutzer mit beispielsweise UID/GID 1000 und benötigter Docker-Gruppenmitgliedschaft betreiben, `GAME_UID`/`GAME_GID` entsprechend setzen. Der Daemon schreibt Installationsdateien unter seiner eigenen Identität. Die Spielecontainer laufen unter derselben Dateisystemidentität. Der separate GameSwitch-Benutzer hat keine Docker-Gruppenmitgliedschaft. Nicht einfach `0` verwenden, wenn Dateirechte fehlschlagen.

Das Spielserverbudget entspricht `HOST_MEMORY_MB` abzüglich `RESERVED_MEMORY_MB`. Im Standardbeispiel bleiben 13312 MB (13 GiB) für die Summe der konfigurierten RAM-Limits laufender Profile. Minecraft mit 6144 MB und GMod mit 4096 MB passen in dieses Beispielbudget. Die CPU-Limits sind Obergrenzen pro Container. Gleichzeitige Last mehrerer Spiele teilt sich die verfügbare Host-CPU.

Beispiel-Service: [gameswitch.service](../deploy/gameswitch.service). Er setzt `/opt/gameswitch/gameswitch` voraus. Beispiel-Proxy: [Caddyfile](../deploy/Caddyfile.example). Dateien vor Installation an Domain, Dateisystem und Betriebssystem anpassen.

Für eine öffentliche IP ohne Domain steht [Caddyfile.ip.example](../deploy/Caddyfile.ip.example) bereit. Mit der geprüften Caddy-Version 2.11.9 wird ein öffentlich vertrauenswürdiges Let's-Encrypt-IP-Zertifikat im `shortlived`-Profil angefordert und automatisch erneuert. Das Caddy-Datenverzeichnis muss dauerhaft erhalten bleiben; HTTPS/ACME über Port 80/443 erreichbar halten. Im GameSwitch-Dienst dann die echte HTTPS-Origin setzen, `ALLOW_LOOPBACK_HTTP_OVER_SSH` entfernen und `TRUST_LOOPBACK_PROXY=true` nur für den vorgeschalteten lokalen Proxy setzen. Backend und PufferPanel bleiben an Loopback gebunden.

Beim ersten Produktionsstart schreibt der Dienst den Einrichtungstoken in `DATA_DIR/setup-token` mit privaten Dateirechten. In der Entwicklung steht er im lokalen Terminal. Nur als Administrator auslesen, das Konto einrichten und den Token vertraulich behandeln. Der interne PufferPanel-Administrator und sein OAuth-Client werden mit [bootstrap-puffer.mjs](../deploy/bootstrap-puffer.mjs) eingerichtet; die gepatchte CLI nimmt das Passwort ausschließlich über `--password-stdin` entgegen. Diese internen Zugangsdaten erscheinen nicht in Prozessargumenten oder Ausgabe. Sitzungen sind pro Prozess; ein Neustart meldet Browser ab. Ein einzelner GameSwitch-Prozess verwaltet ein Datenverzeichnis; mehrere parallele Instanzen mit denselben Dateien werden nicht unterstützt.

Vor dem Upgrade auf den Parallelbetrieb `DATA_DIR/state.json` sichern. Beim nächsten Speichern wird der Zustand auf Schema 2 migriert. Eine vorhandene offene Sicherheitskopie bleibt dem betroffenen Profil zugeordnet. Für einen Rollback auf einen älteren Dienst mit Schema 1 ist der Zustand vor dem Upgrade erforderlich.

## Steam-Einrichtung im Panel aktivieren

Für den Button „Steam einrichten“ wird zusätzlich zum unprivilegierten GameSwitch-Prozess der begrenzte lokale Broker benötigt. Er ist kein öffentlich erreichbares Terminal und öffnet keinen TCP-Port. Er startet ausschließlich den festen Steam-Bibliothekshelfer für Arma 3 oder DayZ. Der Appbenutzer erhält keine Docker-Rechte und keine allgemeine `sudo`-Freigabe.

Die Dateien aus dem geprüften Checkout als Hostadministrator installieren; der separate Benutzer und die Gruppe `gameswitch` müssen bereits vorhanden sein:

```sh
sudo install -d -o root -g root -m 0755 /usr/local/lib/gameswitch /var/lib/gameswitch-libraries
sudo install -d -o root -g root -m 0700 /var/lib/gameswitch-steam-private
sudo install -o root -g root -m 0755 deploy/steam-library.py /usr/local/bin/gameswitch-steam-library
sudo install -o root -g root -m 0644 deploy/steam-setup-broker.py /usr/local/lib/gameswitch/steam-setup-broker.py
sudo install -o root -g root -m 0644 deploy/storage-cleanup.py /usr/local/lib/gameswitch/storage-cleanup.py
sudo install -o root -g root -m 0644 deploy/gameswitch-steam-setup.service /etc/systemd/system/gameswitch-steam-setup.service
sudo systemctl daemon-reload
sudo systemctl enable --now gameswitch-steam-setup.service
sudo systemctl is-active gameswitch-steam-setup.service
```

Diese Befehle sind aus `/opt/gameswitch/gameswitch` gedacht. Der neue Dienst verwaltet sein Runtime-Verzeichnis und den Socket `/run/gameswitch-steam-setup/control.sock`: `root:gameswitch`, Socket `0660`, Verzeichnis `0750`. Linux-Peercredentials erlauben nur Root oder die UID des vorhandenen Appbenutzers (auf dem Zielhost 988). Das Beispielservice begrenzt Schreibpfade und Fähigkeiten; seine festgelegten Bibliotheks-/Privatverzeichnisse müssen vor dem Start existieren. Der Bibliothekshelfer verwendet nur das kontrollierte lokale offizielle SteamCMD-Image, begrenzte Ressourcen und einen eigenen Downloadcontainer. Kein Docker-Socket wird dem Appprozess oder Spielecontainern gegeben.

Unter „Sicherheit & System“ zeigt „Speicher prüfen“ den freien Speicher sowie gesondert frühere veröffentlichte Steam-Bibliotheken und die Download-Zwischenstände für Arma 3 und DayZ. Eine Auswahl wird erst nach ausdrücklicher Bestätigung entfernt. Welten, Spielprofile, PufferPanel-Backups und der Steam-Anmeldecache `steam-home` werden nicht gelöscht. Ältere Bibliotheken sind Rückfallkopien; nach ihrer Entfernung ist genau dieser alte Stand nicht mehr verfügbar. Download-Zwischenstände müssen bei späterer Einrichtung erneut geladen werden. Der root-eigene Broker akzeptiert keine freien Pfade oder Befehle und die Aufräumaktion verwendet dieselbe Sperre wie die Steam-Einrichtung. Während einer aktiven Steam-Einrichtung oder der Verwendung einer vorbereiteten Bibliothek bleibt Aufräumen gesperrt.

Für die aktualisierte Anwendung gegebenenfalls ausschließlich `gameswitch` nach Abschluss laufender Panelaktionen neu starten. **PufferPanel nicht neu starten:** dessen geordneter Dienststopp beendet verwaltete Spiele. Der neue Steam-Einrichtungsdienst erfordert keinen PufferPanel- oder Minecraft-Neustart. Ein Appneustart meldet Browser ab und bricht eine noch laufende Steam-Einrichtung ab; bereits veröffentlichte Bibliotheken bleiben erhalten.

Im angemeldeten HTTPS-Panel über den Header oder „Sicherheit & System“ auf „Steam einrichten“ klicken. Der Button steht auch an Arma-/DayZ-Profilen und in deren Formularen. Spiel und optionale einzelne Workshop-IDs wählen, anschließend „Steam-Anmeldung öffnen“. Der Dialog zeigt die echten SteamCMD-Aufforderungen. Accountname, Passwort und Steam Guard werden jeweils im verdeckten Eingabefeld gesendet; eine leere Eingabe sendet nur Enter. Keine automatische Wiederholung bei unbestätigter Zustellung. Ein Steam-OpenID-Weblogin allein würde nur die Identität bestätigen, aber keine Berechtigung für diese Downloads liefern.

Die Anmeldung darf jederzeit später erfolgen. Ohne begonnene Sitzung wird nichts heruntergeladen. Ein bereits gestarteter Vorgang läuft nach dem Schließen des Dialogs weiter und kann über den Button wieder geöffnet werden. „Steam-Einrichtung abbrechen“ beendet ausschließlich diesen Vorgang. Abmelden entzieht dem Ausgabestream den Zugriff; ein Neustart des Appprozesses oder Verlust seiner Brokerverbindung bricht den eigenen Helfer ab. Die Ausgabe bleibt begrenzt im RAM, Eingaben werden nicht in App-/Browser-Storage, Audit oder Diagnose übernommen. Nur Steams eigener Anmeldecache bleibt im Root-geschützten Hostspeicher.

## Arma 3 und DayZ mit Steam vorbereiten

Die neue Oberfläche kann beide Profile bereits anlegen. Vor ihrem ersten echten Start müssen die benötigten stabilen Linux-Serverdateien über den geschützten Hosthelfer vorbereitet werden. Die erste authentifizierte Installation und native Spielbereitschaft sind im aktuellen Prüfstand noch offen. Bestehende Spiele werden für diese Einrichtung nicht vom Panel gestoppt. Die Vorbereitung benötigt freien Speicher und begrenzte Download-/CPU-Ressourcen; sie ersetzt keinen ausdrücklich angeforderten Spielewechsel.

Die Panel-Einrichtung ist der normale Bedienweg. Alternativ nach Installation des aktuellen Hosthelfers als Serveradministrator über den bereits hostgeprüften SSH-Zugang ausführen:

```sh
sudo gameswitch-steam-library prepare arma3
sudo gameswitch-steam-library prepare dayz
```

Bei dieser Alternative erfolgen Steam-Anmeldung und gegebenenfalls Steam Guard interaktiv im SSH-Terminal. Steam-Zugangsdaten nur in der geschützten Panel-Einrichtung oder den aktuellen SteamCMD-Prompts eingeben, nicht in Chat, Shellbefehle oder normale Profilfelder. Der Helfer hält Steams Anmeldecache in einem gemeinsamen, Root-geschützten HOME; dieses Verzeichnis wird keinem Spielcontainer zugänglich gemacht. Der Steam-Zugang muss für Spiel und ausgewählte Workshop-Inhalte berechtigt sein.

Für einzelne Workshop-Mods den Aufruf um `--workshop ID,ID` ergänzen; dabei die Platzhalter durch die numerischen IDs der gewünschten Inhalte ersetzen. Für Arma 3 gehören die Inhalte zur Workshop-App `107410`, für DayZ zur App `221100`. Auch notwendige Abhängigkeiten explizit vorbereiten und im Profil auswählen. Es gibt in dieser ersten Anbindung keine automatische Collection-Auflösung und keinen Import beliebiger Launcher-Dateien. Serverpakete sind die festen Apps `233780` für Arma 3 und `223350` für DayZ.

Der Helfer veröffentlicht ausschließlich bereinigte Server-/Moddateien und ein Manifest unter `/var/lib/gameswitch-libraries/arma3` beziehungsweise `/var/lib/gameswitch-libraries/dayz`. Diese Bibliotheken müssen Root gehören und dürfen nicht gruppen-/weltbeschreibbar sein. Der Spielcontainer erhält die passende Bibliothek nur lesend und kopiert die benötigten Dateien ins eigene Profil; Anmeldecaches werden nicht übernommen. Der Manifeststatus wird durch `/api/state.runtimeSetup` angezeigt. Ohne sichere Bibliothek oder ohne einen ausgewählten vorbereiteten Mod bleibt der Profilstart gesperrt, serverseitig bereits vor Speichern oder Stoppen der laufenden Instanz. Ein vorbereiteter Dateibestand bestätigt noch keinen erfolgreichen nativen Serverstart.

Arma 3 hält sein HOME einschließlich `.local/share` unter `arma-home` im Spielvolume; die Adminliste liegt im eingeschlossenen `arma/admins.cfg`. Die Datei nur über den Helfer bei bestätigtem Stopp ändern; nach dem nächsten Start können eingetragene Spieler im Spiel `#login` verwenden. DayZ hält Profile und RPT-/Verwaltungslogs unter `profiles`, den Welt-/Charakterzustand im Chernarus-Missionsbereich. Die Spielverzeichnisse gehören zu den vollständigen Backups; nur der verschachtelte `.steam`-Cache wird als Tmpfs ausgenommen. Das Spielpasswort ist zusätzlich im privaten GameSwitch-Geheimnisspeicher abgelegt. Für eine Hostwiederherstellung Panelzustand, Geheimnisspeicher und Bibliotheken berücksichtigen oder die Bibliotheken kontrolliert neu vorbereiten.

Die Serverprotokolle beider Spiele sind im Panel lesbar. Ein BattlEye-RCON-Adapter ist hier nicht freigegeben; der Source/TCP-Adapter für andere Spiele wird nicht dafür verwendet. Vor Freigabe müssen geordnetes Stoppen, Weltpersistenz und Backup/Restore mit der tatsächlich installierten Spielversion geprüft werden.

### DayZ-Laufzeitumgebung

Der native `DayZServer` benötigt die Systembibliotheken `libcurl` und `libcap`, die im reinen `steamcmd/steamcmd`-Image fehlen. Der Steam-Bibliothekshelfer baut deshalb bei jeder DayZ-Einrichtung lokal das Image `gameswitch.invalid/dayz-runtime:1` aus dem bereits vorhandenen `steamcmd/steamcmd:latest` plus `libcurl4t64` und `libcap2` (Ubuntu-Paketquellen müssen erreichbar sein). Danach prüft er `ldd DayZServer` in genau diesem Image ohne Netzwerk und mit schreibgeschütztem Mount. Fehlen Bibliotheken, bricht die Einrichtung mit deren Namen ab und die bisherige Bibliothek bleibt erhalten. Erst danach trägt das Manifest `runtimeImage` ein; ohne diesen Eintrag meldet das Panel „Steam einrichten erneut ausführen“. Der Name mit der reservierten Domain `.invalid` kann nie aus einer Registry gezogen werden: Fehlt das lokale Image, schlägt der Start sicher fehl, statt ein fremdes Image zu laden. Nach einem Update dieses Repositorys den Hosthelfer neu installieren (`sudo install -o root -g root -m 0755 deploy/steam-library.py /usr/local/bin/gameswitch-steam-library`) und DayZ einmal neu einrichten.

### Updates von Server und Mods

DayZ prüft mit `forceSameBuild = 1`, dass Server und Spieler dieselbe Version nutzen; Workshop-Mods müssen ebenfalls zum Client passen. Nach einem Spiel- oder Mod-Update:

1. „Steam einrichten“ für das Spiel erneut ausführen. Die Mod-Liste ist mit den Mods aller Profile dieses Spiels vorbelegt; die Bibliothek enthält danach genau diese Mods.
2. Am Profil „Server & Mods aktualisieren“ wählen. Das Panel zeigt dort an, wenn die Bibliothek neuer ist als das Profil.

Das Update speichert und stoppt ein laufendes Profil, erstellt ein vollständiges `Vor-Update`-Backup, wendet die aktuelle Vorlage erneut an und kopiert Serverdateien, Standard-Missionsdateien, Mods und Signaturschlüssel neu. `mods/` und `keys/` werden dabei vollständig neu aufgebaut. Welt- und Charakterstand (`storage_1`), `profiles/` (Admin-Mod-Daten, Logs) und `serverDZ.cfg` bleiben erhalten. Ein vorher laufendes Profil startet danach wieder. Eigene Änderungen an den Vanilla-Missionsdateien werden wie bei `app_update validate` auf den Spielstand zurückgesetzt.

### DayZ-Administration

- **Ohne Adminmod:** Ein Adminpasswort (8–32 Zeichen) im Profilformular oder später unter „Konsole & Admin“ setzen. Es landet als `passwordAdmin` in `serverDZ.cfg`; im Spiel den Chat öffnen und `#login Adminpasswort` eingeben.
- **VPPAdminTools (Adminmenü):** Im Profilformular „Adminmenü VPPAdminTools hinzufügen“ wählen (fügt CF `1559212036` und VPPAdminTools `1828439124` in dieser Reihenfolge ein), Adminpasswort und SteamID64 der Admins eintragen und die Mods über „Steam einrichten“ vorbereiten. Bei der Installation entstehen `profiles/VPPAdminTools/Permissions/SuperAdmins/SuperAdmins.txt` und `credentials.txt`; VPP ersetzt das Klartextpasswort beim ersten Start durch seinen Hash. Weitere Superadmins und Passwortänderungen bei gestopptem Profil unter „Konsole & Admin“. Im Spiel öffnet die unter Steuerung → VPPAdminTools hinterlegte Taste das Menü, dort das Adminpasswort eingeben.
- **Community Online Tools:** wird mit CF davor geladen; Rechte über die eigenen Dateien unter `profiles/PermissionsFramework` pflegen. Ein Panel-Helfer dafür ist nicht enthalten.

Ob die gewählten Mods den Linux-Server offiziell unterstützen, geben ihre Workshop-Seiten nicht an. Vor dem Spielbetrieb einmal mit echten Spielern prüfen.

## Fehler-ID im Dienstjournal prüfen

Behandelte Serverfehler und fehlgeschlagene Vorgänge zeigen eine Fehler-ID. Beim mitgelieferten systemd-Dienst schreibt der private JSON-Logger auf stderr ins Journal. Als Serveradministrator einen begrenzten Zeitraum und die angezeigte UUID verwenden:

```sh
sudo journalctl -u gameswitch.service --since '30 minutes ago' --no-pager -o cat | rg -F -- 'ANGEZEIGTE-FEHLER-UUID'
```

Ohne `rg` ist `grep -F --` für dieselbe feste UUID geeignet. Der Eintrag `gameswitch_error` enthält nur freigegebene Metadaten, feste Fehlerkategorien und gegebenenfalls einen Antwort-Fingerabdruck; keine rohen Laufzeitantworten oder Passwörter. `requestId`, `jobId` und der fehlgeschlagene Schritt erleichtern die Zuordnung. Die Oberfläche liest das Journal nicht aus. Journalzugriff und Aufbewahrungsfristen auf dem Host beschränken; GameSwitch richtet keine eigene Logdatei oder Rotation ein. Ein fehlender Eintrag kann auch durch Journalkonfiguration oder einen Logger-Schreibfehler entstehen. Eine fehlgeschlagene oder unbestätigte Spielaktion nicht allein zur Diagnose blind wiederholen.

## Freigabetest

Für die aktuelle Evolution-2-Instanz sind acht vCPU, 12 GiB Container-RAM und beim nächsten regulären Start 8 GiB maximaler / 2 GiB anfänglicher Java-Heap vorgesehen. ServerCore 1.5.19 setzt Sichtweite 16 und Simulationsdistanz 6 über `dynamic.default-values` in `config/servercore/config.yml`; dies überschreibt die ebenfalls angepassten Werte in `server.properties`. Die vorhandenen dynamischen Simulationseinträge bleiben auf maximal 6 begrenzt und dürfen bei Last bis 5 reduzieren; es gibt keinen dynamischen Sichtweitenregler, der die gewünschten 16 herabsetzt. Die Packregeln für Mobcaps, Aktivierungsbereiche und Chunk-Ticks bleiben unverändert. Originalkonfigurationen liegen geschützt außerhalb des Spielecontainers unter `/root/gameswitch-config-backups/`.

Diese ServerCore-Version kann Konfiguration und Distanzen ohne Spielneustart übernehmen: `servercore reload`, `servercore settings simulation_distance 6`, `servercore settings view_distance 16`, danach `servercore status` prüfen. Java-Heap und beim Start erzeugte Worker-Pools benötigen dagegen einen regulären Neustart. Der neue Panel-Button verlangt Bestätigung und führt Speichern → geordnetes Stoppen → vollständiges Backup → Start desselben Profils aus; er bestätigt einen laufenden Prozess, keine fertig geladene Welt.

Neue Portalziele können zusätzliche Chunkgenerierung verursachen. Sichtweite 16 erhöht dabei den sichtbaren und zu ladenden Weltumfang; freie Kerne allein beseitigen die Wartezeit nicht. Eine gezielte Vorberechnung begrenzter Zielgebiete mit dem bereits enthaltenen Chunky ist eine gesonderte, ressourcenintensive Aufgabe außerhalb aktiven Spielbetriebs. Hierfür wurden keine Generierungsläufe gestartet. Die Diagnose des konkreten Erstbesuchs bleibt von der früheren Profilaufnahme gewöhnlicher Simulation zu unterscheiden. ServerCore-Referenzen: [Befehle der passenden Version](https://github.com/Wesley1808/ServerCore/blob/ver/26.1/common/src/main/java/me/wesley1808/servercore/common/commands/ServerCoreCommand.java), [dynamische Verwaltung](https://github.com/Wesley1808/ServerCore/blob/ver/26.1/common/src/main/java/me/wesley1808/servercore/common/dynamic/DynamicManager.java).

1. Ohne Anmeldung und mit falscher Origin dürfen Profilaktionen nicht möglich sein. HTTPS und Secure-Cookies im Browser kontrollieren.
2. Minecraft-Profil anlegen, starten, eine erkennbare Weltänderung speichern.
3. GMod mit eigener öffentlicher beziehungsweise ungelisteter Collection parallel starten. Beide Spielprozesse, Ports und Konsolen prüfen. GMod neu starten und danach stoppen. Prüfen, dass Minecraft weiter erreichbar ist und GMod ein eigenes Sicherheitsbackup erhält.
4. Mit einem zweiten Minecraft-Profil denselben TCP-Port sowie mit getrenntem Port ein überschrittenes RAM-Budget prüfen. Der Start muss in beiden Fällen abbrechen. Danach bei allein laufendem Minecraft einen gezielten Wechsel zu einem zulässigen Ziel testen. Zum ursprünglichen Profil zurückkehren, Weltänderung überprüfen und sein Backup separat wiederherstellen.
5. Einen vollen Backupdatenträger und einen PufferPanel-Ausfall simulieren. Beim Wechsel muss ein fehlgeschlagenes Quellbackup den Zielstart blockieren. Nach einem fehlgeschlagenen Backup beim Stopp muss die Verpflichtung für das betroffene Profil erhalten bleiben.
6. GameSwitch während eines Profilvorgangs beenden. Nach seinem Neustart mit PufferPanel abgleichen, welche Profile laufen und welche Backups noch ausstehen. Ein unterbrochener Vorgang muss als fehlgeschlagen erscheinen.
7. Effektive Containerkonfiguration prüfen: unprivilegierter Benutzer, Bridge-Netz, keine zusätzlichen Hostfreigaben außerhalb des Serververzeichnisses und erforderlicher schreibgeschützter Laufzeitdateien, keine zusätzlichen Capabilities, `no-new-privileges`, RAM-/CPU-/PID-Limits.
8. Backup auf einen anderen Speicher kopieren, Zugriff beschränken und Wiederherstellung von dort testen.

Die Abnahme des neuen Parallelbetriebs auf dem Zielsystem steht aus. Die Startprüfung bestätigt einen laufenden Prozess. Spielbeitritt und vollständig geladene Welt sind separat zu prüfen. Große Modpacks können lange initialisieren und in der Startphase besonders viel CPU beanspruchen.
