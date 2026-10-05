import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = process.env.PHONE11_BRACES_NODE_MODULES || path.join(root, 'node_modules');
const store = path.join(dependencies, '.pnpm');
const packageDirectory = name => {
  const entries = fs.readdirSync(store).filter(entry => entry.startsWith(`${name}@`));
  const versions = { braces: '3.0.3', micromatch: '4.0.8', chokidar: '3.6.0' };
  const entry = entries.find(entry => entry === `${name}@${versions[name]}`)
    || entries.find(entry => entry.startsWith(`${name}@${versions[name]}_`));
  assert.ok(entry, `Missing locked local ${name}@${versions[name]} input; no test downloads dependencies`);
  return path.join(store, entry, 'node_modules', name);
};
const patch = path.join(root, 'patches/braces@3.0.3.patch');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'phone11-braces-depth-test-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const originalDirectory = path.join(scratch, 'original');
const patchedDirectory = path.join(scratch, 'patched');
const input = packageDirectory('braces');
fs.cpSync(input, originalDirectory, { recursive: true, dereference: true });
const applyPatch = (directory, reverse = false) => {
  const result = spawnSync('git', ['apply', ...(reverse ? ['--reverse'] : []), '--unsafe-paths', patch], {
    cwd: directory, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
};
// An installed pnpm-patched input is reversed only in our owned scratch copy.
if (fs.readFileSync(path.join(originalDirectory, 'lib/utils.js'), 'utf8').includes('exports.assertDepth')) {
  applyPatch(originalDirectory, true);
}
const publishedHashes = {
  'index.js': '332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4',
  'lib/parse.js': 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310',
  'lib/compile.js': 'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f',
  'lib/expand.js': '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7',
  'lib/stringify.js': '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a',
  'lib/utils.js': 'b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7',
  'lib/constants.js': 'c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b',
};
for (const [file, hash] of Object.entries(publishedHashes)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(originalDirectory, file))).digest('hex'), hash, file);
}
fs.cpSync(originalDirectory, patchedDirectory, { recursive: true });
applyPatch(patchedDirectory);
const inputRequire = createRequire(path.join(input, 'package.json'));
for (const directory of [originalDirectory, patchedDirectory]) {
  fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.dirname(inputRequire.resolve('fill-range/package.json')), path.join(directory, 'node_modules/fill-range'));
}
const require = createRequire(import.meta.url);
const original = require(originalDirectory);
const patched = require(patchedDirectory);
const methods = ['parse', 'compile', 'expand', 'stringify'];
const recursive = methods.slice(1);
const pattern = (depth, kind = 'brace') => kind === 'paren'
  ? '('.repeat(depth) + 'a' + ')'.repeat(depth)
  : '{'.repeat(depth) + 'a' + '}'.repeat(depth);
const astChain = (depth, leaf = { type: 'text', value: 'a' }) => {
  let node = leaf;
  for (let index = 0; index < depth; index++) {
    const parent = { type: 'paren', nodes: [node] };
    node.parent = parent;
    node = parent;
  }
  const ast = { type: 'root', nodes: [node] };
  node.parent = ast;
  return ast;
};
const guarded = error => (error instanceof SyntaxError || error instanceof RangeError)
  && /(?:depth|cycle)/.test(error.message) && !/call stack/i.test(error.message);

