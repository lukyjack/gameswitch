# Prüfstand · 15. November 2026

## Automatisiert bestanden

- `npm test`: 19 Node-Integrationstests. Authentifizierung und Cookieflags, fremde Origin/CSRF, Eingabe-/Port-/RAM-Grenzen, serialisierte Wechselreihenfolge, Backupfehler einschließlich Wiederholung, Restore mit Sicherheitskopie, unterbrochene Vorgänge nach Neustart, gesperrter Start nach unvollständigem Restore, PufferPanel-HTTP-Vertrag, sichere Definitionen/Java-Zuordnung, Sperre nach fehlgeschlagener Zustandspersistenz, FTB-Metadaten/feste Packversionen/RAM-Prüfung, validierter TTT-Spielmodus, privater OAuth-Bootstrap einschließlich Wiederanlauf/Startreihenfolge und streng begrenzte SSH-Transportkonfiguration.
- `npm run build`: React-Produktionsbuild mit Vite erfolgreich.
- `npm audit`: keine gemeldeten Schwachstellen zum Prüfzeitpunkt; keine Garantie für unbekannte Schwachstellen.
- Go 1.27.4: `./servers` mit 8 Testfunktionen beziehungsweise 13 Blattfällen bestanden. Dazu gehören vollständige Backup-/Restore-Rundläufe, fehlende/beschädigte Archive, abgelehnte Pfade und Links, Schreibfehler sowie konkurrierende Start-/Dateioperationen.
- `./web/daemon` und `./web/api` erfolgreich kompiliert. Diese Packages enthalten selbst keine Tests.

Zunächst wurden die Go-Tests unter Windows crosskompiliert und in WSL ausgeführt. Zusätzlich wurde auf dem Debian-13-VPS mit Go 1.27.4 und CGO/SQLite eine vollständige AMD64-Binary gebaut; `go test ./utils ./servers ./cmd ./web/daemon ./web/api` bestand. Die Openat2-Probe wurde als unprivilegierter PufferPanel-Benutzer unter den tatsächlich verwendeten systemd-Schutzoptionen geprüft. Die vollständige Upstream-Testsuite ist nicht als fehlerfrei bestätigt: Ein älterer Symlink-Test erwartet ein nicht existentes Backup-Verzeichnis, das jetzt absichtlich vorab sicher angelegt wird.

## Bedienprüfung

Lokale isolierte Sandbox im Browser: Anmeldung, GMod-Profilanlage mit offizieller Collection-URL, Start, zweites Profil, Wechsel mit abgeschlossenem Backup, Backup-Liste und Wiederherstellung einschließlich zusätzlicher Sicherheitskopie. Minecraft-Versionsliste lädt vom echten Mojang-Katalog; Modrinth-Suche und Versionsauswahl wurden im Browser geprüft. Die echte FTB-Suche liefert FTB Evolution 2; Auswahl löst Version 1.9.0, Minecraft 26.1.2 und Java 25 auf. TTT-Profil mit Collection und explizitem Kartennamen wurde über die Oberfläche angelegt. Keine echten Welten oder VPS-Spielprozesse wurden hierfür verwendet. Schmale Ansicht und Desktop-Breakpoint wurden kontrolliert; keine Browserfehler im geprüften Ablauf.

## Tatsächliches Deployment

GameSwitch, die gepatchte native PufferPanel-Binary und Caddy 2.11.9 laufen als getrennte systemd-Dienste auf Debian 13 und starten automatisch. Ein öffentlich vertrauenswürdiges IP-Zertifikat wurde ausgestellt; Caddy übernimmt die Erneuerung. Verwaltungsdienste 3001/8080/5657 sind ausschließlich an Loopback gebunden. SSH-Passwortanmeldungen wurden nach erfolgreichem Schlüsseltest deaktiviert.

Eine über die echte PufferPanel-API erstellte Testinstanz lief in Docker mit UID/GID 1000, Bridge-Netz, CapDrop ALL, no-new-privileges und effektivem RAM-Limit. Start, geordnetes Stoppen, vollständiges Backup, Änderung der Testdatei und Wiederherstellung des ursprünglichen Inhalts bestanden. Die Testinstanz wurde anschließend entfernt. Dies war ein technischer Testprozess, kein Minecraft- oder GMod-Server.

Externe HTTPS-Prüfungen: Startseite 200, unauthentifizierter Zustand 401, fremde Origin 403, HSTS/CSP vorhanden. Die erste Administratoreinrichtung bleibt dem Eigentümer überlassen. Keine echten Passwörter wurden in Git oder Prozessargumente übernommen.

## Noch offen für den jeweiligen Spielbetrieb

- Echte Docker-Starts von Minecraft Vanilla/Loadern/Modpacks sowie GMod und Collection-Downloads.
- Gamespezifische Bereitschaft statt bloß laufendem Prozess. Ein großer Modpack-Server kann während der Initialisierung als laufend erscheinen.
- Live-Tests für vollen Backupdatenträger, Netzunterbrechung, Prozessabbruch und Wiederherstellung realer Weltdaten; externe Backups und Updatestrategie.
- Keine externe Penetrationsprüfung, kein Sicherheitszertifikat und keine Mehrmandanten-Isolationsfreigabe.

Weitere Freigabetests stehen in [deployment.md](deployment.md). GitHub Actions ist auf Wunsch des Eigentümers deaktiviert; nach dieser Anweisung wurden keine neuen GitHub-CI-Läufe gestartet.
