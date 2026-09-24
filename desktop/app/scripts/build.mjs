import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourcesDir = process.env.PHONE11_RESOURCE_STAGE || resolve(root, 'resources');
await mkdir(resolve(root, 'dist'), { recursive: true });
let pinnedHash = '0'.repeat(64); // No staged helper means calling fails closed.
try {
  const bytes = await readFile(resolve(resourcesDir, 'helper-integrity.json'));
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.platform !== process.platform || !manifest.files || !manifest.symlinks)
    throw new Error('Invalid platform helper integrity manifest');
  pinnedHash = createHash('sha256').update(bytes).digest('hex');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const name of ['main', 'preload']) {
  await build({ entryPoints: [resolve(root, `src/${name}.ts`)], outfile: resolve(root, `dist/${name}.cjs`),
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'],
    sourcemap: false, minify: false,
    define: name === 'main' ? { __PHONE11_MANIFEST_SHA256__: JSON.stringify(pinnedHash) } : {} });
}
await build({ entryPoints: [resolve(root, 'src/renderer.ts')], outfile: resolve(root, 'dist/renderer.js'),
  bundle: true, platform: 'browser', target: 'chrome128', format: 'iife' });
for (const name of ['index.html', 'style.css']) await copyFile(resolve(root, `src/${name}`), resolve(root, `dist/${name}`));
