# Prüfstand · 15. November 2026

## Steam-Anmeldung direkt in der Oberfläche

Der Button „Steam einrichten“ und der Dialog für die tatsächliche SteamCMD-Anmeldung sind implementiert. Er ist im Header, unter „Sicherheit & System“ sowie an Arma-/DayZ-Profilen und deren Formularen erreichbar. Die Oberfläche verwendet verdeckte, flüchtige Eingaben, begrenzte Textausgabe und ausdrücklichen Abbruch; keine automatische Wiederholung von Eingaben. Der abschließende lokale Produktionsbuild nach der defensiven SSE-JSON-Prüfung und präzisierten Speicherformulierung ist `index-NWHxnEeW.js` mit `index-Cd5HyGcp.css`.

Die vollständige Node-Suite bestand mit 163 Tests, einschließlich der neuen Steam-API-/SSE-/Clientprüfungen. Auf Linux bestanden 16 Python-Tests des Bibliothekshelfers, zehn Brokerprüfungen sowie acht native Unix-Socket-/PTY-Integrationsprüfungen. Diese prüfen unter anderem Authentifizierung/Origin/CSRF, begrenzte Protokollframes und Eingaben, flüchtige Ausgabe-Redaktion, Sitzungsgrenzen sowie den Abbruch ausschließlich des eigenen Einrichtungsprozesses.

Ein gesonderter Nachweis nutzte den tatsächlichen Produktionsbroker mit dem unprivilegierten Appbenutzer UID 988: Der feste Hosthelfer startete und lieferte seinen Accountnamen-Prompt. Der Vorgang wurde anschließend abgebrochen; der Helfer endete mit Code 1 und der `.preparing`-Marker wurde entfernt. Es wurden keine Zugangsdaten übermittelt. Dieser Nachweis bestätigt den privaten Einrichtungsweg bis zum ersten Prompt und dessen Abbruch, keine erfolgreiche SteamCMD-Authentifizierung. Der zusätzliche Panel-Anmeldeweg wurde anschließend mit dem Build `index-NWHxnEeW.js` / `index-Cd5HyGcp.css` ausgerollt; GameSwitch, der neue Steam-Einrichtungsdienst, PufferPanel und Caddy wurden als aktiv bestätigt.

Die Browserprüfung in der lokalen Sandbox bestätigte Header-Button → Einrichtungsdialog → Start → verbundene SSE-Ausgabe → verdeckte Dummy-Eingabe mit anschließend geleertem Feld und ohne Rückanzeige → ausdrücklichen Abbruch. Die Dummy-Eingabe wurde ausschließlich am simulierten Browser-Testdienst verwendet; sie war keine Steam-Anmeldung.

Zusätzlich verband ein isolierter authentifizierter HTTP-/Sandboxzustand des ausgerollten Anwendungscodes dessen echte API/SSE-/Node-IPC-Strecke mit dem Produktionsbroker und dem festen CLI-Helfer unter UID 988. Nachgewiesen: Start 201, SSE 200, tatsächlicher Accountnamen-Prompt des Helfers, Abbruch 200 und Endzustand `cancelled`. Es wurden keine Steam-Zugangsdaten gesendet; der Test verzeichnete null Spiel-Lebenszyklusaufrufe und der `.preparing`-Marker wurde entfernt. Der produktive Minecraftcontainer blieb bei derselben ID `76fcf2bc8ee7`, Startzeit 14:48:26.962 UTC, Neustartzähler null und Health `healthy`.

Der Eigentümer hat die Steam-Anmeldung ausdrücklich auf später verschoben. Es wurde kein Accountpasswort und kein Steam-Guard-Code eingegeben; authentifizierte Downloads sowie native Arma-/DayZ-Spielstarts und Spielbeitritt bleiben offen.

## Erweiterung um Arma 3 und DayZ

