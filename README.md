# GameSwitch

Eine deutschsprachige Gameserver-Oberfläche für einen einzelnen VPS. Jedes Spiel und Minecraft-Modpack erhält ein eigenes Profil mit eigenem Spielstand. Profile lassen sich parallel betreiben oder gezielt wechseln.

**Entwicklungsstand:** Auf Debian 13 mit Docker und HTTPS eingerichtet, einschließlich der Erweiterung um Valheim, Terraria 1.4.5.8 und Factorio 2.1.24. Diese drei Spiele wurden mit isolierten echten Instanzen geprüft. FTB Evolution 2 wurde mit verbundenen Spielern geprüft; Garry's Mod lädt die konfigurierte Collection einschließlich ULX. Squad bleibt nach einem fehlgeschlagenen nativen Starttest gesperrt; Farming Simulator 25 benötigt eine Windows-/Lizenzanbindung. Der konkrete Prüfumfang steht in [validation.md](gameswitch/docs/validation.md).

Der Katalog enthält jetzt neun Spiele, zusätzlich mit Arma 3 und DayZ. Deren Profilformulare, feste Linux-Vorlagen und Sicherheitsprüfungen sind implementiert. Die erste echte Steam-Anmeldung, Installation und Spielbereitschaft sind noch gesondert nachzuweisen; ein sichtbarer Katalogeintrag ist dafür kein Nachweis. Der Start bleibt bis zur geschützten Vorbereitung der Serverdateien und aller ausgewählten Mods gesperrt.

## Lokal starten

Voraussetzung: Node.js 24 oder neuer.

```powershell
cd gameswitch
npm ci
npm run dev
```

Öffne `http://127.0.0.1:5173`. Beim ersten Start steht der einmalige Einrichtungstoken im Server-Terminal. Damit legst du deinen Administrator und ein eigenes starkes Passwort an. Es gibt kein voreingestelltes Passwort. Die Sandbox ist in der Oberfläche gekennzeichnet und startet keine echten Spielprozesse.

```powershell
npm test
npm run build
npm start
```

Der gebaute Server läuft standardmäßig unter `http://127.0.0.1:3001`. Konfiguration über Prozessumgebungsvariablen oder `node --env-file=.env server/index.mjs`; Beispiele stehen in [gameswitch/.env.example](gameswitch/.env.example).

## Funktionsumfang

- Minecraft-Profile mit auswählbaren Versionen und unterstützten Loadern; Feed-the-Beast- und Modrinth-Modpacks über Suche und konkrete Packversion, einschließlich FTB Evolution 2 aus dem offiziellen FTB-Katalog.
- Garry's Mod mit Sandbox oder Trouble in Terrorist Town, Steam-Workshop-Collection, Map und ULX-Hilfe für Admin, Superadmin oder Entfernen der direkten Zuweisung per Steam-ID.
- Valheim mit eigener Welt, getrennt gespeichertem Serverpasswort und Steam-Administratorliste; die Listenpflege benötigt eine gestoppte Instanz. Terraria 1.4.5.8 und Factorio 2.1.24 erhalten ebenfalls eigene Welten. Factorio startet mit Basisspiel, privatem IP-Beitritt, Serverpasswort und aktiver Kontoprüfung.
- Arma 3 mit fünf festen Koop-/Zeus-Missionen, einzelnen Workshop-Mod-IDs, privatem Spielpasswort und Steam-Administratorliste. DayZ ist zunächst auf Chernarus beschränkt, mit Workshop-Mod-IDs und eigenem persistentem Welt-/Charakterstand. DayZ-Administration: Adminpasswort für `#login`; mit einem Klick ergänzbares Adminmenü VPPAdminTools (inklusive CF) mit Superadmin-Pflege per SteamID64. CF-Abhängigkeiten von VPP/COT werden geprüft. DayZ läuft in einem lokal gebauten Laufzeitimage mit den benötigten Systembibliotheken.
- Mehrere Profile können gleichzeitig laufen, wenn ihre Host-Ports frei sind und ihre RAM-Limits zusammen ins Spielserverbudget passen. Start, Stopp und Neustart beziehen sich jeweils auf das ausgewählte Profil. Ein gezielter Wechsel ist möglich, wenn genau das angegebene Quellprofil läuft. GameSwitch stoppt und sichert die Quelle vor dem Start des Ziels.
- Backup-Liste, Wiederherstellung im gestoppten Zustand mit vorheriger Sicherung, Konsole, Vorgangsfortschritt und Ereignisse.
- Befehleingabe für Minecraft, Garry's Mod, Terraria und Factorio; Minecraft mit OP-Hilfe. Valheim und Arma 3 zeigen die Ausgabe und verwalten Admins über eine Datei bei bestätigtem Stopp. Arma-Admins melden sich danach im Spiel mit `#login` an. DayZ bietet hier lesbare Serverlogs. Befehle benötigen eine angemeldete Administratorsitzung und werden an die Spielschnittstelle gesendet.
- Beim Stopp speichert und beendet GameSwitch das ausgewählte Profil geordnet und schließt dessen Sicherheitsbackup ab. Ein bestätigter Neustart startet anschließend dasselbe Profil ohne Neuinstallation.
- „Server & Mods aktualisieren“ für Arma 3 und DayZ: übernimmt eine neu vorbereitete Steam-Bibliothek (Spiel- und Mod-Updates) mit Backup vorher; Welt, Profile und Serverkonfiguration bleiben, Mods und Schlüssel werden neu aufgebaut. Das Panel zeigt an, wenn die Bibliothek neuer ist als das Profil.
- Geschützte Steam-Einrichtung direkt im Panel: Über „Steam einrichten“ Arma 3 oder DayZ und einzelne Workshop-IDs wählen, SteamCMD-Anmeldung bei Bedarf öffnen und Accountname, Passwort beziehungsweise Steam Guard verdeckt eingeben. Die Anmeldung kann später erfolgen; ohne vorbereitete Bibliothek bleibt der Profilstart gesperrt.
- Persistente Profile und Jobs; widersprüchliche oder unterbrochene Abläufe brechen kontrolliert ab.
- Standardbudget für 8 vCPU und 16 GiB RAM. Bei 3 GiB Systemreserve bleiben insgesamt 13 GiB für laufende Profile. Maßgeblich sind die konfigurierten RAM-Limits, unabhängig von der momentanen Auslastung.

