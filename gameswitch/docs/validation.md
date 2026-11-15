# Prüfstand · 15. November 2026

## Automatisiert bestanden

- `npm test`: 30 Node-Tests. Authentifizierung und Cookieflags, fremde Origin/CSRF, Eingabe-/Port-/RAM-Grenzen, serialisierte Wechselreihenfolge, Backupfehler einschließlich Wiederholung, Restore mit Sicherheitskopie, unterbrochene Vorgänge nach Neustart, gesperrter Start nach unvollständigem Restore, PufferPanel-HTTP-Vertrag, sichere Definitionen/Java-Zuordnung, Sperre nach fehlgeschlagener Zustandspersistenz, FTB-Metadaten/feste Packversionen/RAM-Prüfung, validierter TTT-Spielmodus, privater OAuth-Bootstrap einschließlich Wiederanlauf/Startreihenfolge und streng begrenzte SSH-Transportkonfiguration. Neue Prüfungen decken Konsolenvalidierung, Auth/CSRF, Audit ohne Argumente, exklusive Lebenszyklussperre, Persistenzfehler vor Versand, unsichere Zustellung ohne Wiederholung sowie FTB-Heapreserve und ausschließlich im gestoppten Zustand angepasste Definitionen ab. Alte Profile mit inzwischen zu kleinem RAM-Budget werden vor Konfigurationsänderung und Start abgewiesen.
- `npm run build`: React-Produktionsbuild mit Vite erfolgreich.
- `npm audit`: keine gemeldeten Schwachstellen zum Prüfzeitpunkt; keine Garantie für unbekannte Schwachstellen.
- Go 1.27.4: `./servers` mit 8 Testfunktionen beziehungsweise 13 Blattfällen bestanden. Dazu gehören vollständige Backup-/Restore-Rundläufe, fehlende/beschädigte Archive, abgelehnte Pfade und Links, Schreibfehler sowie konkurrierende Start-/Dateioperationen.
- `./web/daemon` und `./web/api` erfolgreich kompiliert. Diese Packages enthalten selbst keine Tests.

Zunächst wurden die Go-Tests unter Windows crosskompiliert und in WSL ausgeführt. Zusätzlich wurde auf dem Debian-13-VPS mit Go 1.27.4 und CGO/SQLite eine vollständige AMD64-Binary gebaut; `go test ./utils ./servers ./cmd ./web/daemon ./web/api` bestand. Die Openat2-Probe wurde als unprivilegierter PufferPanel-Benutzer unter den tatsächlich verwendeten systemd-Schutzoptionen geprüft. Die vollständige Upstream-Testsuite ist nicht als fehlerfrei bestätigt: Ein älterer Symlink-Test erwartet ein nicht existentes Backup-Verzeichnis, das jetzt absichtlich vorab sicher angelegt wird.

## Bedienprüfung

Lokale isolierte Sandbox im Browser: Anmeldung, GMod-Profilanlage mit offizieller Collection-URL, Start, zweites Profil, Wechsel mit abgeschlossenem Backup, Backup-Liste und Wiederherstellung einschließlich zusätzlicher Sicherheitskopie. Minecraft-Versionsliste lädt vom echten Mojang-Katalog; Modrinth-Suche und Versionsauswahl wurden im Browser geprüft. Die echte FTB-Suche liefert FTB Evolution 2; Auswahl löst Version 1.9.0, Minecraft 26.1.2 und Java 25 auf. TTT-Profil mit Collection und explizitem Kartennamen wurde über die Oberfläche angelegt. Keine echten Welten oder VPS-Spielprozesse wurden hierfür verwendet. Schmale Ansicht und Desktop-Breakpoint wurden kontrolliert; keine Browserfehler im geprüften Ablauf.

Die neue Minecraft-Konsolensteuerung wurde mit einem separaten simulierten Profil im Browser geprüft: `list` per Enter sowie die OP-Hilfe mit einem Testnamen wurden jeweils einmal angenommen, als Simulation ausgegeben und das Eingabefeld anschließend geleert. Es wurden dabei keine echten Spielrechte vergeben. Die Produktionsanmeldung lädt weiterhin; der geschützte Produktionsdialog wurde ohne Eigentümerpasswort nicht geöffnet.

## Tatsächliches Deployment

