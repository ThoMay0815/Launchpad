# Handball Launchpad

Ein Musik-Launchpad für Handballspiele, bedienbar auf iPad und iPhone. Die Tasten sind nach Spielsituationen gruppiert (Tor, Parade, Fair-Play-Tor, Mitmachen, Auszeit, Einlauf, Halbzeit, Schlusspfiff). Jede Taste spielt einen vorbereiteten Ausschnitt aus Spotify ab dem richtigen Startpunkt. Ein zweiter Tipp blendet aus, ein dritter Tipp während des Ausblendens stoppt sofort.

Diese Version ist ein **Test-Prototyp mit Spotify**. Er soll klären, ob Spotify in der Halle schnell und zuverlässig genug ist. Die Architektur ist so gebaut, dass später eine Wiedergabe aus eigenen Audiodateien ergänzt werden kann, ohne die Oberfläche neu zu bauen (siehe `docs/ARCHITEKTUR.md`).

## Was der Prototyp kann und was nicht

Er kann Clips per Tipp ab einer beliebigen Stelle starten, an einem festgelegten Endpunkt automatisch beenden, pro Kategorie rotieren und die Belegung sichern und wiederherstellen. Start- und Endpunkte lassen sich direkt aus der laufenden Spotify-Wiedergabe übernehmen. Die Funktion „Wach halten“ verhindert, dass iOS die Spotify-App im Leerlauf schlafen legt.

Wichtige Grenzen, die direkt aus Spotify folgen:

- **Ausblenden funktioniert nur auf Geräten, die Spotify eine Lautstärkesteuerung erlauben.** Die App prüft das automatisch. Auf iPhone und iPad ist das nach meinem Kenntnisstand meist nicht der Fall. Dann stoppt der Clip hart, die Statusleiste zeigt „Kein Ausblenden möglich“. Ein Laptop mit der Spotify-Desktop-App erlaubt die Lautstärkesteuerung in der Regel.
- **Internet ist Pflicht.** Jeder Tastendruck geht über die Spotify-Server zum Abspielgerät, auch wenn die Songs heruntergeladen sind.
- **Es gibt eine Verzögerung** zwischen Tipp und Ton. Wie groß sie ist, muss der Test zeigen (Messanleitung unten).
- **Spotify Premium** ist Voraussetzung, und die Anmeldung muss etwa alle sechs Monate erneuert werden.

## Einrichtung (einmalig, etwa 20 bis 30 Minuten)

### 1. Dateien online stellen (GitHub Pages, kostenlos)

Spotify verlangt für die Anmeldung eine HTTPS-Adresse. GitHub Pages liefert das kostenlos.

1. Auf github.com ein Konto anlegen, falls noch nicht vorhanden.
2. Neues Repository anlegen, z. B. `launchpad`, Sichtbarkeit „Public“ (Pages ist bei kostenlosen Konten nur für öffentliche Repositories verfügbar). Im Repository liegt nur Code, keine persönlichen Daten. Deine Belegung und deine Anmeldung bleiben auf dem Gerät.
3. „Add file“, dann „Upload files“ und den kompletten Inhalt dieses Ordners hineinziehen (inklusive der Ordner `css`, `js`, `docs`, `tests`).
4. Unter „Settings“, dann „Pages“ als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen.
5. Nach ein bis zwei Minuten ist die App erreichbar unter `https://DEINNAME.github.io/launchpad/`.

### 2. Spotify-Entwickler-App anlegen

1. Auf developer.spotify.com mit deinem Spotify-Konto anmelden und das Dashboard öffnen.
2. „Create app“ wählen. Name und Beschreibung frei wählen.
3. Als **Redirect URI** exakt die Adresse aus Schritt 1 eintragen, mit abschließendem Schrägstrich: `https://DEINNAME.github.io/launchpad/`
4. Bei den APIs „Web API“ auswählen und speichern.
5. Die **Client ID** kopieren. Ein Client Secret wird nicht gebraucht.

Wichtig: Die App immer genau unter dieser Adresse öffnen, nicht unter `.../launchpad/index.html`. Die Redirect URI muss Zeichen für Zeichen übereinstimmen.

### 3. Verbinden

1. Die Adresse auf dem iPad in Safari öffnen.
2. Die angezeigte Redirect URI mit der im Dashboard vergleichen, Client ID einfügen, „Mit Spotify verbinden“ tippen.
3. Optional: In Safari „Teilen“, dann „Zum Home-Bildschirm“. Die App startet dann ohne Browserleiste.

