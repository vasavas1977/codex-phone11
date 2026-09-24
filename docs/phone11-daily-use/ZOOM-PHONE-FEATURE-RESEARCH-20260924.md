# Zoom Phone feature research for Phone11

**Research date:** 2026-09-24
**Sources:** Zoom Support documentation only. This is a reference for product planning; it does not claim Phone11 implements these capabilities or has parity with Zoom Phone.

## Product pattern

Zoom separates everyday calling in the Zoom Workplace desktop and mobile apps from phone-system configuration in the Zoom web portal. A licensed user works from the app's Phone area, while administrators configure phone users, numbers, policies, auto receptionists, and call queues in the portal. Some individual phone settings are available in-app, while advanced call handling and organization controls live in the portal. [Quick start for Zoom Phone](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066777) · [Phone settings in the Workplace app](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069244) · [Admin setup](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257)

Zoom's documented transfer methods work on desktop and mobile: warm transfer, direct transfer, and transfer to voicemail. Call history and recordings are synced between those app clients. This suggests that Phone11 should give users the same core call and history workflows on both platforms, while accepting some platform-specific device settings. [Transferring calls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064805) · [Viewing call history and recordings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013)

## End-user workflows and screens

| Screen or workflow | Zoom behavior | Phone11 planning note |
|---|---|---|
| **Phone home / dialer** | Users place calls by searching a name, number, or extension. App settings expose direct number, company number, extension, and some calling preferences. | Make identity and dialing easy to find; keep extension calling available alongside external numbers. |
| **Active call** | Users can transfer a call with warm, direct, or voicemail transfer. Admin policy can restrict transfer destinations. | Cover normal call control and transfer on both mobile and desktop; enforce server-side policy for permitted destinations. |
| **History** | Users see recent calls; history and recording state sync between the desktop and mobile Workplace apps. The web portal is used when filtering logs by date or contact, and admins can grant access to other users' recordings. | Keep personal history consistent across app clients; make organization-wide log access an explicit admin privilege. |
| **Voicemail** | Users play voicemail in the app and can change greetings through phone settings. Admins can control shared mailbox access and voicemail policies. | Treat personal and shared/team voicemail as distinct access scopes. |
| **SMS** | SMS is available in the Phone area, but only with eligible numbers, jurisdictions, verification, and policy. | Gate this feature by number capability and region; do not make it a universal promise. |
| **Lines and queues** | Shared line group members can see line status, handle calls, review shared history, and manage the group's voicemail, subject to admin setup and permissions. Queue members can receive calls and may be able to opt in or out. | Add after individual lines and basic business routing; ensure shared content and membership permissions are clear. |

Sources: [Quick start](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066777), [app settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069244), [transfers](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064805), [history and recordings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013), [shared line groups](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068068).

## Admin portal workflows

1. **Set up the phone system.** Zoom's setup flow covers account setup, phone users, direct numbers, sites, and the main auto receptionist. Zoom recommends considering number porting as part of setup. [Getting started with Zoom Phone](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257)
2. **Manage users and assignment.** Admins assign or remove Phone licenses, extensions, calling packages, and direct numbers through Users & Rooms. A Phone license automatically assigns an extension; a calling package is separately assigned when outbound calling is needed. Admins can add an account user and assign Phone as part of user creation. [Managing phone users](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069309)
3. **Configure incoming call paths.** Admins set auto receptionist greetings and business, closed, break, and holiday routing. An auto receptionist can route to a user or queue, and can route callers to an IVR menu. Zoom's IVR article describes a single-level menu flow; more elaborate multi-level menu expectations need separate product design. [Auto receptionist settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062100) · [Creating an IVR](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063150)
4. **Configure team queues.** Queue settings include members, admins, business hours, distribution (simultaneous, sequential, rotating, and grouped rotation), maximum wait/call limits, overflow, voicemail, and holidays. The documented default maximum is 50 members per queue; overflow to another queue supports larger configurations. [Changing call queue settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065370)
5. **Set policies and access.** Admins can enable/disable feature policies at account, group, site, and extension levels, and can lock user-editable settings. Templates can bulk-apply certain settings. [Zoom Phone policy settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069655)
6. **Review calls and numbers.** Zoom's admin setup documentation describes call logs and number assignment/porting. Number requests require admin permissions and Phone/Contact Center licenses at least equal to the requested count; number availability and lead time vary by country. [Admin setup](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257) · [Requesting phone numbers](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060070)

## User and admin role boundaries

Zoom's account roles distinguish the **owner**, **admin**, and **member**: the owner has all privileges including role management; admins can manage users and advanced account features; members have no administrative privileges and ordinarily manage only their own settings, subject to admin locks. Zoom also supports custom account roles. [Account roles and licenses](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060684)

