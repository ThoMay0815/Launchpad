/**
 * Zentrale Konstanten des Handball Launchpads.
 * Keine Logik, keine Browser-Abhängigkeiten, damit das Modul auch in Node-Tests ladbar ist.
 */

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API = 'https://api.spotify.com/v1';

/** Nur die Rechte, die das Launchpad wirklich braucht: Geräte lesen, Wiedergabe steuern. */
export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];

export const STORAGE_KEYS = Object.freeze({
  clientId: 'hlp.clientId',
  tokens: 'hlp.tokens',
  pkce: 'hlp.pkce',
  board: 'hlp.board',
  settings: 'hlp.settings',
});

/** Anzahl Lautstärkeschritte beim Ausblenden. Mehr Schritte klingen weicher, kosten aber API-Aufrufe. */
export const FADE_STEPS = 6;

/** Abgleich mit Spotify bei Clips ohne feste Dauer (z. B. Einlauf), um ein Songende zu erkennen. */
export const POLL_INTERVAL_MS = 10_000;

/** Nach dieser Zeit gilt eine Spotify-Anfrage als gescheitert. */
export const REQUEST_TIMEOUT_MS = 8_000;

/** So lange muss "Bearbeiten" gedrückt werden, damit im Spiel nichts versehentlich verstellt wird. */
export const LONG_PRESS_MS = 800;

/** Kurze Pause vor dem einmaligen Wiederholen bei Serverfehlern (500, 502, 503, 504). */
export const SERVER_RETRY_DELAY_MS = 300;

/** Wach-halten: so oft prüft das Launchpad im Leerlauf, ob der Stille-Track noch läuft. */
export const IDLE_CHECK_MS = 20_000;

/** Wach-halten: Stille-Track neu starten, wenn weniger als diese Restzeit übrig ist. */
export const IDLE_RESTART_MARGIN_MS = 90_000;

/** "Ende vorhören" spielt diese Zeitspanne vor dem Endpunkt. */
export const END_PREVIEW_MS = 3_000;
