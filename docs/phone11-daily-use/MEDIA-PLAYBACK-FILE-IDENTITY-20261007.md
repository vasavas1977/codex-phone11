# Recording and voicemail playback file identity — 7 October 2026

At `8352bb11221b7189d74b2a5efc04ccdf70a82538`, both authenticated playback
handlers checked tenant containment with `realpath`, then asked Express to open
the pathname again. Two deterministic local fixture tests reproduced a changed
pathname being served after that check; 35 existing cases passed.

Both handlers now authorize the owner before accessing storage, inspect a
bounded regular file, open with `O_NOFOLLOW | O_NONBLOCK`, and verify the opened
descriptor's identity and metadata against the inspected file. They recheck
resolved containment, root identity, pathname and descriptor before sending
headers. Streaming uses that descriptor with a 64 KiB buffer; it never reopens
the pathname or buffers the whole recording. HEAD, conditional responses,
seeking, stream failures and disconnected requests close the handle.

Valid single ranges, suffix/open-ended ranges, HEAD and conditional validators
are preserved. An unsatisfiable range now returns 416 with `Content-Range`,
correcting the old callback's 404. Responses retain private/no-store caching
and audio/WAV content type. Missing or changed file identities return generic
errors without disclosing storage paths.

Five focused suites pass 134 cases without skips, covering playback replacements,
authorization, ranges/HEAD, conditional responses, oversize refusal, pending
open/identity-check cancellation, stream errors and cleanup. Focused TypeScript,
ESLint, backend bundling and whitespace checks pass. ESLint retains its existing
Node configuration module-type warning. These are source/local-fixture results.

The descriptor prevents a later pathname replacement from redirecting playback;
it does not prevent a trusted writer from changing the same inode after the
final validation. Commissioned storage custody remains required. This changes
backend bytes and requires a fresh reviewed deployment artifact and operator
plan. The separately retained voicemail producer/relay bundle at
`eb57852776c72bcbbdae838e915b70756a79f167` is unchanged and keeps that source pin.
No live backend, storage, routing, roles, provider, installation or device test
was changed by this source fix.