For Phone administration, Zoom documents narrower roles, including **Phone Super Admin** (all Phone features/settings), **Phone Site Admin** (site-scoped Phone settings, excluding account-only settings), **Call Queue Admin**, **Auto Receptionist Admin**, **Shared Line Group Admin**, **Recording Admin**, and **Compliance Admin**. Target-based roles scope permissions to particular queues, receptionists, or shared line groups. Zoom notes that Phone roles alone do not grant account/group-level policy access; those controls require the corresponding account-level privileges. [Zoom Phone role management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0070100)

**Planning model for Phone11:** account owner/admin handles tenant-wide setup and user lifecycle; delegated administrators manage specific Phone objects (such as one queue or site); end users manage only their own permitted calling preferences and call data. This is a product recommendation based on Zoom's documented role boundaries, not a claim about Phone11's current authorization model.

Phone policies may be scoped to account, group, site, or a phone extension. Zoom supports locking settings so users cannot override admin policy. The documentation also describes priority rules when users belong to multiple groups; Phone11 should define and document its own effective-setting rules rather than rely on ambiguous UI. [Zoom Phone policy settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069655)

## License, region, and feature caveats

- **Phone service requires entitlement.** Zoom documents either a Zoom Workplace license with Phone included or a standalone Zoom Phone calling plan for core Phone administration and user settings. Calling package assignment can be separate from enabling Phone; direct numbers are also assigned separately. Exact packages depend on account offer and market. [Managing phone users](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069309) · [Changing personal Phone settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069132)
- **Phone numbers are country-dependent.** Zoom says number availability and lead times vary by country/region; some countries require business-address documents or other verification. [Requesting phone numbers](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060070)
- **SMS/MMS is constrained.** Zoom's SMS FAQ says users can use assigned US or Canada direct numbers, with policy-controlled international messaging in certain destinations. SMS-capable numbers in the US/Canada, Australia, and UK have verification requirements described in Zoom's status documentation. Toll-free SMS has its own verification steps. Do not infer broad international SMS support from the existence of an SMS UI. [SMS FAQ](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063129) · [SMS verification status](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057873) · [Toll-free SMS verification](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057924)
- **Queue analytics and advanced controls may be add-ons.** Zoom's app settings page lists a Customer Engagement Pack add-on for call queue settings; call-detail sharing also has an add-on requirement in the call history article. Check the current commercial plan before treating those as base Phone features. [App settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069244) · [History and recordings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013)
- **Emergency calling depends on geography and carrier.** Zoom describes different emergency-location signaling requirements for US/Canada Zoom carriers, other countries, and BYOC carriers. Emergency addresses and, where needed, ERL/ELIN setup are admin responsibilities. Phone11 must establish supported markets and carrier behavior before offering this capability. [Emergency response locations](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064642)
- **Recording access is controlled.** Zoom states that other users' recordings are not automatically available to end users; automatic recordings are admin-accessible by default, while users can manage their own ad hoc recordings subject to access settings. [History and recordings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013)

## Prioritized capability checklist for Phone11 planning

### P0 — individual business phone

- [ ] Admin-managed users, Phone entitlement, extension, calling package, and number assignment.
- [ ] Desktop and mobile Phone area with directory/name/number/extension dialing and direct/company number visibility.
- [ ] Incoming/outgoing call controls and warm, direct, and voicemail transfer.
- [ ] Recent call history with missed-call state and consistent user experience across desktop/mobile.
- [ ] Personal voicemail playback and greeting, with admin policy controls.

### P1 — practical PBX

- [ ] Per-user business hours, forwarding, caller ID, and voicemail behavior within admin-defined policy.
- [ ] Admin-configured auto receptionist with greetings and business/closed/holiday routes.
- [ ] Basic IVR menu and clear fallback to a person, queue, or voicemail.
- [ ] Call queues with members, distribution strategy, hours, overflow, voicemail, and user opt-in/out.
- [ ] Role-scoped portal administration for users, sites, queues, and receptionist objects.

### P2 — scale and market expansion

- [ ] Shared lines and call delegation with explicit membership, call visibility, voicemail, and privacy rules.
- [ ] SMS/MMS only for verified eligible number types and supported regions.
- [ ] Call recordings, analytics, compliance access, and add-on entitlements.
- [ ] Country/carrier-specific number provisioning, emergency locations, and operational requirements.

This ordering is a Phone11 planning recommendation derived from Zoom's documented workflows and requirements. It is not a claim that these capabilities exist in Phone11 or that they are available in every market or license tier.
