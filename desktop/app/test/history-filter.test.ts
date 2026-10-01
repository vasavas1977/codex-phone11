import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import type { DesktopCallHistory } from '../../src/authenticated-provider';
import { boundedHistoryQuery, filterHistoryItems, historyDirectionLabel, historyOutcome,
  historyOutcomeLabel, historyScopeKey } from '../src/history-filter';

const call = (overrides: Partial<DesktopCallHistory> = {}): DesktopCallHistory => ({
  id: 1, direction: 'inbound', callerNumber: '+6621234567', calleeNumber: '1020',
  callbackNumber: '+6621234567', durationSeconds: 0, disposition: 'answered',
  startedAt: '2026-10-01T10:00:00.000Z', ...overrides,
});

test('search uses recorded numbers and displayed labels without changing records or order', () => {
  const items = [call({ id: 3 }), call({ id: 2, direction: 'outbound', callbackNumber: '3002', callerNumber: '1020', calleeNumber: '3002' })];
  assert.deepEqual(filterHistoryItems(items, '  InCoMiNg  ', 'all', 'all'), [items[0]]);
  assert.deepEqual(filterHistoryItems(items, '3002', 'all', 'all'), [items[1]]);
  assert.deepEqual(filterHistoryItems(items, '+66 (2) 123-4567', 'all', 'all'), [items[0]]);
  assert.equal(filterHistoryItems(items, '', 'all', 'all')[0], items[0]);
  assert.deepEqual(filterHistoryItems(items, '', 'all', 'all').map(item => item.id), [3, 2]);
  assert.equal(items[0].callbackNumber, '+6621234567');
});

test('Unicode compatibility digits and labels match, while unmatched Thai and names do not invent contacts', () => {
  const item = { ...call(), callerName: 'Som ส้ม', currentExtensionOwner: 'Som' };
  assert.deepEqual(filterHistoryItems([item], '＋６６２１２３４５６７', 'all', 'all'), [item]);
  assert.deepEqual(filterHistoryItems([item], 'ＡＮＳＷＥＲＥＤ', 'all', 'all'), [item]);
  assert.deepEqual(filterHistoryItems([item], 'Som', 'all', 'all'), []);
  assert.deepEqual(filterHistoryItems([item], 'ส้ม', 'all', 'all'), []);
});

test('direction and recorded outcome are independent and combine with search', () => {
  const incomingAnswered = call();
  const outgoingMissed = call({ id: 2, direction: 'outbound', disposition: 'no_answer' });
  const incomingBusy = call({ id: 3, disposition: 'busy' });
  const incomingFailed = call({ id: 4, disposition: 'failed' });
  const items = [incomingAnswered, outgoingMissed, incomingBusy, incomingFailed];
  assert.deepEqual(filterHistoryItems(items, '', 'inbound', 'answered'), [incomingAnswered]);
  assert.deepEqual(filterHistoryItems(items, '', 'outbound', 'missed'), [outgoingMissed]);
  assert.deepEqual(filterHistoryItems(items, 'incoming', 'all', 'missed'), []);
  assert.deepEqual(filterHistoryItems(items, '', 'all', 'busy'), [incomingBusy]);
  assert.deepEqual(filterHistoryItems(items, '', 'all', 'failed'), [incomingFailed]);
});

test('answered calls require the explicit disposition even with zero duration; duration never proves an answer', () => {
  assert.equal(historyOutcome(call({ durationSeconds: 0, disposition: 'ANSWERED' })), 'answered');
  for (const disposition of [null, 'completed', 'normal_clearing', 'canceled'])
    assert.equal(historyOutcome(call({ durationSeconds: 20, disposition })), 'other');
  for (const disposition of ['missed', 'no_answer', 'no-answer', 'NO-ANSWER'])
    assert.equal(historyOutcome(call({ direction: 'outbound', durationSeconds: 20, disposition })), 'missed');
});

test('internal and emergency records remain independently filterable without inferring attribution', () => {
  const internal = call({ direction: 'internal', callbackNumber: null });
  const emergency = call({ id: 2, direction: 'emergency', disposition: 'failed' });
  assert.deepEqual(filterHistoryItems([internal, emergency], '', 'internal', 'all'), [internal]);
  assert.deepEqual(filterHistoryItems([internal, emergency], 'failed', 'emergency', 'failed'), [emergency]);
  assert.equal(internal.callbackNumber, null);
});

