# Admin interface delivery status — 2026-09-27

## Implemented

The existing Expo web admin routes now share a persistent desktop sidebar and compact-screen navigation drawer. The workspace picker is role-scoped; capability and implicit-tenant restrictions continue to control available destinations. Native routes retain their existing navigation.

Overview uses compact metrics, grouped management links, and recent call activity. People uses the existing tenant-bound hooks with a responsive table/card inventory, avatar renderer, search, role/status filters, and the existing membership editor. Desktop member editing is a centered dialog. Unsupported invitation delivery remains clearly unavailable.

Source head `61fbec3` also includes a deeper admin presentation pass: a desktop Extensions inventory, centered IVR/queue/business-hours dialogs, and compact meeting-hosting and voicemail-administration pages. These changes retain existing queries, access gates, and operations. They do not add account-wide meeting policies, holiday routing, voicemail retention controls, or provider capabilities.

Independent workers owned the People inventory and Overview, with a separate source reviewer. The lead integrated the shell, corrected focus/stacking issues, and verified browser behavior. No auth, PBX, SIP, provider, or production configuration was changed.

## Validation

- Final source checks at `61fbec3`: 48 targeted admin/workspace tests passed across seven files; final `tsc --noEmit` passed.
- ESLint on the six changed/new UI files passed with no lint findings; Node emitted an existing module-type configuration warning.
- `git diff --check` passed.
- The earlier shell/Overview/People Expo production web export passed into `/tmp/phone11-admin-ui-export-20260927`, with production API base `https://api.phone11.ai`. This is build evidence for that earlier candidate, not a claim that the deeper-page head was exported or deployed.
- Actual `/admin` and `/admin/users` routes were exercised against a localhost-only synthetic read API. Search, filters, member-editor opening, responsive navigation, and keyboard dismissal passed. No captured browser console errors.
- Deeper-page synthetic fixture captures cover Extensions (desktop and compact), IVR, business hours, and meeting hosting. The queue capture predates its final Save-button color change; no final voicemail capture exists. These images do not prove backend mutation, storage durability, SIP, or provider behavior.
- Presentation preview workspace switching passed with sample data. No production mutation test was performed.
- Independent final source review reported no remaining concrete P0–P2 finding.

See root `design-qa.md` for screenshot paths, reference comparison, corrections, and scope limits. The local preview is `http://localhost:8094/dev/admin-preview`; its sample-data route is development-only.

## Remaining

The deeper-page source head `61fbec3` is not the production candidate. The separate `phone11-admin-release-20260927` checkout shipped application source `009ce8abc2e0f3f8f070fd922abbcd802bb7718b` to https://1toall.phone11.ai/admin. It includes Overview, People, the shared shell, workspace lifecycle safeguards, recent-call field normalization, and presentation-only IVR/queue/business-hours changes compatible with the live base. It does not deploy this development branch wholesale.

The release passed 90 focused tests, typecheck, independent source review, guarded activation, public artifact verification, and signed-in Overview/People search, filters, and member-editor checks. A recoverable React hydration warning occurred on both the predecessor and new release and remains outstanding. Live People rows showed initials; photo delivery was not accepted. Workspace refetch deliberately unmounts the admin editor and can discard an unsaved draft. No production membership edit was submitted. Release metadata and the full evidence/rollback report are committed as `ab5ff64` in the release checkout at `docs/phone11-daily-use/ADMIN-WEB-RELEASE-20260927.md`. Temporary local preview servers have been stopped.

Invitation delivery, full bulk provisioning, detailed policy inheritance, mobile/desktop calling behavior, and meeting audio each require their own implementation and acceptance evidence. Backend-disabled services remain unavailable. Do not label this a completed Zoom Phone/Meetings clone.
