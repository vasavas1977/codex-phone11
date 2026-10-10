# Phone11 typing indicator candidate

Zoom's official [chat guide](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066130) documents a typing indicator for one-to-one chats across supported platforms. Phone11 uses that minimal expectation and extends it with compact named group and thread indicators; this is not a claim of full Zoom group-chat parity.

Typing activity is ephemeral process memory. Phone11 stores no draft text, keystrokes, message content, or database row. A lease is keyed by tenant, conversation, optional thread root, authenticated user and client session. It expires after 10 seconds, retains a short sequence tombstone to reject delayed updates, keeps separate device sessions independent, and bounds global, conversation and per-user memory. Publishing and reading repeat workspace membership, conversation membership, bilateral block, and live-thread checks.

The client publishes a throttled active lease only after a real user composer edit with non-empty text. Restored drafts, AI edits and mounting a populated composer do not publish. It clears on send, blur, background, room/thread exit, account or workspace change, and expires after a crash. Queries run only while the chat screen is focused and the app is foregrounded; failures render no indicator. Typing never triggers push notifications or message sends.

The current API deployment is a single process, so a process-local registry is appropriate and a proxy switch may briefly lose an indicator. A multi-replica API must replace it with a shared ephemeral store that preserves the same tenant, session, sequence and expiry contract. This feature intentionally adds no database migration.

The deterministic UI fixture is `/dev/typing-preview`; it uses the production `TypingIndicator` component and never publishes activity.
