/**
 * Schlanker Client für die Spotify Web API (Player-Endpunkte).
 *
 * Alle Befehle laufen über eine serielle Warteschlange. Spotify garantiert laut Doku
 * keine Ausführungsreihenfolge, wenn Player-Befehle parallel eintreffen. Ohne Schlange
 * könnte z. B. "Lautstärke 0" nach "Play" des nächsten Clips ankommen.
 */

import { REQUEST_TIMEOUT_MS, SPOTIFY_API } from './config.js';

export class SpotifyError extends Error {
  constructor(message, { status = 0, reason } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
    this.reason = reason;
  }
}

/** Übersetzt Spotify-Fehler in Meldungen, mit denen man in der Halle etwas anfangen kann. */
export function describeError(status, reason, fallback) {
  if (reason === 'NO_ACTIVE_DEVICE' || status === 404) {
    return 'Spotify-Gerät nicht erreichbar. Spotify auf dem Abspielgerät öffnen und Gerät neu wählen.';
  }
  if (reason === 'PREMIUM_REQUIRED') return 'Für die Steuerung ist Spotify Premium nötig.';
  if (reason === 'VOLUME_CONTROL_DISALLOW') return 'Dieses Gerät erlaubt keine Lautstärkesteuerung.';
  if (status === 429) return 'Zu viele Anfragen an Spotify. Kurz warten und erneut tippen.';
  return `Spotify meldet einen Fehler (${status}): ${fallback}`;
}

export class SpotifyClient {
  /**
   * @param {{getAccessToken: (opts?: {forceRefresh?: boolean}) => Promise<string>}} auth
   * @param {{onLatency?: (ms: number) => void, fetchImpl?: typeof fetch}} options
   */
  constructor(auth, { onLatency = () => {}, fetchImpl } = {}) {
    this.auth = auth;
    this.onLatency = onLatency;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
    this.tail = Promise.resolve();
  }

  /** Hängt eine Aufgabe an die Schlange. Fehler einer Aufgabe blockieren die folgenden nicht. */
  enqueue(task) {
    const run = this.tail.then(() => task());
    this.tail = run.catch(() => {});
    return run;
  }

  request(method, path, options = {}) {
    return this.enqueue(() => this.send(method, path, options));
  }

  async send(method, path, { query, body } = {}, isRetry = false) {
    const url = new URL(`${SPOTIFY_API}${path}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    const token = await this.auth.getAccessToken({ forceRefresh: isRetry });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = performance.now();
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new SpotifyError('Keine Verbindung zu Spotify. Internet prüfen.', { status: 0 });
    } finally {
      clearTimeout(timeout);
    }
    this.onLatency(Math.round(performance.now() - started));

    // Abgelaufenes Token: einmal erneuern und wiederholen.
    if (response.status === 401 && !isRetry) return this.send(method, path, { query, body }, true);
    if (response.status === 204 || response.status === 202) return null;

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const reason = data?.error?.reason;
      const fallback = data?.error?.message || response.statusText || 'unbekannt';
      throw new SpotifyError(describeError(response.status, reason, fallback), { status: response.status, reason });
    }
    return data;
  }

  async getDevices() {
    const data = await this.request('GET', '/me/player/devices');
    return data?.devices ?? [];
  }

  /** Aktueller Wiedergabezustand oder null, wenn nichts aktiv ist. */
  getPlayback() {
    return this.request('GET', '/me/player');
  }

  play(deviceId, body) {
    return this.request('PUT', '/me/player/play', { query: { device_id: deviceId }, body });
  }

  pause(deviceId) {
    return this.request('PUT', '/me/player/pause', { query: { device_id: deviceId } });
  }

  setVolume(deviceId, volumePercent) {
    return this.request('PUT', '/me/player/volume', {
      query: { volume_percent: volumePercent, device_id: deviceId },
    });
  }
}
