const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');

app.setPath('userData', process.env.PHONE11_PREVIEW_QA_USER_DATA);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: process.env.PHONE11_PREVIEW_QA_PRELOAD,
      partition: `phone11-preview-qa-${process.pid}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.session.setPermissionRequestHandler((sender, permission, callback) =>
    callback(sender === win.webContents && permission === 'media'));
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }));
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await win.loadFile(process.env.PHONE11_PREVIEW_QA_HTML);
  await until("!document.querySelector('#join').disabled", 'meeting list');
  assert.equal(await evaluate("document.querySelector('#prejoin-video').srcObject === null"), true);
  assert.equal(await evaluate("document.querySelector('#start-camera').checked"), false);

  await evaluate("document.querySelector('#start-camera').click()");
  await until("document.querySelector('#prejoin-video').srcObject?.getVideoTracks()[0]?.readyState === 'live'", 'opt-in camera preview');
  assert.equal(await evaluate("document.querySelector('#prejoin-video').srcObject.getAudioTracks().length"), 0);
  await evaluate("window.qaFirst = document.querySelector('#prejoin-video').srcObject; document.querySelector('#start-camera').click()");
  await until("window.qaFirst.getTracks().every(track => track.readyState === 'ended')", 'camera toggle cleanup');
  assert.equal(await evaluate("document.querySelector('#prejoin-video').srcObject === null"), true);

  await evaluate("document.querySelector('#start-camera').click()");
  await until("document.querySelector('#prejoin-video').srcObject?.active === true", 'second preview');
  const admission = new Promise(resolve => ipcMain.once('phone11:preview-qa-admission', resolve));
  await evaluate("window.qaSecond = document.querySelector('#prejoin-video').srcObject; document.querySelector('#join').click()");
  await admission;
  await until("document.querySelector('#prejoin-error').textContent.length > 0", 'failed synthetic admission');
  assert.equal(await evaluate("window.qaSecond.getTracks().every(track => track.readyState === 'ended')"), true);

  await evaluate("document.querySelector('#start-camera').click()");
  await until("document.querySelector('#prejoin-video').srcObject?.active === true", 'third preview');
  await evaluate("window.qaThird = document.querySelector('#prejoin-video').srcObject");
  const acknowledged = new Promise(resolve => ipcMain.once('phone11:meeting-left', resolve));
  win.webContents.send('phone11:meeting-leave-now');
  await Promise.race([acknowledged, delay(5000).then(() => { throw new Error('Timed out waiting for media-stop acknowledgement'); })]);
  assert.equal(await evaluate("window.qaThird.getTracks().every(track => track.readyState === 'ended')"), true);
  console.log('PASS synthetic Chromium preview: off by default; video-only opt-in; toggle cleanup; tracks stopped before failed admission; leaveNow cleanup and acknowledgement.');
  win.destroy();
  app.quit();
}

main().catch(error => { console.error(error); app.exit(1); });