test('empty, unmatched and all-loaded views are distinct inputs without a hidden cache', () => {
  assert.deepEqual(filterHistoryItems([], '', 'all', 'all'), []);
  assert.deepEqual(filterHistoryItems([call()], 'absent', 'all', 'all'), []);
  assert.equal(filterHistoryItems([call()], '  ', 'all', 'all').length, 1);
  assert.deepEqual(filterHistoryItems([], '662', 'all', 'all'), []);
});

test('queries are bounded and literal rather than regular expressions or markup', () => {
  assert.equal(boundedHistoryQuery('a'.repeat(100)).length, 64);
  assert.equal(boundedHistoryQuery('\u00003001\n'), '3001');
  assert.deepEqual(filterHistoryItems([call()], '.*', 'all', 'all'), []);
  assert.deepEqual(filterHistoryItems([call()], '<img src=x onerror=alert(1)>', 'all', 'all'), []);
});

test('session revision and workspace both define scope; signed-out or incomplete states have none', () => {
  const state = { signedIn: true, sessionRevision: 'account-a', tenantId: 1 };
  assert.notEqual(historyScopeKey(state), historyScopeKey({ ...state, sessionRevision: 'account-b' }));
  assert.notEqual(historyScopeKey(state), historyScopeKey({ ...state, tenantId: 2 }));
  for (const incomplete of [null, { ...state, signedIn: false }, { ...state, sessionRevision: null }, { ...state, tenantId: null }])
    assert.equal(historyScopeKey(incomplete), '');
});

test('displayed direction and outcome labels remain truthful', () => {
  assert.equal(historyDirectionLabel('inbound'), 'Incoming');
  assert.equal(historyDirectionLabel('outbound'), 'Outgoing');
  assert.equal(historyOutcomeLabel('other'), 'Other / unknown');
  assert.equal(historyOutcomeLabel('busy'), 'Busy');
});

