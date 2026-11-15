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
- Die Minecraft-Konsole ist nur für den angemeldeten Administrator verfügbar, mit CSRF-/Origin-Prüfung, Befehlsrate und einzeiliger Eingabe ohne Steuerzeichen. Sie verwendet den Spieleingabekanal ohne Shell und teilt die Lebenszyklussperre. Audit-Ereignisse enthalten nur das Befehlswort. Minecraft- und Mod-Befehle können weitreichende Spielrechte haben; die Sperre häufiger direkter Stoppbefehle ersetzt keine Befehls-Sandbox.
- Persistierte Daten und lokale Geheimnisse liegen außerhalb der Git-Verfolgung. Keine Passwörter in Browser-Storage oder API-Antworten.

## Spiele und Mods sind ausführbarer Fremdcode

Auch eine öffentliche Steam-Collection oder ein beliebtes Modpack kann Schadcode enthalten oder später ändern. Nur vertrauenswürdige Inhalte verwenden. Container beschränken Schäden, teilen aber den Hostkernel. Backups enthalten ebenfalls potenziell bösartige Spieldateien und müssen genauso geschützt werden. Das Panel kann keine inhaltliche Schadsoftwareprüfung aller Mods leisten.

Spielecontainer verwenden serverseitig festgelegte Definitionen mit getrennten Datenverzeichnissen. Keine Hostnetzwerkfreigabe, privilegierten Container, Docker-Sockets oder zusätzlichen Hostfreigaben außerhalb des vorgesehenen Serververzeichnisses und erforderlicher schreibgeschützter Laufzeitdateien ergänzen. Laufzeitimages vor einer Freigabe auf gewünschte Version beziehungsweise Digest festlegen und kontrolliert aktualisieren. Netzwerk-Egress und Zugriffe auf interne Adressen müssen zusätzlich auf dem Linux-Host beschränkt werden.

Backup und Wiederherstellung lehnen symbolische Links, Hardlinks, Spezialdateien und unsichere Archivpfade ab. Spielverzeichnisse mit solchen Links müssen bereinigt werden, bevor ein Wechsel gesichert abgeschlossen werden kann. Diese Einschränkung ist beabsichtigt, damit ein Mod nicht über ein Archiv aus seinem Dateibereich ausbrechen kann.

## Vor öffentlicher Nutzung nachweisen

Auf dem tatsächlichen Linux-Host einen vollständigen Wechsel mit realem Minecraft und GMod, Backupfehler durch vollen Datenträger, Prozessabbruch, Netzwerkfehler und Wiederherstellung eines bekannten Spielstandes prüfen. Containerrechte, effektive RAM-/PID-Limits, Netzwerkzugriff und Besitzrechte der Serververzeichnisse kontrollieren. SSH ausschließlich mit Schlüsseln absichern, Administration bevorzugt über VPN, HTTPS einrichten und nur benötigte Spielports freigeben.

Backups auf derselben VPS schützen vor Fehlbedienung, nicht vor VPS-/Datenträgerverlust oder einer Hostkompromittierung. Eine verschlüsselte externe Kopie mit getesteter Wiederherstellung und Aufbewahrungsfristen ist eine separate Hosting-Aufgabe. Auditereignisse im lokalen Zustand sind eine Bedienhistorie; sie sind kein manipulationssicheres SIEM-Log.

## Prüfumfang

Automatisierte Tests decken Authentifizierung, Eingabevalidierung und kritische Lebenszyklusfehler ab. Abhängigkeiten werden über Lockfiles festgelegt. Der konkrete Prüfstand und verbleibende Grenzen stehen in [validation.md](validation.md).

## Quellen

- [Docker Engine security](https://docs.docker.com/engine/security/) erklärt insbesondere die privilegierte Docker-Verwaltung und Grenzen der Container-Isolation.
- [Facepunch: Workshop for Dedicated Servers](https://wiki.facepunch.com/gmod/Workshop_for_Dedicated_Servers) beschreibt Collections und das Updateverhalten der Addons.
