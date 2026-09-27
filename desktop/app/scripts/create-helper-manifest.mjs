import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('macOS or Windows required');
const resourcesDir = process.env.PHONE11_RESOURCE_STAGE || join(appRoot, 'resources');
const root = join(resourcesDir, 'helper', process.platform === 'darwin' ? 'mac' : 'win');
const files = {}, symlinks = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const key = relative(root, path).split(sep).join('/');
    const info = await lstat(path);
    if (info.isDirectory()) await walk(path);
    else if (info.isSymbolicLink()) symlinks[key] = await readlink(path);
    else if (info.isFile()) files[key] = createHash('sha256').update(await readFile(path)).digest('hex');
    else throw new Error(`Unsupported helper bundle entry: ${key}`);
  }
}
await walk(root);
if (Object.keys(files).length === 0) throw new Error('Helper bundle is empty');
await writeFile(join(resourcesDir, 'helper-integrity.json'),
  JSON.stringify({ platform: process.platform, files, symlinks }, null, 2) + '\n');
