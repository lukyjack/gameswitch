# Sicherheitsmodell

GameSwitch ist für einen Administrator auf einem einzelnen eigenen VPS entwickelt. Es ist kein öffentliches Mehrmandanten-Hosting mit voneinander unabhängigen Kunden. Die Anwendung ist ein Entwicklungsstand und kein extern auditiertes Sicherheitsprodukt.

## Vertrauensgrenzen

Browser → authentifizierter GameSwitch-Server → lokale PufferPanel-API → Docker → Spielprozess.

Für Steam-Vorbereitung besteht ein getrennter Weg: angemeldeter HTTPS-Browser → begrenzte GameSwitch-API → privater Unix-Socket → fester Root-Einrichtungsdienst → isolierter SteamCMD-Download. Dieser Weg stellt keine allgemeine Root-Shell bereit.

Der Browser erhält keine PufferPanel-Client-Secrets. PufferPanel ist ein privilegierter Verwaltungsdienst: Wer dessen Docker-Zugang kontrolliert, kann den Host beeinflussen. GameSwitch läuft als eigener unprivilegierter Benutzer ohne Mitgliedschaft in der Docker-Gruppe und ohne Docker-Socket. Das PufferPanel-Administrationspanel bleibt über Loopback beziehungsweise einen administrativen SSH-Tunnel erreichbar.

## Implementierte Schutzmaßnahmen

- Keine Standardzugangsdaten; einmaliger Einrichtungstoken und eigener Administrator.
- Passwörter werden mit gesalzenem scrypt gehasht. Session-Cookies sind HttpOnly und SameSite Strict; HTTPS erzwingt Secure-Cookies im Produktionsbetrieb.
- Schreibzugriffe benötigen die korrekte Origin und einen CSRF-Token. Fremde Origins werden abgelehnt. Login und Einrichtung sind begrenzt; Sitzungen laufen ab.
- Hostname und öffentliche Origin sind explizite Konfiguration. Standardbindung ist Loopback; öffentliches Hosting benötigt eine HTTPS-Origin. Der explizite SSH-Tunnel-Modus erlaubt HTTP nur zwischen Loopback-Adressen an den beiden Enden des verschlüsselten Tunnels. Secure-Cookies gelten für die HTTPS-Variante; im Tunnel bleiben HttpOnly-/SameSite- und CSRF-Schutz aktiv.
- Strikte Profilvalidierung; keine vom Browser gelieferten Shellbefehle, Dateipfade, Templates, Docker-Images oder Download-URLs. Externe Kataloganfragen verwenden festgelegte Anbieter.
- Ressourcen- und Längenbegrenzungen sowie begrenzte HTTP-Anfragen. Keine ungefilterte HTML-Ausgabe aus Konsole, Spielnamen oder Modpackbeschreibungen.
- Global serialisierte Lebenszyklusoperationen. Ein Backupfehler blockiert den Wechsel. Wiederherstellung nur im gestoppten Zustand mit vorherigem Sicherheitsbackup.
- Die Spielekonsole ist nur für den angemeldeten Administrator verfügbar, mit CSRF-/Origin-Prüfung, Befehlsrate und einzeiliger Eingabe ohne Steuerzeichen. Sie verwendet den Spieleingabekanal oder einen fest konfigurierten lokalen RCON-Transport und teilt die Lebenszyklussperre. Audit-Ereignisse enthalten nur das Befehlswort. Spiel- und Mod-Befehle können weitreichende Rechte haben; die Sperre häufiger direkter Stoppbefehle ersetzt keine Befehls-Sandbox. Valheim, Arma 3 und DayZ erhalten lesbare Ausgabe ohne fingierten Befehlsweg. Der Source/TCP-RCON-Adapter wird für Arma und DayZ nicht wiederverwendet.
- Die Admin-Helfer akzeptieren streng geprüfte SteamIDs statt frei zusammengesetzter Befehle. GMod verwendet feste ULX-Befehle; Dateilisten benötigen eine bestätigte gestoppte Instanz, eine vorherige Kopie und eine erneute Statusprüfung vor dem Schreiben. Bestehende fremde Einträge bleiben erhalten; mehrdeutige oder beschädigte verwaltete Gruppen werden abgewiesen. Eine fehlende Zustell-/Schreibbestätigung löst keine automatische Wiederholung aus.
- Persistierte Daten und lokale Geheimnisse liegen außerhalb der Git-Verfolgung. Keine Passwörter in Browser-Storage oder API-Antworten.

Server- und vorbereitete RCON-Passwörter liegen separat in `DATA_DIR/profile-secrets`: Verzeichnis `0700`, atomar geschriebene Dateien `0600`, begrenzte Dateigröße und kein Folgen von Dateilinks. Öffentliche Profilfelder enthalten nur `serverPasswordSet`/`rconPasswordSet`; Zustands- und Auditdaten enthalten keine Passwortwerte. Bekannte Spielgeheimnisse werden aus der angezeigten Konsole entfernt. Die Laufzeit muss diese Werte weiterhin in ihren privaten Einstellungen beziehungsweise im Spielprozess verwenden. Spielkonfigurationen und Backups bleiben daher vertraulich. Der vorbereitete Squad-RCON-Port `21114` wird ausschließlich auf Host-Loopback veröffentlicht.

