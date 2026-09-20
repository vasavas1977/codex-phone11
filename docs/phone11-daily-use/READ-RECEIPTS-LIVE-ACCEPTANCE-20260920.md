# Phone11 chat rollout and device acceptance — 20 September 2026

## Verified preparation

- Signed iOS Build 74 is finished at application source
  `a0f5c463e9a09ef3ca43f53a4de5dae6f54651e5`. Package verification passed;
  installation on both physical phones has not yet been confirmed.
- The isolated API image is
  `sha256:cfea5fb61b244bec980211aab4f9d27320f8fd5e2deec2c5d4ae89c3f0f16e91`.
  Build marker: `read-receipts-a0f5c46-0c3c4e227148`.
  Backend compilation, type checking, and 49 focused tests passed.
- Protected staging evidence is at
  `/opt/phone11ai/read-receipts-api-candidate-20260920T092516Z/candidate-evidence.json`,
  SHA-256 `4c32bf801566588e074083e5c8cfeb6b575c4a0a0ca12b4596bb079d238a8b5d`.
  The lead independently checked the evidence hash, mode 0600, and image identity.
- At that check, the existing `cp11-backend` remained healthy with container
  `f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616`
  and image
  `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`.
- Independent catalog inspection found the existing base chat, collaboration,
  and media schema intact. Only the presence-session and message-read-receipt
  tables and their indexes are missing. Apply a reviewed minimal delta;
  replaying the complete collaboration migration would unnecessarily recreate
  a constraint on the existing message table.

## Not yet accepted

Production migration, candidate activation, public API behavior, and physical
device behavior are separate gates. The preparation above does not pass them.
Connect11 meeting admission and two-device media acceptance are also separate.

## Two-iPhone test sequence

Use only the authorized pilot accounts 3001 and 1020. Install Build 74 through
its EAS installation page, preserving the existing app and sign-in.

1. Send a clearly labelled test message from 3001 to 1020 while 1020 is outside
   that conversation. A notification or inbox preview must not mark it read.
2. Open the conversation on 1020 and leave the message visible. On 3001, verify
   **Read** appears. Opening its details must identify the correct reader.
3. In a test group/channel containing only those two accounts, repeat the test.
   Verify **Read by 1**, the correct name and first-read time, and a working
   Close action. Reopening the message must not reset the first-read time.
4. Type without sending, then stop, send, leave the chat, and background the
   app. The other phone must see the correct typing name only while relevant;
   the indicator must clear rather than remain stuck.
5. Check presence while foregrounded, away, and during a real phone call. Test
   meeting presence only after a real admitted meeting connects. Never infer
   Offline immediately from a closed screen or advertise a meeting merely
   because its join screen opened.
6. Open voice recording, cancel/back out, record a short audible clip, preview,
   send, and play it on the second phone. A read receipt is not proof that a
   clip was listened to.
7. Repeat ordinary 3001-to-1020 and 1020-to-3001 calls, including a locked
   receiving screen and mobile data. Verify ringing, answer, two-way audio,
   and hang-up. Record observations separately from server checks.

Record only observed results; leave unavailable device checks pending.
