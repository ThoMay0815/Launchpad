/**
 * Persistenz im localStorage: Board (Tastenbelegung) und Einstellungen.
 * Speicherfehler (z. B. privater Modus) werden abgefangen, die App läuft dann mit Werten im Speicher weiter.
 */

import { STORAGE_KEYS } from './config.js';
import { createDefaultBoard } from './defaultBoard.js';
import { validateBoard } from './logic.js';

const DEFAULT_SETTINGS = { deviceId: null, masterVolume: 100, rotation: {} };

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadBoard(storage = globalThis.localStorage) {
  const stored = read(storage, STORAGE_KEYS.board);
  if (stored && validateBoard(stored).length === 0) return stored;
  return createDefaultBoard();
}

export function saveBoard(board, storage = globalThis.localStorage) {
  return write(storage, STORAGE_KEYS.board, board);
}

export function loadSettings(storage = globalThis.localStorage) {
  const stored = read(storage, STORAGE_KEYS.settings) || {};
  return { ...DEFAULT_SETTINGS, ...stored, rotation: { ...(stored.rotation || {}) } };
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  return write(storage, STORAGE_KEYS.settings, settings);
}

export function boardToJson(board) {
  return JSON.stringify(board, null, 2);
}

/** @returns {{board: object | null, errors: string[]}} */
export function parseBoardJson(text) {
  let board;
  try {
    board = JSON.parse(text);
  } catch {
    return { board: null, errors: ['Die Datei ist kein gültiges JSON.'] };
  }
  const errors = validateBoard(board);
  return { board: errors.length ? null : board, errors };
}
