# Prüfstand · 15. November 2026

## Automatisierte Prüfungen

- `npm test`: Die abschließende vollständige Node-Suite bestand nach der letzten Diagnose-/ID-Härtung mit 109 Tests einschließlich Unterfällen. Geprüft sind Authentifizierung, Cookies, Origin/CSRF, Eingabe-/Ressourcen-/Portgrenzen, geheime Profilfelder, unsichere Dateipfade, Konsolenvalidierung und Zustellunsicherheit ohne Wiederholung sowie Adminrollen und Listenänderungen. Lebenszyklusprüfungen decken konkurrierende Anfragen, dauerhafte Sicherheitsmarker, Save-/Stopp-/Backupfehler, Restore mit Sicherheitskopie und den Neustart ohne Neuinstallation ab. Diagnose- und HTTP-Tests prüfen die eingeschränkten Logfelder und Korrelations-IDs.
- Der abschließende React-Produktionsbuild mit Vite wurde erfolgreich erzeugt: `index-BfFj6URu.js` und `index-Cvjb3b1S.css`.
- Frühere `npm audit`-Prüfung ohne gemeldete Schwachstellen; das ist keine Garantie gegen unbekannte Schwachstellen.
- Die gepatchte PufferPanel-Laufzeit wurde auf Debian 13 mit Go 1.27.4 und CGO/SQLite gebaut; `go test ./utils ./servers ./cmd ./web/daemon ./web/api` bestand beim Laufzeitaufbau. Der vollständige unveränderte Upstream-Testbestand ist nicht als fehlerfrei bestätigt.

## Browserprüfung

Die isolierte Sandbox wurde für Anmeldung, Profilanlage, Start/Wechsel, Backup/Wiederherstellung, Katalogsuche und den bestätigten Restart-Ablauf geprüft. Minecraft-OP-Hilfe und Befehleingabe wurden mit simulierten Namen getestet. Die neue Oberfläche wurde außerdem für alle sieben Katalogeinträge, GMod-Superadmin-Hilfe, Valheim-/Terraria-/Factorio-/vorbereitete Squad-Formulare, gestoppte Valheim-Adminlistenpflege und die lesbare FS25-Sperre geprüft. Das bestätigt Bedienabläufe, keine echten Rechtevergaben.

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
| Squad | Steam-Installation erfolgreich, tatsächlicher nativer Kartenstart getestet | Absturz mit Signal 11 ohne OOM-Nachweis; gesperrt. Kein startbarer oder lizenzierter VPS-Server zugesagt. |
| FS25 | Voraussetzungen und sichtbare Sperre geprüft | Keine Windows-/Lizenzlaufzeit eingerichtet; keine Spielinstallation oder Startfreigabe. |

Alle isolierten Testserver wurden anschließend über die Laufzeit-API entfernt. Die produktiven Profile wurden für diese Spieltests nicht gewechselt. Während der Arbeiten forderte der Eigentümer selbst einen Wechsel von GMod zu Minecraft an. Dieser brach wegen des alten Steam-Caches vor der erforderlichen Sicherung sicher ab; beide produktiven Profile waren danach gestoppt, der ausstehende Sicherheitsmarker blieb erhalten. Beim Deployment wurde der bekannte Cache des bestätigten gestoppten GMod-Profils unter den Strukturprüfungen bereinigt. Die Fortsetzung des angeforderten Wechsels einschließlich vollständiger Quellsicherung und Minecraft-Bereitschaft ist gesondert zu bestätigen.

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

Diese Instanz wurde später durch einen vom Eigentümer angeforderten Wechsel geordnet beendet. Gespeichert bleiben View 16 / Simulation 6, das Budget von acht vCPU und die vorbereiteten 8 GiB maximaler/2 GiB anfänglicher Java-Heap für den nächsten regulären Start. Dies ist keine Zusage ruckelfreier neuer Portalbereiche.

## Verbleibende Prüfgrenzen

- Ein großer Server kann als laufend erscheinen, während das Spiel noch lädt; Spielebeitritt und Bereitschaft bleiben gesonderte Kriterien.
- Offene Belastungsfälle: voller Backupdatenträger, Netzunterbrechung und Wiederherstellung einer echten produktiven Welt unter Ausfällen; externe Backups und Updatestrategie.
- Kein externer Penetrationstest, Sicherheitszertifikat oder Nachweis einer Mehrmandanten-Isolation.
- PufferPanel-Dienstneustarts stoppen verwaltete Spiele. Ein reines Paneldeployment darf nur GameSwitch neu starten und muss laufende Vorgänge vorher ausschließen.

Weitere Freigabetests stehen in [deployment.md](deployment.md). GitHub Actions bleibt auf Eigentümerwunsch deaktiviert; für diese Arbeiten wurden keine GitHub-CI-Läufe gestartet.
