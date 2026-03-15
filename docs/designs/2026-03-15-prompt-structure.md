# Design: Prompt Optimization for Mid-Tier Instruct Models

## 1. Problem Statement

OpenVault’s current prompt architecture is optimized for flagship, reasoning-capable models (like Claude 3.5 Sonnet or GPT-4o). However, when running on mid-tier, non-reasoning instruct models (e.g., Qwen-72B, DeepSeek-V2/V3, Kimi), several systemic failures occur:

1. **Recency Bias (Attention Decay)**: Mid-tier models forget strict formatting rules (like output schemas and task constraints) if a massive narrative payload (the chat history) is placed *after* the rules.
2. **JSON Concatenation Hallucinations**: These models often attempt to break long JSON strings across multiple lines using JavaScript/Python syntax (e.g., `"summary": "text" + \n "more text"`), causing `safeParseJSON` to fail with `Unexpected character "+"`.
3. **`<tool_call>` Bleed**: Because these models are heavily RLHF-trained for agentic workflows, forensic/system-log framing causes them to hallucinate `<tool_call>` wrappers around their JSON, ignoring negative constraints like "Do NOT use tool calls".
4. **Conversational Drift**: Human-centric role framing (e.g., "You are a character psychologist") causes the models to generate flowery narrative prose instead of clinical data.
5. **Open-Ended `<think>` Blocks**: Unstructured thinking tags encourage the model to summarize the entire scene (including sensitive/e*plicit acts) in prose, which wastes tokens and risks triggering internal safety alignment filters.

## 2. Goals & Non-Goals

### Must Do
- Restructure the prompt topology to defeat recency bias (move schemas/rules *after* the payload).
- Add strict, positive formatting constraints to eliminate `<tool_call>` and `+` concatenation hallucinations.
- Rewrite prompt roles to be mechanical/clinical parsers rather than human personas.
- Standardize all few-shot `<think>` examples into rigid, mechanical checklists.
- Maintain existing dynamic language resolution and example filtering.

### Won't Do
- No changes to the underlying JS pipeline logic (`extract.js`, `reflect.js`, etc.).
- No changes to `safeParseJSON` (we are fixing the root cause at the prompt level, not the symptom).
- No changes to the Zod validation schemas.

## 3. Proposed Architecture

### 3.1 The "Recency Bias" Prompt Layout

The `[System, User, Assistant]` message array will be restructured to place critical execution instructions at the very end of the user's context window.

**Current Topology:**
*   **System:** Preamble → Role → Language Rules → Schema → Task Rules → Examples
*   **User:** Context → Messages → Language Reminder

**New Topology:**
*   **System:** Preamble → Role → Examples (Context & Calibration)
*   **User:** Context → Messages → Language Rules & Reminder → Task Rules → Output Schema → Execution Trigger (Payload & Constraints)
*   **Assistant:** Prefill

### 3.2 Anti-Hallucination Directives

**Fixing JSON Concatenation (`+`):**
Inject a visually distinct, highly specific rule into all output schemas:
`CRITICAL: NEVER use string concatenation (like "+") inside JSON values. Write all text as a single, unbroken line within the quotes.`

**Fixing `<tool_call>` Bleed:**
Replace negative constraints ("Do not use tool calls") with a positive execution trigger at the very end of the User prompt:
`OUTPUT FORMAT: Output standard plain text for your <think> block, immediately followed by raw JSON. Do not wrap your response in any tool, function, or code blocks.`

### 3.3 Mechanical Roles & Rigid `<think>` Blocks

**Role Adjustments:**
Shift all roles from human personas to automated systems.
*   *Old:* "You are a character psychologist analyzing a character's memory stream..."
*   *New:* "You are an automated behavioral analysis parser. Your function is to read temporal memory arrays and output structured insights."

**`<think>` Formatting:**
All few-shot examples in `src/prompts/examples/*.js` will have their `<think>` blocks rewritten into a strict, clinical 4-step or 5-step format (e.g., Step 1: Extract data, Step 2: Cross-reference, Step 3: Check progression, Step 4: Format JSON). This clinical tone helps bypass safety filters on sensitive content by framing the analysis purely as data extraction.

### 3.4 Consolidated Language Instructions

Group the `MIRROR_LANGUAGE_RULES` and the dynamic `LANG_INSTRUCTION` (from `resolveLanguageInstruction`) together immediately prior to the JSON schema in the User prompt. Use stark contrasts to prevent translation bleed:
`KEYS = ENGLISH ONLY.`
`VALUES = SAME LANGUAGE AS SOURCE TEXT.`
`NAMES = EXACT ORIGINAL SCRIPT (Do not translate/transliterate).`

## 4. File Change Map

| File | Change |
|------|--------|
| `src/prompts/shared/formatters.js` | Refactor `assembleSystemPrompt` to return only Role + Examples. Update `buildMessages` integration if necessary, or shift the assembly logic to the individual domain builders. |
| `src/prompts/shared/rules.js` | Update `MIRROR_LANGUAGE_RULES` to the punchier, high-contrast format. |
| `src/prompts/*/builder.js` | Update all 5 builders (`events`, `graph`, `reflection`, `communities`, `edge`) to construct the new User prompt topology (Context -> Messages -> Rules -> Schema). |
| `src/prompts/*/schema.js` | Add the anti-concatenation (`+`) rule and the positive `<tool_call>` formatting constraint. |
| `src/prompts/*/role.js` | Rewrite roles to use mechanical/parser framing. |
| `src/prompts/examples/*.js` | Rewrite all `<think>` blocks to use the rigid, mechanical step-by-step checklist format. |
| `tests/prompts/*.test.js` | Update unit tests to assert the new string positioning (e.g., verifying schemas are in the User message, not the System message). |

## 5. Risks & Edge Cases

### Risk: Top-Tier Model Degradation
- **Scenario:** Claude 3.5 Sonnet or GPT-4o might perform worse with rules in the User prompt instead of the System prompt.
- **Mitigation:** Extensive testing across the industry shows that placing schemas and strict constraints at the end of the context window (User prompt) actually *improves* instruction following across all model tiers, including frontier models.

### Risk: Example Token Bloat
- **Scenario:** Making `<think>` blocks more rigid might increase their token count.
- **Mitigation:** The rigid checklist format is generally *shorter* than the flowery narrative prose the models were generating previously. We will ensure the examples are concise.

## 6. Success Criteria

- [ ] All 5 prompt domains utilize the new `System (Role+Examples) -> User (Context+Payload+Rules+Schema)` topology.
- [ ] No `Unexpected character "+"` errors during extraction batches.
- [ ] No `<tool_call>` or markdown code block hallucinations in the raw LLM output.
- [ ] Few-shot examples strictly adhere to the mechanical Step-by-Step `<think>` format.
- [ ] Unit tests pass with the updated string topologies.