Weitere Spiele werden als geprüfte serverseitige Definitionen hinzugefügt. Beliebige Shellbefehle, Container-Images und Installations-URLs können über die Oberfläche nicht eingeschleust werden. Siehe [Erweiterungen](gameswitch/docs/extending.md).

## Sicherheit und späteres Hosting

GameSwitch bindet standardmäßig nur an Loopback; im VPS-Betrieb steht ein HTTPS-Reverse-Proxy davor. Anmeldung, scrypt-Passworthashes, begrenzte Loginversuche, HttpOnly-/SameSite-/Secure-Cookies, CSRF-/Origin-Prüfung, Sicherheitsheader und validierte Eingaben gehören zur Anwendung. Zugangsdaten der Laufzeit bleiben auf dem Server. GameSwitch selbst benötigt keinen Docker-Socket. GitHub Actions ist für dieses Repository deaktiviert; Prüfungen laufen lokal oder auf dem VPS.

Spielpasswörter liegen getrennt unter `DATA_DIR/profile-secrets` mit privaten Dateirechten; Profil- und Zustandsantworten enthalten nur Kennzeichen, ob sie gesetzt sind. Ein Neustart des PufferPanel-Dienstes beendet auch verwaltete Spielprozesse. Ein reines Oberflächenupdate darf deshalb nur den GameSwitch-Dienst neu starten.

Arma 3 und DayZ verwenden eine geschützte, schreibgeschützt eingebundene Serverbibliothek. Der Button „Steam einrichten“ öffnet die echte SteamCMD-Anmeldung im angemeldeten HTTPS-Panel; ein Steam-Weblogin über OpenID allein würde keinen Downloadzugriff erteilen. Eingaben werden verdeckt übertragen und von GameSwitch weder gespeichert noch protokolliert. Nur Steams eigener Anmeldecache bleibt im Root-geschützten Hostspeicher, außerhalb der Spielvolumes. Der begrenzte lokale Einrichtungsdienst erhält keinen frei wählbaren Shellbefehl; GameSwitch selbst bleibt ohne Docker-Socket. Die interaktive SSH-CLI `sudo gameswitch-steam-library prepare arma3` beziehungsweise `dayz` mit optionalem `--workshop ID,ID` bleibt eine Alternative. Einrichtung und Prüfgrenzen stehen in [deployment.md](gameswitch/docs/deployment.md).

Fehlgeschlagene Serveraktionen erhalten eine Fehler-ID zur Zuordnung im privaten Dienstjournal. Die Diagnose speichert nur freigegebene Metadaten und feste Fehlerkategorien; Anfrageinhalte, Passwörter und rohe Laufzeitantworten werden nicht übernommen. Details zum administrativen Zugriff stehen in [deployment.md](gameswitch/docs/deployment.md).

Die echte Laufzeit verwendet **diesen gepatchten PufferPanel-Fork**. Die Backup-Erweiterung meldet den bestätigten Abschluss oder einen Fehler bei Stopp, Neustart und Wechsel.

Details: [Sicherheitsmodell](gameswitch/docs/security.md), [Hosting-Vorbereitung](gameswitch/docs/deployment.md), [API](gameswitch/docs/api-contract.md).

## Basis und Lizenz

Fork von [PufferPanel v3](https://github.com/pufferpanel/pufferpanel/tree/v3), Ausgangscommit `ded2eeb93980934ecb494a4550923a1fc247ef28`. Die ursprüngliche Engine, API und Oberfläche bleiben im Repository erhalten; die neue Oberfläche und ihr Orchestrator liegen unter `gameswitch/`. Das ursprüngliche README liegt unter [README.upstream.md](README.upstream.md).

PufferPanel und die GameSwitch-Erweiterungen stehen unter [Apache-2.0](LICENSE). Hinweise und Lizenzen eingebundener Drittprojekte bleiben erhalten. Dieser Fork ist ein unabhängiges Projekt; Änderungen werden nicht automatisch an das Upstream-Projekt gesendet.
