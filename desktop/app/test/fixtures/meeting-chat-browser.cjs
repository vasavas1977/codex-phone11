const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', process.env.PHONE11_CHAT_QA_USER_DATA);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: process.env.PHONE11_CHAT_QA_PRELOAD, partition: `phone11-chat-qa-${process.pid}`,
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  } });
  let networkAttempts = 0;
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => { networkAttempts++; callback({ cancel: true }); });
  win.webContents.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  const published = [];
  ipcMain.on('phone11:chat-qa-published', (_event, packet) => published.push(packet));
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await delay(30); }
    throw new Error(`Timed out: ${expression}`);
  };
  await win.loadFile(process.env.PHONE11_CHAT_QA_HTML);
  await until("!document.querySelector('#join').disabled");
  await evaluate("document.querySelector('#join').click()");
  await until("!document.querySelector('#room').hidden");
  await evaluate("document.querySelector('#chat').click()");
  assert.equal(await evaluate("document.querySelector('#chat').getAttribute('aria-pressed')"), 'true');
  assert.equal(await evaluate("document.querySelector('#participant-roster').hidden"), true);
  assert.equal(await evaluate("document.activeElement.id"), 'chat-text');
  win.webContents.send('phone11:chat-qa-command', 'receive');
  await until("document.querySelectorAll('#chat-messages li').length === 1");
  assert.equal(await evaluate("document.querySelector('#chat-messages strong').textContent"), 'SDK sender');
  assert.equal(await evaluate("document.querySelector('#chat-messages p').textContent"), '<img src=x onerror=alert(1)> สวัสดี');
  assert.equal(await evaluate("document.querySelectorAll('#chat-messages img').length"), 0);
  await evaluate("document.querySelector('#chat-text').value = 'Hello team'; document.querySelector('#chat-text').dispatchEvent(new Event('input', { bubbles: true }))");
  await evaluate("document.querySelector('#chat-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))");
  assert.equal(published.length, 0);
  await evaluate("document.querySelector('#chat-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))");
  assert.equal(published.length, 0);
  await evaluate("document.querySelector('#chat-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await until("document.querySelectorAll('#chat-messages li').length === 2");
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0].text).text, 'Hello team');
  assert.deepEqual(published[0].options, { reliable: true, topic: 'phone11.meeting.chat.v1' });
  assert.equal(await evaluate("document.querySelector('#chat-text').value"), '');
  await evaluate("document.querySelector('#chat-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#chat-panel').hidden"), true);
  assert.equal(await evaluate("document.querySelector('#participant-roster').hidden"), false);
  assert.equal(await evaluate("document.activeElement.id"), 'chat');
  win.webContents.send('phone11:chat-qa-command', 'revoke');
  await until("document.querySelector('#chat-text').disabled");
  await evaluate("document.querySelector('#chat').click()");
  assert.equal(await evaluate("document.activeElement.id"), 'chat-messages');
  assert.equal(await evaluate("document.querySelector('#chat-send').disabled"), true);
  win.webContents.send('phone11:chat-qa-command', 'leave');
  await until("document.querySelector('#room').hidden");
  assert.equal(await evaluate("document.querySelector('#chat-messages').children.length"), 0);
  assert.equal(await evaluate("document.querySelector('#chat-text').value"), '');
  assert.equal(await evaluate("document.querySelector('#chat-panel').hidden"), true);
  assert.equal(networkAttempts, 0);
  win.destroy();
  console.log('PASS desktop chat Chromium: keyboard, plaintext, SDK sender, permission revocation, leave clearing; no network');
  app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
