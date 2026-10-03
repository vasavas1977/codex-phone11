import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type Platform = 'darwin' | 'win32';
type IntegrityManifest = { platform: Platform; files: Record<string, string>; symlinks: Record<string, string> };
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const within = (root: string, path: string): boolean => path === root || path.startsWith(`${root}${sep}`);
const validEntry = (path: string): boolean => path.length > 0 && path.length < 1024 &&
  !isAbsolute(path) && !path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'));

export function helperExecutable(resourcesDir: string, platform: Platform): string {
  return platform === 'darwin'
    ? join(resourcesDir, 'helper', 'mac', 'phone11_siprix_helper.app', 'Contents', 'MacOS', 'phone11_siprix_helper')
    : join(resourcesDir, 'helper', 'win', 'phone11_siprix_helper.exe');
}

/** Hashes the entire loader-visible helper tree against a build-pinned manifest. */
export async function verifyPackagedHelper(path: string, resourcesDir: string,
                                            pinnedManifestSha256: string,
                                            platform: Platform = process.platform as Platform): Promise<boolean> {
  try {
    if (platform !== 'darwin' && platform !== 'win32') return false;
    if (resolve(path) !== resolve(helperExecutable(resourcesDir, platform)) || !hash(pinnedManifestSha256)) return false;
    const root = join(resourcesDir, 'helper', platform === 'darwin' ? 'mac' : 'win');
    const resourcesReal = await realpath(resourcesDir);
    const rootReal = await realpath(root);
    if (rootReal !== join(resourcesReal, 'helper', platform === 'darwin' ? 'mac' : 'win')) return false;
    const manifestPath = join(resourcesDir, 'helper-integrity.json');
    if (await realpath(manifestPath) !== join(resourcesReal, 'helper-integrity.json')) return false;
    const manifestBytes = await readFile(manifestPath);
    if (!timingSafeEqual(Buffer.from(sha(manifestBytes), 'hex'), Buffer.from(pinnedManifestSha256, 'hex'))) return false;
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as IntegrityManifest;
    if (!plain(manifest) || manifest.platform !== platform || !plain(manifest.files) || !plain(manifest.symlinks)) return false;
    const expectedFiles = Object.entries(manifest.files);
    const expectedLinks = Object.entries(manifest.symlinks);
    if (expectedFiles.length < 1 || expectedFiles.length + expectedLinks.length > 5000 ||
        expectedFiles.some(([name, value]) => !validEntry(name) || !hash(value)) ||
        expectedLinks.some(([name, value]) => !validEntry(name) || typeof value !== 'string' || !value || isAbsolute(value))) return false;
    const executable = relative(root, path).split(sep).join('/');
    if (!hash(manifest.files[executable])) return false;
    if (platform === 'win32' && !['siprix.dll', 'siprixMedia.dll'].every(name => hash(manifest.files[name]))) return false;
    if (platform === 'darwin') {
      for (const [framework, binary] of [['siprix', 'siprix'], ['siprixMedia', 'siprixMedia']]) {
        const key = `phone11_siprix_helper.app/Contents/Frameworks/${framework}.framework/${binary}`;
        if (!hash(manifest.files[key]) && typeof manifest.symlinks[key] !== 'string') return false;
        const binaryReal = await realpath(join(root, key));
        if (!within(rootReal, binaryReal) || !(await lstat(binaryReal)).isFile()) return false;
      }
    }
    const actualFiles = new Set<string>();
    const actualLinks = new Set<string>();
    let bytes = 0;
    async function scan(dir: string): Promise<boolean> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const absolute = join(dir, entry.name);
        const key = relative(root, absolute).split(sep).join('/');
        if (!validEntry(key)) return false;
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) {
          const target = await readlink(absolute);
          if (manifest.symlinks[key] !== target || !within(rootReal, await realpath(absolute))) return false;
          actualLinks.add(key);
        } else if (info.isDirectory()) {
          if (!(await scan(absolute))) return false;
        } else if (info.isFile()) {
          if (!hash(manifest.files[key]) || info.size < 1 || info.size > 100_000_000) return false;
          bytes += info.size;
          if (bytes > 500_000_000) return false;
          const actual = Buffer.from(sha(await readFile(absolute)), 'hex');
          if (!timingSafeEqual(actual, Buffer.from(manifest.files[key], 'hex'))) return false;
          actualFiles.add(key);
        } else return false;
      }
      return true;
    }
    if (!(await scan(root))) return false;
    if (actualFiles.size !== expectedFiles.length || actualLinks.size !== expectedLinks.length) return false;
    const binaryReal = await realpath(path);
    const expectedReal = join(rootReal, relative(root, path));
    return binaryReal === expectedReal && dirname(binaryReal) === dirname(expectedReal) &&
      (platform !== 'darwin' || ((await lstat(binaryReal)).mode & 0o111) !== 0);
  } catch { return false; }
}
