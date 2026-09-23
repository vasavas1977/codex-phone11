# Phone11 avatar and profile navigation

## Research and reference

The user's IMG_1003 shows an account hub; IMG_1004 shows its separate My profile detail page. These are self-management screens, not the information other colleagues should automatically receive.

Official Zoom sources checked September 24, 2026:

- [Zoom mobile navigation and profile menu](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063582): avatar opens account/presence/settings; My profile opens identity/photo/account details. Availability depends on permissions and features.
- [Profile cards in Meetings and Chat](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065858): contact cards provide identity, presence and authorized contact information. Outside meetings, actions include Chat, Meet and Phone; in-meeting cards omit those actions. The article's detailed interaction instructions concern desktop; the mobile tap design below is Phone11's adaptation.
- [Personal account profile](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060639): profile fields include identity, role and contact information, with administrator restrictions. Phone assignments and meeting identifiers are real account resources, not arbitrary display values.

## Intended behavior

| Entry | Result |
| --- | --- |
| Known teammate avatar or initials in chat, Contacts, Recent Calls, readers or member lists | Shared contact profile with current authorized name, photo, presence, workspace and extension |
| Avatar inside mention/member/meeting selection | Informational profile over the same picker; Back returns to unchanged selection; avatar tap does not select the row |
| Own account hub avatar or My profile row | Full My profile page with photo, name, PERSONAL rows and CONTACT INFO |
| Photo/camera badge on My profile | Existing camera/library/remove flow; failure explanation and Retry remain reachable |
| Known participant during active call/meeting | Information only; underlying session remains mounted |
| Incoming ringing screen | Preserve Answer/Decline access; photo is display-only until the call is answered |
| Channel/group icon, unidentified caller, guest or ambiguous phone match | Do not guess a person's identity from a name/image; existing channel/call/device-contact action remains |

The contact card is an inline overlay with a visible Back button. It does not push a new call route, start a meeting, or stack native modal controllers. Native picker modals have their own inline host. Call/Message actions reuse existing checks and only appear in normal browsing; selection and conference/call contexts show information only.

## Data and privacy

Cards resolve the exact user ID in the requested workspace through the existing authenticated directory. Names and photo URLs are not identity lookup keys. Invalid IDs, another account's cached data, or a different workspace response cannot populate the card. Removed or inaccessible people show unavailable/not found. Opening a card performs a fresh directory read; it does not prefetch every profile while ringing.

Current colleague directory fields: user ID, display name, assigned extension and protected photo descriptor. Existing presence polling supplies availability. Email remains self-only because the colleague directory does not disclose it. Device-address-book photos stay local and are not treated as company profile records.

Current My profile fields: authenticated full name/email, selected workspace, provisioned extension, and editable workspace photo. Identity rows are read-only until an authorized editing endpoint exists. No license badges, phone numbers or meeting IDs are fabricated.

## Fuller profile schema design (not implemented by this client change)

| Field | Proposed authority and exposure |
| --- | --- |
| Display name | Reuse existing identity service; permit editing only when company policy allows |
| Department, job title, office location | Tenant member profile, administered by company; optional employee edits through explicit policy |
| Direct/company number | Read from actual PBX assignments; same tenant; never derive a public number from an extension |
| Work location/status | Existing tenant profile service; display only where commissioned and authorized |
| Direct chat link / QR | Tenant-scoped authenticated deep link; opening must recheck membership, never auto-join or disclose messages |
| Personal meeting ID / link | Connect11-owned persistent meeting resource with host entitlement; do not derive from user/extension |

Use optional fields: hide unavailable sections instead of rendering false editable rows. Reuse Super Number identity and Connect11 meeting authority rather than creating parallel account/meeting databases.

## Verification and release boundary

Implemented client source: shared card host/context, avatar tap propagation guard, picker-local hosts, refreshed My profile detail page, and directory owner/workspace checks. No server schema or deployment change is required for this supported subset.

Validation: 105 tests passed across 15 focused profile, directory, chat, selection, call-avatar, participant and admin suites. TypeScript and `git diff --check` passed. Changed production files passed ESLint with no errors and one pre-existing Team Chat hook-dependency warning. A 440 × 956 browser preview verified hub → My profile → photo options → close → My profile. Independent source review found and closed two issues: photo capability errors must leave Retry reachable; incoming-call avatars must not cover ringing controls.

Signed daily-pilot Build 91 was produced by successful workflow run [35907511897](https://github.com/vasavas1977/codex-phone11/actions/runs/35907511897) from source commit `01b8551ba0d6ca88472f236313e2394a28a3711a`. EAS build [c5ebc657-c56b-4643-8000-3edc61060f45](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/c5ebc657-c56b-4643-8000-3edc61060f45) uses `preview-ios-siprix-daily-pilot`; the retained IPA SHA-256 is `ee49f329638a8d8337296ea485b13b30504242fb90065a1fca5f33cafab9785f`. The signed package passed the native and retained-Build-49 comparison checks. `devicectl` installed it on paired iPhone 17 Pro Max `C31981DC-D67D-5AED-8F86-7E826CD4BA0B`, and device inventory reported Phone11 version 1.0.0/build 91. Build 90 remains retained as rollback.

Native avatar taps, modal gestures, SIP continuity and photo display still require on-screen handset acceptance. No backend deployment or provider action was performed.

Handset checklist: tap sender, direct-chat header, Team contact, Recent Call teammate, Read by reader and member-picker avatar; confirm the same identity. Deselect a meeting invitee, inspect another profile, Back, and confirm selection remains. Open My profile, change/cancel photo, confirm return. Test retry after capability failure, sign-out/tenant switch, and an unavailable teammate. During active meeting inspect a participant and confirm ongoing media; during ringing verify Answer/Decline remain accessible.