Der Katalog umfasst mit Arma 3 und DayZ jetzt neun Spiele. Vor der neuen Web-Steam-Einrichtung bestand die vollständige Node-Suite mit 144 Tests. Zusätzlich bestanden 16 Python-Hosthelfertests und drei Bibliotheksprüfungen direkt unter Linux; die späteren Broker-/Webtests sind davon getrennt. Darin enthalten sind sieben neue API-/Sicherheitsprüfungen für Authentifizierung/Origin/CSRF, freigegebene Missionen, gültige Steam-Konten, begrenzte Workshop-Listen, Injection-/Crossgame-Eingaben, private Spielpasswörter, abgeleitete Portbereiche und reine Leseprotokolle. Eine fehlende Steam-Bibliothek verhindert die Aktivierung vor jeder Save-/Stopp-Aktion an der laufenden Minecraft-Instanz. Der Produktionsbuild der neuen Formularoberfläche wurde lokal erfolgreich erzeugt.

Arma-Admin-Konfiguration, DayZ-Vorlage, Bibliotheksmanifest und Dateigrenzen sind implementiert und werden gezielt geprüft. Die ersten authentifizierten Steam-Downloads, die nativen Spielstarts, Spielerbeitritt, geordnetes Speichern/Stoppen und ein vollständiger Arma-/DayZ-Backup-/Restore-Zyklus sind noch nicht bestätigt. Die Arma-/DayZ-Profilformulare, beide simulierten Wechselabläufe mit Backup und die gestoppte Arma-Adminpflege wurden in der lokalen Sandbox geprüft. Anschließend wurden diese Erweiterung und der CLI-Hosthelfer auf dem VPS bereitgestellt; Minecraft behielt Container-ID, Startzeit und den Neustartzähler null. Die danach ergänzte Web-Steam-Einrichtung und ihre abgegrenzten Browser-/HTTP-/Broker-Nachweise sind oben gesondert erfasst. Die Sandbox simuliert Server-/Steam-Bereitschaft und ist kein Nachweis einer echten Spieleinstallation. Für diese Erweiterung wurde Minecraft nicht gestoppt; GitHub-CI bleibt deaktiviert.

Die nachfolgenden 109-Tests-/Build- und Minecraft-/GMod-Laufzeitnachweise dokumentieren den vorherigen abgeschlossenen Stand und werden durch den neuen Zwischenstand nicht ersetzt.

## Automatisierte Prüfungen

- `npm test`: Die abschließende vollständige Node-Suite bestand nach der letzten Diagnose-/ID-Härtung mit 109 Tests einschließlich Unterfällen. Geprüft sind Authentifizierung, Cookies, Origin/CSRF, Eingabe-/Ressourcen-/Portgrenzen, geheime Profilfelder, unsichere Dateipfade, Konsolenvalidierung und Zustellunsicherheit ohne Wiederholung sowie Adminrollen und Listenänderungen. Lebenszyklusprüfungen decken konkurrierende Anfragen, dauerhafte Sicherheitsmarker, Save-/Stopp-/Backupfehler, Restore mit Sicherheitskopie und den Neustart ohne Neuinstallation ab. Diagnose- und HTTP-Tests prüfen die eingeschränkten Logfelder und Korrelations-IDs.
- Der abschließende React-Produktionsbuild mit Vite wurde erfolgreich erzeugt: `index-X-UBhCWj.js` und `index-Cvjb3b1S.css`. Der Hinweis nach Aktivierung lautet „Serverprozess gestartet.“ und erklärt wie beim Neustart, dass die Welt noch laden kann; die Konsole zeigt den Fortschritt.
- Frühere `npm audit`-Prüfung ohne gemeldete Schwachstellen; das ist keine Garantie gegen unbekannte Schwachstellen.
- Die gepatchte PufferPanel-Laufzeit wurde auf Debian 13 mit Go 1.27.4 und CGO/SQLite gebaut; `go test ./utils ./servers ./cmd ./web/daemon ./web/api` bestand beim Laufzeitaufbau. Der vollständige unveränderte Upstream-Testbestand ist nicht als fehlerfrei bestätigt.

