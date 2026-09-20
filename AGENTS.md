# Phone11 project instructions

## Owner-approved orchestration policy

Follow the latest owner-provided Global AI Development Orchestration Policy
and `~/.codex/AGENTS.md`. This section supersedes the older Astra Low / Luna
allocation and mandatory nine-stage pipeline previously recorded here.

- Intended lead: Astra High for scope, architecture, delegation and acceptance.
  Do not claim a lead model/effort change without environment confirmation.
- Terra XHigh: bounded routine implementation, frontend, tests and documentation.
- Sol Medium: difficult existing-code or cross-component implementation; escalate
  after a Terra attempt exposes incomplete understanding.
- Sol High: selective lifecycle, telephony, networking, concurrency or security
  diagnosis and critical review.
- Use at most 2–3 independent workers. No nested delegation or overlapping file
  ownership. Give each worker an objective, context, scope, constraints, expected
  behavior, acceptance criteria, testing and escalation condition. Keep the same
  worker through fixes and verification. Do not constantly poll.
- If a requested model/effort is unavailable, report it instead of substituting.
- Preserve existing architecture and working calling. Diagnose the execution
  path before patching symptoms; use the smallest correct change.
- Reports distinguish completed source, checks actually run, deployments,
  provider behavior and physical-device acceptance. Include unresolved risks.

## Phone11 delivery and integration

- Preserve the signed daily-pilot iPhone app. Never replace it with a development
  launcher, Expo Go or a Metro-dependent build. Retain verified rollback IPAs.
- Installation QR codes target the verified EAS build-details page; raw IPA
  links are not the primary iPhone installation flow.
- Keep SIP wake/background calling protected while changing Team Chat.
- Keep private recording follow-ups private unless explicitly shared.
- Use explicit tenant/account mappings for Connect11 and shared services.
- Never treat source tests, token minting or a browser preview as two-phone
  audio/video, background ringing or push-delivery acceptance.
- Continue safe bounded work autonomously. Ask only for missing access or an
  unresolved material product/operational decision after preparing a concrete
  reviewable result.