// Opt in like the established Electron meeting rehearsals; no account, helper, network or media permission is used.
test('isolated Chromium renders loaded-history controls, literal data, paging and scope clearing', {
  skip: process.env.PHONE11_HISTORY_BROWSER_QA !== '1', timeout: 30_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'phone11-history-qa-'));
  try {
    await build({ entryPoints: [join(__dirname, '../src/renderer.ts')], outfile: join(temporary, 'renderer.js'),
      bundle: true, platform: 'browser', target: 'chrome128', format: 'iife' });
    for (const name of ['index.html', 'style.css']) await copyFile(join(__dirname, '../src', name), join(temporary, name));
    await mkdir(join(temporary, 'icons'));
    for (const icon of ['delete', 'log-out', 'mic', 'pause', 'phone-off', 'phone', 'refresh-cw', 'video', 'phone-incoming', 'phone-outgoing', 'phone-missed'])
      await copyFile(join(__dirname, '../node_modules/lucide-static/icons', `${icon}.svg`), join(temporary, 'icons', `${icon}.svg`));
    const calling = { version: 1, registered: true, call: null, dialState: 'idle', callActionState: 'idle', holdMessage: null };
    const publicState = { signedIn: true, sessionRevision: 'synthetic-history-a', generation: 'synthetic-generation', tenantId: 1,
      extensionNumber: '1020', calling };
    const first = { ...call(), callbackNumber: '3001', callerNumber: '3001', disposition: 'missed' };
    const second = { ...call(), id: 2, direction: 'outbound', callbackNumber: '3002', callerNumber: '1020', calleeNumber: '3002' };
    const literal = { ...call(), id: 3, callerNumber: '<img src=x onerror=alert(1)> ส้ม', calleeNumber: null,
      callbackNumber: null, callerName: 'Untrusted name', disposition: null };
    await writeFile(join(temporary, 'preload.cjs'), `
      const { contextBridge } = require('electron');
      let state = ${JSON.stringify(publicState)};
      contextBridge.exposeInMainWorld('phone11', {
        state: async () => state, onUpdate: () => () => {},
        signIn: async () => state, selectTenant: async () => state,
        signOut: async () => { state = { ...state, signedIn: false, sessionRevision: null, tenantId: null }; return state; },
        action: async () => { throw new Error('Synthetic QA never calls'); },
        openMeetings: async () => { throw new Error('Synthetic QA never joins'); },
        directoryList: async revision => ({ sessionRevision: revision, tenantId: 1, items: [], nextOffset: null }),
        historyList: async (revision, cursor) => ({ sessionRevision: revision,
          items: cursor ? [${JSON.stringify(second)}, ${JSON.stringify(literal)}] : [${JSON.stringify(first)}],
          nextCursor: cursor ? null : { startedAt: '2026-10-01T10:00:00.000001Z', id: 1 } }),
      });
    `);
    const fixture = `
      const assert = require('node:assert/strict');
      const { app, BrowserWindow } = require('electron');
      const path = require('node:path');
      app.setPath('userData', path.join(__dirname, 'user-data'));
      (async () => {
        await app.whenReady();
        const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'), partition: 'phone11-history-synthetic',
          sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
        let networkAttempts = 0;
        win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
          (_details, callback) => { networkAttempts++; callback({ cancel: true }); });
        win.webContents.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
        const evaluate = source => win.webContents.executeJavaScript(source);
        const until = async source => { for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate(source)) return; await new Promise(resolve => setTimeout(resolve, 20));
        } throw new Error('Synthetic history timed out: ' + source); };
        await win.loadFile(path.join(__dirname, 'index.html'));
        await until("document.querySelectorAll('.history-row').length === 1");
        assert.equal(await evaluate("document.querySelector('#history-count').textContent"), 'Showing 1 of 1 loaded calls.');
        assert.match(await evaluate("document.querySelector('#history-scope').textContent"), /loaded calls only/);
        await evaluate("document.querySelector('#history-search').focus(); document.querySelector('#history-search').value = '３００２'; document.querySelector('#history-search').dispatchEvent(new Event('input'))");
        assert.equal(await evaluate("document.activeElement.id"), 'history-search');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await until("document.activeElement.id === 'history-direction'");
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await until("document.activeElement.id === 'history-outcome'");
        assert.match(await evaluate("document.querySelector('#history-list').textContent"), /No loaded calls match/);
        assert.equal(await evaluate("document.querySelector('#history-more').hidden"), false);
        await evaluate("document.querySelector('#history-more').click()");
        await until("document.querySelectorAll('.history-row').length === 1 && document.querySelector('.history-row strong').textContent === '3002'");
        assert.equal(await evaluate("document.querySelector('#history-count').textContent"), 'Showing 1 of 3 loaded calls.');
        await evaluate("document.querySelector('.history-row').click()");
        assert.equal(await evaluate("document.querySelector('#destination').value"), '3002');
        await evaluate("document.querySelector('#history-outcome').value = 'missed'; document.querySelector('#history-outcome').dispatchEvent(new Event('change'))");
        assert.match(await evaluate("document.querySelector('#history-list').textContent"), /No loaded calls match/);
        await evaluate("document.querySelector('#history-clear').click()");
        assert.equal(await evaluate("document.activeElement.id"), 'history-search');
        assert.equal(await evaluate("document.querySelectorAll('.history-row').length"), 3);
        assert.equal(await evaluate("document.querySelector('.history-row:last-child strong').textContent"), '<img src=x onerror=alert(1)> ส้ม');
        assert.equal(await evaluate("document.querySelectorAll('.history-row strong img').length"), 0);
        assert.equal(await evaluate("document.body.textContent.includes('Untrusted name')"), false);
        await evaluate("document.querySelector('#history-direction').value = 'outbound'; document.querySelector('#history-direction').dispatchEvent(new Event('change'))");
        assert.equal(await evaluate("document.querySelectorAll('.history-row').length"), 1);
        await evaluate("document.querySelector('#history-search').value = 'answered'; document.querySelector('#history-search').dispatchEvent(new Event('input'))");
        await evaluate("document.querySelector('#sign-out').click()");
        await until("document.querySelector('#workspace').hidden");
        assert.equal(await evaluate("document.querySelector('#history-search').value"), '');
        assert.equal(await evaluate("document.querySelector('#history-direction').value"), 'all');
        assert.equal(await evaluate("document.querySelector('#history-outcome').value"), 'all');
        assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 0);
        assert.equal(networkAttempts, 0);
        console.log('Synthetic Phone11 history: controls/paging/plaintext/teardown PASS; network attempts 0');
        win.destroy(); app.exit(0);
      })().catch(error => { console.error(error); app.exit(1); });
    `;
    await writeFile(join(temporary, 'fixture.cjs'), fixture);
    // Keep a copy in the temporary directory only; it is never a production preload or app package.
    assert.match(await readFile(join(temporary, 'index.html'), 'utf8'), /<title>Phone11<\/title>/);
    const electron = createRequire(__filename)('electron') as string;
    const child = spawn(electron, [join(temporary, 'fixture.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic history exceeded 20 seconds')); }, 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exitCode, 0, output);
    assert.match(output, /controls\/paging\/plaintext\/teardown PASS; network attempts 0/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
