/**
 * Präsentationsschicht: baut die Oberfläche und verbindet sie mit Auth, Client und PlaybackController.
 * Nutzerinhalte (Titel, Notizen) werden nur als textContent gesetzt, nie als HTML.
 */

import { END_PREVIEW_MS, LONG_PRESS_MS } from './config.js';
import { AuthError, SpotifyAuth, redirectUri } from './auth.js';
import { SpotifyClient } from './spotify.js';
import { PlaybackController } from './player.js';
import * as store from './store.js';
import {
  clampVolume,
  durationFromEnd,
  formatSeconds,
  formatTime,
  makeId,
  nextRotationIndex,
  parseSpotifyLink,
  parseTime,
} from './logic.js';

/** Kleiner DOM-Baukasten. "onClick" wird zu addEventListener('click'). */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export class App {
  constructor(root, toastRoot) {
    this.root = root;
    this.toastRoot = toastRoot;
    this.auth = new SpotifyAuth();
    this.client = new SpotifyClient(this.auth, { onLatency: (ms) => this.showLatency(ms) });
    this.board = store.loadBoard();
    this.settings = store.loadSettings();
    this.devices = [];
    this.device = null;
    this.editMode = false;
    this.lastLatency = null;
    this.tiles = new Map();
    this.rafId = null;
    this.lastDeviceRefresh = 0;

    this.controller = new PlaybackController(this.client, {
      getDevice: () => this.device,
      getMasterVolume: () => this.settings.masterVolume,
      // Im Bearbeitungsmodus bleibt Wach halten aus, damit Stille nicht dein manuelles Suchen in Spotify überschreibt.
      getIdleUri: () => (this.settings.keepAlive && !this.editMode && this.settings.idleUri) || null,
      onVolumeUnsupported: () => {
        this.toast('Dieses Gerät erlaubt keine Lautstärkesteuerung. Clips stoppen deshalb ohne Ausblenden.');
        this.renderStatus();
      },
    });
    this.controller.addEventListener('change', () => this.updatePlayState());
    this.controller.addEventListener('error', (event) => this.handleError(event.detail));
  }

  async start() {
    try {
      await this.auth.handleRedirect();
    } catch (err) {
      this.toast(err.message, 'error');
    }
    if (!this.auth.isLoggedIn()) {
      this.renderSetup();
      return;
    }
    this.renderApp();
    this.installLifecycleHooks();
    await this.refreshDevices();
    this.controller.startIdleWatch();
    this.controller.checkIdle().catch(() => {});
  }

  // Einrichtung

  renderSetup() {
    const uri = redirectUri();
    const input = el('input', {
      id: 'client-id',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      value: this.auth.clientId,
    });
    const connect = async () => {
      this.auth.clientId = input.value;
      try {
        await this.auth.login();
      } catch (err) {
        this.toast(err.message, 'error');
      }
    };
    this.root.replaceChildren(
      el('section', { class: 'setup' }, [
        el('h1', { text: 'Handball Launchpad' }),
        el('p', { text: 'Einmalig mit deinem Spotify-Konto verbinden. Die ausführliche Anleitung steht in der README.' }),
        el('ol', { class: 'setup__steps' }, [
          el('li', {}, [
            'Im Spotify Developer Dashboard eine App anlegen und genau diese Adresse als Redirect URI eintragen:',
            el('code', { class: 'setup__uri', text: uri }),
            el('button', { type: 'button', class: 'button', text: 'Adresse kopieren', onClick: () => this.copy(uri) }),
          ]),
          el('li', {}, [el('label', { for: 'client-id', text: 'Client ID der App einfügen' }), input]),
          el('li', {}, [el('button', { type: 'button', class: 'button button--primary', text: 'Mit Spotify verbinden', onClick: connect })]),
        ]),
      ]),
    );
  }

  // Hauptansicht

  renderApp() {
    this.statusBar = el('header', { class: 'topbar' });
    this.boardEl = el('div', { class: 'board' });
    this.root.replaceChildren(this.statusBar, this.boardEl);
    this.renderStatus();
    this.renderBoard();
  }

  renderStatus() {
    if (!this.statusBar) return;
    const select = el(
      'select',
      { class: 'topbar__device', 'aria-label': 'Wiedergabegerät', onChange: (event) => this.selectDevice(event.target.value) },
      [
        el('option', { value: '', text: this.devices.length ? 'Gerät wählen' : 'Kein Gerät gefunden' }),
        ...this.devices.map((device) =>
          el('option', { value: device.id, selected: device.id === this.device?.id, text: `${device.name} (${device.type})` }),
        ),
      ],
    );

    let hint = 'Spotify auf dem Abspielgerät öffnen, dann aktualisieren';
    if (this.device) {
      hint = this.device.supportsVolume ? 'Ausblenden aktiv' : 'Kein Ausblenden möglich, Stopp ist hart';
      hint += this.settings.keepAlive && this.settings.idleUri ? '. Wach halten an' : '. Wach halten aus';
    }

    const master = this.device?.supportsVolume
      ? el('label', { class: 'topbar__master' }, [
          'Lautstärke',
          el('input', {
            type: 'range',
            min: '0',
            max: '100',
            value: String(this.settings.masterVolume),
            onChange: (event) => {
              this.settings.masterVolume = clampVolume(event.target.value);
              store.saveSettings(this.settings);
            },
          }),
        ])
      : null;

    this.latencyEl = el('span', { class: 'topbar__latency', text: this.latencyText() });

    const editButton = el('button', {
      type: 'button',
      class: this.editMode ? 'button button--active' : 'button',
      'aria-pressed': String(this.editMode),
      text: this.editMode ? 'Bearbeiten beenden' : 'Bearbeiten (halten)',
    });
    this.bindEditButton(editButton);

    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', onChange: (event) => this.importBoard(event) });
    const menu = el('details', { class: 'menu' }, [
      el('summary', { class: 'button', text: 'Mehr' }),
      el('div', { class: 'menu__panel' }, [
        el('button', {
          type: 'button',
          class: 'button',
          text: this.settings.keepAlive ? 'Wach halten ausschalten' : 'Wach halten einschalten',
          onClick: () => this.toggleKeepAlive(),
        }),
        el('button', { type: 'button', class: 'button', text: 'Stille-Track festlegen', onClick: () => this.chooseIdleTrack() }),
        el('button', { type: 'button', class: 'button', text: 'Belegung exportieren', onClick: () => this.exportBoard() }),
        el('button', { type: 'button', class: 'button', text: 'Belegung importieren', onClick: () => fileInput.click() }),
        el('button', { type: 'button', class: 'button', text: 'Von Spotify abmelden', onClick: () => this.logout() }),
        fileInput,
      ]),
    ]);

    const items = [
      el('div', { class: 'topbar__group' }, [
        select,
        el('button', { type: 'button', class: 'button', text: 'Aktualisieren', onClick: () => this.refreshDevices() }),
        // Öffnet die Spotify-App. Nach der Rückkehr lädt das Launchpad die Geräte automatisch neu.
        el('a', { class: 'button', href: 'spotify:', text: 'Spotify öffnen' }),
      ]),
      el('span', { class: 'topbar__hint', text: hint }),
      master,
      this.latencyEl,
      editButton,
      menu,
      el('button', { type: 'button', class: 'button button--stop', text: 'Alles aus', onClick: () => this.run(() => this.controller.stop()) }),
    ];
    // replaceChildren würde null als Text "null" einfügen, deshalb leere Einträge vorher entfernen.
    this.statusBar.replaceChildren(...items.filter(Boolean));
  }

  bindEditButton(button) {
    if (this.editMode) {
      button.addEventListener('click', () => this.setEditMode(false));
      return;
    }
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      button.classList.remove('is-holding');
    };
    button.addEventListener('pointerdown', () => {
      button.classList.add('is-holding');
      timer = setTimeout(() => {
        cancel();
        this.setEditMode(true);
      }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, cancel));
    button.addEventListener('click', () => {
      if (!this.editMode) this.toast('Zum Bearbeiten den Knopf gedrückt halten.');
    });
  }

  setEditMode(on) {
    this.editMode = on;
    this.renderStatus();
    this.renderBoard();
    if (!on) this.controller.checkIdle().catch(() => {});
  }

  // Wach halten

  async toggleKeepAlive() {
    if (!this.settings.keepAlive && !this.settings.idleUri) {
      const chosen = this.chooseIdleTrack();
      if (!chosen) return;
    }
    this.settings.keepAlive = !this.settings.keepAlive;
    store.saveSettings(this.settings);
    this.renderStatus();
    if (this.settings.keepAlive) {
      this.toast('Wach halten ist an. Im Leerlauf läuft der Stille-Track.');
      this.controller.checkIdle().catch((err) => this.handleError(err));
    } else {
      this.toast('Wach halten ist aus.');
      // Nur die Stille beenden. Ein gerade laufender Clip bleibt unangetastet.
      if (this.controller.phase === 'idle') this.run(() => this.controller.stop({ fade: false, keepAlive: false }));
    }
  }

  /** Fragt den Link zum Stille-Track ab. @returns {boolean} true, wenn ein gültiger Track gesetzt wurde */
  chooseIdleTrack() {
    const input = window.prompt(
      'Spotify-Link zu einem stillen Track (mindestens 5, besser 60 Minuten Stille). In Spotify: Song, Teilen, Link kopieren.',
      this.settings.idleUri || '',
    );
    if (input === null) return false;
    const link = parseSpotifyLink(input);
    if (!link || link.type !== 'track') {
      this.toast('Das ist kein gültiger Spotify-Link zu einem einzelnen Song.', 'error');
      return false;
    }
    this.settings.idleUri = link.uri;
    store.saveSettings(this.settings);
    this.toast('Stille-Track gespeichert.');
    this.renderStatus();
    return true;
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.tiles.clear();
    this.boardEl.classList.toggle('board--editing', this.editMode);
    this.boardEl.replaceChildren(...this.board.categories.map((category) => this.renderTile(category)));
    this.updatePlayState();
  }

  renderTile(category) {
    const line = el('span', { class: 'tile__line' });
    const time = el('span', { class: 'tile__time' });
    const bar = el('span', { class: 'tile__bar' });
    const main = el('button', { type: 'button', class: 'tile__main', onClick: () => this.onTileTap(category) }, [
      el('span', { class: 'tile__name', text: category.name }),
      el('span', { class: 'tile__meta' }, [line, time]),
      el('span', { class: 'tile__progress', 'aria-hidden': 'true' }, [bar]),
    ]);

    const chips = el('div', { class: 'tile__chips' }, [
      ...category.clips.map((clip, index) => {
        const classes = ['chip'];
        if (!clip.uri) classes.push('chip--missing');
        if (!clip.startVerified) classes.push('chip--unverified');
        return el('button', {
          type: 'button',
          class: classes.join(' '),
          dataset: { clipId: clip.id },
          title: clip.artist ? `${clip.title}, ${clip.artist}` : clip.title,
          text: clip.title,
          onClick: () => this.onChipTap(category, clip, index),
        });
      }),
      this.editMode
        ? el('button', { type: 'button', class: 'chip chip--add', text: 'Clip hinzufügen', onClick: () => this.openEditor(category, null) })
        : null,
    ]);

    const tile = el('section', { class: `tile tile--${category.id}`, 'aria-label': category.name }, [
      el('div', { class: 'tile__inner' }, [main, chips]),
    ]);
    this.tiles.set(category.id, { tile, chips, line, time, bar });
    return tile;
  }

  // Bedienung

  onTileTap(category) {
    if (this.editMode) {
      this.toast('Im Bearbeitungsmodus einen Clip antippen, um ihn zu ändern.');
      return;
    }
    const { current, phase } = this.controller.snapshot();
    if (current?.categoryId === category.id && phase !== 'idle') {
      this.run(() => this.controller.stop({ fade: phase !== 'fading' }));
      return;
    }
    const index = nextRotationIndex(category.clips, this.settings.rotation[category.id] ?? -1);
    if (index === -1) {
      this.toast(`In „${category.name}“ hat noch kein Clip einen Spotify-Link.`, 'error');
      return;
    }
    this.rememberRotation(category.id, index);
    this.run(() => this.controller.play(category.id, category.clips[index]));
  }

  onChipTap(category, clip, index) {
    if (this.editMode) {
      this.openEditor(category, clip);
      return;
    }
    if (!clip.uri) {
      this.toast(`„${clip.title}“ hat noch keinen Spotify-Link. Im Bearbeitungsmodus ergänzen.`, 'error');
      return;
    }
    if (!this.controller.isActive(clip.id)) this.rememberRotation(category.id, index);
    this.run(() => this.controller.toggle(category.id, clip));
  }

  rememberRotation(categoryId, index) {
    this.settings.rotation[categoryId] = index;
    store.saveSettings(this.settings);
  }

  async run(task) {
    if (!this.device) {
      this.toast('Erst oben ein Wiedergabegerät wählen.', 'error');
      return;
    }
    try {
      await task();
    } catch (err) {
      this.handleError(err);
    }
  }

  handleError(err) {
    if (err instanceof AuthError && ['not_logged_in', 'invalid_grant'].includes(err.code)) {
      this.toast('Die Spotify-Verbindung ist abgelaufen. Bitte neu verbinden.', 'error');
      this.renderSetup();
      return;
    }
    this.toast(err.message || 'Unbekannter Fehler', 'error');
    if (err.status === 404) this.refreshDevices();
  }

  // Wiedergabeanzeige

  updatePlayState() {
    const { current, phase } = this.controller.snapshot();
    for (const category of this.board.categories) {
      const parts = this.tiles.get(category.id);
      if (!parts) continue;
      const active = phase !== 'idle' && current?.categoryId === category.id;
      parts.tile.classList.toggle('is-playing', active);
      parts.tile.classList.toggle('is-fading', active && phase === 'fading');
      parts.line.textContent = active ? this.activeLabel(phase, current.clip) : this.nextLabel(category);
      if (!active) {
        parts.time.textContent = '';
        parts.bar.style.transform = 'scaleX(0)';
      }
      parts.chips.querySelectorAll('.chip[data-clip-id]').forEach((chip) => {
        chip.classList.toggle('is-playing', active && chip.dataset.clipId === current.clip.id);
      });
    }
    if (phase === 'playing' || phase === 'fading') this.startProgressLoop();
  }

  activeLabel(phase, clip) {
    if (phase === 'starting') return `Startet: ${clip.title}`;
    if (phase === 'fading') return 'Blendet aus. Nochmal tippen stoppt sofort.';
    return `Läuft: ${clip.title}`;
  }

  nextLabel(category) {
    const index = nextRotationIndex(category.clips, this.settings.rotation[category.id] ?? -1);
    return index === -1 ? 'Noch kein Clip mit Link' : `Als Nächstes: ${category.clips[index].title}`;
  }

  startProgressLoop() {
    if (this.rafId) return;
    const tick = () => {
      const { current, phase } = this.controller.snapshot();
      if (!current || phase === 'idle') {
        this.rafId = null;
        return;
      }
      const parts = this.tiles.get(current.categoryId);
      if (parts) {
        const elapsed = performance.now() - current.startedAt;
        const total = current.clip.durationMs;
        parts.bar.style.transform = total > 0 ? `scaleX(${Math.min(1, elapsed / total)})` : 'scaleX(1)';
        parts.time.textContent = formatTime(elapsed);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // Geräte

  async refreshDevices() {
    this.lastDeviceRefresh = Date.now();
    try {
      const list = await this.client.getDevices();
      this.devices = list
        .filter((device) => !device.is_restricted)
        .map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
          supportsVolume: Boolean(device.supports_volume),
          volume: device.volume_percent,
          isActive: device.is_active,
        }));
      const preferred =
        this.devices.find((device) => device.id === this.settings.deviceId) ||
        this.devices.find((device) => device.isActive) ||
        null;
      this.applyDevice(preferred);
    } catch (err) {
      this.handleError(err);
    }
    this.renderStatus();
  }

  selectDevice(id) {
    this.applyDevice(this.devices.find((device) => device.id === id) || null);
    this.renderStatus();
  }

  applyDevice(device) {
    this.device = device;
    this.controller.setDevice(device);
    if (device) {
      this.settings.deviceId = device.id;
      store.saveSettings(this.settings);
    }
  }

  // Clip-Editor

  openEditor(category, clip) {
    const isNew = !clip;
    const template = category.clips[0];
    const draft = clip
      ? { ...clip }
      : {
          id: makeId('clip'),
          title: '',
          artist: '',
          uri: '',
          startMs: 0,
          durationMs: template?.durationMs ?? 7000,
          fadeMs: template?.fadeMs ?? 1500,
          volume: template?.volume ?? 100,
          startVerified: false,
          note: '',
        };

    const field = (label, input, hint, wide = false) =>
      el('label', { class: wide ? 'field field--wide' : 'field' }, [
        el('span', { class: 'field__label', text: label }),
        input,
        hint ? el('span', { class: 'field__hint', text: hint }) : null,
      ]);
    const textInput = (value, extra = {}) => el('input', { type: 'text', value, autocomplete: 'off', ...extra });

    const inputs = {
      title: textInput(draft.title),
      artist: textInput(draft.artist),
      uri: textInput(draft.uri, { autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' }),
      start: textInput(formatTime(draft.startMs), { inputmode: 'decimal' }),
      end: textInput(draft.durationMs > 0 ? formatTime(draft.startMs + draft.durationMs) : '', { inputmode: 'decimal' }),
      fade: textInput(formatSeconds(draft.fadeMs), { inputmode: 'decimal' }),
      volume: el('input', { type: 'number', min: '0', max: '100', step: '5', value: String(draft.volume) }),
      verified: el('input', { type: 'checkbox', checked: draft.startVerified }),
      note: textInput(draft.note || ''),
    };
    const errorEl = el('p', { class: 'editor__error', role: 'alert' });
    const durationHint = el('span', { class: 'field__hint' });

    /** Zeigt die aus Start und Ende berechnete Dauer, damit man den Schnitt im Blick hat. */
    const updateDurationHint = () => {
      const startMs = parseTime(inputs.start.value);
      const result = startMs === null ? { error: 'Start prüfen.' } : durationFromEnd(startMs, inputs.end.value);
      if (result.error) durationHint.textContent = result.error;
      else if (result.durationMs === 0) durationHint.textContent = 'Kein Ende gesetzt: läuft, bis du stoppst.';
      else durationHint.textContent = `Dauer: ${formatSeconds(result.durationMs)} Sekunden`;
    };
    inputs.start.addEventListener('input', updateDurationHint);
    inputs.end.addEventListener('input', updateDurationHint);

    /** Liest das Formular. Wirft mit lesbarer Meldung, wenn etwas nicht passt. */
    const readForm = () => {
      const title = inputs.title.value.trim();
      if (!title) throw new Error('Bitte einen Titel eintragen.');
      const uriText = inputs.uri.value.trim();
      const link = uriText ? parseSpotifyLink(uriText) : null;
      if (uriText && !link) {
        throw new Error('Link nicht erkannt. In Spotify "Teilen, Link kopieren" nutzen. Kurzlinks (spotify.link) erst im Browser öffnen und die volle Adresse kopieren.');
      }
      const startMs = parseTime(inputs.start.value);
      const fadeMs = parseTime(inputs.fade.value);
      if (startMs === null) throw new Error('Start bitte als m:ss angeben, z. B. 1:05 oder 1:05,5.');
      const end = durationFromEnd(startMs, inputs.end.value);
      if (end.error) throw new Error(end.error);
      const { durationMs } = end;
      if (fadeMs === null) throw new Error('Ausblenden bitte in Sekunden angeben.');
      return {
        ...draft,
        title,
        artist: inputs.artist.value.trim(),
        uri: link ? link.uri : '',
        startMs,
        durationMs,
        fadeMs,
        volume: clampVolume(inputs.volume.value),
        startVerified: inputs.verified.checked,
        note: inputs.note.value.trim(),
      };
    };

    /** Verschiebt Start oder Ende um deltaMs. Ein leeres Ende startet beim Startpunkt. */
    const nudge = (input, deltaMs) => {
      const base = parseTime(input.value) ?? parseTime(inputs.start.value) ?? 0;
      input.value = formatTime(Math.max(0, base + deltaMs));
      updateDurationHint();
    };

    /**
     * Übernimmt die aktuelle Spotify-Position.
     * target "start" übernimmt zusätzlich Song, Titel und Interpret, "end" nur die Position.
     */
    const takeFromSpotify = async (target) => {
      try {
        const state = await this.client.getPlayback();
        if (!state?.item) {
          this.toast('In Spotify läuft gerade kein Song.', 'error');
          return;
        }
        if (target === 'start') {
          inputs.uri.value = state.item.uri;
          if (!inputs.title.value.trim()) inputs.title.value = state.item.name;
          if (!inputs.artist.value.trim()) inputs.artist.value = (state.item.artists || []).map((artist) => artist.name).join(', ');
          inputs.start.value = formatTime(state.progress_ms);
          this.toast('Song und Startpunkt übernommen.');
        } else {
          const current = parseSpotifyLink(inputs.uri.value);
          if (current && current.uri !== state.item.uri) {
            this.toast('Achtung: In Spotify läuft ein anderer Song als der hinterlegte.', 'error');
            return;
          }
          inputs.end.value = formatTime(state.progress_ms);
          this.toast('Endpunkt übernommen.');
        }
        updateDurationHint();
      } catch (err) {
        this.handleError(err);
      }
    };

    const preview = (part) => {
      try {
        errorEl.textContent = '';
        let candidate = readForm();
        if (!candidate.uri) throw new Error('Zum Vorhören wird ein Spotify-Link gebraucht.');
        if (part === 'end') {
          if (!(candidate.durationMs > 0)) throw new Error('Zum Vorhören des Endes bitte zuerst ein Ende setzen.');
          const endMs = candidate.startMs + candidate.durationMs;
          const from = Math.max(candidate.startMs, endMs - END_PREVIEW_MS);
          candidate = { ...candidate, id: `${candidate.id}-ende`, startMs: from, durationMs: endMs - from };
        }
        this.run(() => this.controller.toggle('preview', candidate));
      } catch (err) {
        errorEl.textContent = err.message;
      }
    };

    const dialog = el('dialog', { class: 'editor', 'aria-label': isNew ? 'Clip hinzufügen' : 'Clip bearbeiten' });
    const close = () => dialog.close();

    const save = () => {
      let updated;
      try {
        updated = readForm();
      } catch (err) {
        errorEl.textContent = err.message;
        return;
      }
      if (isNew) {
        category.clips.push(updated);
      } else {
        const index = category.clips.findIndex((item) => item.id === draft.id);
        category.clips[index] = updated;
      }
      this.persistBoard();
      close();
    };

    const remove = () => {
      // Bestätigung per nativem Dialog, damit im Spiel nichts versehentlich verschwindet.
      if (!window.confirm(`„${draft.title}“ wirklich löschen?`)) return;
      category.clips = category.clips.filter((item) => item.id !== draft.id);
      this.persistBoard();
      close();
    };

    dialog.append(
      el('h2', { class: 'editor__title', text: `${category.name}: ${isNew ? 'neuer Clip' : draft.title}` }),
      el('div', { class: 'editor__grid' }, [
        field('Titel', inputs.title),
        field('Interpret', inputs.artist),
        field('Spotify-Link', inputs.uri, 'In Spotify: Song, Teilen, Link kopieren. Playlists gehen auch.', true),
        el('div', { class: 'field field--wide' }, [
          el('span', { class: 'field__label', text: 'Startpunkt' }),
          el('div', { class: 'editor__row' }, [
            inputs.start,
            el('button', { type: 'button', class: 'button', text: '0,5 s früher', onClick: () => nudge(inputs.start, -500) }),
            el('button', { type: 'button', class: 'button', text: '0,5 s später', onClick: () => nudge(inputs.start, 500) }),
            el('button', { type: 'button', class: 'button', text: 'Aus Spotify übernehmen', onClick: () => takeFromSpotify('start') }),
          ]),
          el('div', { class: 'editor__row' }, [
            el('button', { type: 'button', class: 'button', text: 'Vorhören oder stoppen', onClick: () => preview('all') }),
          ]),
        ]),
        el('div', { class: 'field field--wide' }, [
          el('span', { class: 'field__label', text: 'Endpunkt' }),
          el('div', { class: 'editor__row' }, [
            inputs.end,
            el('button', { type: 'button', class: 'button', text: '0,5 s früher', onClick: () => nudge(inputs.end, -500) }),
            el('button', { type: 'button', class: 'button', text: '0,5 s später', onClick: () => nudge(inputs.end, 500) }),
            el('button', { type: 'button', class: 'button', text: 'Aus Spotify übernehmen', onClick: () => takeFromSpotify('end') }),
          ]),
          el('div', { class: 'editor__row' }, [
            el('button', { type: 'button', class: 'button', text: 'Ende vorhören', onClick: () => preview('end') }),
          ]),
          durationHint,
          el('span', {
            class: 'field__hint',
            text: 'Tipp: Song in Spotify an der gewünschten Stelle pausieren, dann "Aus Spotify übernehmen". Das Ausblenden endet genau am Endpunkt.',
          }),
        ]),
        field('Ausblenden in Sekunden', inputs.fade),
        field('Lautstärke in Prozent', inputs.volume, 'Wirkt nur auf Geräten mit Lautstärkesteuerung'),
        el('label', { class: 'field field--check' }, [inputs.verified, el('span', { text: 'Startpunkt geprüft' })]),
        field('Notiz', inputs.note, null, true),
      ]),
      errorEl,
      el('div', { class: 'editor__actions' }, [
        isNew ? null : el('button', { type: 'button', class: 'button button--danger', text: 'Löschen', onClick: remove }),
        el('button', { type: 'button', class: 'button', text: 'Abbrechen', onClick: close }),
        el('button', { type: 'button', class: 'button button--primary', text: 'Speichern', onClick: save }),
      ]),
    );
    dialog.addEventListener('close', () => {
      const { current } = this.controller.snapshot();
      if (current?.categoryId === 'preview') this.run(() => this.controller.stop());
      dialog.remove();
    });
    document.body.append(dialog);
    updateDurationHint();
    dialog.showModal();
  }

  persistBoard() {
    if (!store.saveBoard(this.board)) this.toast('Speichern auf dem Gerät nicht möglich. Bitte Belegung exportieren.', 'error');
    this.renderBoard();
  }

  // Import, Export, Abmelden

  exportBoard() {
    const blob = new Blob([store.boardToJson(this.board)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'handball-launchpad.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importBoard(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    const { board, errors } = store.parseBoardJson(await file.text());
    if (!board) {
      this.toast(`Import abgelehnt: ${errors.slice(0, 3).join(' ')}`, 'error');
      return;
    }
    if (!window.confirm('Aktuelle Belegung durch die Datei ersetzen?')) return;
    this.board = board;
    this.persistBoard();
    this.toast('Belegung importiert.');
  }

  logout() {
    this.controller.stopIdleWatch();
    this.controller.stop({ fade: false, keepAlive: false }).catch(() => {});
    this.auth.logout();
    this.renderSetup();
  }

  // Lebenszyklus: Bildschirm wach halten, Geräte nach App-Wechsel neu laden

  installLifecycleHooks() {
    const keepAwake = async () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // Nicht kritisch. Dann bitte Auto-Sperre in den iOS-Einstellungen abschalten.
      }
    };
    document.addEventListener('pointerdown', keepAwake, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      keepAwake();
      // Zurück aus der Spotify-App: Geräteliste auffrischen, aber höchstens alle 5 Sekunden.
      if (this.auth.isLoggedIn() && Date.now() - this.lastDeviceRefresh > 5000) this.refreshDevices();
    });
    keepAwake();
  }

  // Kleinkram

  latencyText() {
    return this.lastLatency === null ? '' : `Letzter Befehl: ${this.lastLatency} ms`;
  }

  showLatency(ms) {
    this.lastLatency = ms;
    if (this.latencyEl) this.latencyEl.textContent = this.latencyText();
  }

  copy(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => this.toast('Adresse kopiert.'))
      .catch(() => this.toast('Kopieren nicht möglich. Bitte die Adresse markieren und kopieren.', 'error'));
  }

  toast(message, kind = 'info') {
    const node = el('div', { class: `toast toast--${kind}`, text: message });
    this.toastRoot.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 6000 : 3500);
  }
}
