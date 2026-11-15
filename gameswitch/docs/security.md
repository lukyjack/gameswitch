# Sicherheitsmodell

GameSwitch ist für einen Administrator auf einem einzelnen eigenen VPS entwickelt. Es ist kein öffentliches Mehrmandanten-Hosting mit voneinander unabhängigen Kunden. Die Anwendung ist ein Entwicklungsstand und kein extern auditiertes Sicherheitsprodukt.

## Vertrauensgrenzen

Browser → authentifizierter GameSwitch-Server → lokale PufferPanel-API → Docker → Spielprozess.

Der Browser erhält keine PufferPanel-Client-Secrets. PufferPanel ist ein privilegierter Verwaltungsdienst: Wer dessen Docker-Zugang kontrolliert, kann den Host beeinflussen. GameSwitch läuft als eigener unprivilegierter Benutzer ohne Mitgliedschaft in der Docker-Gruppe und ohne Docker-Socket. Das PufferPanel-Administrationspanel bleibt über Loopback beziehungsweise einen administrativen SSH-Tunnel erreichbar.

## Implementierte Schutzmaßnahmen

- Keine Standardzugangsdaten; einmaliger Einrichtungstoken und eigener Administrator.
- Passwörter werden mit gesalzenem scrypt gehasht. Session-Cookies sind HttpOnly und SameSite Strict; HTTPS erzwingt Secure-Cookies im Produktionsbetrieb.
- Schreibzugriffe benötigen die korrekte Origin und einen CSRF-Token. Fremde Origins werden abgelehnt. Login und Einrichtung sind begrenzt; Sitzungen laufen ab.
- Hostname und öffentliche Origin sind explizite Konfiguration. Standardbindung ist Loopback; öffentliches Hosting benötigt eine HTTPS-Origin. Der explizite SSH-Tunnel-Modus erlaubt HTTP nur zwischen Loopback-Adressen an den beiden Enden des verschlüsselten Tunnels. Secure-Cookies gelten für die HTTPS-Variante; im Tunnel bleiben HttpOnly-/SameSite- und CSRF-Schutz aktiv.
- Strikte Profilvalidierung; keine vom Browser gelieferten Shellbefehle, Dateipfade, Templates, Docker-Images oder Download-URLs. Externe Kataloganfragen verwenden festgelegte Anbieter.
- Ressourcen- und Längenbegrenzungen sowie begrenzte HTTP-Anfragen. Keine ungefilterte HTML-Ausgabe aus Konsole, Spielnamen oder Modpackbeschreibungen.
- Global serialisierte Lebenszyklusoperationen. Ein Backupfehler blockiert den Wechsel. Wiederherstellung nur im gestoppten Zustand mit vorherigem Sicherheitsbackup.
- Die Spielekonsole ist nur für den angemeldeten Administrator verfügbar, mit CSRF-/Origin-Prüfung, Befehlsrate und einzeiliger Eingabe ohne Steuerzeichen. Sie verwendet den Spieleingabekanal oder einen fest konfigurierten lokalen RCON-Transport und teilt die Lebenszyklussperre. Audit-Ereignisse enthalten nur das Befehlswort. Spiel- und Mod-Befehle können weitreichende Rechte haben; die Sperre häufiger direkter Stoppbefehle ersetzt keine Befehls-Sandbox. Valheim erhält keinen fingierten Konsoleneingang.
- Die Admin-Helfer akzeptieren streng geprüfte SteamIDs statt frei zusammengesetzter Befehle. GMod verwendet feste ULX-Befehle; Dateilisten benötigen eine bestätigte gestoppte Instanz, eine vorherige Kopie und eine erneute Statusprüfung vor dem Schreiben. Bestehende fremde Einträge bleiben erhalten; mehrdeutige oder beschädigte verwaltete Gruppen werden abgewiesen. Eine fehlende Zustell-/Schreibbestätigung löst keine automatische Wiederholung aus.
- Persistierte Daten und lokale Geheimnisse liegen außerhalb der Git-Verfolgung. Keine Passwörter in Browser-Storage oder API-Antworten.

