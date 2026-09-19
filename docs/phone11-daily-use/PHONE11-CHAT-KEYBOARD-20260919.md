# Team Chat keyboard correction

The conversation previously placed keyboard avoidance below the custom header
and safe-area wrappers. Its local layout origin did not match the iPhone
keyboard's screen coordinates, allowing the composer to remain covered.

The keyboard-avoiding view now owns the whole route. The safe-area container,
header, message list and composer resize together. Bottom safe-area protection
also applies when the keyboard is closed. Input and Send occupy one nonwrapping
row; reply context occupies its own row. Multiline input is bounded to 140 points
and scrolls internally. Dragging the conversation dismisses the keyboard.

List layout changes scroll to the end only when the reader was already at the
bottom; reading earlier messages does not trigger that jump. Existing send,
draft, owner and workspace checks remain intact.

Verification: 19 focused chat UI tests, TypeScript and whitespace checks passed.
Mocked layout checks do not establish physical keyboard behavior.

Candidate: standalone internal Phone11 Build 66, EAS ID
`6e756690-5b67-4b98-9abf-6ae6557ddddc`, using
`preview-ios-siprix-daily-pilot`. Retain Build 65 for rollback. Signing,
installation and physical keyboard acceptance must be recorded separately.

Build 66 finished. Siprix IPA verification and all 18 signed-release checks
passed; artifact SHA256 is
`9344b6d06d594b3943d7a23b8a11e8f79ba8efb75a17d8a096a5906c076dba8a`.
Installed in place and launched on the connected iPhone 17 Pro Max at
11:23 Bangkok time on 19 September 2026. Device inventory confirms version
1.0.0 (66). Physical typing/keyboard acceptance below remains pending.

## Handset acceptance

1. Open Team Chat and tap Message. Message and Send must remain above the keyboard.
2. Type several lines, then enough to exceed the input height. The input scrolls
   internally and Send remains visible. Check both Thai and English keyboards.
3. Reply to a saved message. The reply preview and composer remain reachable.
4. At the latest message, open/close the keyboard; the latest message stays visible.
5. Read older messages, then open the keyboard; the list must not jump to the end.
6. Drag the list to dismiss the keyboard. Reopen it and send one consenting test
   message with one tap. Confirm only one message is created.
