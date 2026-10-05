import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
// Reuse Expo's pinned XML parser dependency, without executing an Expo mod.
const expo = createRequire(require.resolve('expo/config-plugins'));
const xml = createRequire(expo.resolve('@expo/config-plugins/build/utils/XML'));
const sax = createRequire(xml.resolve('xml2js'))('sax');
const android = 'http://schemas.android.com/apk/res/android';
const service = 'com.oney.WebRTCModule.Phone11ScreenProjectionService';
const metadata = 'ai.phone11.meeting.SCREEN_TRANSACTION';
const permission = 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION';
const name = node => node.attributes.get(`${android}:name`);
const fail = message => { throw new Error(`Android screen manifest: ${message}`); };
export function verifyManifest(contents, mode) {
  if (mode !== 'off' && mode !== 'on') fail('mode must be off or on');
  if (Buffer.byteLength(contents) > 2 * 1024 * 1024) fail('manifest too large');
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  const roots = [], stack = []; let attributes = new Map();
  parser.ondoctype = () => fail('DOCTYPE is unsupported');
  parser.onerror = error => { throw error; };
  parser.onattribute = attribute => {
    const key = `${attribute.uri}:${attribute.local}`;
    if (attributes.has(key)) fail('duplicate or aliased attribute');
    attributes.set(key, attribute.value);
  };
  parser.onopentag = tag => {
    if (tag.uri) fail('framework elements must not be namespaced');
    const node = { tag: tag.local, attributes, children: [], parent: stack.at(-1) };
    attributes = new Map();
    if (node.parent) node.parent.children.push(node); else roots.push(node);
    stack.push(node);
  };
  parser.onclosetag = () => { stack.pop(); };
  parser.write(contents).close();
  if (roots.length !== 1 || roots[0].tag !== 'manifest') fail('requires one manifest');
  const manifest = roots[0], apps = manifest.children.filter(node => node.tag === 'application');
  if (apps.length !== 1) fail('requires one application');
  const app = apps[0], packageName = manifest.attributes.get(':package');
  const resolveName = value => value?.startsWith('.') ? `${packageName}${value}` : value && !value.includes('.') ? `${packageName}.${value}` : value;
  const found = { service: [], metadata: [], permission: [] };
  const visit = node => {
    const value = name(node);
    if (resolveName(value) === service) {
      if (node.tag !== 'service' || node.parent !== app) fail('ambiguous service owner');
      found.service.push(node);
    }
    if (value === metadata) {
      if (node.tag !== 'meta-data' || node.parent !== app) fail('ambiguous metadata owner');
      found.metadata.push(node);
    }
    if (value === permission) {
      if (node.tag !== 'uses-permission' || node.parent !== manifest) fail('ambiguous permission owner');
      found.permission.push(node);
    }
    node.children.forEach(visit);
  };
  visit(manifest);
  const expected = mode === 'on' ? 1 : 0;
  for (const [kind, nodes] of Object.entries(found)) if (nodes.length !== expected) fail(`expected ${expected} owned ${kind}`);
  if (mode === 'on') {
    const owned = found.service[0];
    for (const component of [app, owned]) {
      const enabled = component.attributes.get(`${android}:enabled`);
      if (enabled !== undefined && enabled !== 'true') fail('application and owned service must be provably enabled');
    }
    if (owned.attributes.get(`${android}:exported`) !== 'false' ||
        owned.attributes.get(`${android}:foregroundServiceType`) !== 'mediaProjection' ||
        owned.children.length)
      fail('service must be enabled, private, video projection only, without filters');
    const gate = found.metadata[0];
    if (gate.attributes.get(`${android}:value`) !== 'true' || gate.attributes.has(`${android}:resource`)) fail('metadata gate must be literal true');
    const grant = found.permission[0];
    if (grant.attributes.has(`${android}:maxSdkVersion`) || grant.attributes.has(`${android}:usesPermissionFlags`)) fail('projection permission must be unconditional');
  }
  return { mode, serviceCount: found.service.length, metadataCount: found.metadata.length, permissionCount: found.permission.length };
}
let entry;
try { entry = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href; }
catch { /* Imported by stdin/test launchers that have no real entry file. */ }
if (import.meta.url === entry) {
  try {
    if (process.argv.length !== 4) fail('usage: <manifest-path> <off|on>');
    console.log(JSON.stringify(verifyManifest(readFileSync(process.argv[2], 'utf8'), process.argv[3])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