Server- und vorbereitete RCON-Passwörter liegen separat in `DATA_DIR/profile-secrets`: Verzeichnis `0700`, atomar geschriebene Dateien `0600`, begrenzte Dateigröße und kein Folgen von Dateilinks. Öffentliche Profilfelder enthalten nur `serverPasswordSet`/`rconPasswordSet`; Zustands- und Auditdaten enthalten keine Passwortwerte. Bekannte Spielgeheimnisse werden aus der angezeigten Konsole entfernt. Die Laufzeit muss diese Werte weiterhin in ihren privaten Einstellungen beziehungsweise im Spielprozess verwenden. Spielkonfigurationen und Backups bleiben daher vertraulich. Der vorbereitete Squad-RCON-Port `21114` wird ausschließlich auf Host-Loopback veröffentlicht.

## Private Fehlerdiagnose

Der Server erzeugt Anfrage-UUIDs selbst; vom Browser gelieferte Korrelationswerte werden nicht übernommen. Behandelte Serverfehler und fehlgeschlagene Jobs geben eine feste, verständliche Fehlerkategorie mit Fehler-ID zurück. Der Diagnoselogger schreibt JSON-Zeilen auf stderr, beim mitgelieferten systemd-Dienst ins administrative Journal. Es gibt weder eine eigene Diagnosedatei noch eine Diagnoseansicht im Browser. Zugriffsrechte und Aufbewahrung des Journals sind Hostkonfiguration.

Die Felder sind strikt freigegeben: Zeit, Fehler-/Anfrage-/Job-/Profil-IDs, bekanntes Spiel, Operation, Schritt, HTTP-/Laufzeitstatus, feste Fehlerklasse und Fehlerkategorie sowie bekannte Systemfehlercodes. Optional werden ein SHA-256-Fingerabdruck des höchstens 16 KiB großen gelesenen Laufzeit-Antwortteils und dessen Kürzungskennzeichen erfasst. Stackstellen sind auf bis zu acht bekannte Servermodul-Basisnamen mit Zeile und Spalte begrenzt. Rohe Fehlermeldungen, Ursachenobjekte, Antwort-/Anfrageinhalte, URLs, Header, Cookies, Passwörter, SteamIDs und Befehlsargumente werden nicht protokolliert.

Die Diagnose ersetzt weder das Audit noch eine Sicherung: Ein Schreibfehler des Loggers darf die eigentliche Fehlerbehandlung nicht verhindern. Eine angezeigte Fehler-ID garantiert daher keinen dauerhaft gespeicherten Journaleintrag. Vor Weitergabe eines Auszugs dessen Inhalt prüfen; die übrigen Host- und Spielelogs unterliegen nicht automatisch dieser Feldfreigabe.

## Spiele und Mods sind ausführbarer Fremdcode

Auch eine öffentliche Steam-Collection oder ein beliebtes Modpack kann Schadcode enthalten oder später ändern. Nur vertrauenswürdige Inhalte verwenden. Container beschränken Schäden, teilen aber den Hostkernel. Backups enthalten ebenfalls potenziell bösartige Spieldateien und müssen genauso geschützt werden. Das Panel kann keine inhaltliche Schadsoftwareprüfung aller Mods leisten.

Spielecontainer verwenden serverseitig festgelegte Definitionen mit getrennten Datenverzeichnissen. Keine Hostnetzwerkfreigabe, privilegierten Container, Docker-Sockets oder zusätzlichen Hostfreigaben außerhalb des vorgesehenen Serververzeichnisses und erforderlicher schreibgeschützter Laufzeitdateien ergänzen. Laufzeitimages vor einer Freigabe auf gewünschte Version beziehungsweise Digest festlegen und kontrolliert aktualisieren. Netzwerk-Egress und Zugriffe auf interne Adressen müssen zusätzlich auf dem Linux-Host beschränkt werden.

