ARC XP - OFFLINE CAM
====================

Für einen Windows-XP-PC mit der vorhandenen Internet-Explorer-Engine.
Ziel ist Internet Explorer 8. Es muss kein zusätzlicher Browser installiert werden.
Die Ausgabe wurde nicht auf echtem Windows XP / Internet Explorer geprüft.
Bitte zuerst mit einem kleinen Testteil und ohne eingeschaltetes Plasma prüfen.

START
1. ZIP auf einem anderen Rechner herunterladen.
2. ZIP vollständig entpacken und den Ordner per USB auf den XP-PC kopieren.
3. arc-xp.hta doppelt anklicken. Nicht in eine Internetseite einbetten.
   HTA nutzt die vorhandene IE-Engine als lokale Windows-Anwendung.
   Sie benötigt keinen Server und keine Internetverbindung.
   Falls HTA durch den Rechneradministrator deaktiviert ist, arc-xp.html
   im vorhandenen IE öffnen. Die HTML-Ausgabe greift nicht auf Dateien zu:
   DXF über den Editor einfügen, G-Code markieren/kopieren und im Editor
   als ANSI unter dem angezeigten .nc-Dateinamen speichern.

DATEIEN IN DER HTA-AUSGABE
- Quelle "DXF" wählen, Datei auswählen und "Ausgewählte Datei öffnen" klicken.
- "Berechnen" klicken. Die Datei wird nur gelesen, nicht verändert.
- Im Feld "Speicherpfad" den vollständigen Ausgabepfad prüfen oder ändern.
- "Datei speichern" schreibt die Ausgabe an diesen Pfad.
- Eine vorhandene Ausgabedatei wird nur nach Rückfrage überschrieben.
- Die App schreibt keine Registry-Einstellungen und startet keine Programme.
- HTA hat normalen lokalen Dateizugriff. Nur diese eigene lokale Datei starten.

FUNKTIONEN
- Rechteck, Kreis/Ring, Laschen, Flansche und Textschilder.
- Drei Schablonenschriften sind als vorberechnete Konturen enthalten.
- Zusatzstege, Abstände und Rand-/Lochprüfung wie in der Teile-App.
- Flache ASCII-DXF inkl. SPLINE-Konturen; 1 MB und 200 Konturen als XP-Grenze.
- Höchstens 24 Textzeichen. Kleine Teile bevorzugen; auf sehr langsamen PCs
  können detaillierte Kurven und viele Buchstaben länger dauern.
- Vorschau nutzt VML im alten IE, SVG in neueren Browsern.
- Text hat eine eigene Drehung. "Auf Lasche ausrichten" positioniert und
  dreht Text bei Laschen unter das Kopfloch bzw. zwischen die Endlöcher
  einer Langlasche und sucht eine passende Größe. Bei ungültigem Text
  bleibt die Grundform sichtbar; Ausgabe bleibt gesperrt.
- Keine Maus-Zoom-/Verschiebe-Werkzeuge. Position, Drehung und Nullpunkt
  über Zahlenfelder und Schaltflächen einstellen.
- Nach Änderungen explizit "Berechnen". Vorherige Ausgabe wird ungültig.
- Offene oder unklare Konturen manuell zuordnen. Löcher werden vor der
  Außenkontur geschnitten. Keine Höhenachse, Referenzfahrt oder Nullpunktsetzung
  auf der Maschine. Vor dem Schnitt simulieren.

MACH3 / WARTEZEIT
Standardbefehle: M8 ein / M9 aus.
Einstechzeit immer in Sekunden eingeben.
Standardausgabe G4 P in Millisekunden: 0,5 s ergibt G4 P500.
In Mach3 "Config > General Config > G04 Dwell in ms" aktivieren.
Ist diese Option aus, in der App die G4-P-Einheit "Sekunden" wählen.
Beide Einstellungen müssen übereinstimmen.

VORGABEN
- Blechdicke und Prozesswerte speichern.
- Lokaler Browser-Speicher funktioniert unter XP/file:// nicht zuverlässig.
- "Vorgaben ausgeben" erzeugt eine JSON-Sicherung mit M-Befehlen und G4-Einheit.
- JSON über die HTA-Dateiauswahl oder in das DXF-Textfeld laden und
  "Vorgaben laden" klicken. Moderne Blechvorgaben-JSON-Dateien sind lesbar.
- Texteinstellungen und Teilemaße werden in dieser Ausgabe nicht dauerhaft
  gespeichert. Die Browser-/HTA-Sitzung erhält sie bis zum Schließen.

Die moderne Webseite bleibt unverändert. Diese Ausgabe enthält alle Skripte,
Konturen und Lizenzen direkt in der Datei; es werden keine Online-Dienste genutzt.
