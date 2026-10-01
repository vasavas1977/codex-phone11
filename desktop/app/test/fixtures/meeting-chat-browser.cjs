const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
app.setPath('userData', process.env.PHONE11_CHAT_QA_USER_DATA);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  const { DesktopMeetingWindow } = require(process.env.PHONE11_CHAT_QA_WINDOW);
  const photoRequests = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWfDhPwAGVAL0ONfvaAAAAABJRU5ErkJggg==', 'base64');
  assert.equal(nativeImage.createFromBuffer(png).isEmpty(), false);
  const session = { revision: 'synthetic-chat-test', userId: '7', tenantId: 9 };
  let lateRelease;
  const provider = { currentSession: () => session,
    availableMeetings: async () => [{ meetingId: '12345678-1234-4234-8234-123456789012', title: 'Test chat' }],
    meetingChannels: async () => [], meetingDirectChats: async () => [],
    joinMeeting: async () => ({ url: 'wss://invalid.test', token: 'synthetic-not-a-token', expiresAt: 9999999999, grantProfile: 'interactive' }),
    meetingProfilePhoto: async (_revision, localIdentity, identity, signal) => {
      photoRequests.push(identity);
      assert.equal(localIdentity, 'p11-t9-u7');
      assert.equal(signal.aborted, false);
      if (identity === 'p11-t9-u10') await new Promise(resolve => { lateRelease = resolve; });
      return { identity, mimeType: 'image/png', bytes: new Uint8Array(identity === 'p11-t9-u9' ? png.subarray(0, 33) : png) };
    },
  };
  const owner = new DesktopMeetingWindow(provider, { snapshot: () => ({ call: null, dialState: 'idle', callActionState: 'idle' }) }, () => null);
  owner.registerIpc();
  // Keep this synthetic test's production window hidden.
  const show = BrowserWindow.prototype.show;
  BrowserWindow.prototype.show = function () {};
  try { await owner.open(); } finally { BrowserWindow.prototype.show = show; }
  const win = BrowserWindow.getAllWindows()[0];
  let networkAttempts = 0;
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => { networkAttempts++; callback({ cancel: true }); });
  win.webContents.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  const published = [];
  let probeResults;
  ipcMain.on('phone11:chat-qa-probes', (_event, results) => { probeResults = results; });
  ipcMain.on('phone11:chat-qa-published', (_event, packet) => published.push(packet));
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await delay(30); }
    throw new Error(`Timed out: ${expression}`);
  };
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
  assert.equal(await evaluate("document.querySelectorAll('#chat-messages li > div img').length"), 0);
  await until("document.querySelector('#chat-messages .person-avatar img')?.naturalWidth === 1");
  assert.equal(await evaluate("document.querySelector('#chat-messages .person-avatar').getAttribute('aria-label')"), 'SDK sender profile photo');
  assert.equal(await evaluate("document.querySelector('#chat-messages .person-initials').hidden"), true);
  assert.equal(await evaluate("document.querySelector('#chat-messages img').src.startsWith('data:image/png;base64,')"), true);
  await until("document.querySelectorAll('#participant-list .person-avatar img:not([hidden])').length === 2");
  await until("document.querySelectorAll('.tile-placeholder img:not([hidden])').length === 2");
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
  const beforeUnknown = photoRequests.length;
  win.webContents.send('phone11:chat-qa-command', 'unknown-photo');
  await until("document.querySelectorAll('#chat-messages li').length === 3");
  assert.equal(photoRequests.length, beforeUnknown);
  assert.equal(await evaluate("document.querySelector('#chat-messages li:last-child .person-initials').hidden"), false);
  win.webContents.send('phone11:chat-qa-command', 'broken-photo');
  await until("document.querySelectorAll('#chat-messages li').length === 4");
  await delay(100);
  assert.equal(await evaluate("document.querySelector('#chat-messages li:last-child img') === null"), true);
  assert.equal(await evaluate("document.querySelector('#chat-messages li:last-child .person-initials').hidden"), false);
  await evaluate("document.querySelector('#chat-messages li:first-child img').src = 'data:image/png;base64,AAAA'");
  await until("document.querySelector('#chat-messages li:first-child img').hidden");
  assert.equal(await evaluate("document.querySelector('#chat-messages li:first-child .person-initials').hidden"), false);
  await evaluate("document.querySelector('#chat-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#chat-panel').hidden"), true);
  assert.equal(await evaluate("document.querySelector('#participant-roster').hidden"), false);
  assert.equal(await evaluate("document.activeElement.id"), 'chat');
  win.webContents.send('phone11:chat-qa-command', 'revoke');
  await until("document.querySelector('#chat-text').disabled");
  await evaluate("document.querySelector('#chat').click()");
  assert.equal(await evaluate("document.activeElement.id"), 'chat-messages');
  assert.equal(await evaluate("document.querySelector('#chat-send').disabled"), true);
  const beforeProbes = photoRequests.length;
  win.webContents.send('phone11:chat-qa-command', 'probe-photo');
  for (let attempt = 0; attempt < 100 && !probeResults; attempt++) await delay(10);
  assert.deepEqual(probeResults, [null, null, null]);
  assert.equal(photoRequests.length, beforeProbes);
  win.webContents.send('phone11:chat-qa-command', 'late-photo');
  for (let attempt = 0; attempt < 100 && !lateRelease; attempt++) await delay(10);
  assert.equal(typeof lateRelease, 'function');
  session.revision = 'replaced-session';
  lateRelease();
  await delay(100);
  assert.equal(await evaluate("document.querySelector('#chat-messages li:last-child img') === null"), true);
  win.webContents.send('phone11:chat-qa-command', 'leave');
  await until("document.querySelector('#room').hidden");
  assert.equal(await evaluate("document.querySelector('#chat-messages').children.length"), 0);
  assert.equal(await evaluate("document.querySelector('#chat-text').value"), '');
  assert.equal(await evaluate("document.querySelector('#chat-panel').hidden"), true);
  assert.equal(networkAttempts, 0);
  win.destroy();
  console.log('PASS desktop chat Chromium: keyboard, plaintext, SDK sender, trusted chat/roster/tile photos, unknown/broken photo fallback, permission revocation, leave clearing; no network');
  app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