## Geschützte Steam-Bibliotheken für Arma 3 und DayZ

Diese beiden Spiele benötigen eine authentifizierte Steam-Vorbereitung. Der Button „Steam einrichten“ öffnet die tatsächliche SteamCMD-Anmeldung innerhalb der geschützten Panel-Sitzung; ein OpenID-Identitätsnachweis allein erteilt keine Berechtigung zum Herunterladen. Die normale Profil-API nimmt weiterhin keine Steam-Zugangsdaten entgegen. Die dedizierte Einrichtungs-API übermittelt verdeckte, begrenzte Eingaben ausschließlich an die aktive PTY-Sitzung. Passwort und Steam Guard gehören nicht in Chat, Prozessargumente, Spielkonfigurationen oder Spielbackups. Die SSH-CLI bleibt als alternative interaktive Einrichtung erhalten.

Der Root-Dienst bindet ausschließlich `/run/gameswitch-steam-setup/control.sock`, mit `0660` und `root:gameswitch`; das Runtime-Verzeichnis hat `0750`. Er prüft Linux-Peercredentials (`SO_PEERCRED`) und akzeptiert nur den konfigurierten `gameswitch`-Benutzer (auf diesem Host UID 988) oder Root. Er startet ausschließlich den festen Hosthelfer für `arma3` oder `dayz` und geprüfte Workshop-IDs. Frei wählbare Befehle, Programme, Hostpfade, Images oder eine allgemeine Shell werden nicht angeboten. GameSwitch bleibt ohne Docker-Gruppenmitgliedschaft und ohne Docker-Socket; nur dieser begrenzte Root-Dienst darf den vorhandenen Docker-Daemon für seinen eigenen isolierten Downloadcontainer nutzen.

Der TLS-Schutz endet beim GameSwitch-Server. Die Administrationsanwendung und der Einrichtungsdienst verarbeiten Eingaben kurzzeitig im RAM und gehören zur vertrauenswürdigen Hostsoftware; ein kompromittiertes Panel könnte solche laufenden Eingaben mitlesen. Deshalb bleibt die Einrichtung eine Funktion des einzelnen vertrauenswürdigen Administrators.

Alle Browserzugriffe verlangen eine angemeldete Administratorsitzung. Eingaben und Änderungen benötigen passende Origin und CSRF-Token; der SSE-Ausgabestream prüft zusätzlich fremde Origins/Cross-Site-Anfragen und Sitzungsablauf. Logout beziehungsweise ein ersetzter Login invalidieren bestehende Streams. Eingaben sind auf eine Zeile und 512 UTF-8-Bytes begrenzt, werden vor dem Absenden aus dem Feld gelöscht und nicht automatisch wiederholt. Die Anzeige verwendet begrenzten, als Text gerenderten RAM-Puffer mit entfernten ANSI-/Steuersequenzen. Die Anwendung nutzt dafür weder Browser-Storage noch persistente Terminaldateien; Diagnosen und Audit übernehmen keine Eingaben oder rohen Steam-Ausgaben. Der Broker begrenzt Sitzungsdauer, Framegröße, Eingaben und Verbindungen; PTY-Echo und eine zusätzliche flüchtige Ausgabe-Redaktion schützen vor versehentlicher Rückanzeige.

Nur Steams eigener Anmeldecache bleibt in einem gemeinsam genutzten Root-geschützten Steam-HOME unter `/var/lib/gameswitch-steam-private`. Er gehört zur privilegierten Hostverwaltung und darf nicht in Spielvolumes, öffentliches Hosting oder Spielbackups gelangen. Eine vollständige Hostkompromittierung könnte auch diesen Cache betreffen; die Trennung ist keine Garantie gegen Root-Zugriff. Beim Schließen des Dialogs läuft eine begonnene Einrichtung weiter und lässt sich wieder öffnen. Expliziter Abbruch oder Verlust der Verbindung zwischen GameSwitch und Broker beendet ausschließlich den eigenen Einrichtungshelfer; der Neustart von GameSwitch beendet damit eine laufende Steam-Einrichtung, während Spielecontainer erhalten bleiben.

Die vom Host veröffentlichten Bibliotheken und Manifeste gehören Root und dürfen nicht gruppen- oder weltbeschreibbar sein. Die Laufzeit prüft feste Spiel-/Appkennungen, begrenzte Manifestgröße, echte Binärdateien und ausgewählte Modverzeichnisse. Symlinks, Hardlinks oder unerwartete Dateitypen werden bei der Vorbereitung/Kopie abgewiesen. Die Spiele erhalten nur eine schreibgeschützte Bibliothek und kopieren benötigte Dateien sowie ausgewählte Modschlüssel ins eigene Profilvolume. Steam-Anmeldeartefakte gehören nicht in diese Bibliothek.

