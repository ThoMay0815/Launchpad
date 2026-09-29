/**
 * Startbelegung des Boards.
 *
 * Die Spotify-Links sind absichtlich leer. Sie werden im Bearbeitungsmodus per Link
 * oder über "Aus Spotify übernehmen" gesetzt. So landet garantiert die Version im Spiel,
 * die du gehört hast (Album, Remaster, Radio Edit und Remix haben unterschiedliche Zeiten).
 *
 * Alle Startpunkte sind Vorschläge und deshalb als ungeprüft markiert (startVerified: false).
 * Im Bearbeitungsmodus zeigt ein gelber Punkt, welche Clips noch geprüft werden müssen.
 */

const seconds = (value) => Math.round(value * 1000);

function clip(id, title, artist, preset, extra = {}) {
  const merged = { start: 0, volume: 100, note: '', ...preset, ...extra };
  return {
    id,
    title,
    artist,
    uri: '',
    startMs: seconds(merged.start),
    durationMs: seconds(merged.duration),
    fadeMs: seconds(merged.fade),
    volume: merged.volume,
    startVerified: false,
    note: merged.note,
  };
}

const TOR = { duration: 7, fade: 1.5 };
const PARADE = { duration: 5, fade: 1 };
const FAIRPLAY = { duration: 4, fade: 1, volume: 80 };
const MITMACHEN = { duration: 20, fade: 2 };
const AUSZEIT = { duration: 20, fade: 3, volume: 60 };
const EINLAUF = { duration: 0, fade: 3 };
const HALBZEIT = { duration: 0, fade: 4, volume: 70 };
const SCHLUSS = { duration: 0, fade: 4 };

/** Liefert bei jedem Aufruf ein frisches Objekt, damit niemand die Vorlage verändert. */
export function createDefaultBoard() {
  return {
    version: 1,
    categories: [
      {
        id: 'tor',
        name: 'Tor',
        clips: [
          clip('tor-zombie', 'Zombie Nation (Oh-oh-oh)', 'Kernkraft 400, Sport Support Remix', TOR, { note: 'Oh-oh-oh-Stelle setzen' }),
          clip('tor-maria', 'Maria (I Like It Loud)', 'Scooter', TOR, { start: 65, note: 'Döp-döp-Stelle, ca. 1:05 laut Vorlage' }),
          clip('tor-survive', 'I Will Survive', 'Hermes House Band', TOR, { start: 70, note: 'La-la-la-Stelle, ca. 1:10 laut Vorlage' }),
          clip('tor-alabama', 'Alabama 10 (Drop)', 'Moonlight', TOR, { note: 'Start direkt auf den Drop legen' }),
          clip('tor-attention', 'Attention', 'Blitz Union', TOR),
          clip('tor-freed', 'Freed from Desire', 'Gala', TOR, { note: 'Na-na-na-Stelle' }),
          clip('tor-dagger', 'Chelsea Dagger', 'The Fratellis', TOR),
        ],
      },
      {
        id: 'parade',
        name: 'Parade',
        clips: [
          clip('parade-air', 'In the Air Tonight', 'Phil Collins', PARADE, { start: 220, duration: 6, note: 'Drum-Fill, ca. 3:40 in der Albumversion' }),
          clip('parade-tsunami', 'Tsunami', 'DVBBS & Borgeous', PARADE, { start: 90, note: 'Drop, ca. 1:30 laut Vorlage' }),
          clip('parade-touch', "U Can't Touch This", 'MC Hammer', PARADE, { note: 'Hook setzen' }),
          clip('parade-ghost', 'Ghostbusters', 'Ray Parker Jr.', PARADE, { note: 'Who you gonna call' }),
          clip('parade-clarity', 'Clarity', 'Zedd', PARADE, { note: 'Drop setzen' }),
        ],
      },
      {
        id: 'fairplay',
        name: 'Fair-Play-Tor',
        clips: [
          clip('fair-happy', 'Happy', 'Pharrell Williams', FAIRPLAY),
          clip('fair-sunshine', 'Walking on Sunshine', 'Katrina and the Waves', FAIRPLAY),
          clip('fair-soul', 'Hey, Soul Sister', 'Train', FAIRPLAY),
        ],
      },
      {
        id: 'mitmachen',
        name: 'Mitmachen',
        clips: [
          clip('mit-rock', 'We Will Rock You', 'Queen', MITMACHEN),
          clip('mit-seven', 'Seven Nation Army', 'The White Stripes', MITMACHEN),
          clip('mit-attention', 'Attention', 'Blitz Union', MITMACHEN),
        ],
      },
      {
        id: 'auszeit',
        name: 'Auszeit',
        clips: [
          clip('aus-handclap', 'HandClap', 'Fitz and the Tantrums', AUSZEIT),
          clip('aus-song2', 'Song 2', 'Blur', AUSZEIT),
          clip('aus-whoomp', 'Whoomp! (There It Is)', 'Tag Team', AUSZEIT, { start: 15 }),
          clip('aus-ballroom', 'Ballroom Blitz', 'Sweet', AUSZEIT),
        ],
      },
      {
        id: 'einlauf',
        name: 'Einlauf',
        clips: [
          clip('ein-zombie', 'Zombie Nation (Sport Support Remix)', 'Kernkraft 400', EINLAUF),
          clip('ein-sirius', 'Sirius', 'The Alan Parsons Project', EINLAUF),
          clip('ein-thunder', 'Thunderstruck', 'AC/DC', EINLAUF),
          clip('ein-countdown', 'The Final Countdown', 'Europe', EINLAUF),
          clip('ein-alabama', 'Alabama 10 (Aufbau)', 'Moonlight', EINLAUF),
        ],
      },
      {
        id: 'halbzeit',
        name: 'Halbzeit',
        clips: [
          clip('halb-playlist', 'Halbzeit-Playlist', 'Eigene Playlist', HALBZEIT, { note: 'Link zu einer Playlist einfügen' }),
        ],
      },
      {
        id: 'schluss',
        name: 'Schlusspfiff',
        clips: [
          clip('schluss-aufuns', 'Auf uns', 'Andreas Bourani', SCHLUSS),
          clip('schluss-celebration', 'Celebration', 'Kool & The Gang', SCHLUSS),
        ],
      },
    ],
  };
}
