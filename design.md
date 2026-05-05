# CloudPhone11 — Mobile App Design

## Brand Identity

- **App Name:** CloudPhone11
- **Tagline:** Your number. Everywhere.
- **Primary Color:** #0057FF (electric blue — telecom authority)
- **Secondary Color:** #00C896 (emerald green — active/connected)
- **Background (light):** #F8FAFF
- **Background (dark):** #0D0F14
- **Surface (light):** #FFFFFF
- **Surface (dark):** #161A24
- **Danger/End Call:** #FF3B30
- **Typography:** System font (SF Pro on iOS, Roboto on Android)

---

## Screen List

| Screen | Route | Description |
|---|---|---|
| Dialpad | `/(tabs)/index` | Main dial pad with number input and call button |
| Recents (Call Log) | `/(tabs)/recents` | Incoming, outgoing, missed call history |
| Contacts | `/(tabs)/contacts` | Device and SIP contacts directory |
| Messages | `/(tabs)/messages` | SIP instant messaging threads |
| Settings | `/(tabs)/settings` | SIP account, server config, audio, notifications |
| Active Voice Call | `/call/active` | Full-screen in-call UI (mute, hold, transfer, keypad, speaker) |
| Active Video Call | `/call/video` | Full-screen video call with camera toggle, mute, end |
| Incoming Call | `/call/incoming` | Full-screen incoming call with accept/decline |
| Contact Detail | `/contacts/[id]` | Contact info, call/message/video buttons |
| Message Thread | `/messages/[id]` | Individual chat thread with SIP messaging |
| Voicemail | `/voicemail` | Voicemail inbox with playback and transcription |
| IVR Builder | `/settings/ivr` | Visual IVR flow builder (greetings, menus, routing) |
| SIP Account Setup | `/settings/sip` | SIP server, username, password, transport config |
| Audio Settings | `/settings/audio` | Codec priority, echo cancellation, noise suppression |
| About / Backend Docs | `/settings/about` | Architecture info, open-source stack, version |

---

## Primary Content and Functionality

### Dialpad (Home)
- 12-key dial pad (0–9, *, #) with haptic feedback on each key press
- Number input field at top with backspace button
- Green call button (voice) and blue video call button
- Recent numbers quick-dial strip below pad
- SIP registration status indicator (green dot = registered)

### Recents
- Grouped list: Today, Yesterday, Older
- Each row: avatar/icon, name or number, call type icon (in/out/missed), duration, timestamp
- Tap to call back; long press for options (add to contacts, block, message)
- Missed calls shown in red

### Contacts
- Searchable list with alphabetical index
- Sections: Favorites, All Contacts
- Each row: avatar, name, SIP extension or phone number
- FAB (+) to add new SIP contact

### Messages
- Thread list: avatar, name, last message preview, unread badge, timestamp
- SIP MESSAGE protocol for instant messaging
- Supports text, emoji, file attachments

### Settings
- SIP Account section: server address, port, username, password, transport (UDP/TCP/TLS)
- Audio section: codec priority list (Opus, G.722, G.711, G.729), echo cancel, noise suppress
- Notifications: ringtone, vibration, background calling
- IVR Builder shortcut
- About / Architecture docs

---

## Key User Flows

### Making a Voice Call
1. User opens Dialpad tab
2. Types number or selects from recents
3. Taps green call button
4. Active Call screen appears (full-screen, dark background)
5. In-call controls: mute, hold, speaker, keypad, transfer, end call (red)

### Receiving a Call
1. Push notification wakes app (CallKit on iOS, ConnectionService on Android)
2. Full-screen Incoming Call screen: caller name/number, accept (green) / decline (red)
3. Accept → Active Call screen
4. Decline → call rejected via SIP 603

### Video Call
1. From Contact Detail or Dialpad, tap video icon
2. Active Video Call screen: local preview (PiP), remote full-screen
3. Controls: camera flip, mute mic, mute video, speaker, end call

### Sending a Message
1. Open Messages tab → tap thread or compose new
2. Type message → send via SIP MESSAGE
3. Delivery receipt shown (single/double tick)

### IVR Setup
1. Settings → IVR Builder
2. Drag-and-drop flow: Greeting → Menu → Route to Extension / Voicemail / Queue
3. Save → exports dial plan config for FreeSWITCH/Asterisk

---

## Color Choices

| Token | Light | Dark | Usage |
|---|---|---|---|
| `primary` | #0057FF | #3D7FFF | Brand, active states, call button |
| `secondary` | #00C896 | #00E5A8 | Online/registered indicator |
| `background` | #F8FAFF | #0D0F14 | Screen background |
| `surface` | #FFFFFF | #161A24 | Cards, dialpad background |
| `foreground` | #0D0F14 | #F0F4FF | Primary text |
| `muted` | #6B7280 | #8B95A8 | Secondary text, timestamps |
| `border` | #E2E8F0 | #1E2535 | Dividers, input borders |
| `danger` | #FF3B30 | #FF453A | End call, missed call, error |
| `success` | #00C896 | #00E5A8 | Active call, registered |
| `warning` | #FF9500 | #FFB340 | On hold, warning states |
