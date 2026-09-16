# Phone11 project instructions

## Sub-agent model guardrail

When the main agent is running GPT-6 Astra (`gpt-6-astra`), every delegated task must request Sonnet 5 with extra-high reasoning. Set both overrides explicitly when the orchestration runtime supports that model; do not inherit Astra for sub-agents. In a runtime where Sonnet 5 is unavailable, use GPT-5.6 Luna (`gpt-5.6-luna`) with extra-high reasoning (`xhigh`) instead, and state that fallback in the delegation.

Propagate this rule in every delegated task: any nested sub-agents must make the same Sonnet 5 extra-high request, or use the documented Luna extra-high fallback when Sonnet 5 is unavailable. If neither approved combination is available, continue locally and report the limitation rather than silently choosing another model.

This guardrail applies whenever sub-agents are used; it does not require delegation for every task. When the main agent uses a different model, this conditional rule does not impose a sub-agent model override.
