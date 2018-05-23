import FileSender from './fileSender';
import FileReceiver from './fileReceiver';
import {
  copyToClipboard,
  delay,
  fadeOut,
  openLinksInNewTab,
  percent
} from './utils';

export default function(state, emitter) {
  let lastRender = 0;
  let updateTitle = false;

  function render() {
    emitter.emit('render');
  }

  async function checkFiles() {
    const files = state.storage.files.slice();
    let rerender = false;
    for (const file of files) {
      const oldLimit = file.dlimit;
      const oldTotal = file.dtotal;
      await file.updateDownloadCount();
      if (file.dtotal === file.dlimit) {
        state.storage.remove(file.id);
        rerender = true;
      } else if (oldLimit !== file.dlimit || oldTotal !== file.dtotal) {
        rerender = true;
      }
    }
    if (rerender) {
      render();
    }
  }

  function updateProgress() {
    if (updateTitle) {
      emitter.emit('DOMTitleChange', percent(state.transfer.progressRatio));
    }
    render();
  }

  emitter.on('DOMContentLoaded', () => {
    document.addEventListener('blur', () => (updateTitle = true));
    document.addEventListener('focus', () => {
      updateTitle = false;
      emitter.emit('DOMTitleChange', 'Firefox Send');
    });
    checkFiles();
  });

  emitter.on('navigate', checkFiles);

  emitter.on('render', () => {
    lastRender = Date.now();
  });

  emitter.on('changeLimit', async ({ file, value }) => {
    await file.changeLimit(value);
    state.storage.writeFile(file);
  });

  emitter.on('delete', async ({ file }) => {
    try {
      state.storage.remove(file.id);
      await file.del();
    } catch (e) {
      state.raven.captureException(e);
    }
  });

  emitter.on('cancel', () => {
    state.transfer.cancel();
  });

  emitter.on('upload', async ({ file, type }) => {
    const sender = new FileSender(file);
    sender.on('progress', updateProgress);
    sender.on('encrypting', render);
    state.transfer = sender;
    state.uploading = true;
    render();

    const links = openLinksInNewTab();
    await delay(200);
    try {
      const ownedFile = await sender.upload();
      ownedFile.type = type;
      state.storage.totalUploads += 1;

      state.storage.addFile(ownedFile);
      const cancelBtn = document.getElementById('cancel-upload');
      if (cancelBtn) {
        cancelBtn.hidden = 'hidden';
      }
      await delay(1000);
      await fadeOut('.page');
      emitter.emit('pushState', `/share/${ownedFile.id}`);
    } catch (err) {
      if (err.message === '0') {
        //cancelled. do nothing
        render();
      } else {
        // eslint-disable-next-line no-console
        console.error(err);
        state.raven.captureException(err);
        emitter.emit('pushState', '/error');
      }
    } finally {
      openLinksInNewTab(links, false);
      state.uploading = false;
      state.transfer = null;
    }
  });

  emitter.on('password', async ({ password, file }) => {
    try {
      state.settingPassword = true;
      render();
      await file.setPassword(password);
      state.storage.writeFile(file);
      await delay(1000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      state.passwordSetError = err;
    } finally {
      state.settingPassword = false;
    }
    render();
  });

  emitter.on('getMetadata', async () => {
    const file = state.fileInfo;
    const receiver = new FileReceiver(file);
    try {
      await receiver.getMetadata();
      state.transfer = receiver;
    } catch (e) {
      if (e.message === '401') {
        file.password = null;
        if (!file.requiresPassword) {
          return emitter.emit('pushState', '/404');
        }
      }
    }
    render();
  });

  emitter.on('download', async () => {
    state.transfer.on('progress', updateProgress);
    state.transfer.on('decrypting', render);
    const links = openLinksInNewTab();
    try {
      const dl = state.transfer.download();
      render();
      await dl;
      await delay(1000);
      await fadeOut('.page');
      state.storage.totalDownloads += 1;
      state.transfer.reset();
      emitter.emit('pushState', '/completed');
    } catch (err) {
      if (err.message === '0') {
        // download cancelled
        state.transfer.reset();
        render();
      } else {
        // eslint-disable-next-line no-console
        console.error(err);
        state.transfer = null;
        const location = err.message === '404' ? '/404' : '/error';
        if (location === '/error') {
          state.raven.captureException(err);
        }
        emitter.emit('pushState', location);
      }
    } finally {
      openLinksInNewTab(links, false);
    }
  });

  emitter.on('copy', ({ url }) => {
    copyToClipboard(url);
  });

  setInterval(() => {
    // poll for updates of the download counts
    // TODO something for the share page: || state.route === '/share/:id'
    if (state.route === '/') {
      checkFiles();
    }
  }, 2 * 60 * 1000);

  setInterval(() => {
    // poll for rerendering the file list countdown timers
    if (
      state.route === '/' &&
      state.storage.files.length > 0 &&
      Date.now() - lastRender > 30000
    ) {
      render();
    }
  }, 60000);
}
