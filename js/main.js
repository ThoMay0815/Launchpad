/**
 * Einstiegspunkt. Bewusst minimal: App erzeugen und starten.
 */
import { App } from './app.js';

const app = new App(document.getElementById('app'), document.getElementById('toasts'));
app.start();
