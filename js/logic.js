/**
 * Reine Hilfsfunktionen ohne Seiteneffekte.
 * Alles in dieser Datei ist mit `node --test` prüfbar (siehe tests/logic.test.mjs).
 */

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const LINK_TYPES = ['track', 'playlist', 'album'];

/**
 * Wandelt einen Spotify-Link oder eine Spotify-URI in eine kanonische URI um.
 * Akzeptiert: https://open.spotify.com/track/<id>?si=..., .../intl-de/track/<id>, spotify:track:<id>
 * Kurzlinks (spotify.link/...) lassen sich ohne Netzabfrage nicht auflösen und liefern null.
 * @param {string} input
 * @returns {{type: string, id: string, uri: string} | null}
 */
export function parseSpotifyLink(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  let type;
  let id;
  const uriMatch = text.match(/^spotify:(track|playlist|album):([A-Za-z0-9]+)$/);
  if (uriMatch) {
    [, type, id] = uriMatch;
  } else {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => LINK_TYPES.includes(part));
    if (typeIndex === -1) return null;
    type = parts[typeIndex];
    id = parts[typeIndex + 1];
  }

  if (!LINK_TYPES.includes(type) || !SPOTIFY_ID.test(id || '')) return null;
  return { type, id, uri: `spotify:${type}:${id}` };
}

/**
 * Liest eine Zeitangabe wie "1:05", "1:05,5", "65" oder "7,5" (Sekunden) in Millisekunden.
 * @param {string} input
 * @returns {number | null} Millisekunden oder null bei ungültiger Eingabe
 */
export function parseTime(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(',', '.');
  const match = text.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  if (match[1] && seconds >= 60) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
}

/**
 * Formatiert Millisekunden als "m:ss" mit optionaler Zehntelsekunde ("1:05,5").
 * @param {number} ms
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const tenths = Math.round(ms / 100);
  const totalSeconds = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return fraction ? `${base},${fraction}` : base;
}

/**
 * Formatiert Millisekunden als Sekunden mit deutschem Komma ("7" oder "7,5").
 * @param {number} ms
 */
export function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0';
  const tenths = Math.round(ms / 100);
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  return fraction ? `${whole},${fraction}` : String(whole);
}

/** Begrenzt eine Lautstärke auf ganze Prozent zwischen 0 und 100. */
export function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** Clip-Lautstärke skaliert mit der Gesamtlautstärke, beide in Prozent. */
export function scaledVolume(clipVolume, masterVolume) {
  return clampVolume((clampVolume(clipVolume) * clampVolume(masterVolume)) / 100);
}

/**
 * Nächster abspielbarer Clip einer Kategorie in der Rotation.
 * Clips ohne Spotify-Link werden übersprungen.
 * @param {Array<{uri: string}>} clips
 * @param {number} lastIndex zuletzt gespielter Index, -1 wenn noch keiner
 * @returns {number} Index oder -1, wenn kein Clip abspielbar ist
 */
export function nextRotationIndex(clips, lastIndex = -1) {
  const count = clips.length;
  if (count === 0) return -1;
  const start = Number.isInteger(lastIndex) ? lastIndex : -1;
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + step) % count) + count) % count;
    if (clips[index].uri) return index;
  }
  return -1;
}

/**
 * Lautstärkeschritte für ein Ausblenden. Die Kurve fällt anfangs langsamer,
 * weil das Ohr Lautstärke logarithmisch wahrnimmt. Der letzte Schritt ist immer 0.
 * @returns {Array<{volume: number, delayMs: number}>}
 */
export function buildFadeSteps(fromVolume, fadeMs, steps = 6) {
  const start = clampVolume(fromVolume);
  if (!(fadeMs > 0) || steps < 1 || start === 0) return [{ volume: 0, delayMs: 0 }];
  const delayMs = Math.round(fadeMs / steps);
  const result = [];
  for (let i = 1; i <= steps; i += 1) {
    const remaining = 1 - i / steps;
    result.push({ volume: Math.round(start * remaining ** 1.5), delayMs });
  }
  return result;
}

/**
 * Ab wann nach dem Start das automatische Ausblenden beginnt.
 * @returns {number | null} null bei Clips ohne feste Dauer
 */
export function stopDelayMs(clip) {
  if (!(clip.durationMs > 0)) return null;
  return Math.max(0, clip.durationMs - Math.max(0, clip.fadeMs || 0));
}

/**
 * Anfragekörper für PUT /me/player/play.
 * Einzelne Songs laufen über "uris", Playlists und Alben über "context_uri".
 */
