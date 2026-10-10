# Maintained braces depth mitigation — 5 October 2026

Candidate base: `32d9af7be19e1dab0abe1292a10a28d1d69735be`.
This is a maintained patch to the existing `braces@3.0.3`, not an official fixed
release, security exception, renamed package or scanner suppression. The
[official advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists
`<=3.0.3` as affected with no patched version; the freshly read
[npm registry](https://registry.npmjs.org/braces) lists latest `3.0.3`.
The historical dependency audit remains an observation at its stated time.

## Source and boundary

The proposal inspected is [PR #72](https://github.com/micromatch/braces/pull/72),
head `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, closed **unmerged** on 5 October.
Upstream master `e53730e6f935498326c72d768889ac194eedc0e0` still identifies 3.0.3.
Published 3.0.3's npm `gitHead` is
`74b2db2938fad48a2ea54a9c8bf27a37a62c350d`.

The patch changes only `lib/parse.js`, `compile.js`, `expand.js`, `stringify.js`
and `utils.js`. It adapts the proposal's brace/parenthesis parse ceiling and
expansion parent-chain cycle refusal to the released source. Its recursive
walkers and stringify's original no-parent recursion remain unchanged.
A shared **iterative** AST preflight checks the entire structural path before
invalid, dollar, value or range short-circuits. This closes a proposal gap:
a direct AST of depth 199 with an invalid subtree at depth 100 was accepted by
expansion when nested stringify restarted its counter. Ancestor tracking rejects
node cycles without rejecting shared DAG nodes. Completed subtree heights are
memoized, and each incoming depth is checked against its cached height: a shallow
alias cannot hide a deeper path. Independent review reproduced exponential
preflight work on a compact 36-object value-short-circuit DAG in the initial
candidate. The corrected cache makes that traversal linear in structural nodes
and edges; three bounded subprocess regressions preserve released output for
80-level compact DAGs without enumerating their paths.

The maximum is 100 structural levels. Finite numeric `maxDepth` uses
`Math.min(100, value)`: stricter fractional thresholds are honored before the
next integer level; negative finite values refuse positive nesting and cannot
disable the guard. Undefined, nonnumeric and nonfinite values use 100. Large
finite numbers are capped at 100. Parser depth counts combined unescaped,
unquoted brace/parenthesis opens; bracket/quoted/escaped literals do not count.
For ASTs, a root wrapper is depth 0, a standalone container is depth 1, each
container child adds 1, and terminal nodes do not add a level. String input
exceeding its threshold raises `SyntaxError`; AST depth/node cycles and looping
nonanchored expansion parent chains raise explicit `RangeError`, before native
stack exhaustion. Inputs beyond the new ceiling intentionally become errors.

This is a recursion-depth mitigation. It does not promise to bound AST width,
expansion cardinality, regex complexity, custom getters/proxies/iterators or
all resource exhaustion. Existing range limits, package identity, dependencies
and the two preexisting patches remain intact.

## Verification and install gate

On Node 22.23.1, the original under 10,000-character depth 4998 pattern parses but
causes native stack exhaustion in compile/expand/stringify; the patch refuses it.
The focused suite checks 100/101, mixed syntax, stricter fractional and impossible
options, deep/cyclic/direct ASTs, invalid subtrees, longest-path DAG aliases,
stringify `escapeInvalid`, 6,000 seeded shallow compatibility comparisons,
actual micromatch 4.0.8 compilation and an actual chokidar 3.6.0 temporary-file watch.
Scratch-only execution registers 114 tests; it makes no installed-resolution claim.

All 12 unchanged published upstream test files at the npm gitHead execute 764
registered tests on original, proposal and patched sources, with zero failures.
A synchronous describe/it compatibility harness and `/bin/bash` bash-path shim
were used because Mocha was unavailable. Fixture entries intentionally omitted
by upstream are not counted as executed tests; this is not the proposal author's
904-test/Node 8/Windows result. Original/proposal/source inputs and raw logs are
retained separately for independent review.

Exact cached pnpm 9.12.0 generated patch hash
`z5dn2cikq3bclbpyfwz5ssf4ay`. Its full offline lock-only regeneration also rewrote
unrelated peer keys; that raw result was retained, and only its braces patch
entry, snapshot and two consumer references were carried onto the original
lock. Reversing those four braces-specific changes yields the byte-identical
base lock. An offline `--lockfile-only --frozen-lockfile --ignore-scripts` check
accepts this minimal lock; **that alone is not a full installation**.

A separate owned three-package consumer fixture uses the exact 16-package
subset of this lock and read-only copies of already-local CAS inputs. Actual
pnpm 9.12.0 `--offline --frozen-lockfile --ignore-scripts` installation applies the
patch with zero downloads, without modifying main node_modules or shared cache.
All 115 tests pass with the required installed-resolution mode: both consumers'
actual braces files match this exact patch and reject hostile inputs. An initial
newly resolved fixture selected uncached picomatch 2.3.2 and failed offline;
using the existing lock's exact 2.3.1 subset resolved that fixture mismatch.
This subset proof does not claim a full Phone11 frozen install or hosted CI pass.

The standalone security gate runs at the candidate checkout with scripts
disabled. Daily-use hosted CI preserves its existing normal frozen install and
native source postinstall, then runs the same required installed-consumer test:

```sh
test "$(pnpm --version)" = "9.12.0"
pnpm install --frozen-lockfile --ignore-scripts
PHONE11_BRACES_REQUIRE_INSTALLED_PATCH=1 node --test tests/phone11-braces-depth-mitigation.test.mjs
```

Require 115 passed tests, zero failed/cancelled/skipped/todo. Do not omit the
installed-resolution flag: the test then verifies actual installed micromatch
and chokidar resolution and source bytes, rather than only a scratch patch.
A retained scanner finding is expected while version 3.0.3 remains affected;
no scanner result, deployed-image inventory, production invocation, signed
package, provider or physical-device acceptance is established here.
Independent review and exact-head hosted install/tests precede integration.
