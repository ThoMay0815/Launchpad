/**
 * Automatisierte Tests, ausführbar mit: npm test (oder node --test tests/*.test.mjs)
 * Keine Abhängigkeiten, nur der eingebaute Node-Testrunner (Node 18 oder neuer).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFadeSteps,
  buildPlayBody,
  durationFromEnd,
  idleAction,
  formatSeconds,
  formatTime,
  makeId,
  nextRotationIndex,
  parseSpotifyLink,
  parseTime,
  scaledVolume,
  stopDelayMs,
  validateBoard,
} from '../js/logic.js';
import { createDefaultBoard } from '../js/defaultBoard.js';
import { PlaybackController } from '../js/player.js';
import { SpotifyClient } from '../js/spotify.js';
import { parseBoardJson } from '../js/store.js';

const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('parseSpotifyLink', () => {
  test('erkennt normale Teilen-Links mit Tracking-Parameter', () => {
    assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/track/${TRACK_ID}?si=abc123`), {
      type: 'track',
      id: TRACK_ID,
      uri: `spotify:track:${TRACK_ID}`,
    });
  });

  test('erkennt Links mit Sprachpfad und Playlists', () => {
    assert.equal(parseSpotifyLink(`https://open.spotify.com/intl-de/track/${TRACK_ID}`).uri, `spotify:track:${TRACK_ID}`);
    assert.equal(parseSpotifyLink(`https://open.spotify.com/playlist/${TRACK_ID}`).type, 'playlist');
  });

  test('akzeptiert auch Einbetten-Links (embed)', () => {
    assert.equal(parseSpotifyLink(`https://open.spotify.com/embed/track/${TRACK_ID}?utm_source=generator`).uri, `spotify:track:${TRACK_ID}`);
  });

  test('akzeptiert Spotify-URIs', () => {
    assert.equal(parseSpotifyLink(`spotify:track:${TRACK_ID}`).id, TRACK_ID);
  });

  test('lehnt Kurzlinks, fremde Seiten und kaputte IDs ab', () => {
    assert.equal(parseSpotifyLink('https://spotify.link/abc'), null);
    assert.equal(parseSpotifyLink(`https://example.com/track/${TRACK_ID}`), null);
    assert.equal(parseSpotifyLink('https://open.spotify.com/track/zu-kurz'), null);
    assert.equal(parseSpotifyLink(`https://open.spotify.com/artist/${TRACK_ID}`), null);
    assert.equal(parseSpotifyLink(''), null);
    assert.equal(parseSpotifyLink(undefined), null);
  });
});

describe('Zeitangaben', () => {
  test('parseTime versteht m:ss, Sekunden und deutsches Komma', () => {
    assert.equal(parseTime('1:05'), 65_000);
    assert.equal(parseTime('1:05,5'), 65_500);
    assert.equal(parseTime('3:40.2'), 220_200);
    assert.equal(parseTime('7'), 7000);
    assert.equal(parseTime('7,5'), 7500);
    assert.equal(parseTime(' 0 '), 0);
  });

  test('parseTime lehnt Unsinn ab', () => {
    assert.equal(parseTime('1:75'), null);
    assert.equal(parseTime('abc'), null);
    assert.equal(parseTime('-3'), null);
    assert.equal(parseTime(''), null);
  });

  test('formatTime und parseTime sind umkehrbar', () => {
    for (const ms of [0, 1000, 65_000, 65_500, 220_000, 599_900]) {
      assert.equal(parseTime(formatTime(ms)), ms);
    }
    assert.equal(formatTime(65_500), '1:05,5');
    assert.equal(formatSeconds(7500), '7,5');
    assert.equal(formatSeconds(7000), '7');
  });
});

describe('Rotation', () => {
  const clips = [{ uri: 'a' }, { uri: '' }, { uri: 'c' }];

  test('startet vorne und überspringt Clips ohne Link', () => {
    assert.equal(nextRotationIndex(clips, -1), 0);
    assert.equal(nextRotationIndex(clips, 0), 2);
    assert.equal(nextRotationIndex(clips, 2), 0);
  });

  test('liefert -1, wenn nichts abspielbar ist', () => {
    assert.equal(nextRotationIndex([], -1), -1);
    assert.equal(nextRotationIndex([{ uri: '' }], -1), -1);
  });

  test('verkraftet veraltete Indizes nach dem Löschen von Clips', () => {
    assert.equal(nextRotationIndex(clips, 17), 0);
  });
});

describe('Ausblenden und Lautstärke', () => {
  test('Fade-Schritte fallen monoton und enden bei 0', () => {
    const steps = buildFadeSteps(80, 1500, 6);
    assert.equal(steps.length, 6);
    assert.equal(steps.at(-1).volume, 0);
    for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i].volume <= steps[i - 1].volume);
    assert.equal(steps.reduce((sum, step) => sum + step.delayMs, 0), 1500);
  });

  test('ohne Fade-Dauer gibt es genau einen Schritt auf 0', () => {
    assert.deepEqual(buildFadeSteps(80, 0), [{ volume: 0, delayMs: 0 }]);
  });

  test('Clip-Lautstärke wird mit der Gesamtlautstärke skaliert und begrenzt', () => {
    assert.equal(scaledVolume(60, 50), 30);
    assert.equal(scaledVolume(150, 100), 100);
    assert.equal(scaledVolume('x', 100), 0);
  });

  test('Auto-Stopp beginnt so, dass das Ausblenden mit der Dauer endet', () => {
    assert.equal(stopDelayMs({ durationMs: 7000, fadeMs: 1500 }), 5500);
    assert.equal(stopDelayMs({ durationMs: 1000, fadeMs: 1500 }), 0);
    assert.equal(stopDelayMs({ durationMs: 0, fadeMs: 1500 }), null);
  });
});

describe('Play-Anfrage und Board', () => {
  test('Songs laufen über uris, Playlists über context_uri', () => {
    assert.deepEqual(buildPlayBody({ uri: `spotify:track:${TRACK_ID}`, startMs: 65_000 }), {
      uris: [`spotify:track:${TRACK_ID}`],
      position_ms: 65_000,
    });
    assert.deepEqual(buildPlayBody({ uri: `spotify:playlist:${TRACK_ID}`, startMs: 0 }), {
      context_uri: `spotify:playlist:${TRACK_ID}`,
      position_ms: 0,
    });
    assert.throws(() => buildPlayBody({ uri: '', title: 'Leer' }), /Leer/);
  });

  test('die Startbelegung ist gültig und hat eindeutige IDs', () => {
    assert.deepEqual(validateBoard(createDefaultBoard()), []);
  });

  test('Import erkennt kaputte Dateien mit lesbarer Meldung', () => {
    assert.match(parseBoardJson('{kein json').errors[0], /JSON/);
    const board = createDefaultBoard();
    board.categories[0].clips[1].id = board.categories[0].clips[0].id;
    board.categories[0].clips[0].volume = -5;
    const { errors } = parseBoardJson(JSON.stringify(board));
    assert.ok(errors.some((message) => message.includes('doppelte id')));
    assert.ok(errors.some((message) => message.includes('volume')));
  });

  test('makeId ist mit festen Quellen deterministisch', () => {
    assert.equal(makeId('clip', () => 0.5, () => 36), 'clip-10-i');
  });
});

// Wiedergabesteuerung mit einem Fake-Client, der alle Befehle protokolliert

class FakeClient {
  constructor({ volumeError = null, playDelayMs = 0 } = {}) {
    this.calls = [];
    this.volumeError = volumeError;
    this.playDelayMs = playDelayMs;
  }

  async setVolume(_deviceId, volume) {
    if (this.volumeError) throw this.volumeError;
    this.calls.push(`volume:${volume}`);
  }

  async play(_deviceId, body) {
    if (this.playDelayMs) await sleep(this.playDelayMs);
    this.calls.push(`play:${body.uris?.[0] ?? body.context_uri}@${body.position_ms}`);
  }

  async pause() {
    this.calls.push('pause');
  }

  async getPlayback() {
    return { is_playing: true };
  }
}

function makeController(client, deviceOverrides = {}) {
  const device = { id: 'dev', name: 'Test', supportsVolume: true, volume: 100, ...deviceOverrides };
  const unsupported = [];
  const controller = new PlaybackController(client, {
    getDevice: () => device,
    getMasterVolume: () => 100,
    onVolumeUnsupported: (d) => unsupported.push(d.id),
    pollIntervalMs: 20,
  });
  controller.setDevice(device);
  return { controller, device, unsupported };
}

const clipA = { id: 'a', title: 'A', uri: `spotify:track:${TRACK_ID}`, startMs: 65_000, durationMs: 0, fadeMs: 60, volume: 100 };
const clipB = { ...clipA, id: 'b', title: 'B', startMs: 1000 };

describe('PlaybackController', () => {
  test('zweites Tippen blendet aus und pausiert danach', async () => {
    const client = new FakeClient();
    const { controller } = makeController(client);
    await controller.toggle('tor', clipA);
    assert.equal(controller.phase, 'playing');
    await controller.toggle('tor', clipA);
    assert.equal(controller.phase, 'idle');

    const pauseIndex = client.calls.indexOf('pause');
    const fadeCalls = client.calls.slice(1, pauseIndex);
    assert.equal(client.calls[0], `play:spotify:track:${TRACK_ID}@65000`);
    assert.ok(fadeCalls.length >= 2, 'es muss mehrere Lautstärkeschritte geben');
    assert.equal(fadeCalls.at(-1), 'volume:0');
    await sleep(5);
    assert.equal(client.calls.at(-1), 'volume:100', 'nach dem Stopp wird die Lautstärke zurückgesetzt');
  });

  test('ohne Lautstärkesteuerung wird hart pausiert', async () => {
    const client = new FakeClient();
    const { controller } = makeController(client, { supportsVolume: false });
    await controller.toggle('tor', clipA);
    await controller.toggle('tor', clipA);
    assert.deepEqual(client.calls, [`play:spotify:track:${TRACK_ID}@65000`, 'pause']);
  });

  test('VOLUME_CONTROL_DISALLOW schaltet auf harten Stopp um, der Clip startet trotzdem', async () => {
    const error = Object.assign(new Error('nope'), { status: 403, reason: 'VOLUME_CONTROL_DISALLOW' });
    const client = new FakeClient({ volumeError: error });
    const { controller, device, unsupported } = makeController(client);
    await controller.play('auszeit', { ...clipA, volume: 60 });
    assert.equal(device.supportsVolume, false);
    assert.deepEqual(unsupported, ['dev']);
    assert.equal(client.calls[0], `play:spotify:track:${TRACK_ID}@65000`);
    await controller.stop();
    assert.equal(client.calls.at(-1), 'pause');
  });

  test('Auto-Stopp beendet Clips mit fester Dauer von selbst', async () => {
    const client = new FakeClient();
    const { controller } = makeController(client, { supportsVolume: false });
    await controller.play('tor', { ...clipA, durationMs: 40, fadeMs: 0 });
    await sleep(80);
    assert.equal(controller.phase, 'idle');
    assert.equal(client.calls.at(-1), 'pause');
  });

  test('ein neuer Clip während des Ausblendens wird nicht nachträglich pausiert', async () => {
    const client = new FakeClient();
    const { controller } = makeController(client);
    await controller.play('einlauf', { ...clipA, fadeMs: 300 });
    const stopping = controller.stop();
    await sleep(40);
    await controller.play('tor', clipB);
    await stopping;
    await sleep(20);
    const lastPlay = client.calls.lastIndexOf(`play:spotify:track:${TRACK_ID}@1000`);
    assert.ok(lastPlay > -1);
    assert.ok(!client.calls.slice(lastPlay).includes('pause'), 'nach dem neuen Clip darf kein Pause folgen');
    assert.equal(controller.current.clip.id, 'b');
    assert.equal(controller.phase, 'playing');
    await controller.stop({ fade: false });
  });

  test('Polling setzt den Zustand zurück, wenn Spotify nicht mehr spielt', async () => {
    const client = new FakeClient();
    client.getPlayback = async () => ({ is_playing: false });
    const { controller } = makeController(client);
    await controller.play('einlauf', clipA);
    await sleep(60);
    assert.equal(controller.phase, 'idle');
  });
});

describe('SpotifyClient', () => {
  test('erneuert bei 401 einmal das Token und wiederholt die Anfrage', async () => {
    const tokens = [];
    const auth = { getAccessToken: async ({ forceRefresh }) => (forceRefresh ? 'neu' : 'alt') };
    const responses = [new Response(null, { status: 401 }), new Response(null, { status: 204 })];
    const client = new SpotifyClient(auth, {
      fetchImpl: async (_url, options) => {
        tokens.push(options.headers.Authorization);
        return responses.shift();
      },
    });
    assert.equal(await client.pause('dev'), null);
    assert.deepEqual(tokens, ['Bearer alt', 'Bearer neu']);
  });

  test('übersetzt NO_ACTIVE_DEVICE in eine verständliche Meldung', async () => {
    const auth = { getAccessToken: async () => 't' };
    const body = JSON.stringify({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
    const client = new SpotifyClient(auth, { fetchImpl: async () => new Response(body, { status: 404 }) });
    await assert.rejects(client.play('dev', {}), (err) => err.reason === 'NO_ACTIVE_DEVICE' && /Spotify auf dem Abspielgerät öffnen/.test(err.message));
  });

  test('Befehle laufen strikt nacheinander, auch wenn einer scheitert', async () => {
    const order = [];
    const auth = { getAccessToken: async () => 't' };
    let call = 0;
    const client = new SpotifyClient(auth, {
      fetchImpl: async (url) => {
        call += 1;
        const mine = call;
        order.push(`start ${mine}`);
        await sleep(mine === 1 ? 30 : 1);
        order.push(`ende ${mine}`);
        return mine === 1 ? new Response('{}', { status: 400 }) : new Response(null, { status: 204 });
      },
    });
    const first = client.setVolume('dev', 50).catch(() => 'fehler');
    const second = client.pause('dev');
    assert.equal(await first, 'fehler');
    await second;
    assert.deepEqual(order, ['start 1', 'ende 1', 'start 2', 'ende 2']);
  });
});

describe('Endpunkt und Wach halten', () => {
  test('durationFromEnd rechnet Ende in Dauer um', () => {
    assert.deepEqual(durationFromEnd(65_000, '1:12'), { durationMs: 7000 });
    assert.deepEqual(durationFromEnd(65_000, '1:12,5'), { durationMs: 7500 });
    assert.deepEqual(durationFromEnd(65_000, ''), { durationMs: 0 });
    assert.deepEqual(durationFromEnd(65_000, '0'), { durationMs: 0 });
    assert.match(durationFromEnd(65_000, '1:00').error, /nach dem Start/);
    assert.match(durationFromEnd(65_000, 'abc').error, /m:ss/);
  });

  const SILENCE = 'spotify:track:stille';
  test('idleAction startet Stille, wenn nichts oder Pause', () => {
    assert.equal(idleAction(null, SILENCE), 'start');
    assert.equal(idleAction({ is_playing: false, item: { uri: SILENCE, duration_ms: 3_600_000 }, progress_ms: 10 }, SILENCE), 'start');
    assert.equal(idleAction({ is_playing: false, item: { uri: 'spotify:track:anderer' } }, SILENCE), 'start');
  });

  test('idleAction lässt laufende Stille und fremde Musik in Ruhe', () => {
    assert.equal(idleAction({ is_playing: true, item: { uri: SILENCE, duration_ms: 3_600_000 }, progress_ms: 60_000 }, SILENCE), 'none');
    assert.equal(idleAction({ is_playing: true, item: { uri: 'spotify:track:anderer' } }, SILENCE), 'none');
  });

  test('idleAction startet Stille kurz vor ihrem Ende neu', () => {
    assert.equal(idleAction({ is_playing: true, item: { uri: SILENCE, duration_ms: 600_000 }, progress_ms: 550_000 }, SILENCE, 90_000), 'start');
  });

  const IDLE = `spotify:track:${'S'.repeat(22)}`;
  function makeIdleController(client) {
    const device = { id: 'dev', name: 'iPhone', supportsVolume: false, volume: null };
    const controller = new PlaybackController(client, {
      getDevice: () => device,
      getMasterVolume: () => 100,
      getIdleUri: () => IDLE,
      pollIntervalMs: 20,
      idleCheckMs: 20,
    });
    controller.setDevice(device);
    return controller;
  }

  test('mit Wach halten läuft beim Stopp Stille statt Pause', async () => {
    const client = new FakeClient();
    const controller = makeIdleController(client);
    await controller.toggle('tor', clipA);
    await controller.toggle('tor', clipA);
    assert.deepEqual(client.calls, [`play:spotify:track:${TRACK_ID}@65000`, `play:${IDLE}@0`]);
    assert.equal(controller.phase, 'idle');
  });

  test('keepAlive false erzwingt eine echte Pause', async () => {
    const client = new FakeClient();
    const controller = makeIdleController(client);
    await controller.stop({ fade: false, keepAlive: false });
    assert.deepEqual(client.calls, ['pause']);
  });

  test('der Wächter startet Stille, wenn Spotify pausiert ist', async () => {
    const client = new FakeClient();
    client.getPlayback = async () => ({ is_playing: false, item: null });
    const controller = makeIdleController(client);
    controller.startIdleWatch();
    await sleep(60);
    controller.stopIdleWatch();
    assert.ok(client.calls.includes(`play:${IDLE}@0`));
  });

  test('eine Taste während der Wächter-Abfrage gewinnt gegen die Stille', async () => {
    const client = new FakeClient();
    client.getPlayback = async () => {
      await sleep(30);
      return { is_playing: false, item: null };
    };
    const controller = makeIdleController(client);
    const check = controller.checkIdle();
    await sleep(5);
    await controller.play('tor', clipB);
    await check;
    assert.deepEqual(client.calls, [`play:spotify:track:${TRACK_ID}@1000`]);
    assert.equal(controller.current.clip.id, 'b');
    await controller.stop({ fade: false, keepAlive: false });
  });

  test('nach Songende eines Einlauf-Clips übernimmt die Stille', async () => {
    const client = new FakeClient();
    let playing = true;
    client.getPlayback = async () => ({ is_playing: playing, item: null });
    const controller = makeIdleController(client);
    await controller.play('einlauf', clipA);
    playing = false;
    await sleep(80);
    assert.equal(controller.phase, 'idle');
    assert.equal(client.calls.at(-1), `play:${IDLE}@0`);
  });
});

describe('SpotifyClient Serverfehler', () => {
  test('wiederholt bei 502 einmal und meldet danach verständlich', async () => {
    let count = 0;
    const auth = { getAccessToken: async () => 't' };
    const flaky = new SpotifyClient(auth, {
      retryDelayMs: 1,
      fetchImpl: async () => {
        count += 1;
        return count === 1 ? new Response('Bad Gateway', { status: 502 }) : new Response(null, { status: 204 });
      },
    });
    assert.equal(await flaky.pause('dev'), null);
    assert.equal(count, 2);

    const broken = new SpotifyClient(auth, { retryDelayMs: 1, fetchImpl: async () => new Response('Bad Gateway', { status: 502 }) });
    await assert.rejects(broken.pause('dev'), (err) => err.status === 502 && /Nochmal tippen/.test(err.message));
  });
});
