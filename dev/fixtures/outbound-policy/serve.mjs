/** Explicit launch only. Bundles once into RAM, then serves three fixed loopback assets. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP, HOST, PORT, classifyRequest } from './server-policy.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const DONOR = '/Users/vasavas16macbookpro/Documents/Codex/phone11-pbx-ivr-safety-20261013';
const COMPONENT = join(ROOT, 'components/admin/outbound-call-policy.tsx');
const COMPONENT_SHA = 'b488652a35d49b0c7969b6606493aab22ca435128fb7580bf94061dfd2b45207';
export const EXPECTED_ASSETS = Object.freeze({
  html: Object.freeze({ bytes: 313, sha256: 'e5cf1bd9d44ad8bb68de81daa08d2ddf46eebb8883eb8529c11e256f34b1ac48' }),
  css: Object.freeze({ bytes: 427, sha256: 'ee6129820e99fba24cad949d8492124e788866bdb11b205f2d3743be4e0f9b21' }),
  js: Object.freeze({ bytes: 288865, sha256: 'fbc3e16d84a901ace1349ebb4baed5480a0d704e7f9ddccdb8ee2efddde8f1e6' }),
});
/** Pure exact-artifact guard. Callers cannot provide alternate expected pins. */
export function validateAssetBytes(name, value) {
  const expected = Object.hasOwn(EXPECTED_ASSETS, name) ? EXPECTED_ASSETS[name] : null;
  if (!expected || !Buffer.isBuffer(value) || value.length !== expected.bytes ||
      createHash('sha256').update(value).digest('hex') !== expected.sha256)
    throw new Error('FIXTURE_ASSET_PIN_REFUSED');
  return value;
}
export function validateAssets(assets) {
  if (!assets || Object.keys(assets).sort().join(',') !== 'css,html,js')
    throw new Error('FIXTURE_ASSET_PIN_REFUSED');
  for (const name of Object.keys(EXPECTED_ASSETS)) validateAssetBytes(name, assets[name]);
  return assets;
}
const HTML = Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generated Phone11 policy fixture</title><link rel="stylesheet" href="/fixture.css"><script defer src="/fixture.js"></script></head><body><div id="fixture-root"></div></body></html>');
const CSS = Buffer.from('body{margin:0;background:#f4f6f9;color:#17212e;font-family:system-ui,sans-serif}main{max-width:680px;margin:24px auto;padding:0 18px}h1{font-size:24px}p{line-height:1.5}.harness{border:1px dashed #77869a;border-radius:12px;padding:16px;margin:20px 0;background:#eaf1f9}.harness label{display:block;margin:10px 0}.harness button,.harness select{font:inherit;min-height:38px;margin:5px;padding:6px 10px}.harness p{font-size:13px}');
export async function prepareAssets() {
  const source = await readFile(COMPONENT);
  if (createHash('sha256').update(source).digest('hex') !== COMPONENT_SHA)
    throw new Error('FIXTURE_COMPONENT_SOURCE_DRIFT');
  const require = createRequire(join(DONOR, 'package.json'));
  const esbuild = require('esbuild');
  const boundary = join(HERE, 'boundary.tsx');
  const substitutions = new Map([
    ['@/hooks/use-auth', boundary], ['@/hooks/use-colors', boundary],
    ['@/hooks/use-pbx-admin', boundary], ['@/lib/_core/auth', boundary],
    ['react-native', join(dirname(require.resolve('react-native-web/package.json')), 'dist/index.js')],
    ['react', require.resolve('react')], ['react/jsx-runtime', require.resolve('react/jsx-runtime')],
    ['react-dom/client', require.resolve('react-dom/client')],
  ]);
  const timer = setTimeout(() => esbuild.stop(), 30_000);
  let output;
  try {
    output = await esbuild.build({ entryPoints: [join(HERE, 'entry.tsx')], absWorkingDir: ROOT,
      outfile: 'fixture.js', bundle: true, write: false, platform: 'browser', format: 'iife',
      jsx: 'automatic', minify: true, sourcemap: false, logLevel: 'silent', metafile: true,
      define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [join(DONOR, 'node_modules')],
      plugins: [{ name: 'fixture-only-boundaries', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (substitutions.has(args.path)) return { path: substitutions.get(args.path) };
          if (args.path.startsWith('@/')) throw new Error('FIXTURE_UNAPPROVED_APP_IMPORT');
        });
      } }],
    });
  } finally { clearTimeout(timer); esbuild.stop(); }
  if (output.outputFiles.length !== 1 || !output.outputFiles[0].path.endsWith('fixture.js') ||
      output.outputFiles[0].contents.length > 2 * 1024 * 1024)
    throw new Error('FIXTURE_ASSET_BOUNDS');
  // Compile isolation is also checked from actual build inputs, not aliases alone.
  const applicationInputs = Object.keys(output.metafile.inputs).map(p => resolve(ROOT, p))
    .filter(p => p.startsWith(ROOT + '/') && !p.startsWith(HERE + '/'));
  if (applicationInputs.length !== 1 || applicationInputs[0] !== COMPONENT)
    throw new Error('FIXTURE_UNEXPECTED_PRODUCT_IMPORT');
  return validateAssets({ html: HTML, css: CSS, js: Buffer.from(output.outputFiles[0].contents) });
}
export function makeHandler(assets) {
  return (request, response) => {
    const route = classifyRequest(request.method, request.url, request.headers);
    const body = route.asset ? assets[route.asset] : Buffer.from(route.status === 204 ? '' : 'Fixture request refused.');
    response.writeHead(route.status, { 'Content-Type': route.asset === 'js' ? 'text/javascript; charset=utf-8' :
      route.asset === 'css' ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Length': body.length, 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
}
async function main() {
  if (process.argv.length !== 2) throw new Error('FIXTURE_NO_OPTIONS_OR_OVERRIDES');
  const assets = await prepareAssets();
  const server = createServer({ maxHeaderSize: 8192 }, makeHandler(assets));
  server.maxConnections = 4; server.maxHeadersCount = 30;
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000;
  const lifetime = setTimeout(() => { server.closeAllConnections(); server.close(); }, 30 * 60_000);
  server.once('close', () => clearTimeout(lifetime));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.closeAllConnections(); server.close();
  });
  server.once('error', () => { clearTimeout(lifetime); console.error('Fixture could not bind fixed loopback port.'); process.exitCode = 1; });
  server.listen(PORT, HOST, () => console.log('Generated fixture: http://127.0.0.1:8106/ (30-minute maximum; Ctrl-C to stop)'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('Fixture preparation refused. No production action was attempted.'); process.exitCode = 1; });
