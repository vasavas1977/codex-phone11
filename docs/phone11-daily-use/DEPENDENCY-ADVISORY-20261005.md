# Dependency advisory — 5 October 2026

Source-only audit base: `775dc0fb3c1b2ca38a52b89cace2daf2f968d2d5`.
The dependency graph was initially inspected at
`acc93c2fa6ea15c4dc48e424c0624fbbf1f8a07a`; the lockfile, package manifest,
backend Dockerfile and Metro/Tailwind configuration are unchanged between those
pins. `pnpm-lock.yaml` SHA-256:
`e5b640727e7b5e3a7431311bb71c26c3160dd80196311b8a180574a9d399f92c`.

## Advisory and remediation availability

[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
rates deeply nested brace-pattern stack exhaustion High (8.7), affects
`braces <=3.0.3`, and lists no patched version. Character limits alone do not
bound recursive AST depth. The
[upstream package manifest](https://github.com/micromatch/braces/blob/master/package.json)
still identifies version 3.0.3; [fix PR #72](https://github.com/micromatch/braces/pull/72)
was open when checked. The official
[npm versions page](https://www.npmjs.com/package/braces?activeTab=versions),
indexed five days before this audit, also lists 3.0.3 as `latest`. Fresh npm
registry retrieval was unavailable; this note does not claim a fresh registry
dist-tag response. These upstream states must be rechecked before remediation.

## Locked paths and input boundary

The lock resolves `braces@3.0.3` at line 3100 and its snapshot at line 9804.
`micromatch@4.0.8` depends on it at lines 12417–12420; `chokidar@3.6.0` also
depends directly on it at lines 9900–9903.

- Expo 54 → Expo CLI/Metro 0.83.2 → `metro-file-map` → micromatch → braces.
  React Native 0.81.5 → community CLI/Metro 0.83.3 reaches the same sink.
  The Metro snapshots bind micromatch at lines 12153–12175.
- NativeWind/Tailwind 3.4.19 → Chokidar, fast-glob or micromatch → braces.
  Tailwind bindings are at lines 13610–13622; fast-glob is at 11137–11143.
- Jest tooling in the locked graph also depends on micromatch. This is package
  presence, not proof that every test command invokes the vulnerable walker.

Cached consumer source inspection found Metro matching filesystem paths as
subjects against configured globs, Tailwind consuming configured content-file
patterns, and Chokidar expanding registered watch paths. Phone11's
`tailwind.config.js:19` supplies fixed repository content patterns;
`metro.config.js:1–10` composes Expo and NativeWind tooling. No direct first-party
braces/micromatch/glob-consumer import or untrusted HTTP/customer pattern path was
identified in the reviewed application/server source. This is a bounded source
reachability result, not proof of universal nonreachability.

The backend Dockerfile installs the shared manifest with `--prod` at
`infra/docker/backend/Dockerfile:27–28`, then copies those dependencies into the
final image at line 85. Expo/React Native are production dependencies in that
shared manifest, so excluding devDependencies alone does not remove their build
tooling. A rebuilt backend image can therefore contain braces even without an
identified backend invocation path. The server entrypoint is compiled with
external packages at Dockerfile line 63 and runs `dist/index.mjs` at line 111;
its reviewed source does not initialize Metro or Tailwind.

## Evidence limits and safe next steps

No fresh deployed-image inventory, Phone11 dependency scanner result or exploit
test was obtained. A sibling Connect11 Trivy failure is not a Phone11 CI result.
This audit performed no dependency edits, install, package download, suppression,
provider, database or device action.

Preserve advisory visibility. Do not pin a nonexistent fixed version, rename a
package to hide the finding, or treat the open upstream PR as a released fix.
Inspect the intended artifact separately. If backend package presence must be
removed, prepare a dedicated runtime dependency graph and independently verify
external imports, frozen-lock reproducibility and backend packaging. If an
interim patch is needed, review an exact upstream depth-guard backport using the
existing pnpm patch mechanism, with original-suite, direct-AST/string depth,
boundary, cycle and glob/watch regressions. Such a patch remains a maintained
mitigation, not an official fixed release or evidence of a clean scanner result.
