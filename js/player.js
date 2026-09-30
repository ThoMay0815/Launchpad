/**
 * PlaybackController: kennt genau einen laufenden Clip und steuert Start, Ausblenden und Stopp.
 *
 * Kernidee gegen Wettlaufsituationen: Jede neue Aktion zieht ein neues "token".
 * Laufende Abläufe (Ausblenden, Auto-Stopp, Polling) prüfen vor jedem Schritt, ob ihr
 * token noch aktuell ist, und brechen sonst still ab. Dadurch kann ein Tor-Clip jederzeit
 * einen gerade ausblendenden Einlauf-Clip ablösen, ohne dass danach noch ein "Pause" kommt.
 *
 * Wach halten: iOS legt die Spotify-App im Hintergrund schlafen, sobald keine Musik läuft.
 * Dann verschwindet sie als Spotify-Gerät. Ist ein Stille-Track hinterlegt, spielt der
 * Controller im Leerlauf diesen Track statt zu pausieren. Ein Wächter startet ihn neu,
 * falls er endet oder jemand pausiert.
 *
 * Das Modul hängt nur an einem Client-Objekt mit play, pause, setVolume und getPlayback.
 * Eine spätere Engine für lokale Audiodateien kann dieselbe Schnittstelle bedienen.
 */

import { FADE_STEPS, IDLE_CHECK_MS, IDLE_RESTART_MARGIN_MS, POLL_INTERVAL_MS } from './config.js';
import { buildFadeSteps, buildPlayBody, clampVolume, idleAction, scaledVolume, stopDelayMs } from './logic.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {{id: string, name: string, supportsVolume: boolean, volume: number | null}} Device
 * @typedef {'idle' | 'starting' | 'playing' | 'fading'} Phase
 */

export class PlaybackController extends EventTarget {
  /**
   * @param {object} client Objekt mit play, pause, setVolume, getPlayback
   * @param {object} options
   * @param {() => Device | null} options.getDevice
   * @param {() => number} options.getMasterVolume
   * @param {() => string | null} [options.getIdleUri] Stille-Track oder null, wenn Wach halten aus ist
   * @param {() => boolean} [options.isEditing] true im Bearbeitungsmodus, dann bleibt ein fremder Song stehen
   * @param {(d: Device) => void} [options.onVolumeUnsupported]
   */
  constructor(
    client,
    {
      getDevice,
      getMasterVolume,
      getIdleUri = () => null,
      isEditing = () => false,
      onVolumeUnsupported = () => {},
      pollIntervalMs = POLL_INTERVAL_MS,
      idleCheckMs = IDLE_CHECK_MS,
    },
  ) {
    super();
    this.client = client;
    this.getDevice = getDevice;
    this.getMasterVolume = getMasterVolume;
    this.getIdleUri = getIdleUri;
    this.isEditing = isEditing;
    this.onVolumeUnsupported = onVolumeUnsupported;
    this.pollIntervalMs = pollIntervalMs;
    this.idleCheckMs = idleCheckMs;
    this.idleTimer = null;

    this.token = 0;
    /** @type {Phase} */
    this.phase = 'idle';
    this.current = null;
    /** Zuletzt gesetzte Gerätelautstärke. null bedeutet unbekannt. */
    this.deviceVolume = null;
    this.autoStopTimer = null;
    this.pollTimer = null;
  }

  snapshot() {
    return { phase: this.phase, current: this.current };
  }

  /** true, solange der Clip startet, läuft oder ausblendet. */
  isActive(clipId) {
    return this.phase !== 'idle' && this.current?.clip.id === clipId;
  }

  setDevice(device) {
    this.deviceVolume = device?.supportsVolume && Number.isFinite(device.volume) ? clampVolume(device.volume) : null;
  }

  /**
   * Verhalten einer Taste: startet den Clip, beim zweiten Tippen wird ausgeblendet,
   * beim dritten Tippen (während des Ausblendens) sofort gestoppt.
   */
  toggle(categoryId, clip) {
    if (this.isActive(clip.id)) {
      return this.stop({ fade: this.phase !== 'fading' });
    }
    return this.play(categoryId, clip);
  }

  async play(categoryId, clip) {
    const device = this.requireDevice();
    const token = this.nextToken();
    this.current = { categoryId, clip, startedAt: performance.now() };
    this.setPhase('starting');

    try {
      await this.applyVolume(device, scaledVolume(clip.volume, this.getMasterVolume()));
      if (token !== this.token) return;
      await this.client.play(device.id, buildPlayBody(clip));
    } catch (err) {
      if (token === this.token) this.reset();
      throw err;
    }
    if (token !== this.token) return;

    this.current.startedAt = performance.now();
    this.setPhase('playing');

    const delay = stopDelayMs(clip);
    if (delay === null) {
      this.startPolling(token);
    } else {
      this.autoStopTimer = setTimeout(() => {
        if (token === this.token) this.stop().catch((err) => this.fail(err));
      }, delay);
    }
  }

