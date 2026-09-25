import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'node:test';

test('desktop participant labels keep human names and replace provider identities', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'phone11-participant-name-'));
  const output = join(temporary, 'meeting-preload.mjs');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { readyState: 'loading', addEventListener() {} },
  });

  try {
    await build({
      entryPoints: [resolve('src/meeting-preload.ts')],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [{
        name: 'desktop-meeting-test-stubs',
        setup(plugin) {
          plugin.onResolve({ filter: /^(electron|livekit-client)$/ }, args => ({
            path: args.path,
            namespace: 'desktop-meeting-test-stubs',
          }));
          plugin.onLoad({ filter: /.*/, namespace: 'desktop-meeting-test-stubs' }, args => ({
            loader: 'js',
            contents: args.path === 'electron'
              ? 'export const ipcRenderer = {};'
              : 'export class Participant {} export class Room {} export const RoomEvent = {}; export const Track = { Kind: { Audio: "audio", Video: "video" } };',
          }));
        },
      }],
    });

    const module = await import(`${pathToFileURL(output).href}?test=${Date.now()}`) as {
      participantName(participant: { isLocal: boolean; identity: string; name?: string }): string;
    };
    const label = module.participantName;
    const opaque = '6fa4634ade063138::phone11-plain-video-abc123';
    const uuid = '8d9723ea-f18a-4caa-b5e2-489061a0bd44';

    assert.equal(label({ isLocal: false, identity: opaque, name: opaque }), 'Participant');
    assert.equal(label({ isLocal: false, identity: uuid, name: uuid }), 'Participant');
    assert.equal(label({ isLocal: false, identity: 'p11-t7-u3001', name: 'p11-t7-u3001' }), 'Participant');
    assert.equal(label({ isLocal: false, identity: 'opaque-id', name: '  Nadia S.  ' }), 'Nadia S.');
    assert.equal(label({ isLocal: false, identity: opaque }), 'Participant');
    assert.equal(label({ isLocal: true, identity: opaque, name: opaque }), 'You');
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: unknown }).document;
    await rm(temporary, { recursive: true, force: true });
  }
});