Hinweis zum Home-Bildschirm: Web-Apps auf dem Home-Bildschirm haben einen eigenen Speicher, getrennt von Safari. Falls die Anmeldung dort nicht zurück in die App führt, für den Test einfach Safari verwenden. Das habe ich nicht auf einem echten Gerät geprüft.

### Alternative: lokal auf einem Mac testen

```bash
npm run serve
```

Dann `http://127.0.0.1:8080/` öffnen und genau diese Adresse zusätzlich als Redirect URI eintragen. Spotify erlaubt `127.0.0.1`, aber nicht `localhost`.

## Testaufbau

Spotify braucht ein **Abspielgerät**, auf dem die Spotify-App läuft. Das Launchpad ist nur die Fernbedienung. Drei sinnvolle Aufbauten:

| Aufbau | Abspielgerät | Launchpad | Ausblenden | Einschätzung |
|---|---|---|---|---|
| A | iPad, Spotify und Launchpad nebeneinander in Split View | dasselbe iPad | voraussichtlich nein | Ein Gerät, einfachster Aufbau |
| B | iPhone mit Spotify im Vordergrund, Bildschirm an | iPad | voraussichtlich nein | Spotify bleibt sicher aktiv |
| C | Laptop mit Spotify-Desktop-App | iPad oder iPhone | voraussichtlich ja | Einziger Weg zum echten Ausblenden |

Das Abspielgerät wird per Bluetooth oder Kabel mit der Box verbunden. Die Geräteliste in der App zeigt nach dem Laden, ob Lautstärkesteuerung verfügbar ist.

**Split View auf dem iPad:** Launchpad in Safari öffnen, oben auf die drei Punkte tippen, „Split View“ wählen und Spotify daneben öffnen. Beide Apps bleiben so im Vordergrund. Ob iOS die Spotify-App im Hintergrund als Gerät erreichbar hält, ist die größte Unbekannte des Tests.

### Empfohlene Spotify-Einstellungen auf dem Abspielgerät

- **Überblenden (Crossfade) aus.** Sonst beginnt ein Clip leise.
- **Autoplay aus.** Sonst läuft nach Songende etwas Zufälliges weiter.
- **Lautstärke normalisieren an.** Die Clips sind dann ähnlich laut.
- **Wiederholen aus.**
- Alle Songs der Belegung **herunterladen**. Das spart Datenvolumen und Pufferzeit.

## Wach halten (wichtig bei iPhone und iPad)

**Das Problem:** iOS legt Apps im Hintergrund nach wenigen Sekunden schlafen, sobald sie keinen Ton abspielen. Läuft das Launchpad in Safari und Spotify im Hintergrund, verschwindet Spotify nach einer Pause als Gerät. Das Launchpad meldet dann „Spotify-Gerät nicht erreichbar“. Solange Musik läuft, bleibt Spotify wach.

**Die Lösung:** Im Leerlauf spielt das Launchpad einen stillen Track, statt zu pausieren. Für iOS läuft damit durchgehend Musik, für dich ist es still. Ein Wächter prüft alle 20 Sekunden, ob die Stille noch läuft, und startet sie bei Bedarf neu, auch kurz bevor der Track endet.

**Einrichten:**

1. In Spotify nach „silence“ oder „Stille“ suchen. Lange, wirklich stille Tracks sind selten, weil Spotify reine Stille-Alben in der Vergangenheit entfernt hat. Der Track sollte **mindestens etwa 2 Minuten** lang sein. Sehr kurze Tracks von wenigen Sekunden funktionieren nicht zuverlässig, weil der Wächter nur alle 20 Sekunden prüft. Ein möglicher Kandidat ist John Cage, „4'33“, von dem es viele Aufnahmen gibt.
2. **Mit Kopfhörern bei voller Lautstärke prüfen**, dass wirklich nichts zu hören ist. Manche „Stille“-Tracks enthalten Rauschen oder Raumklang, auch viele Aufnahmen von „4'33“.
3. Den Track in Spotify **herunterladen**.
4. Im Launchpad unter „Mehr“ auf „Stille-Track festlegen“ tippen und den Link einfügen.
5. Unter „Mehr“ „Wach halten einschalten“ wählen. Die Statusleiste zeigt „Wach halten an“.

**Zu beachten:**

