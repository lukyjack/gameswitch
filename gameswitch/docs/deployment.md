# Hosting-Vorbereitung für den Netcup-VPS

Diese Anleitung beschreibt den Betrieb auf einem einzelnen VPS. Die konkrete Zieladresse bleibt in der lokalen SSH-Konfiguration. Private Schlüssel und Root-Passwörter gehören niemals ins Repository. GitHub Actions ist auf Wunsch des Eigentümers deaktiviert; Builds und Tests laufen lokal oder direkt auf dem VPS.

## Aufbau

- Linux-VPS, 8 vCPU, 16 GB RAM; Betriebssystem und Updates zuerst klären.
- PufferPanel aus **diesem Fork** auf Loopback, Docker für Spiele. Die neue Backup-Schnittstelle ist Voraussetzung.
- GameSwitch als eigener Systembenutzer ohne Docker-Rechte, nur auf `127.0.0.1:3001`.
- HTTPS-Reverse-Proxy vor GameSwitch; Verwaltung bevorzugt zusätzlich auf VPN beschränken.
- Nur benötigte Spielports veröffentlichen: typischerweise Minecraft TCP 25565, GMod TCP/UDP 27015. Die tatsächlichen Profilports sind maßgeblich. PufferPanel 8080 und SFTP 5657 bleiben administrativ erreichbar.

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

UID/GID müssen zur Dienstidentität des PufferPanel-Daemons und zum Besitzer der Serververzeichnisse auf dem Testhost passen: PufferPanel als unprivilegierten Benutzer mit beispielsweise UID/GID 1000 und benötigter Docker-Gruppenmitgliedschaft betreiben, `GAME_UID`/`GAME_GID` entsprechend setzen. Der Daemon schreibt Installationsdateien unter seiner eigenen Identität. Die Spielecontainer laufen unter derselben Dateisystemidentität. Der separate GameSwitch-Benutzer hat keine Docker-Gruppenmitgliedschaft. Nicht einfach `0` verwenden, wenn Dateirechte fehlschlagen. Das Standardbudget lässt 3 GB für Betriebssystem, Panel, Dateicache und Backupverarbeitung frei; ein Profil kann maximal 13 GB reservieren.

Beispiel-Service: [gameswitch.service](../deploy/gameswitch.service). Er setzt `/opt/gameswitch/gameswitch` voraus. Beispiel-Proxy: [Caddyfile](../deploy/Caddyfile.example). Dateien vor Installation an Domain, Dateisystem und Betriebssystem anpassen.

Für eine öffentliche IP ohne Domain steht [Caddyfile.ip.example](../deploy/Caddyfile.ip.example) bereit. Mit der geprüften Caddy-Version 2.11.9 wird ein öffentlich vertrauenswürdiges Let's-Encrypt-IP-Zertifikat im `shortlived`-Profil angefordert und automatisch erneuert. Das Caddy-Datenverzeichnis muss dauerhaft erhalten bleiben; HTTPS/ACME über Port 80/443 erreichbar halten. Im GameSwitch-Dienst dann die echte HTTPS-Origin setzen, `ALLOW_LOOPBACK_HTTP_OVER_SSH` entfernen und `TRUST_LOOPBACK_PROXY=true` nur für den vorgeschalteten lokalen Proxy setzen. Backend und PufferPanel bleiben an Loopback gebunden.

Beim ersten Produktionsstart schreibt der Dienst den Einrichtungstoken in `DATA_DIR/setup-token` mit privaten Dateirechten. In der Entwicklung steht er im lokalen Terminal. Nur als Administrator auslesen, das Konto einrichten und den Token vertraulich behandeln. Der interne PufferPanel-Administrator und sein OAuth-Client werden mit [bootstrap-puffer.mjs](../deploy/bootstrap-puffer.mjs) eingerichtet; die gepatchte CLI nimmt das Passwort ausschließlich über `--password-stdin` entgegen. Diese internen Zugangsdaten erscheinen nicht in Prozessargumenten oder Ausgabe. Sitzungen sind pro Prozess; ein Neustart meldet Browser ab. Ein einzelner GameSwitch-Prozess verwaltet ein Datenverzeichnis; mehrere parallele Instanzen mit denselben Dateien werden nicht unterstützt.

## Freigabetest