`runtimeSetup` veröffentlicht nur Bereitschaft der Dateien, vorbereitete Mod-IDs, einen festen Hinweis und gegebenenfalls das Aktualisierungsdatum. Der tatsächliche native Serverstart wird damit nicht bestätigt. Eine fehlende oder unlesbare Bibliothek beziehungsweise ein nicht vorbereiteter ausgewählter Mod verhindert die Aktivierung vor jeder Save-/Stopp-Aktion der laufenden Instanz. Das Browser-Gating ergänzt diese serverseitige Prüfung. Arma-Missionen sind auf fünf feste Vorlagen beschränkt, DayZ zunächst auf Chernarus. Workshop-Listen sind auf 30 eindeutige numerische IDs begrenzt; die Arma-Adminliste auf 20 gültige individuelle SteamID64.

Arma aktualisiert ausschließlich den festen eingeschlossenen Adminabschnitt `arma/admins.cfg`, mit Sicherung und wiederholter Stoppprüfung. Eine Rechtevergabe erzeugt keinen Spielneustart. DayZ bietet keinen behaupteten nativen Steam-ID-Adminweg; zusätzliche Adminmods müssen separat auf Berechtigungen und Vertrauenswürdigkeit geprüft werden.

## Private Fehlerdiagnose

Der Server erzeugt Anfrage-UUIDs selbst; vom Browser gelieferte Korrelationswerte werden nicht übernommen. Behandelte Serverfehler und fehlgeschlagene Jobs geben eine feste, verständliche Fehlerkategorie mit Fehler-ID zurück. Der Diagnoselogger schreibt JSON-Zeilen auf stderr, beim mitgelieferten systemd-Dienst ins administrative Journal. Es gibt weder eine eigene Diagnosedatei noch eine Diagnoseansicht im Browser. Zugriffsrechte und Aufbewahrung des Journals sind Hostkonfiguration.

Die Felder sind strikt freigegeben: Zeit, Fehler-/Anfrage-/Job-/Profil-IDs, bekanntes Spiel, Operation, Schritt, HTTP-/Laufzeitstatus, feste Fehlerklasse und Fehlerkategorie sowie bekannte Systemfehlercodes. Optional werden ein SHA-256-Fingerabdruck des höchstens 16 KiB großen gelesenen Laufzeit-Antwortteils und dessen Kürzungskennzeichen erfasst. Stackstellen sind auf bis zu acht bekannte Servermodul-Basisnamen mit Zeile und Spalte begrenzt. Rohe Fehlermeldungen, Ursachenobjekte, Antwort-/Anfrageinhalte, URLs, Header, Cookies, Passwörter, SteamIDs und Befehlsargumente werden nicht protokolliert.

Die Diagnose ersetzt weder das Audit noch eine Sicherung: Ein Schreibfehler des Loggers darf die eigentliche Fehlerbehandlung nicht verhindern. Eine angezeigte Fehler-ID garantiert daher keinen dauerhaft gespeicherten Journaleintrag. Vor Weitergabe eines Auszugs dessen Inhalt prüfen; die übrigen Host- und Spielelogs unterliegen nicht automatisch dieser Feldfreigabe.

## Spiele und Mods sind ausführbarer Fremdcode

Auch eine öffentliche Steam-Collection oder ein beliebtes Modpack kann Schadcode enthalten oder später ändern. Nur vertrauenswürdige Inhalte verwenden. Container beschränken Schäden, teilen aber den Hostkernel. Backups enthalten ebenfalls potenziell bösartige Spieldateien und müssen genauso geschützt werden. Das Panel kann keine inhaltliche Schadsoftwareprüfung aller Mods leisten.

Spielecontainer verwenden serverseitig festgelegte Definitionen mit getrennten Datenverzeichnissen. Keine Hostnetzwerkfreigabe, privilegierten Container, Docker-Sockets oder zusätzlichen Hostfreigaben außerhalb des vorgesehenen Serververzeichnisses und erforderlicher schreibgeschützter Laufzeitdateien ergänzen. Laufzeitimages vor einer Freigabe auf gewünschte Version beziehungsweise Digest festlegen und kontrolliert aktualisieren. Netzwerk-Egress und Zugriffe auf interne Adressen müssen zusätzlich auf dem Linux-Host beschränkt werden.

Neue GMod-/Valheim-/Squad-Definitionen verwenden ein eigenes begrenztes HOME-Tmpfs (`0700`, UID/GID des Spiels, ausführbar für benötigte Steam-Bibliotheken). Arma 3 und DayZ verwenden ein dauerhaftes HOME im Spielverzeichnis, damit Profile, gespeicherte Zustände und Protokolle gesichert werden; nur das verschachtelte `.steam` liegt in einem eigenen begrenzten Tmpfs. Das separate `/tmp` bleibt `noexec`; sämtliche Linux-Capabilities werden entfernt. Die Cache-Abgrenzung ist keine weitergehende Isolation von Steam oder Mods gegenüber dem eigenen Spielprozess.

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