## Browserprüfung

Die isolierte Sandbox des vorherigen Stands wurde für Anmeldung, Profilanlage, Start/Wechsel, Backup/Wiederherstellung, Katalogsuche und den bestätigten Restart-Ablauf geprüft. Minecraft-OP-Hilfe und Befehleingabe wurden mit simulierten Namen getestet. Die damalige Oberfläche wurde außerdem für ihre sieben Katalogeinträge, GMod-Superadmin-Hilfe, Valheim-/Terraria-/Factorio-/vorbereitete Squad-Formulare, gestoppte Valheim-Adminlistenpflege und die lesbare FS25-Sperre geprüft. Das bestätigt Bedienabläufe, keine echten Rechtevergaben; Arma-/DayZ-Browserprüfungen sind oben gesondert erfasst.

## Echte Laufzeit auf dem VPS

GameSwitch, gepatchtes PufferPanel und Caddy laufen als getrennte Debian-Dienste mit HTTPS. Verwaltungsports 3001/8080/5657 binden an Loopback; SSH-Passwortanmeldung ist deaktiviert. Externe Prüfungen bestätigten Startseite 200, unauthentifizierten Zustand 401, fremde Origin 403 und Sicherheitsheader. Zugangsdaten wurden nicht in Git übernommen.

Die nachfolgenden neuen Spiele wurden über isolierte Testinstanzen auf diesem Host geprüft. Die erweiterte Oberfläche einschließlich privater Fehlerdiagnose und Steam-Cache-Vorbereitung wurde anschließend auf dem VPS ausgerollt. Nur GameSwitch wurde für das Deployment neu gestartet; PufferPanel und Caddy blieben unverändert. Vorher und danach liefen keine Spielecontainer. Die öffentliche HTTPS-Startseite antwortete anschließend mit 200 und die Zustands-API ohne Anmeldung mit 401.

| Spiel/Test | Nachgewiesen | Grenze |
| --- | --- | --- |
| FTB Evolution 2 1.9.0 | Minecraft 26.1.2/Java 25 mit verbundenen Spielern; lesender Konsolenbefehl `list` bestätigt | Weitere Minecraft-Varianten sind nicht durch diesen Test abgedeckt. |
| Garry's Mod | Echte Collection-Installation und gestartete Instanz mit geladenem ULX/ULib | Es wurde kein echter Admin/Superadmin vergeben, da der Eigentümer keine Ziel-ID genannt hat. Vollständige TTT-Spielrunden und Client-Inhalte sind separat zu prüfen. |
| Valheim | Native Installation, Weltstart, geordnetes SIGINT-Ende, Admin-Dateiänderung und vollständiges Backup der isolierten Instanz | Kein echter Spieler wurde zum Administrator gemacht; allgemeine Modunterstützung ist nicht freigegeben. |
| Terraria 1.4.5.8 | Echter Start, Konsolenantwort, Speichern, geordnetes Stoppen und vollständiges Backup der isolierten Instanz | Kein Nachweis für TShock/tModLoader oder andere Serverversionen. |
| Factorio 2.1.24 | Offizielles Paket mit SHA-256 geprüft, Welt erzeugt und gehostet; `/help` beantwortet, `/save World` schrieb `state/saves/World.zip`, `/quit` endete mit `Goodbye`; vollständiges Backup und Restore mit identischem Welt-Hash und entfernter nachträglicher Testmarkierung | Basisspiel, privater IP-Beitritt und Kontoprüfung; keine öffentliche Token-Anbindung oder fremden Modpacks geprüft. |
| Arma 3 | Typisierte Profil-API, feste Missionen, Steam-ID-/Workshop-Prüfungen, private Passwörter und Aktivierungssperre automatisiert geprüft | Steam-Anmeldung, echte Serverinstallation, native Spielbereitschaft, Rechtevergabe im Spiel und produktives Backup/Restore stehen noch aus. |
| DayZ | Chernarus-Profil, numerische Workshop-IDs, private Passwörter, Ports und reine Leseprotokolle automatisiert geprüft. Laufzeitimage real gebaut: `steamcmd/steamcmd:latest` (Ubuntu 26.04) enthält kein `libcurl.so.4`, `gameswitch.invalid/dayz-runtime:1` enthält `libcurl.so.4` und `libcap.so.2`; die `ldd`-Prüfung des Hosthelfers meldete mit einer libcurl-gelinkten Ersatzdatei im Basisimage `libcurl.so.4` als fehlend und im Laufzeitimage keine Lücke. Update-Ablauf, Adminpasswort und VPP-Superadmins automatisiert und in der Sandbox-Oberfläche geprüft. | Steam-Anmeldung, das echte `DayZServer`-Binary (inklusive `ldd` gegen dieses Binary), Spielbereitschaft, Spielerbeitritt, `#login`/VPP im Spiel, Update mit echter Bibliothek und Welt-/Charakterpersistenz stehen noch aus. |
| Squad | Steam-Installation erfolgreich, tatsächlicher nativer Kartenstart getestet | Absturz mit Signal 11 ohne OOM-Nachweis; gesperrt. Der genaue Unreal-Crashlog wurde beim damaligen Cleanup nicht bewahrt. Eine RCON-Probe während des Kartenladens wurde als Einfluss nicht getrennt untersucht; der Test beweist keine prinzipielle VPS-Unvereinbarkeit. |
| FS25 | Voraussetzungen und sichtbare Sperre geprüft | Keine Windows-/Lizenzlaufzeit eingerichtet; keine Spielinstallation oder Startfreigabe. |