Neue Steam-Definitionen verwenden ein eigenes begrenztes HOME-Tmpfs (`0700`, UID/GID des Spiels, ausführbar für benötigte Steam-Bibliotheken). Das separate `/tmp` bleibt `noexec`; sämtliche Linux-Capabilities werden entfernt. Dadurch landen neue Steam-Home-Caches nicht im Spielstandverzeichnis. Dies ist keine weitergehende Isolation von Steam oder Mods gegenüber dem eigenen Spielprozess.

Backup und Wiederherstellung lehnen symbolische Links, Hardlinks, Spezialdateien und unsichere Archivpfade ab. Spielverzeichnisse mit solchen Links müssen bereinigt werden, bevor ein Wechsel gesichert abgeschlossen werden kann. Diese Einschränkung ist beabsichtigt, damit ein Mod nicht über ein Archiv aus seinem Dateibereich ausbrechen kann.

Für alte Steam-Installationen gibt es genau eine begrenzte Vorbereitung: Nur im bestätigten Stopp unter Lebenszyklussperre darf der feste, wieder erzeugbare `.steam`-Cache entfernt werden. Root- und Kindlisten werden vor der Löschung erneut geprüft; ein Link an der Cache-Wurzel, zusätzliche Namen oder unerwartete Metadaten führen zur Ablehnung. Die Löschung folgt den Kindlinks nicht. Die Archivprüfung wird nicht gelockert und überspringt keine beliebigen Dateien: Ein Link im Welt-/Konfigurationsbereich blockiert die Sicherung weiterhin.

## Vor öffentlicher Nutzung nachweisen

Auf dem tatsächlichen Linux-Host einen vollständigen Wechsel mit realem Minecraft und GMod, Backupfehler durch vollen Datenträger, Prozessabbruch, Netzwerkfehler und Wiederherstellung eines bekannten Spielstandes prüfen. Containerrechte, effektive RAM-/PID-Limits, Netzwerkzugriff und Besitzrechte der Serververzeichnisse kontrollieren. SSH ausschließlich mit Schlüsseln absichern, Administration bevorzugt über VPN, HTTPS einrichten und nur benötigte Spielports freigeben.

Backups auf derselben VPS schützen vor Fehlbedienung, nicht vor VPS-/Datenträgerverlust oder einer Hostkompromittierung. Eine verschlüsselte externe Kopie mit getesteter Wiederherstellung und Aufbewahrungsfristen ist eine separate Hosting-Aufgabe. Auditereignisse im lokalen Zustand sind eine Bedienhistorie; sie sind kein manipulationssicheres SIEM-Log.

Ein Spielbackup umfasst das Spielverzeichnis. Für eine vollständige Host-Wiederherstellung müssen auch Panelzustand und der getrennte Geheimnisspeicher gesichert werden. Ein Neustart des PufferPanel-Daemons beendet verwaltete Spielprozesse; Oberflächenupdates starten deshalb nur GameSwitch neu, nachdem laufende Vorgänge geprüft wurden.

## Prüfumfang

Automatisierte Tests decken Authentifizierung, Eingabevalidierung und kritische Lebenszyklusfehler ab. Abhängigkeiten werden über Lockfiles festgelegt. Der konkrete Prüfstand und verbleibende Grenzen stehen in [validation.md](validation.md).

## Quellen

- [Docker Engine security](https://docs.docker.com/engine/security/) erklärt insbesondere die privilegierte Docker-Verwaltung und Grenzen der Container-Isolation.
- [Facepunch: Workshop for Dedicated Servers](https://wiki.facepunch.com/gmod/Workshop_for_Dedicated_Servers) beschreibt Collections und das Updateverhalten der Addons.
