# Phone11 project instructions

## Owner-approved orchestration policy

Follow the latest owner-provided policy and `~/.codex/AGENTS.md`.

- Every subagent uses `gpt-6.1-sol` with `high` reasoning, explicitly selected.
  The owner's 1 October 2026 preference supersedes older project/skill routing.
- Do not claim a model/effort change without environment confirmation. Stop
  and replace an existing subagent with different or unknown settings while
  preserving its work and exact handoff.
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