  /**
   * @param {{fade?: boolean, keepAlive?: boolean}} options
   *   keepAlive false erzwingt eine echte Pause, z. B. beim Abmelden.
   */
  async stop({ fade = true, keepAlive = true } = {}) {
    const device = this.getDevice();
    const token = this.nextToken();
    const clip = this.current?.clip;

    if (clip) this.setPhase('fading');

    const canFade = fade && clip && device?.supportsVolume && clip.fadeMs > 0 && this.deviceVolume > 0;
    if (canFade) {
      for (const step of buildFadeSteps(this.deviceVolume, clip.fadeMs, FADE_STEPS)) {
        if (token !== this.token) return;
        const stepStarted = performance.now();
        let applied = false;
        try {
          applied = await this.applyVolume(device, step.volume);
        } catch {
          // Klappt ein Lautstärkeschritt nicht, wird nicht weiter geblendet, sondern direkt pausiert.
          applied = false;
        }
        if (!applied) break;
        await sleep(Math.max(0, step.delayMs - (performance.now() - stepStarted)));
      }
    }
    if (token !== this.token) return;

    const idleUri = keepAlive ? this.getIdleUri() : null;
    if (device) {
      try {
        // Mit Wach halten läuft statt Pause der Stille-Track weiter. Hörbar ist das wie ein Stopp.
        if (idleUri) await this.client.play(device.id, { uris: [idleUri], position_ms: 0 });
        else await this.client.pause(device.id);
      } catch (err) {
        // 403 heißt beim Pausieren meist "war schon pausiert". Das ist für einen Stopp kein Fehler.
        if (idleUri || err.status !== 403) {
          if (token === this.token) this.reset();
          throw err;
        }
      }
    }
    if (token !== this.token) return;
    this.reset();

    // Lautstärke zurücksetzen, solange Stille ist. So startet der nächste Clip ohne Zusatzbefehl.
    if (device?.supportsVolume && canFade) {
      this.applyVolume(device, clampVolume(this.getMasterVolume())).catch(() => {});
    }
  }

  // Interne Helfer

  requireDevice() {
    const device = this.getDevice();
    if (!device) throw new Error('Kein Wiedergabegerät gewählt.');
    return device;
  }

  nextToken() {
    this.token += 1;
    this.clearTimers();
    return this.token;
  }

  clearTimers() {
    clearTimeout(this.autoStopTimer);
    clearInterval(this.pollTimer);
    this.autoStopTimer = null;
    this.pollTimer = null;
  }

  reset() {
    this.clearTimers();
    this.current = null;
    this.setPhase('idle');
  }

  setPhase(phase) {
    this.phase = phase;
    this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
  }

  fail(err) {
    this.dispatchEvent(new CustomEvent('error', { detail: err }));
  }

  /**
   * Setzt die Gerätelautstärke, falls das Gerät es erlaubt.
   * @returns {Promise<boolean>} false, wenn Lautstärke nicht steuerbar ist
   */
  async applyVolume(device, volume) {
    if (!device.supportsVolume) return false;
    if (this.deviceVolume === volume) return true;
    try {
      await this.client.setVolume(device.id, volume);
      this.deviceVolume = volume;
      return true;
    } catch (err) {
      if (err.reason === 'VOLUME_CONTROL_DISALLOW') {
        device.supportsVolume = false;
        this.deviceVolume = null;
        this.onVolumeUnsupported(device);
        return false;
      }
      throw err;
    }
  }

  /** Bei Clips ohne feste Dauer erkennen, ob Spotify inzwischen pausiert hat oder der Song zu Ende ist. */
  startPolling(token) {
    this.pollTimer = setInterval(async () => {
      if (token !== this.token) return;
      try {
        const state = await this.client.getPlayback();
        if (token === this.token && (!state || !state.is_playing)) {
          this.reset();
          this.checkIdle().catch(() => {});
        }
      } catch {
        // Polling ist Komfort. Fehler hier stören das Spiel nicht und werden nicht gemeldet.
      }
    }, this.pollIntervalMs);
  }

  // Wach halten

  /** Startet den Wächter. Er fragt nur, wenn Wach halten aktiv ist und kein Clip läuft. */
  startIdleWatch() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      this.checkIdle().catch(() => {
        // Wächterfehler nicht melden. Der nächste Tastendruck zeigt ein echtes Problem ohnehin an.
      });
    }, this.idleCheckMs);
  }

  stopIdleWatch() {
    clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  /**
   * Prüft im Leerlauf, ob der Stille-Track läuft, und startet ihn bei Bedarf.
   * Tippt jemand während der Abfrage eine Taste, gewinnt die Taste.
   */
  async checkIdle() {
    const idleUri = this.getIdleUri();
    const device = this.getDevice();
    if (!idleUri || !device || this.phase !== 'idle') return;
    const token = this.token;
    const state = await this.client.getPlayback();
    if (token !== this.token || this.phase !== 'idle') return;
    if (idleAction(state, idleUri, IDLE_RESTART_MARGIN_MS, { keepForeign: this.isEditing() }) === 'start') {
      await this.client.play(device.id, { uris: [idleUri], position_ms: 0 });
    }
  }

  /**
   * Startet die Stille sofort, ohne vorher nachzufragen.
   * Gedacht für den Moment direkt nach "Aus Spotify übernehmen": Die Position ist gesichert,
   * der pausierte Song wird nicht mehr gebraucht, und Spotify soll nicht einschlafen.
   */
  async resumeIdle() {
    const idleUri = this.getIdleUri();
    const device = this.getDevice();
    if (!idleUri || !device || this.phase !== 'idle') return;
    await this.client.play(device.id, { uris: [idleUri], position_ms: 0 });
  }
}