Alle isolierten Testserver wurden anschließend über die Laufzeit-API entfernt. Die produktiven Profile wurden für diese Spieltests nicht gewechselt. Während der Arbeiten forderte der Eigentümer selbst einen Wechsel von GMod zu Minecraft an. Dieser brach wegen des alten Steam-Caches vor der erforderlichen Sicherung sicher ab; beide produktiven Profile waren danach gestoppt, der ausstehende Sicherheitsmarker blieb erhalten. Beim Deployment wurde der bekannte Cache des bestätigten gestoppten GMod-Profils unter den Strukturprüfungen bereinigt. Anschließend schloss der normale Controller den angeforderten Wechsel ab: vollständige GMod-Sicherung bestätigt, Sicherheitsmarker gelöscht, Minecraftprozess gestartet. GameSwitch, PufferPanel und Caddy wurden danach als aktiv bestätigt.

Minecraft meldete am 15. November 2026 um 14:54:47 UTC in der frischen Konsole `Done (5.890s)!`. Danach bestätigte eine externe Statusabfrage vom Windows-Rechner über TCP 25565 die Erreichbarkeit, Version 26.1.2 und 0 von maximal 20 Spielern. Ein einzelner lesender `list`-Befehl lieferte nach dem Start eine frische native Antwort. Damit sind Spielbereitschaft und externe Statusantwort nach der Reparatur bestätigt; eine echte Spieleranmeldung wurde in diesem Reparaturlauf nicht getestet. Die Nachprobe um 14:56:29 UTC bestätigte denselben Container ohne Neustart, Health `healthy`, 5,79/12 GiB RAM und 1,45 % CPU im Leerlauf. Auf dem Host waren 9,17 GiB verfügbar; Cgroup-Zähler für OOM, OOM-Kills und Speicherlimit-Ereignisse standen auf null. Das ist eine kurze Beobachtung nach dem Start, kein Langzeitlasttest. Um den aktiven Minecraftserver mit 12 GiB nicht zu belasten, wurde kein weiterer großer Squad-Installationslauf gestartet.

## Backupschutz und Steam-Cache

