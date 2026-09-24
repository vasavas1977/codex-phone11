import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preloadSource = resolve(root, 'src/meeting-preload.ts');
const require = createRequire(import.meta.url);
const electron = require('electron');
const temporary = await mkdtemp(resolve(tmpdir(), 'phone11-meeting-preview-'));
const ipcImport = "import { ipcRenderer } from 'electron';";
const ipcStub = `import { ipcRenderer as realIpc } from 'electron';
const previewStreams = [];
const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async constraints => {
  const stream = await originalGetUserMedia(constraints);
  previewStreams.push(stream);
  return stream;
};
const ipcRenderer = {
  on: (...args) => realIpc.on(...args),
  send: (...args) => realIpc.send(...args),
  invoke: async channel => {
    if (channel === 'phone11:meeting-state') return {
      revision: 'synthetic-preview-test', meetingIds: ['12345678-1234-4234-8234-123456789012']
    };
    if (channel === 'phone11:meeting-join') {
      if (previewStreams.some(stream => stream.getTracks().some(track => track.readyState !== 'ended')))
        throw new Error('Admission requested while preview camera is active');
      realIpc.send('phone11:preview-qa-admission');
      throw new Error('Synthetic admission refused');
    }
    if (channel === 'phone11:meeting-join-failed' || channel === 'phone11:meeting-finished') return;
    throw new Error('Unexpected meeting IPC: ' + channel);
  }
};`;

try {
  let replacements = 0;
  await build({
    entryPoints: [preloadSource], outfile: resolve(temporary, 'meeting-preload.cjs'),
    bundle: true, platform: 'browser', target: 'chrome128', format: 'cjs',
    external: ['electron'],
    plugins: [{ name: 'isolated-preview-admission', setup(plugin) {
      plugin.onLoad({ filter: /meeting-preload\.ts$/ }, async () => {
        const { readFile } = await import('node:fs/promises');
        const original = await readFile(preloadSource, 'utf8');
        if (original.split(ipcImport).length !== 2)
          throw new Error('Meeting preload IPC import changed; update the preview test deliberately');
        replacements++;
        return { contents: original.replace(ipcImport, ipcStub), loader: 'ts', resolveDir: dirname(preloadSource) };
      });
    } }],
  });
  if (replacements !== 1) throw new Error('Meeting preload source was not transformed exactly once');

  const child = spawn(electron, [resolve(root, 'test/fixtures/meeting-preview-browser.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PHONE11_PREVIEW_QA_HTML: resolve(root, 'src/meeting.html'),
      PHONE11_PREVIEW_QA_PRELOAD: resolve(temporary, 'meeting-preload.cjs'),
      PHONE11_PREVIEW_QA_USER_DATA: resolve(temporary, 'user-data'),
    },
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectExit(new Error('Synthetic meeting preview timed out after 20 seconds'));
    }, 20_000);
    child.once('error', error => { clearTimeout(timer); rejectExit(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit(code ?? (signal ? 1 : 0)); });
  });
  if (exitCode !== 0) throw new Error(`Synthetic meeting preview exited with ${exitCode}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