GameSwitch, die gepatchte native PufferPanel-Binary und Caddy 2.11.9 laufen als getrennte systemd-Dienste auf Debian 13 und starten automatisch. Ein öffentlich vertrauenswürdiges IP-Zertifikat wurde ausgestellt; Caddy übernimmt die Erneuerung. Verwaltungsdienste 3001/8080/5657 sind ausschließlich an Loopback gebunden. SSH-Passwortanmeldungen wurden nach erfolgreichem Schlüsseltest deaktiviert.

Eine über die echte PufferPanel-API erstellte Testinstanz lief in Docker mit UID/GID 1000, Bridge-Netz, CapDrop ALL, no-new-privileges und effektivem RAM-Limit. Start, geordnetes Stoppen, vollständiges Backup, Änderung der Testdatei und Wiederherstellung des ursprünglichen Inhalts bestanden. Die Testinstanz wurde anschließend entfernt. Dies war ein technischer Testprozess, kein Minecraft- oder GMod-Server.

Externe HTTPS-Prüfungen: Startseite 200, unauthentifizierter Zustand 401, fremde Origin 403, HSTS/CSP vorhanden. Der Eigentümer hat den Administratorzugang eingerichtet. Keine echten Passwörter wurden in Git oder Prozessargumente übernommen.

FTB Evolution 2 1.9.0 (Minecraft 26.1.2, Java 25) wurde vom Eigentümer gestartet. Der erste Prozess wurde nachweislich durch das Container-RAM-Limit von 10 GiB beendet: 9472 MiB maximaler und anfänglicher Java-Heap ließen zu wenig nativen Spielraum. Das Limit der anschließend laufenden Instanz wurde ohne Neustart auf 12 GiB erhöht. Container-ID, Startzeit und Neustartzähler blieben beim Panel-Update unverändert. Eine externe Minecraft-Statusabfrage bestätigte Erreichbarkeit auf Port 25565 und drei verbundene Spieler; Docker-Health war zuletzt healthy. Der neue Laufzeitadapter übermittelte einmalig den lesenden Befehl `list`; die Antwort wurde in der echten Minecraft-Konsole bestätigt. Es wurden keine OP-Rechte vergeben. Die korrigierten 8 GiB maximaler/2 GiB anfänglicher Heap gelten erst beim nächsten regulären Start; die laufende JVM wurde nicht verändert.

Die anschließende Live-Diagnose erfolgte ohne Spielneustart: keine neuen OOM-Ereignisse, etwa 11,2/12 GiB Container-RAM und 3,7–3,8 GiB verfügbarer Host-RAM. Spark meldete etwa 2,7/9,3 GiB belegten Java-Heap, keine Old-Generation-Collections, aber Tick-Spitzen bis 1,5 Sekunden. Eine zweiminütige Hostmessung zeigte im Mittel 62 Prozent CPU-Leerlauf, keinen CPU-Steal und keinen I/O-Wait. Das 31,5 Sekunden lange lokale Spark-Profil mit 10-ms-Java-Abtastung ergab rund 19,76 TPS; die Hauptlast verteilte sich auf Entity-Simulation und Chunk-Ticks. Es belegt keinen einzelnen dominanten Mod und keine überwiegende neue Weltgenerierung. Das Profil blieb auf dem VPS; kein Upload zu einem Profildienst. Auf Eigentümerwunsch wurde das laufende Docker-CPU-Limit ohne Neustart von sechs auf acht vCPU angehoben. Die automatische Übernahme in künftige Minecraft-Definitionen und beim nächsten gestoppten FTB-Start ist ebenfalls geprüft.

## Noch offen für den jeweiligen Spielbetrieb

- Echte Docker-Starts anderer Minecraft-Varianten sowie GMod und Collection-Downloads.
- Gamespezifische Bereitschaft statt bloß laufendem Prozess. Ein großer Modpack-Server kann während der Initialisierung als laufend erscheinen.
- Live-Tests für vollen Backupdatenträger, Netzunterbrechung, Prozessabbruch und Wiederherstellung realer Weltdaten; externe Backups und Updatestrategie.
- Keine externe Penetrationsprüfung, kein Sicherheitszertifikat und keine Mehrmandanten-Isolationsfreigabe.

Weitere Freigabetests stehen in [deployment.md](deployment.md). GitHub Actions ist auf Wunsch des Eigentümers deaktiviert; nach dieser Anweisung wurden keine neuen GitHub-CI-Läufe gestartet.