export function buildPlayBody(clip) {
  const link = parseSpotifyLink(clip.uri);
  if (!link) throw new Error(`„${clip.title || 'Clip'}“ hat keinen gültigen Spotify-Link.`);
  const position_ms = Math.max(0, Math.round(clip.startMs || 0));
  if (link.type === 'track') return { uris: [link.uri], position_ms };
  return { context_uri: link.uri, position_ms };
}

/** Eindeutige ID für neue Clips. Zufall und Uhr sind injizierbar, damit Tests deterministisch sind. */
export function makeId(prefix, random = Math.random, now = Date.now) {
  return `${prefix}-${now().toString(36)}-${random().toString(36).slice(2, 7)}`;
}

/**
 * Prüft ein Board (z. B. beim Import) und liefert lesbare Fehlermeldungen.
 * @returns {string[]} leer, wenn alles passt
 */
export function validateBoard(board) {
  if (!board || typeof board !== 'object') return ['Keine gültige Board-Datei.'];
  const errors = [];
  if (board.version !== 1) errors.push('Unbekannte Board-Version.');
  if (!Array.isArray(board.categories)) {
    errors.push('Die Liste der Kategorien fehlt.');
    return errors;
  }
  const clipIds = new Set();
  board.categories.forEach((category, categoryIndex) => {
    if (!category || typeof category.id !== 'string' || typeof category.name !== 'string') {
      errors.push(`Kategorie ${categoryIndex + 1}: id oder Name fehlt.`);
      return;
    }
    if (!Array.isArray(category.clips)) {
      errors.push(`Kategorie ${category.name}: Clip-Liste fehlt.`);
      return;
    }
    category.clips.forEach((clip, clipIndex) => {
      const where = `${category.name}, Clip ${clipIndex + 1}`;
      if (!clip || typeof clip.id !== 'string' || typeof clip.title !== 'string') {
        errors.push(`${where}: id oder Titel fehlt.`);
        return;
      }
      if (clipIds.has(clip.id)) errors.push(`${where}: doppelte id ${clip.id}.`);
      clipIds.add(clip.id);
      if (clip.uri && !parseSpotifyLink(clip.uri)) errors.push(`${where}: ungültiger Spotify-Link.`);
      for (const key of ['startMs', 'durationMs', 'fadeMs', 'volume']) {
        if (!Number.isFinite(clip[key]) || clip[key] < 0) errors.push(`${where}: ${key} ist ungültig.`);
      }
      if (clip.volume > 100) errors.push(`${where}: Lautstärke über 100.`);
    });
  });
  return errors;
}

/**
 * Entscheidet im Leerlauf, ob der Stille-Track (neu) gestartet werden muss.
 * Läuft in Spotify gerade ein anderer Song, bleibt er unangetastet.
 * @param {object | null} state Antwort von GET /me/player
 * @param {string} idleUri URI des Stille-Tracks
 * @param {number} marginMs Neustart, wenn die Stille weniger Restzeit hat
 * @param {{keepForeign?: boolean}} options keepForeign: einen fremden Song auch pausiert
 *   stehen lassen. Im Bearbeitungsmodus wichtig, weil du dort gerade eine Stelle suchst.
 * @returns {'start' | 'none'}
 */
export function idleAction(state, idleUri, marginMs = 90_000, { keepForeign = false } = {}) {
  if (!state || !state.item) return 'start';
  if (state.item.uri !== idleUri) {
    if (keepForeign) return 'none';
    return state.is_playing ? 'none' : 'start';
  }
  if (!state.is_playing) return 'start';
  const remaining = (state.item.duration_ms ?? 0) - (state.progress_ms ?? 0);
  return remaining < marginMs ? 'start' : 'none';
}

/**
 * Rechnet einen Endpunkt (absolute Songposition) in eine Clip-Dauer um.
 * Leeres Ende bedeutet: läuft bis zum Stopp.
 * @returns {{durationMs: number} | {error: string}}
 */
export function durationFromEnd(startMs, endText) {
  const text = typeof endText === 'string' ? endText.trim() : '';
  if (!text || text === '0') return { durationMs: 0 };
  const endMs = parseTime(text);
  if (endMs === null) return { error: 'Ende bitte als m:ss angeben, z. B. 1:12, oder leer lassen.' };
  if (endMs <= startMs) return { error: 'Das Ende muss nach dem Start liegen.' };
  return { durationMs: endMs - startMs };
}
