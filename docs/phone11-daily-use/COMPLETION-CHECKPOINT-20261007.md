# Phone11 completion checkpoint — 7 October 2026

Continuation base: `b54ae07b66f925111c40d58c1200d4f3bfe32f96`, the current PR 7 head observed before this follow-up. Its 15 reported GitHub checks passed. This record does not retag existing signed apps or prove full Zoom feature parity.

## Completed follow-up

- Meeting prejoin now retires pending admission and connection attempts when its mounted stack route loses focus. Refocusing cannot revive an old attempt; late sessions leave before navigation. Existing Back cancellation was already correct. See [meeting source and regression evidence](MEETING-COMPLETION-20261007.md).
- Admin extension inventory now exposes Previous/Next pages, total count and explicit page-scoped search. Extensions beyond the first 100 are reachable. Workspace changes already remount the admin content; no speculative assignment-lifecycle patch was added. See [admin evidence](ADMIN-COMPLETION-20261007.md).
- Daily CI now requires the pagination suite to exist, execute exactly once and have nonempty, all-passed assertions with no skipped cases.

## Validation performed locally

- Meeting invitation/prejoin regression batch: 180 passed. Original-source negative reproduction failed as expected; independent narrow review batch passed 74 cases.
- Admin pagination and existing number/extension suite: 13 passed.
- Exact five-suite hosting/presence/admin ownership CI batch: 239 passed, zero pending/failed cases; required report membership validated.
- Disposable loopback PostgreSQL 17 migration and schema preflight: 278 passed, zero skips (156 migration, 122 preflight). Test server stopped afterward; no live database used.
- Recording/voicemail descriptor safety: 87 passed (63 media, 24 voicemail storage).
- Playback-route, voicemail producer and relay: 51 passed.
- Release-profile and Siprix packaging guards: 12 passed, zero skips.
- Desktop helper source-receipt guards: 87 passed, zero skips.
- Backend esbuild bundle passed. Changed-source whitespace checks passed. Workflow YAML parsed using Ruby YAML.
- The first full TypeScript attempt failed because the reused setup omitted the desktop dependency tree. A later isolated Git archive of `4f007fb`, using existing root and desktop dependencies, passed root TypeScript, desktop TypeScript, backend bundling and the desktop Darwin JS build. The initial report incorrectly claimed all four package manifests/lockfiles matched: only the desktop pair matched; the root pair differed in the EAS preinstall script and maintained patch references. These remain actual reused-dependency compilation results, not locked-root installation proof. Daily CI now runs root TypeScript after installing the locked root and desktop dependencies. Its exact-head result must be recorded separately. No local dependency installation or shared-tree mutation was performed.
- Android standalone trial transport suite: 8 passed, 3 skipped because no explicit already-owned AAR was supplied. Those skipped SDK-input cases are not an Android package acceptance claim.

## Hosted follow-up at `4f007fb`

The exact meeting/admin commit is `4f007fbf680cd797dc9c4d37360abed256383ed9` on PR 7. [Daily-use run 37574892164](https://github.com/vasavas1977/codex-phone11/actions/runs/37574892164) passed all ten jobs; actual logs confirm 30 required suites and 1,125 cases with zero skips, plus the executed 41-case prejoin-owner and 33-case admission-race suites. Authentication and release guards passed separately.

[Mobile run 37574892467](https://github.com/vasavas1977/codex-phone11/actions/runs/37574892467) passed all six jobs. Its hosted isolated Android foreground trial verifier reported APK SHA-256 `1c2b6a8195b59e055a46cab3fa56a5fc4edf897ef36aa1aacbe90e4d8578a572`, package `ai.phone11.mobile.foregroundtrial`, and four checksum-pinned ARM SDK libraries. This package was not downloaded or installed; packaging does not establish phone, background wake or unrestricted production acceptance.

[Desktop run 37574892138](https://github.com/vasavas1977/codex-phone11/actions/runs/37574892138) passed macOS/Windows helper compilation but failed the isolated fake-SDK hold-recovery protocol test. The test assumed one uncertainty episode across both delayed hold and resume, then stopped after a short sleep. The old fake also emitted a resume `Remote` callback while its queried local state was still held. The follow-up test uses per-phase command/frame waits, verifies both recovery episodes and preserves rejection, identity, ordering and privacy assertions. The delayed fake now preserves local hold until its final `None` callback. Production helper code is unchanged.

The lead ran all six desktop protocol scripts successfully, including eleven transfer scenarios. A patched-test/old-fake negative replay failed the recovery-order assertion as expected. Independent reproduction and fresh follow-up CI must be recorded separately before treating this test-only change as verified.

## Fresh unsigned voicemail package

An offline bundle from the base pin was built at `/private/tmp/phone11-voicemail-b54ae07-20261007`. Manifest SHA-256: `104d94988e84333efc734e3a5e35da4d28f2b323a63d5f6e2472ef982c67963a`. Seven source inputs were independently compared to `git show` at the pin, and all five output artifact hashes and lengths matched. The initial `/tmp` invocation was refused because the contract requires resolved parent paths on macOS; no guard was weakened. The bundle is unsigned, with commissioning and rollout approval false. No runtime plan or host state was fabricated.

## Remaining production gates

- Siprix remains trial-only with its 60-second call limit. Unrestricted calling needs a production license and signed-build long-call acceptance.
- Signed/notarized desktop distribution, a fresh signed Android trial package and platform acceptance remain separate from source/package guard checks.
- Physical two-phone meeting speech/video, SIP interruption, routes, reconnect and background/locked calling remain owner-deferred; no new handset acceptance occurred here.
- PBX/voicemail still need current writer/principal inventory, protected-clone rehearsal, exact active/rollback artifacts, approved helper staging and a real owned deposit/playback. No live routing, provider, service, flag or customer account was changed.
- Unsupported provider host controls and meeting-bot recording/custody remain gated under their existing Phone11/Connect11/note11 ownership. Source reviews cannot establish provider behavior.

These are explicit release blockers, not a claim that unrestricted production is complete.