- Wach halten gilt auch im Bearbeitungsmodus. Nach dem Vorhören läuft wieder die Stille. Einen Song, den du in Spotify pausiert hast, um eine Stelle zu suchen, lässt der Wächter im Bearbeitungsmodus aber stehen. Sobald du „Aus Spotify übernehmen“ tippst, ist die Position gesichert und die Stille startet sofort wieder.
- Läuft in Spotify ein anderer Song, den du selbst gestartet hast, lässt der Wächter ihn in Ruhe.
- Nebeneffekte: etwas mehr Akkuverbrauch, und die Stille taucht in deinem Spotify-Verlauf auf. Ein Vorteil: Viele Bluetooth-Boxen schalten sich bei Stille-Wiedergabe nicht in den Standby.
- Wacht Spotify trotzdem nicht auf, hilft „Spotify öffnen“ in der Statusleiste. Nach der Rückkehr lädt das Launchpad die Geräte automatisch neu.

## Clips einrichten

1. „Bearbeiten (halten)“ etwa eine Sekunde gedrückt halten. Ein gelber Punkt zeigt Clips, deren Startpunkt noch nicht geprüft ist. Gestrichelte Clips haben noch keinen Link.
2. Einen Clip antippen. Der schnellste Weg: den Song in Spotify starten, zurück ins Launchpad wechseln und **im richtigen Moment, während der Song läuft,** beim **Startpunkt** „Aus Spotify übernehmen“ tippen. Song, Titel und Position werden übernommen. Pausieren in Spotify geht auch, dann aber zügig übernehmen, weil iOS eine pausierte Spotify-App nach wenigen Sekunden schlafen legen kann.
3. Genauso den **Endpunkt** setzen: Song weiterlaufen lassen und an der Endstelle beim Endpunkt „Aus Spotify übernehmen“ tippen. Unter dem Feld steht die berechnete Dauer. Endpunkt leer lassen heißt: läuft, bis du stoppst.
4. Mit „Vorhören oder stoppen“ den ganzen Clip prüfen, mit „Ende vorhören“ nur die letzten vier Sekunden. Beide Punkte lassen sich mit „0,5 s früher“ und „0,5 s später“ feinjustieren. Meist passt ein Start eine halbe Sekunde vor dem Höhepunkt am besten, weil die Verzögerung den Rest frisst. Kann das Gerät ausblenden (Laptop), endet das Ausblenden genau am Endpunkt. Kann es das nicht (iPhone, iPad), stoppt der Clip hart genau am Endpunkt.
5. „Startpunkt geprüft“ anhaken und speichern.
6. Danach über „Mehr“ die Belegung exportieren. Das ist dein Backup.

Richtwerte der Vorbelegung: Tor 7 Sekunden mit 1,5 Sekunden Ausblenden, Parade 5 Sekunden, Fair-Play-Tor 4 Sekunden, Auszeit 20 Sekunden mit reduzierter Lautstärke, Einlauf bis zum manuellen Stopp.

## Bedienung im Spiel

- **Große Fläche einer Kategorie:** spielt den nächsten Clip der Rotation. Beim nächsten Tor kommt automatisch ein anderer Song.
- **Einzelner Clip:** spielt genau diesen Clip.
- **Nochmal tippen:** blendet aus. **Ein drittes Mal:** sofort aus.
- **Neue Taste während ein Clip läuft:** der neue Clip ersetzt den alten.
- **Alles aus:** blendet aus und pausiert, egal was läuft.

## Prüfen und Testen

### Automatisierte Tests

Voraussetzung ist Node.js ab Version 18, sonst nichts.

```bash
npm test        # 46 Tests: Logik, Wiedergabesteuerung, Wach halten, API-Client
npm run check   # Syntaxprüfung aller Module
```

Die Tests decken unter anderem ab: Link-Erkennung (auch Einbetten-Links), Zeitformate, Endpunkt, Rotation, Fade-Kurve, harter Stopp ohne Lautstärkesteuerung, automatischer Wechsel bei `VOLUME_CONTROL_DISALLOW`, Auto-Stopp, Abbruch eines laufenden Ausblendens durch einen neuen Clip, Stille statt Pause, Wächter gegen Tastendruck, einmalige Wiederholung bei 502, Token-Erneuerung bei 401 und die strikte Reihenfolge der Befehle.

### Manuelles Testprotokoll (zu Hause, mit Box)

