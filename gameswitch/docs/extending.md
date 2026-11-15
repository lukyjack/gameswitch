# Ein weiteres Spiel ergänzen

Neue Spiele sind eine Codeänderung durch den Administrator. Die Weboberfläche akzeptiert absichtlich keine beliebigen ausführbaren Templates.

1. Die offizielle oder gründlich geprüfte PufferPanel-Definition mit Quellcommit und Lizenz unter `server/templates/` ablegen. Dort liegt auch eine Valheim-Vorlage als Ausgangspunkt; Valheim ist noch kein freigeschaltetes Spiel.
2. Unter `server/catalog.mjs` den Katalogeintrag und die Eingabevalidierung erweitern. Nur benötigte Felder erlauben; Dateipfade, ausführbare Befehle und fremde Download-URLs bleiben gesperrt.
3. Unter `server/templates.mjs` die Definition erzeugen. Installations-/Startbefehle sind fest im Code. Docker-Isolation und Ressourcenlimits beibehalten; keine Autostart-/Autorestart-Aktionen außerhalb des Orchestrators. Spielstand, Ports, Stop-Verhalten und Bereitschaftssignal explizit festlegen.
4. Benötigte Spieleingaben in `web/` ergänzen. Eine Bibliothekskachel allein gilt nicht als Unterstützung. Falls zusätzliche Geheimnisse nötig sind, diese nur serverseitig konfigurieren.
5. Adaptertests, erfolgreichen Start, geordnetes Stoppen, Backup, Wiederherstellung und Wechsel auf einem Linux-Testhost nachweisen. Erst danach den Katalogeintrag freischalten.

Die gemeinsame Lebenszyklussteuerung in `server/controller.mjs` und der Laufzeitadapter in `server/runtime.mjs` bleiben die einzigen Wege zum Starten und Stoppen. Ein neues Spiel darf diesen Pfad nicht umgehen.

## Minecraft-Anbieter

Modrinth und der offizielle öffentliche FTB-Katalog sind integriert. FTB verwendet feste Pack-/Versions-IDs und den offiziellen Installer über den FTBA-Modus des itzg-Laufzeitimages. Minecraft-/Java-Version sowie RAM-Minimum stammen aus den offiziellen Versionsmetadaten; bei FTB Evolution 2 wählt die Oberfläche beispielsweise Java 25 und standardmäßig 12 GB Profil-RAM, soweit das Hostbudget dies erlaubt. Mindestens 2 GB bleiben außerhalb des Java-Heaps frei; das Heap-Maximum ist zusätzlich auf die Packempfehlung begrenzt. Evolution 2 verwendet damit 8 GB maximalen und 2 GB anfänglichen Heap. Änderungen werden erst beim nächsten regulären Start einer gestoppten Instanz übernommen. Die Spieler benötigen auf ihrem PC dieselbe Packversion, etwa über die FTB App. Das Panel installiert den dedizierten Server.

CurseForge benötigt eine zusätzliche eigene Anbieteranbindung sowie Prüfung von API-Schlüsseln, Nutzungsbedingungen und Serverpack-Installationsformaten. Eine CurseForge-URL als Modrinth-Pack auszugeben wäre keine Unterstützung. Für vorhandene Mods ist ein dediziertes, versionsgebundenes Modpack der nachvollziehbare Weg.

## Steam-Inhalte

GMod nutzt die eigene öffentliche oder ungelistete Workshop-Collection. Die ID wird aus einer offiziellen Steam-URL extrahiert; die Anwendung ruft keine frei eingegebene URL ab. Sandbox und Trouble in Terrorist Town stehen als feste Modi zur Auswahl; TTT startet über `terrortown`. Den echten BSP-Kartennamen ohne `.bsp` eintragen; die Karte muss in der Collection vorhanden oder separat installiert sein. Der Modus allein erkennt keine passenden Karten automatisch.

Der Server lädt und mountet die Collection. Je nach Addon sind für Client-Inhalte zusätzlich eine Subscription beziehungsweise `resource.AddWorkshop` erforderlich. Eine Spielebibliothek mit beispielsweise Counter-Strike-Source-Assets zu mounten ist ein separater Schritt mit Lizenz-, SteamCMD- und Dateirechteanforderungen und gehört noch nicht zum MVP. Ein gegebenenfalls benötigter Steam Game Server Login Token wird beim Hosting serverseitig ergänzt und gehört nicht in Chat oder Git.

Quellen: [FTB Evolution 2](https://www.feed-the-beast.com/modpacks/135), [FTBA-Laufzeitdokumentation](https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/mod-platforms/ftb/), [GMod Workshop](https://wiki.facepunch.com/gmod/Workshop_for_Dedicated_Servers).