Für die aktuelle Evolution-2-Instanz sind acht vCPU, 12 GiB Container-RAM und beim nächsten regulären Start 8 GiB maximaler / 2 GiB anfänglicher Java-Heap vorgesehen. ServerCore 1.5.19 setzt Sichtweite 16 und Simulationsdistanz 6 über `dynamic.default-values` in `config/servercore/config.yml`; dies überschreibt die ebenfalls angepassten Werte in `server.properties`. Die vorhandenen dynamischen Simulationseinträge bleiben auf maximal 6 begrenzt und dürfen bei Last bis 5 reduzieren; es gibt keinen dynamischen Sichtweitenregler, der die gewünschten 16 herabsetzt. Die Packregeln für Mobcaps, Aktivierungsbereiche und Chunk-Ticks bleiben unverändert. Originalkonfigurationen liegen geschützt außerhalb des Spielecontainers unter `/root/gameswitch-config-backups/`.

Diese ServerCore-Version kann Konfiguration und Distanzen ohne Spielneustart übernehmen: `servercore reload`, `servercore settings simulation_distance 6`, `servercore settings view_distance 16`, danach `servercore status` prüfen. Java-Heap und beim Start erzeugte Worker-Pools benötigen dagegen einen regulären Neustart. Der neue Panel-Button verlangt Bestätigung und führt Speichern → geordnetes Stoppen → vollständiges Backup → Start desselben Profils aus; er bestätigt einen laufenden Prozess, keine fertig geladene Welt.

Neue Portalziele können zusätzliche Chunkgenerierung verursachen. Sichtweite 16 erhöht dabei den sichtbaren und zu ladenden Weltumfang; freie Kerne allein beseitigen die Wartezeit nicht. Eine gezielte Vorberechnung begrenzter Zielgebiete mit dem bereits enthaltenen Chunky ist eine gesonderte, ressourcenintensive Aufgabe außerhalb aktiven Spielbetriebs. Hierfür wurden keine Generierungsläufe gestartet. Die Diagnose des konkreten Erstbesuchs bleibt von der früheren Profilaufnahme gewöhnlicher Simulation zu unterscheiden. ServerCore-Referenzen: [Befehle der passenden Version](https://github.com/Wesley1808/ServerCore/blob/ver/26.1/common/src/main/java/me/wesley1808/servercore/common/commands/ServerCoreCommand.java), [dynamische Verwaltung](https://github.com/Wesley1808/ServerCore/blob/ver/26.1/common/src/main/java/me/wesley1808/servercore/common/dynamic/DynamicManager.java).

1. Ohne Anmeldung und mit falscher Origin dürfen Profilaktionen nicht möglich sein. HTTPS und Secure-Cookies im Browser kontrollieren.
2. Minecraft-Profil anlegen, starten, eine erkennbare Weltänderung speichern.
3. Zum zweiten Minecraft-Profil und dann zu GMod mit eigener öffentlicher beziehungsweise ungelisteter Collection wechseln. Zu jedem Zeitpunkt darf nur ein Profil laufen.
4. Zum ursprünglichen Profil zurückwechseln und die Weltänderung prüfen. Backup separat wiederherstellen.
5. Einen vollen Backupdatenträger und einen PufferPanel-Ausfall testen: kein neuer Spielstart nach gescheitertem Backup.
6. Panel während eines Wechsels abbrechen. Nach Neustart darf kein zweiter Server unbemerkt dazukommen.
7. Effektive Containerkonfiguration prüfen: unprivilegierter Benutzer, Bridge-Netz, keine zusätzlichen Hostfreigaben außerhalb des Serververzeichnisses und erforderlicher schreibgeschützter Laufzeitdateien, keine zusätzlichen Capabilities, `no-new-privileges`, RAM-/CPU-/PID-Limits.
8. Backup auf einen anderen Speicher kopieren, Zugriff beschränken und Wiederherstellung von dort testen.

Vor diesem Nachweis ist die echte Laufzeit eine integrierte, aber nicht auf dem Zielsystem abgenommene Funktion. Die aktuelle Startprüfung bestätigt einen laufenden Prozess, keine vollständig geladene Welt oder einen beitrittsbereiten Spielport. Große Modpacks können lange initialisieren; CPU-Kerne allein garantieren keine Minecraft-Tickrate. Ein gamespezifisches Bereitschaftssignal ist vor einem verlässlichen Produktionsstatus zu ergänzen.