| Nr. | Test | Erwartung |
|---|---|---|
| 1 | Anmelden, Gerät wählen | Gerät erscheint, Hinweis zur Lautstärke passt zum Gerät |
| 2 | Tor tippen | Clip startet an der richtigen Stelle, stoppt nach etwa 7 Sekunden |
| 3 | Tor tippen, nach 2 Sekunden nochmal | Ausblenden (Aufbau C) oder harter Stopp (A, B) |
| 4 | Einlauf starten, dann Tor tippen | Tor ersetzt Einlauf ohne Pause dazwischen |
| 5 | Zehnmal Tor im Abstand von 20 Sekunden | Rotation durch alle Tor-Clips, keine Aussetzer |
| 6 | 20 Minuten nichts tun, dann Tor | Gerät noch erreichbar oder klare Fehlermeldung |
| 7 | WLAN aus, mobile Daten an | Funktioniert weiter |
| 8 | Internet ganz aus | Verständliche Fehlermeldung, kein Absturz |
| 9 | Belegung exportieren, App-Daten löschen, importieren | Belegung vollständig zurück |
| 10 | Wach halten an, iPhone 15 Minuten liegen lassen (Bildschirm an), dann Tor | Tor startet ohne Fehlermeldung |
| 11 | Wach halten an, Launchpad-Bildschirm sperren, 5 Minuten warten, entsperren, Tor | Tor startet, eventuell nach „Aktualisieren“ |

### Verzögerung messen

Die Anzeige „Letzter Befehl“ zeigt nur die Antwortzeit der Spotify-Server, nicht, wann der Ton kommt. Für die echte Verzögerung:

1. iPad und Box nebeneinander stellen.
2. Mit dem iPhone ein Zeitlupenvideo aufnehmen (240 Bilder pro Sekunde).
3. Zehnmal Tor tippen, jeweils mit etwas Abstand.
4. Im Video die Bilder zwischen Fingerberührung und erstem Ton zählen. Bilder geteilt durch 240 ergibt Sekunden.

### Entscheidung: Spotify behalten oder Songs kaufen

Vorschlag für klare Kriterien, bevor du testest:

- Verzögerung Tipp bis Ton **unter einer Sekunde in mindestens 9 von 10 Versuchen**
- **Kein Aussetzer** in einem 20-Minuten-Test mit realistischer Nutzung
- Gerät bleibt **über ein ganzes Spiel erreichbar**
- Harter Stopp statt Ausblenden ist für dich **akzeptabel**, oder Aufbau C ist praktikabel

Wird ein Kriterium verfehlt, ist die Umstellung auf eigene Audiodateien der nächste Schritt.

## Checkliste Spieltag

- Akkus voll, Powerbank dabei
- Internet vor Ort geprüft, notfalls Hotspot vom Handy
- „Nicht stören“ auf allen beteiligten Geräten
- Automatische Bildschirmsperre aus
- Box verbunden, Pegel vor dem Spiel getestet
- Spotify auf dem Abspielgerät geöffnet, Gerät in der App ausgewählt, Wach halten an
- Einen Tor-Clip einmal leise probeweise abgespielt

## Projektstruktur

```
index.html              Einstieg, Content-Security-Policy
manifest.webmanifest    Metadaten für den Home-Bildschirm
css/styles.css          Gestaltung
js/main.js              Start der App
js/app.js               Oberfläche (Setup, Board, Editor, Statusleiste)
js/player.js            Wiedergabesteuerung (Start, Ausblenden, Auto-Stopp)
js/spotify.js           Spotify-API-Client mit Befehlsschlange
js/auth.js              Anmeldung per PKCE
js/store.js             Speichern, Import und Export der Belegung
js/logic.js             Reine Hilfsfunktionen
js/defaultBoard.js      Vorbelegung der Tasten
js/config.js            Konstanten
tests/                  Automatisierte Tests
docs/ARCHITEKTUR.md     Architekturübersicht und Entscheidungen
```

## Rechtlicher Hinweis

Ich bin kein Anwalt. Spotify ist nach seinen Nutzungsbedingungen für die private Nutzung lizenziert. Öffentliche Wiedergabe bei einer Veranstaltung ist davon nach meinem Verständnis nicht gedeckt, unabhängig von einer GEMA-Lizenz des Vereins. Für einen Test im kleinen Rahmen ist das eine bewusste Abwägung, für den Dauerbetrieb sind gekaufte Dateien plus GEMA-Abdeckung des Vereins der saubere Weg.