Die zusätzliche Bereinigung betrifft ausschließlich den festen, wieder erzeugbaren alten `.steam`-Cache einer bestätigten gestoppten Instanz. Frische Root-/Kindlisten und Strukturgrenzen werden geprüft; die Archivregeln bleiben unverändert. Drei isolierte Linux-Szenarien bestätigten:

- Erwartete Steam-Cache-Form wird vorbereitet; vollständiges Backup und Restore bewahren die übrige Verzeichnisstruktur und den Weltinhalt.
- Ein Link an der `.steam`-Wurzel liefert 409 vor einer Änderung.
- Ein anderer Link im Weltbereich lässt das Backup weiterhin scheitern.

Ein ausschließlich laufender Prozess genügt keiner Backupfreigabe. Sicherung und Wiederherstellung prüfen den tatsächlichen Abschluss in der gepatchten API; fehlende Bestätigung blockiert den Folgestart.

## Implementierte Fehlerdiagnose

Anfrage-UUID im `X-Request-ID`-Header, Fehler-ID in behandelten Serverfehlern und `job.errorId` sind implementiert und Teil der bestandenen Tests. Der private JSON-Logger verwendet eine strikte Feldfreigabe und feste Kategorien; rohe Fehler-/Antwortinhalte und Geheimnisse werden ausgeschlossen. Die Kontrolle eines tatsächlichen Fehlerfalls im produktiven Dienstjournal steht noch aus. Es gibt keinen Diagnose-Endpunkt für den Browser.

## Bestehende Minecraft-Leistungskonfiguration

Ein früherer Absturz von Evolution 2 wurde durch das damalige 10-GiB-Containerlimit verursacht. Die anschließend laufende Instanz erhielt ohne Neustart 12 GiB und acht vCPU. Eine lokale 31,5-Sekunden-Spark-Messung ergab rund 19,76 TPS mit Last durch Entity-Simulation und Chunk-Ticks; sie beweist keine einzelne Ursache für Portalspitzen. Der Eigentümer meldete vor allem Erstbesuche neuer Gebiete. Auf seinen Wunsch wurde Sichtweite 16 bei Simulation 6 live bestätigt; die Packregeln und deren dynamische Simulationsgrenzen 6/5 bleiben erhalten. Eine Weltvorberechnung wurde nicht gestartet.

Diese Instanz wurde später durch einen vom Eigentümer angeforderten Wechsel geordnet beendet und nach bestätigter GMod-Sicherung wieder gestartet. Für den neuen Minecraftcontainer wurden 12 GiB RAM, acht vCPU, tatsächlich `MAX_MEMORY=8192M`/`INIT_MEMORY=2048M`, Sichtweite 16 und Simulation 6 bestätigt. Sämtliche Linux-Capabilities sind entfernt und `no-new-privileges` ist aktiv. Der anschließend abgeschlossene Weltstart und die externe Statusantwort sind oben dokumentiert; sie sind keine Zusage ruckelfreier neuer Portalbereiche.

## Verbleibende Prüfgrenzen

- Ein großer Server kann als laufend erscheinen, während das Spiel noch lädt; Spielebeitritt und Bereitschaft bleiben gesonderte Kriterien.
- Offene Belastungsfälle: voller Backupdatenträger, Netzunterbrechung und Wiederherstellung einer echten produktiven Welt unter Ausfällen; externe Backups und Updatestrategie.
- Kein externer Penetrationstest, Sicherheitszertifikat oder Nachweis einer Mehrmandanten-Isolation.
- PufferPanel-Dienstneustarts stoppen verwaltete Spiele. Ein reines Paneldeployment darf nur GameSwitch neu starten und muss laufende Vorgänge vorher ausschließen.

Weitere Freigabetests stehen in [deployment.md](deployment.md). GitHub Actions bleibt auf Eigentümerwunsch deaktiviert; für diese Arbeiten wurden keine GitHub-CI-Läufe gestartet.
