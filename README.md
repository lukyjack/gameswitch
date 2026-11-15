# GameSwitch

Eine deutschsprachige Gameserver-Oberfläche für einen einzelnen VPS: Spiele und Minecraft-Modpacks als getrennte Profile verwalten und zwischen ihnen wechseln, ohne den bisherigen Spielstand zu überschreiben.

**Entwicklungsstand:** MVP mit Sandbox und PufferPanel-Adapter; auf Debian 13 mit Docker und HTTPS eingerichtet. Start/Stopp, Containerrechte und Backup/Wiederherstellung wurden gegen die echte Laufzeit geprüft. FTB Evolution 2 1.9.0 ist mit verbundenen Spielern nachgewiesen; weitere Minecraft-Varianten und GMod-Collections benötigen ihre jeweiligen Spieltests.

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
- Garry's Mod mit Sandbox oder Trouble in Terrorist Town, Steam-Workshop-Collection, Map, Spielerzahl und separatem Profil.
- Ein aktives von GameSwitch verwaltetes Profil. Wechsel: laufende Instanz geordnet beenden → vollständiges Backup bestätigen → Ziel installieren/starten. Getrennte Serververzeichnisse bewahren die ursprünglichen Welten und Konfigurationen. Zusätzliche manuell gestartete Server außerhalb der verwalteten Profile liegen außerhalb dieser Steuerung.
- Backup-Liste, Wiederherstellung im gestoppten Zustand mit vorheriger Sicherung, Konsole, Vorgangsfortschritt und Ereignisse.
- Minecraft-Konsole mit Befehleingabe und OP-Hilfe für einen Spielernamen. Befehle benötigen eine angemeldete Administratorsitzung und werden ohne Shell an die laufende Instanz gesendet.
- Neustart des aktiven Profils mit ausdrücklicher Bestätigung: Welt speichern, geordnet stoppen, vollständiges Backup abschließen und dasselbe Profil ohne Neuinstallation starten.
- Persistente Profile und Jobs; widersprüchliche oder unterbrochene Abläufe brechen kontrolliert ab.
- Ressourcenbudget passend für 8 vCPU / 16 GB RAM, mit Reserve für Betriebssystem und Panel. Große Modpacks müssen anhand ihrer eigenen Anforderungen dimensioniert werden.

Weitere Spiele werden als geprüfte serverseitige Definitionen hinzugefügt. Beliebige Shellbefehle, Container-Images und Installations-URLs können über die Oberfläche nicht eingeschleust werden. Siehe [Erweiterungen](gameswitch/docs/extending.md).

## Sicherheit und späteres Hosting

GameSwitch bindet standardmäßig nur an Loopback; im VPS-Betrieb steht ein HTTPS-Reverse-Proxy davor. Anmeldung, scrypt-Passworthashes, begrenzte Loginversuche, HttpOnly-/SameSite-/Secure-Cookies, CSRF-/Origin-Prüfung, Sicherheitsheader und validierte Eingaben gehören zur Anwendung. Zugangsdaten der Laufzeit bleiben auf dem Server. GameSwitch selbst benötigt keinen Docker-Socket. GitHub Actions ist für dieses Repository deaktiviert; Prüfungen laufen lokal oder auf dem VPS.

Die echte Laufzeit verwendet **diesen gepatchten PufferPanel-Fork**. Die Backup-Erweiterung meldet tatsächlichen Abschluss beziehungsweise Fehler; ein unverändertes PufferPanel wird dafür abgelehnt. Das ist eine Voraussetzung für den sicheren Wechselablauf.

Details: [Sicherheitsmodell](gameswitch/docs/security.md), [Hosting-Vorbereitung](gameswitch/docs/deployment.md), [API](gameswitch/docs/api-contract.md).

## Basis und Lizenz

Fork von [PufferPanel v3](https://github.com/pufferpanel/pufferpanel/tree/v3), Ausgangscommit `ded2eeb93980934ecb494a4550923a1fc247ef28`. Die ursprüngliche Engine, API und Oberfläche bleiben im Repository erhalten; die neue Oberfläche und ihr Orchestrator liegen unter `gameswitch/`. Das ursprüngliche README liegt unter [README.upstream.md](README.upstream.md).

PufferPanel und die GameSwitch-Erweiterungen stehen unter [Apache-2.0](LICENSE). Hinweise und Lizenzen eingebundener Drittprojekte bleiben erhalten. Dieser Fork ist ein unabhängiges Projekt; Änderungen werden nicht automatisch an das Upstream-Projekt gesendet.
