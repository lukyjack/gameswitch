# Prüfstand · 15. November 2026

## Automatisiert bestanden

- `npm test`: 13 Node-Integrationstests. Authentifizierung und Cookieflags, fremde Origin/CSRF, Eingabe-/Port-/RAM-Grenzen, serialisierte Wechselreihenfolge, Backupfehler einschließlich Wiederholung, Restore mit Sicherheitskopie, unterbrochene Vorgänge nach Neustart, gesperrter Start nach unvollständigem Restore, PufferPanel-HTTP-Vertrag, sichere Definitionen/Java-Zuordnung, Sperre nach fehlgeschlagener Zustandspersistenz, offizielle FTB-Metadaten/feste Packversionen/RAM-Prüfung und validierter TTT-Spielmodus mit Workshop-Collection.
- `npm run build`: React-Produktionsbuild mit Vite erfolgreich.
- `npm audit`: keine gemeldeten Schwachstellen zum Prüfzeitpunkt; keine Garantie für unbekannte Schwachstellen.
- Go 1.27.4: `./servers` mit 8 Testfunktionen beziehungsweise 13 Blattfällen bestanden. Dazu gehören vollständige Backup-/Restore-Rundläufe, fehlende/beschädigte Archive, abgelehnte Pfade und Links, Schreibfehler sowie konkurrierende Start-/Dateioperationen.
- `./web/daemon` und `./web/api` erfolgreich kompiliert. Diese Packages enthalten selbst keine Tests.

Auf Windows wurden die Go-Tests mit `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go test -c -o .tools/servers.test ./servers` gebaut und anschließend unter WSL Ubuntu mit `wsl -d Ubuntu-20.04 --exec /mnt/f/Coding/Server_games/.tools/servers.test` ausgeführt. Das ist kein vollständiger CGO-/SQLite-Build der Anwendung.

## Bedienprüfung

Lokale isolierte Sandbox im Browser: Anmeldung, GMod-Profilanlage mit offizieller Collection-URL, Start, zweites Profil, Wechsel mit abgeschlossenem Backup, Backup-Liste und Wiederherstellung einschließlich zusätzlicher Sicherheitskopie. Minecraft-Versionsliste lädt vom echten Mojang-Katalog; Modrinth-Suche und Versionsauswahl wurden im Browser geprüft. Die echte FTB-Suche liefert FTB Evolution 2; Auswahl löst Version 1.9.0, Minecraft 26.1.2 und Java 25 auf. TTT-Profil mit Collection und explizitem Kartennamen wurde über die Oberfläche angelegt. Keine echten Welten oder VPS-Spielprozesse wurden hierfür verwendet. Schmale Ansicht und Desktop-Breakpoint wurden kontrolliert; keine Browserfehler im geprüften Ablauf.

## Noch offen vor Hosting

- Vollständiger Build und reale PufferPanel-Installation auf dem Zielbetriebssystem.
- Echte Docker-Starts von Minecraft Vanilla/Loadern/Modpacks sowie GMod und Collection-Downloads.
- Verifikation effektiver Containerrechte, Dateibesitz, Ressourcenlimits und Firewall auf dem VPS.
- Gamespezifische Bereitschaft statt bloß laufendem Prozess. Ein großer Modpack-Server kann während der Initialisierung als laufend erscheinen.
- Live-Tests für vollen Backupdatenträger, Netzunterbrechung, Prozessabbruch und Wiederherstellung realer Weltdaten; externe Backups und Updatestrategie.
- Keine externe Penetrationsprüfung, kein Sicherheitszertifikat und keine Mehrmandanten-Isolationsfreigabe.

Die Freigabetests stehen in [deployment.md](deployment.md). SSH-Zugang ist ein getrennter Administrationsschritt und bedeutet kein Panel-Deployment.
