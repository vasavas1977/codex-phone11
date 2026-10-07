# Calendar availability — 7 October 2026

The Calendar route now reports **Calendar sync unavailable** instead of passing
a fabricated empty event list to the schedule component and claiming nothing is
scheduled. Its Settings subtitle also states that shared sync is unavailable.
The route explains that events cannot be loaded until calendar sync is available.
Scheduled calls, callbacks and meetings remain owned by the shared Super Number
service under the [existing adapter contract](SHARED-CALENDAR-PHONE11-ADAPTER-20260916.md).

The reusable `PhoneTodayView` still renders supplied events and a real empty
schedule. No calendar store, transport, provider or sync activation was added.

Validation: the updated route assertion failed on the original implementation
with the misleading empty-schedule output. After the fix, all three focused
Calendar suites passed 10 cases with no skips, including unavailable route,
supplied populated/empty schedule and Back navigation cases. Targeted ESLint
passed for the three changed source/test files; changed-source whitespace passed.
After the final explanatory-copy refinement, the UI suite passed all four cases.
The lead's updated six-suite completion batch passed 243 cases with no skips;
the actual JSON report contained every required suite exactly once. Daily CI now
requires the Calendar UI suite in its file-presence check, invocation and
all-passed result validator. The workflow YAML parsed and whitespace checks passed.
Full TypeScript and hosted CI are pending for this follow-up. Signed-package and
device acceptance are separate and were not performed.
