# Desktop personal-history search and filters

This source follow-up starts from `ae54c8a9c8f81aef6e56d98ff869d3a98dcb7924`.
Phone11 desktop History now offers a 64-character search, independent Direction
and Outcome selectors, and Clear search and filters. Search matches only the
numbers and direction/outcome labels present in the already loaded owned records.
Case is normalized; Unicode compatibility digits and formatted phone queries work.
Trusted call-time contact names are absent from the contract, so current contact
or extension-owner names are neither fetched nor inferred.

The scope note and result count explicitly describe loaded calls. An unmatched
view keeps the server-provided Load more cursor available. Loading older calls
preserves the current query/filters and reevaluates the accumulated records in
their original keyset order. Empty history, no loaded matches, loading and request
failure have distinct messages. A selected row still only fills the dialpad; it
does not initiate a call or derive a callback from current assignment.

Direction remains independent of recorded outcome. Only explicit `answered`
disposition enters Answered; `missed`, `no_answer` and `no-answer` enter Missed /
no answer. Busy and Failed have separate filters; unrecognized/null dispositions
remain Other / unknown. Duration and direction never infer an answer or missed
ownership. No recording, summary, ingestion or remote-search capability is added.

The opaque account/session revision and selected workspace define the in-memory
scope. Sign-out, sign-in admission and scope replacement invalidate pending
history requests, records, cursors, reconciliation timers, query and filters.
Signed-out rendering clears the hidden DOM too. Late responses/errors and retained
old-owner row callbacks cannot update a new scope. No persistence or shared cache
is introduced. The authenticated API, tenant/immutable ownership checks, native
helper and calling/provider contracts remain unchanged.

[Zoom's official personal call-history guidance](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013)
describes newest-first history and optional missed-call filtering. Phone11 uses
that control pattern with the narrower capabilities established by its existing
personal-history contract; it does not claim Zoom parity or target-service proof.

## Local validation

- `PHONE11_HISTORY_BROWSER_QA=1 node --import tsx --test test/history-filter.test.ts test/renderer.test.ts`
  from `desktop/app`: 13 cases passed, including isolated Chromium with synthetic
  records, no account/helper/media access and zero network attempts. Coverage
  includes search/Unicode/name exclusion, independent direction/outcome,
  pagination under filters, empty/no-match/failure, deferred owner/workspace
  responses, scope clearing, stale row callback rejection and literal/XSS data.
- Full root TypeScript and desktop TypeScript passed. Desktop build passed.
- Focused ESLint passed with zero errors and three existing renderer `array-type`
  warnings; the existing module-type warning also remains. Diff checks passed.
- The full desktop suite observed 90 passed, one failed, and one opt-in browser
  skip. The unrelated `meeting-participant-name.test.ts` fixture lacked
  `ConnectionState` and `DataPacket_Kind` exports used by concurrent meeting work.
  Its exact esbuild failure was reported to that owner without changing their
  files. The history/browser focused run above passed with no skipped cases.

The browser rehearsal is opt-in through `PHONE11_HISTORY_BROWSER_QA=1`, following
the established isolated Electron test pattern; it creates and removes temporary
fixtures only. Package/configuration/dependency files were not changed. No real
credentials, provider, production schema, native install, or signed-client/physical
device acceptance was used or established. Independent source review is required
before integration approval.