test('manifest and every locked braces edge retain version3.0.3 and bind the generated patch hash', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.pnpm.patchedDependencies['braces@3.0.3'], 'patches/braces@3.0.3.patch');
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const hash = lock.match(/braces@3\.0\.3:\n    hash: (\w+)\n    path: patches\/braces@3\.0\.3\.patch/)[1];
  assert.ok(lock.includes(`braces@3.0.3(patch_hash=${hash}):`));
  const edges = [...lock.matchAll(/      braces: (.+)/g)].map(match => match[1]);
  assert.deepEqual(edges, Array(2).fill(`3.0.3(patch_hash=${hash})`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(patchedDirectory, 'package.json'))).version, '3.0.3');
});
for (const method of recursive) {
  test(`published ${method} reproduces native stack exhaustion; maintained patch refuses before walking`, () => {
    const hostile = pattern(4998);
    assert.ok(hostile.length < 10_000);
    assert.doesNotThrow(() => original.parse(hostile));
    assert.throws(() => original[method](hostile), error => error instanceof RangeError && /call stack/i.test(error.message));
    assert.throws(() => patched[method](hostile), guarded);
  });
}
for (const method of methods) {
  for (const kind of ['brace', 'paren']) {
    test(`${method} ${kind} accepts100 and rejects101 and4998`, () => {
      assert.doesNotThrow(() => patched[method](pattern(100, kind)));
      for (const depth of [101, 4998]) assert.throws(() => patched[method](pattern(depth, kind)), guarded);
    });
  }
  test(`${method} counts mixed brace and parenthesis syntax in one ceiling`, () => {
    const mixed = depth => Array.from({ length: depth }, (_, index) => index % 2 ? '(' : '{').join('')
      + 'a' + Array.from({ length: depth }, (_, index) => (depth - index - 1) % 2 ? ')' : '}').join('');
    assert.doesNotThrow(() => patched[method](mixed(100)));
    assert.throws(() => patched[method](mixed(101)), guarded);
  });
  for (const maxDepth of [0, 0.5, 1, 3.5, 99.5]) {
    test(`${method} finite maxDepth${maxDepth} is honored before increment`, () => {
      assert.doesNotThrow(() => patched[method](pattern(Math.floor(maxDepth)), { maxDepth }));
      assert.throws(() => patched[method](pattern(Math.floor(maxDepth) + 1), { maxDepth }), guarded);
    });
  }
  for (const maxDepth of [100_000, Infinity, -Infinity, NaN, '100000', null, false]) {
    test(`${method} maxDepth${String(maxDepth)} cannot bypass the100 ceiling`, () => {
      assert.doesNotThrow(() => patched[method](pattern(100), { maxDepth }));
      assert.throws(() => patched[method](pattern(101), { maxDepth }), guarded);
    });
  }
  test(`${method} negative finite threshold cannot bypass refusal`, () => {
    assert.throws(() => patched[method]('{a}', { maxDepth: -0.5 }), guarded);
  });
}
for (const method of recursive) {
  test(`${method} direct AST accepts100/rejects101/10000 independently of parsing`, () => {
    assert.doesNotThrow(() => patched[method](astChain(100)));
    for (const depth of [101, 10_000]) assert.throws(() => patched[method](astChain(depth)), guarded);
    assert.throws(() => patched[method](astChain(4), { maxDepth: 3.5 }), guarded);
  });
  test(`${method} direct AST cannot disable the ceiling with large/nonfinite/nonnumeric options`, () => {
    for (const maxDepth of [100_000, Infinity, -Infinity, NaN, '100000', null, false]) {
      assert.doesNotThrow(() => patched[method](astChain(100), { maxDepth }));
      assert.throws(() => patched[method](astChain(101), { maxDepth }), guarded);
    }
  });
  test(`${method} AST root/terminal/container thresholds agree with parsed structural depth`, () => {
    assert.doesNotThrow(() => patched[method]({ type: 'root', nodes: [{ type: 'text', value: 'x' }] }, { maxDepth: 0 }));
    const container = () => ({ type: 'paren', nodes: [{ type: 'text', value: 'x' }] });
    assert.doesNotThrow(() => patched[method](container(), { maxDepth: 1 }));
    assert.throws(() => patched[method](container(), { maxDepth: 0 }), guarded);
  });
  test(`${method} cyclic node path is refused before recursive walking or mutation`, () => {
    const node = { type: 'paren', nodes: [] };
    node.nodes.push(node);
    const ast = { type: 'root', nodes: [node] };
    assert.throws(() => patched[method](ast), guarded);
    assert.equal(node.queue, undefined);
  });
  test(`${method} shared DAG aliases retain normal released behavior`, () => {
    const make = () => {
      const node = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
      return { type: 'root', nodes: [node, node] };
    };
    assert.deepEqual(patched[method](make()), original[method](make()));
  });
  test(`${method} repeated DAG child checks its longest path instead of global visited status`, () => {
    const shared = { type: 'paren', nodes: [{ type: 'paren', nodes: [{ type: 'text', value: 'x' }] }] };
    const deep = astChain(100, shared);
    deep.nodes.unshift(shared);
    assert.throws(() => patched[method](deep), guarded);
  });
  for (const shortCircuit of ['invalid', 'dollar', 'value', 'ranges']) {
    test(`${method} checks excessive descendants before ${shortCircuit} short-circuit`, () => {
      const ast = astChain(199);
      let node = ast;
      for (let depth = 0; depth < 100; depth++) node = node.nodes[0];
      node[shortCircuit] = shortCircuit === 'value' ? 'x' : shortCircuit === 'ranges' ? 1 : true;
      assert.throws(() => patched[method](ast), guarded);
    });
  }
}
test('expansion invalid-subtree counterreset reproduction is accepted by original and refused by patch', () => {
  const make = () => {
    const ast = astChain(199);
    let node = ast;
    for (let depth = 0; depth < 100; depth++) node = node.nodes[0];
    node.invalid = true;
    return ast;
  };
  assert.doesNotThrow(() => original.expand(make()));
  assert.throws(() => patched.expand(make()), guarded);
});
test('expansion rejects nonanchored parent cycles and normal parsed parent links remain accepted', () => {
  const node = { type: 'paren', nodes: [] };
  node.parent = node;
  assert.throws(() => patched.expand({ type: 'root', nodes: [node] }), guarded);
  assert.deepEqual(patched.expand('{a,b}/{c,d}'), original.expand('{a,b}/{c,d}'));
});
const compatibility = [
  '', 'a', '{}', '{a}', '{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}}', '{}{a}', '{1..8}',
  'a/{b,c}/d', '{a,,b,}', '{00..05}', '{z..a..2}', '{1..10..2}', '{1..3,x}',
  '\\{a,b}', '${a,b}', '[{a,b}]', "'{a,b}'", '({a,b})', 'a{b{c{d,e}f}g}h',
  'z{a,b},c}d', 'z{a,b{,c}d', '{a..}', '{x,y}{1,2}', '{a..Z}', 'foo/{bar,baz}/**/*.tsx',
];
for (const method of recursive) {
  test(`${method} preserves released shallow/malformed/escapeInvalid behavior`, () => {
    for (const input of compatibility) for (const escapeInvalid of [false, true]) {
      assert.deepEqual(patched[method](input, { escapeInvalid }), original[method](input, { escapeInvalid }), `${input}/${escapeInvalid}`);
    }
  });
}
test('1000 deterministic shallow patterns preserve compile/expand/stringify including escapeInvalid', () => {
  const tokens = ['x', '{a,b}', '{{a}}', '{1..3}', '\\{', '}', '(', ')', '[{}]', "'{a,b}'", '${x}'];
  let state = 0x20261005;
  for (let index = 0; index < 1000; index++) {
    let input = '';
    for (let part = 0; part < 6; part++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      input += tokens[state % tokens.length];
    }
    for (const method of recursive) for (const escapeInvalid of [false, true]) {
      assert.deepEqual(patched[method](input, { escapeInvalid }), original[method](input, { escapeInvalid }), `${method}/${index}/${escapeInvalid}`);
    }
  }
});
for (const method of methods) {
  test(`${method} escaped/quoted/bracketed braces remain literal and do not consume structural depth`, () => {
    for (const input of ['\\{'.repeat(101), "'" + pattern(101) + "'", '[' + pattern(101) + ']']) {
      if (method === 'parse') assert.equal(patched.stringify(patched.parse(input)), original.stringify(original.parse(input)));
      else assert.deepEqual(patched[method](input), original[method](input));
    }
  });
}
const consumer = name => {
  const source = packageDirectory(name);
  const target = path.join(scratch, name);
  fs.cpSync(source, target, { recursive: true, dereference: true });
  fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
  const consumerRequire = createRequire(path.join(source, 'package.json'));
  for (const dependency of Object.keys(JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).dependencies || {})) {
    const directory = dependency === 'braces' ? patchedDirectory : path.dirname(consumerRequire.resolve(`${dependency}/package.json`));
    fs.symlinkSync(directory, path.join(target, 'node_modules', dependency));
  }
  return require(target);
};
const micromatch = consumer('micromatch');
const chokidar = consumer('chokidar');
test('actual micromatch4.0.8 uses patched braces for normal glob compilation and hostile refusal', () => {
  assert.deepEqual(micromatch(['foo/a.ts', 'foo/b.tsx', 'foo/c.js'], 'foo/*.{ts,tsx}'), ['foo/a.ts', 'foo/b.tsx']);
  assert.deepEqual(micromatch.braces('x/{a,b}', { expand: true }), ['x/a', 'x/b']);
  assert.throws(() => micromatch.braces(pattern(101)), guarded);
});
test('actual chokidar3.6 glob helper keeps ordinary brace paths and refuses excessive nesting', async () => {
  const watcher = new chokidar.FSWatcher({ ignoreInitial: true });
  try {
    assert.ok(watcher._getWatchHelpers(path.join(scratch, '*.{ts,tsx}'), 0).hasGlob);
    assert.throws(() => watcher._getWatchHelpers(path.join(scratch, pattern(101) + '/*.ts'), 0), guarded);
  } finally { await watcher.close(); }
});
test('actual chokidar3.6 watcher observes normal expanded brace globs in owned temporary files', async () => {
  const directory = path.join(scratch, 'watched');
  fs.mkdirSync(directory);
  for (const name of ['one.tsx', 'two.tsx', 'three.js']) fs.writeFileSync(path.join(directory, name), 'fixture');
  const found = [];
  const watcher = chokidar.watch(path.join(directory, '{one,two}.tsx'), { persistent: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned fixture watch readiness timed out')), 3000);
      watcher.on('add', file => found.push(path.basename(file)));
      watcher.once('error', error => { clearTimeout(timer); reject(error); });
      watcher.once('ready', () => { clearTimeout(timer); resolve(); });
    });
    assert.deepEqual(found.sort(), ['one.tsx', 'two.tsx']);
  } finally { await watcher.close(); }
});

