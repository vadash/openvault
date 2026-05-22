# Prompts and LLM Directives

## DIRECTORY STRUCTURE
Prompt modules are organized by domain:
- `events/` - Event extraction prompts (role, rules, schema, examples)
- `graph/` - Graph entity extraction prompts
- `reflection/` - Reflection synthesis prompts
- `world-state/` - World state synthesis prompts
- `shared/` - Cross-domain formatters (`format-examples.js`, `formatters.js`, `preambles.js`, `rules.js`)

Each domain follows the same structure: `builder.js` (assembles messages), `role.js`, `rules.js`, `schema.js`, `examples/{en,ru}.js` (bilingual few-shot).

## TOPOLOGY & ANTI-RECENCY BIAS
- **Construct via `buildMessages()`.** Always use the shared formatter.
- **System Prompt:** Assemble using `assembleSystemPrompt()`. Include ONLY the role definition and few-shot examples.
- **User Prompt:** Append the constraint block using `assembleUserConstraints()`. Order strictly: `Language Rules -> Task Rules -> Schema -> Execution Trigger`. Forcing constraints to the very end of the context window guarantees mid-tier model compliance.

## `<think/>` TAG ENFORCEMENT
- **Use `<think/>` exclusively.** Never prompt the model to output `<thinking>` or `<reasoning>`.
- **Wrap structural guidelines in `<draft_process>`.** Use this XML tag in system rules to define the steps, and instruct the model to keep each draft step to 8 words max inside standard `<think/>` tags.
- **Strip tags safely.** Run all LLM output through `stripThinkingTags()` before JSON parsing. Handle orphaned closing tags resulting from assistant prefilling.

## LANGUAGE MIRRORING
- **Enforce original scripts for entity names.** Never translate or transliterate character names in JSON values.
- **Mirror the prose.** Output values in Russian if the input is Russian. Output keys exclusively in English.
- **Detect non-Latin scripts heuristically.** If `outputLanguage` is 'auto', scan the user message for Cyrillic/CJK and dynamically inject the "Do NOT translate to English" reminder.

## FEW-SHOT EXAMPLES
- **Format via `formatExamples()`.** Wrap examples in numbered `<example_X>` tags. Map the `thinking` object property to actual `<think/>` blocks.
- **Bilingual coverage.** Each domain has `examples/en.js` and `examples/ru.js` with language-matched few-shot examples.
- **Calibrate compliance via SFW-to-Kink gradients.** Ensure examples cover mundane actions, violent conflicts, and explicit/kink scenarios to bypass refusal filters mechanically.
