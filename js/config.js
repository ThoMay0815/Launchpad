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
