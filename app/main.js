import 'fast-text-encoding'; // MS Edge support
import 'fluent-intl-polyfill';
import app from './routes';
import locale from '../common/locales';
import fileManager from './fileManager';
import dragManager from './dragManager';
import { canHasSend } from './utils';
import storage from './storage';
import Raven from 'raven-js';

if (navigator.doNotTrack !== '1' && window.RAVEN_CONFIG) {
  Raven.config(window.SENTRY_ID, window.RAVEN_CONFIG).install();
}

app.use((state, emitter) => {
  state.transfer = null;
  state.fileInfo = null;
  state.translate = locale.getTranslator();
  state.storage = storage;
  state.raven = Raven;
  window.appState = state;
  emitter.on('DOMContentLoaded', async function checkSupport() {
    let unsupportedReason = null;
    if (
      // Firefox < 50
      /firefox/i.test(navigator.userAgent) &&
      parseInt(navigator.userAgent.match(/firefox\/*([^\n\r]*)\./i)[1], 10) < 50
    ) {
      unsupportedReason = 'outdated';
    }
    const ok = await canHasSend();
    if (!ok) {
      unsupportedReason = /firefox/i.test(navigator.userAgent)
        ? 'outdated'
        : 'gcm';
    }
    if (unsupportedReason) {
      setTimeout(() =>
        emitter.emit('replaceState', `/unsupported/${unsupportedReason}`)
      );
    }
  });
});

app.use(fileManager);
app.use(dragManager);

app.mount('body');
