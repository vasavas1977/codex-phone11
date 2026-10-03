# Desktop transfer and safer meeting/admin actions — 4 October 2026

This source batch adds desktop blind transfer and fixes two existing consumer
workflows. It does not establish complete Zoom parity or production/device
acceptance. The earlier `71360e7` packages and signed Build 115 remain retained;
they are not packages of these newer changes.

## Behavior

- A direct-chat meeting action retires when its route, focused visit, account,
  workspace or conversation changes. Late permission results cannot create an
  invitation after exit; late creation results cannot navigate or overwrite a
  newer attempt. Explicit retries within the retained component recover the
  same actor/conversation request ID. A dispatched durable invitation is not
  canceled by leaving the screen; cross-remount recovery is not newly added.
- Web administrators receive an explicit, scrollable confirmation before
  deactivation. The warning reflects existing backend behavior: revoke assigned
  active extensions' SIP access, suspend those extensions/accounts and remove
  extension access grants. Reactivation does not restore those grants. Session,
  workspace, member, editor and current draft checks retire old Save/Confirm
  callbacks; cancellation, ordinary saves, duplicate protection and error retry
  remain available. An already-submitted backend request is not canceled by
  closing the editor. Owner/final-administrator protections are unchanged.
- Desktop transfer appears only when the verified helper's successful init
  reply advertises registered callback support. Old helpers remain usable for
  existing calling and do not expose transfer. Destinations allow an optional
  `+` and up to 32 digits; renderer input cannot supply SIP URIs or native intent
  IDs. Native state permits one SDK transfer invocation per call, including an
  immediate refusal. Reservation precedes the SDK call; callback association
  uses the exact call and privileged UUID intent plus session/account/generation
  fences. Retired SDK IDs fail closed.
- Request acceptance is not transfer success. Only callback status `0` confirms;
  nonzero codes, including `200`, remain unconfirmed. A missing callback becomes
  uncertain after the existing bounded deadline. End and Mute remain available;
  Hold stays disabled after an attempt. The client does not auto-End the call.
  Newer renderer snapshots/requests fence delayed replies and errors, so an old
  transfer cannot replace a newer incoming call or unlock another request.

## Evidence and release boundaries

The source commits and independent reviews are retained separately from final
integration/CI/package receipts. Regressions reproduce the original route-exit,
web confirmation, stale draft and delayed renderer-reply defects before fixes.
Fake-SDK protocol tests exercise transfer callbacks, refusal, uncertainty, End,
duplicate commands and both incoming/outgoing ID reuse. These are local source
checks, not real PBX REFER or speech evidence.

Hosted checks now include all desktop boundary/supervisor suites and an explicit
macOS fake-SDK call-control job. Actual Mac/Windows SDK compilation remains a
separate workflow. New native helpers, manifests and platform packages are
required for transfer; reusing an earlier helper does not establish support.
The mobile component changed, so Build 115 does not contain the route fix.

[Build 116 and fresh desktop packages](BUILD-116-RELEASE-20261004.md) now contain
this follow-up at frozen source `b5a97e6`; their exact-source CI and independent
package verification are recorded separately. Installation remains deferred.
The later [PBX mutation-authority fix](PBX-ROUTING-AUTHORITY-20261004.md) changes
backend/tests and CI/documentation only, preserving those client/native trees.

Physical phone testing remains owner-deferred. Real transfer success/rejection,
two-way audio, meeting media, locked-screen calling/push and Windows runtime
acceptance remain open. Formal signing, SDK redistribution terms, voicemail
commissioning, advanced PBX writer/clone/rollback gates and unsupported host
controls retain their existing independent requirements. No membership,
provider, production schema/route/flag or device operation is implied here.

Siprix behavior follows its [official transfer/callback API](https://docs.siprix-voip.com/rst/api.html).
See [coverage and ownership](ZOOM-FEATURE-COVERAGE-20261004.md) for remaining work.
