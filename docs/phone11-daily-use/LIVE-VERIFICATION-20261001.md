# Phone11 live verification — 1 October 2026

## Confirmed

- Public Chrome session: assigned extension 3001 in the Phone11 workspace. Settings opens Workspace administration.
- Public voicemail screen loads “No voicemail”; this proves the inbox path loads, not recording or playback.
- Admin Workspace status shows enabled. The user Profile page exposes Availability, Status and Work location; Availability opens Available, Away, Busy, Out of office and Reset automatic. No profile or policy changes were submitted. These controls require a successful profile.self query state for the session; this is browser evidence, not handset acceptance.
- Team directory loads the other two directory entries. Direct-contact meeting invitation and receipt remain unverified in this session.
- Source cea0ab6f5e6eb2f7d5d73a8cc23e915742e34a86 runs as the guarded workerless candidate on loopback 3021. Health, exact image/bundle/runtime and preserved public-route/wake/baseline/recovery checks passed. Anonymous chat and conference GETs returned 401. Public tRPC remains on 3016.
- Existing protected Connect11 tenant-1 status credential returned ready at 03:32 UTC (10:32 Bangkok), with zero token mints or provider mutations.
- Build 111 was installed and launched on the 17 Pro Max, and installed-app readback confirmed 111. Its mobile source remains 11cd1f199cd4cd79d133637ad59271a21014d9e8.
- All 14 hosted CI checks passed at 16da5a2e17a9e7b0ee147505a5973574d7dc799a. The builder follow-up also passed 79 focused local operator tests and independent source review.

## Remaining gates

The public admin overview still marks IVR, queues, ring groups and business hours unavailable. Source completion does not commission their hosted schema or call routing. The current live-schema writer and rollback compatibility gates remain open; no production DDL or public route change was performed.

Later on 1 October, iPhone Mirroring became available. The signed Build 111 app opened and responded to Team Chat, Settings and Profile navigation. The Test channel meeting picker showed its other member selected by default, allowed deselection (zero selected disables Start meeting), restored selection and cancelled cleanly. Tapping the own message avatar opened My profile rather than Contact not found. The Profile page rendered the saved photo and exposed Availability, Status and Work location. Away saved and remained selected after leaving and reopening Profile; Reset automatic restored the original setting. No meeting was initiated and no chat message was sent during these checks.

The Team Chat header and own profile card briefly rendered a blank photo while other message avatars loaded; the shared component hid initials before image load. The source correction now retains initials until successful load and rejects stale source callbacks. It is not yet in the installed signed build. The initial blank state does not prove an authentication or server failure. Mirroring keyboard input used the Mac's Thai layout and clipboard forwarding timed out, so this session does not claim physical keyboard-overlap acceptance.

Two-phone meeting audio, background wake, direct-contact meeting invitation receipt, and a real voicemail deposit/playback still require acceptance. No empty inbox, ready capability or navigation check is counted as those results.

The latest source batch persists a private voicemail admission intent before the backend request, retries the same UUID on a dedicated endpoint, and requires the exact acknowledgement before recording. Backend and producer rollbacks fail closed. Real-filesystem regression tests cover interrupted intent publication and reviewed retirement; conflicting links remain rejected. Read-only inspection of an interrupted retirement still requires the operator to retry that exact previously reviewed retirement before a general sweep. No WAV is deleted automatically. The running cea0ab6 candidate does not include this source change.

Validation on the final amended source: 2,375 Vitest cases passed with 451 environment-gated skips, and all 69 native Node cases passed. Root TypeScript, backend build and diff checks passed; focused ESLint reported zero errors with existing style warnings. The voicemail-focused suites passed 44 cases. Eight restricted local PostgreSQL cases passed before the final route/filesystem-only amendments; their database helper and schema were unchanged, and the disposable database and role were removed and cluster stopped. These results do not count the PostgreSQL skips in the full suite as passes.

The direct-recipient chat regression checks focus-scoped polling, exact admitted-room Join, expired/removed invitation hiding and ignored late responses after focus cleanup. Its focused suites passed 35 cases. Independent review returned APPROVE_SOURCE_ONLY for the frozen voicemail producer, storage handler, four tests and reconciliation note, with no remaining P0–P2 finding. The reviewer independently passed 44 focused cases and TypeScript and verified unchanged file digests; its eight PostgreSQL cases were skipped. No merge, public promotion, production DDL or new signed mobile package is implied.

## SDK packaging follow-up

The unverified PJSIP postinstall download was audited as data: all 723 archive members matched the prior immutable image's package resources, with no unsafe members. The source now pins its SHA-256 before extraction and preserves the install lifecycle; see [PJSIP SDK packaging](PJSIP-SDK-PACKAGING.md). Nine focused lifecycle cases and fourteen avatar cases passed, and independent review approved these scoped files for source only. The integrated follow-up passed 2,382 Vitest cases (451 environment-gated skips) and all 78 native Node cases, root TypeScript, backend bundle build and diff checks. The reviewed seven file digests matched at integration. A checksum pin is not a finished backend/native build or handset audio result. See [PBX release gates](PBX-RELEASE-GATES-20261001.md) for the separate production database/writer constraints.