// The hosted gate must set this after the project's real frozen pnpm install.
// Scratch-only runs intentionally make no assertion about installed resolution.
if (process.env.PHONE11_BRACES_REQUIRE_INSTALLED_PATCH === '1') {
  test('actual installed micromatch/chokidar resolutions contain this exact maintained patch', async () => {
    for (const name of ['micromatch', 'chokidar']) {
      const source = packageDirectory(name);
      const sourceRequire = createRequire(path.join(source, 'package.json'));
      const resolved = path.dirname(sourceRequire.resolve('braces/package.json'));
      assert.equal(JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'))).version, '3.0.3');
      for (const file of Object.keys(publishedHashes)) {
        assert.deepEqual(fs.readFileSync(path.join(resolved, file)), fs.readFileSync(path.join(patchedDirectory, file)), `${name} actual braces/${file}`);
      }
      const actual = sourceRequire('braces');
      assert.throws(() => actual.compile(pattern(101)), guarded);
      assert.throws(() => actual.expand(astChain(199)), guarded);
      assert.deepEqual(actual.expand('x/{a,b}'), ['x/a', 'x/b']);
      if (name === 'micromatch') assert.throws(() => require(source).braces(pattern(101)), guarded);
      if (name === 'chokidar') {
        const watcher = new (require(source).FSWatcher)({ ignoreInitial: true });
        try { assert.throws(() => watcher._getWatchHelpers(path.join(scratch, pattern(101) + '/*.ts'), 0), guarded); }
        finally { await watcher.close(); }
      }
    }
  });
}
