# Phone11 project instructions

## Lead and delegation workflow

This owner-requested workflow supersedes all previous model allocations and the mandatory nine-stage pipeline.

Keep Astra Low (`gpt-6-astra`, `low`) as the intended lead for this task. The lead owns scope, important decisions, delegation and final acceptance. Keep planning concise and proportional. Do not claim to change the lead model or reasoning setting unless the environment supports and confirms the change.

Assign subagents explicitly:

| Responsibility | Model | Reasoning |
| --- | --- | --- |
| Simple lookup, extraction and formatting | `gpt-5.6-luna` | `low` |
| Research, summaries, documentation and initial inspection | `gpt-5.6-luna` | `medium` |
| Bounded coding, tests, UI changes, straightforward fixes, focused investigation and routine review | `gpt-5.6-luna` | `high` |
| Substantial implementation, complex integrations and difficult changes across components | `gpt-5.6-terra` | `high` |
| A specific difficult bounded investigation warranting additional reasoning only | `gpt-5.6-luna` | `xhigh` |

Use one subagent by default. Add another only for independent work or a necessary independent review. No nested delegation. Complete trivial actions directly when delegation adds overhead.

Give each worker a compact brief with the objective, relevant files, constraints, known findings and acceptance criteria. Include only necessary history. Set the model and reasoning explicitly using a supported context-fork mode. Keep the same implementation worker through testing, fixes and polish.

Combine necessary product planning, architecture and UX decisions into one Astra Low pass. Skip unnecessary stages. Do not automatically use Astra Medium/High for research, front-end design, screenshots or final review.

Review worker evidence and inspect relevant source where necessary. Do not repeat the entire investigation or commission overlapping reviews. Request concise reports containing changes, verification, unresolved risks and decisions needed.

Escalate when complexity or risk warrants it, or after two unsuccessful substantive attempts. State the reason and choose the appropriate model directly. Reserve Astra Medium for unresolved cross-system decisions and Astra High for a specific demanding problem.

Preserve meaningful tests, security checks, tenant isolation, browser verification and device checks where applicable. Stop when acceptance criteria and required checks are satisfied. Optimize total credits per successfully completed task, including rework.

If a requested model or reasoning setting is unavailable, report it rather than silently substituting.

For future standalone tasks, recommend Luna High as lead for routine work, Terra High for substantial implementation with a clear plan, and Astra Low for complex or ambiguous product work.
