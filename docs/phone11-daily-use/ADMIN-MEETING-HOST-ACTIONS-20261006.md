# Administrator meeting-host action lifetime — 6 October 2026

The hosting switches in `app/admin/meetings.tsx` previously sent two opposing writes from callbacks captured in one render. The same switch could also dispatch after unmount or replacement sign-in with the same numeric account ID. Three actual-component regressions reproduce those failures on `178f5a2ef2ae555f0fdb02b437f192a5b4b3a72a` before the source change.

Each switch now requires its original observed authentication object, mounted screen, selected tenant, current administrator read and exact current conversation/member objects. An observed logout, loading transition or replacement authentication object retires that scope permanently; a stable-object profile refresh remains valid. Query errors and in-progress reads disable host writes. Results and errors are consumed only by the current original scope and row.

A synchronous screen-level custody record admits one request before React can re-render. It remains owned across workspace remounts until the dispatched mutation and any original-scope refetch settle. The replacement screen waits and is notified when the record clears. This does not cancel or revoke a request already dispatched: the server may have applied it, and stale results are discarded. An unconfirmed read or write never claims that settings were unchanged.

`tests/phone11-admin-meeting-host-actions.test.tsx` executes the actual component with controlled query/auth/renderer boundaries. It covers direct and channel payloads, opposing callbacks, sticky auth retirement and stable refresh, workspace remount custody, row/role/query changes, late settlement, current retry and unmounted callbacks. These are source checks; they do not prove a deployed administrator write or provider/device behavior.

The existing authenticated `adminSetHostPermission` and `adminSetDirectHostPermission` procedures remain authoritative for fresh administrator, tenant and membership checks. Hosting rights are separate from meeting admission and publication permissions. No server, Connect11, native media, build flag or release contract changes are included.
