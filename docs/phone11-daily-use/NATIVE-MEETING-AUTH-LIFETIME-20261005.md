# Native meeting authentication lifetime — 5 October 2026

Source correction from `6ed24449ea3527ea2888c1b3f423c4f094a7eb63`.
Five new real-controller/mock-SDK regressions failed against that source while
all 51 existing native lifecycle cases passed: same-ID replacement and observed
null-to-same-object restoration before the first await, queued replacement,
initial publication after delayed connect, and a connected room surviving a
same-ID sign-in. Numeric owner equality did not identify the initiating session.

The native lifecycle now captures the exact observed authenticated object and
subscribes before queue or binding awaits. Any observed change permanently
retires that attempt, including restoration of the original object. Stable
profile updates preserve the same object through the existing auth observer and
remain valid. The same guard fences the shared controller's connect, initial
microphone/camera work, queued controls and callbacks, and native audio setup
and output selection. `ownerIsCurrent()` exposes only this sticky lifetime
predicate for an adapter; connected admission, SDK permissions and the current
media lease remain separate requirements. It supplies no token, room revision,
provider revocation or host authority.

Auth retirement hides active rooms immediately through the existing registry,
but failed room/audio stop retains ownerless cleanup custody and the media
barrier. Replacement joining and SIP activation cannot bypass that drain.
Late setup/publication remains cleanup-owned, and explicit cleanup/retry does
not restore the old authenticated lifetime. The pending subscription is removed
when its join settles; the lifecycle subscription remains until cleanup succeeds.
No lifecycle subscription is installed when media acquisition is refused.

Validation passed 66 native cases and 222 adjacent web, registry, media-owner,
auth-client and Android calling cases across nine files, all without failures
or skips. Strict scoped TypeScript checks and scoped ESLint used the existing
installed dependencies through a private scratch resolver. No dependency install,
SDK runtime, capture, device, provider, signing or deployment action occurred.
Ordinary audio and unsupported native screen publishing retain their source
behavior. Fresh client packaging, exact-build runtime acceptance and independent
source review remain separate gates; old artifacts keep their original pins.
