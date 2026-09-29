/**
 * Spotify-Anmeldung per Authorization Code Flow mit PKCE.
 * PKCE braucht kein Client Secret, deshalb ist dieser Ablauf für eine reine Web-App geeignet.
 * Tokens liegen im localStorage des Geräts und verlassen es nur Richtung Spotify.
 */

import { SCOPES, SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, STORAGE_KEYS } from './config.js';

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length) {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => VERIFIER_CHARS[value % VERIFIER_CHARS.length]).join('');
}

function base64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Die Adresse, unter der die App läuft. Genau diese muss im Spotify Dashboard stehen. */
export function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export class SpotifyAuth {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.refreshing = null;
  }

  get clientId() {
    return this.storage.getItem(STORAGE_KEYS.clientId) || '';
  }

  set clientId(value) {
    this.storage.setItem(STORAGE_KEYS.clientId, String(value).trim());
  }

  get tokens() {
    try {
      return JSON.parse(this.storage.getItem(STORAGE_KEYS.tokens));
    } catch {
      return null;
    }
  }

  isLoggedIn() {
    return Boolean(this.tokens?.refreshToken);
  }

  /** Leitet zu Spotify weiter. Die Seite wird dabei verlassen. */
  async login() {
    if (!this.clientId) throw new AuthError('Bitte zuerst die Client ID eintragen.', 'missing_client_id');
    const verifier = randomString(64);
    const state = randomString(16);
    this.storage.setItem(STORAGE_KEYS.pkce, JSON.stringify({ verifier, state }));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: SCOPES.join(' '),
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(verifier),
      state,
    });
    window.location.assign(`${SPOTIFY_AUTH_URL}?${params}`);
  }

  /**
   * Verarbeitet die Rückkehr von Spotify (?code=... oder ?error=...).
   * @returns {Promise<boolean>} true, wenn eine Anmeldung abgeschlossen wurde
   */
  async handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (!code && !error) return false;

    // Code sofort aus der Adresszeile entfernen, damit er nicht in Lesezeichen oder im Verlauf landet.
    window.history.replaceState(null, '', redirectUri());
    let pending = null;
    try {
      pending = JSON.parse(this.storage.getItem(STORAGE_KEYS.pkce));
    } catch {
      pending = null;
    }
    this.storage.removeItem(STORAGE_KEYS.pkce);

    if (error) throw new AuthError(`Spotify-Anmeldung abgebrochen (${error}).`, error);
    if (!pending || pending.state !== params.get('state')) {
      throw new AuthError('Anmeldung konnte nicht zugeordnet werden. Bitte erneut verbinden.', 'state_mismatch');
    }
    const data = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: this.clientId,
      code_verifier: pending.verifier,
    });
    this.saveTokens(data);
    return true;
  }

  /**
   * Gültiges Access Token, bei Bedarf automatisch erneuert.
   * Parallele Aufrufe teilen sich eine einzige Erneuerung.
   */
  async getAccessToken({ forceRefresh = false } = {}) {
    const tokens = this.tokens;
    if (!tokens?.refreshToken) throw new AuthError('Nicht mit Spotify verbunden.', 'not_logged_in');
    if (!forceRefresh && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;

    if (!this.refreshing) {
      this.refreshing = this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: this.clientId,
      })
        .then((data) => {
          this.saveTokens(data);
          return data.access_token;
        })
        .catch((err) => {
          // invalid_grant heißt: Refresh Token abgelaufen oder widerrufen. Neu anmelden ist nötig.
          if (err.code === 'invalid_grant') this.logout();
          throw err;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  logout() {
    this.storage.removeItem(STORAGE_KEYS.tokens);
  }

  saveTokens(data) {
    const previous = this.tokens;
    const tokens = {
      accessToken: data.access_token,
      // Spotify liefert nicht bei jeder Erneuerung ein neues Refresh Token. Dann das alte behalten.
      refreshToken: data.refresh_token || previous?.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    this.storage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
  }

  async tokenRequest(fields) {
    let response;
    try {
      response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    } catch {
      throw new AuthError('Spotify ist nicht erreichbar. Internetverbindung prüfen.', 'network');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.error_description || data.error || response.status;
      throw new AuthError(`Spotify-Anmeldung fehlgeschlagen: ${detail}`, data.error);
    }
    return data;
  }
}
