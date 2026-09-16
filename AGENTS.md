# Phone11 project instructions

## Sub-agent model guardrail

When the main agent is running GPT-6 Astra (`gpt-6-astra`), every sub-agent for this Phone11 project must use GPT-5.6 Luna (`gpt-5.6-luna`) with extra-high reasoning (`xhigh`). Set both overrides explicitly when spawning; do not inherit Astra for sub-agents. Use a supported context-fork mode that permits explicit model overrides, and include the concrete task and necessary context in the delegation.

Propagate this rule in every delegated task: any nested sub-agents must also use `gpt-5.6-luna` with `xhigh` reasoning for that Astra-led run. If this combination is unavailable, continue locally and report the limitation rather than silently choosing another model.

This guardrail applies whenever sub-agents are used; it does not require delegation for every task. When the main agent uses a different model, this conditional rule does not impose a sub-agent model override.
