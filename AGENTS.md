# Phone11 project instructions

## Sub-agent model guardrail

For Astra-led Phone11 work, use the following task-based model allocation. This supersedes the previous Sonnet 5 and blanket Luna extra-high rules.

| Task | Model | Reasoning |
| --- | --- | --- |
| Search, summarize, inspect, documentation | `gpt-5.6-luna` | `medium` |
| Tests, UI, bounded coding, straightforward fixes | `gpt-5.6-luna` | `high` |
| Investigation, review, difficult bounded problems | `gpt-5.6-luna` | `xhigh` |
| Substantial implementation | `gpt-5.6-terra` | `high` |
| Product, architecture, decomposition, final judgment (general default) | `gpt-6-astra` | `low` |
| Hard cross-system problems; escalate only when necessary | `gpt-6-astra` | `medium` |

### Product workflow overrides

For these specific stages, use the allocation below instead of the general defaults:

1. Research: Astra `medium`.
2. Product plan: Astra `medium`.
3. UX and information architecture: Astra `medium`.
4. Front-end design: Astra `high`.
5. Build: Terra `high`.
6. Cheap parallel work: Luna `high` or `xhigh`, according to difficulty.
7. Screenshot and browser UX review: Astra `high`.
8. Implement polish: Terra `high` for substantial implementation; Luna `high` for bounded changes or `xhigh` for difficult bounded problems.
9. Final product review: Astra `high`.

Set model and reasoning overrides explicitly for each sub-agent, using a context-fork mode that supports overrides. Include this allocation policy in every delegation prompt and require nested delegations to follow it. State the chosen model, reasoning effort, and bounded responsibility. Escalate only when the task requires it; do not inherit Astra accidentally for cheap parallel work.

If a required model or effort is unavailable, report the limitation rather than silently substituting another model. Do not claim to change the main agent's active model or reasoning setting through a prompt; apply supported overrides to delegated work and report any main-agent setting limitation.

This rule applies whenever sub-agents are used; it does not require delegation for every task. When the main agent uses a different model, this conditional rule does not impose a sub-agent model override.
