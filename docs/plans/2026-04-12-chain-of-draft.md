# Chain of Draft (CoD) Implementation Plan

**Goal:** Replace verbose Chain-of-Thought reasoning in all prompt modules with Chain of Draft — concise, symbol-heavy drafts with an 8-word-per-step limit.
**Testing Conventions:** Tests mirror `src/` structure under `tests/`. No prompt-content tests (asserting literal strings). Existing prompt-building tests verify structure, not content length. Pre-commit `npm run check` validates lint, typecheck, generate-types.

**CoD Reference:** Read the full paper at `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` before starting any task. Key points: minimal drafts per step, ≤8 words, use symbols (`->`, `+`, `!=`, `=`, `()`), keep semantic steps identical, only change framing and verbosity.

**Design Document:** `docs/designs/2026-04-12-chain-of-draft.md`

> **Path correction from design doc:** There is no `src/prompts/global_synthesis/` directory. `GLOBAL_SYNTHESIS_RULES` and `GLOBAL_SYNTHESIS` examples live inside `src/prompts/communities/`. The plan below uses the correct paths.

---

### Task 1: Update EXECUTION_TRIGGER in shared formatters

**Objective:** Change the wording in `EXECUTION_TRIGGER` to instruct the model to write concise draft notes instead of verbose reasoning.

**Files to modify/create:**
- Modify: `src/prompts/shared/formatters.js` (Purpose: Update Step 1 wording in `EXECUTION_TRIGGER`)
- Test: No new test needed (existing prompt-building tests cover structure; no prompt-content tests per conventions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand the CoD paradigm. Then read the top of `src/prompts/shared/formatters.js` (lines 18-30) to see the current `EXECUTION_TRIGGER`.
2. **Implement Change:** In `EXECUTION_TRIGGER`, replace the Step 1 line:
   - **Current:** `Step 1: Write your reasoning in plain text inside <think/> tags.`
   - **New:** `Step 1: Write concise draft notes inside <think/> tags. Limit each step to 8 words max.`
   - Steps 2-3 remain unchanged.
3. **Verify:** Run `npm run check` to confirm lint, typecheck, and generate-types all pass.
4. **Commit:** Commit with message: `feat(cod): update EXECUTION_TRIGGER to request concise draft notes`

---

### Task 2: Add draft tags to stripThinkingTags safety regex

**Objective:** Add `draft` and `draft_process` to the tag-name alternation in `stripThinkingTags()` so that any model echo of the new `<draft_process>` tag gets stripped correctly.

**Files to modify/create:**
- Modify: `src/utils/text.js` (Purpose: Add `draft` and `draft_process` to both regex alternations in `stripThinkingTags()`)
- Test: `tests/utils/text.test.js` (Purpose: Add test cases for draft tag stripping)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand CoD. Then read `src/utils/text.js` lines 260-280 to see the current `stripThinkingTags()` function and its regex patterns.
2. **Write Failing Test:** In `tests/utils/text.test.js`, add test cases verifying that:
   - `<draft>content</draft>` gets stripped from output
   - `<draft_process>content</draft_process>` gets stripped from output
   - Mixed `<think/>` + `<draft>` content strips both
   - `[DRAFT]content[/DRAFT]` bracket-style tags get stripped
   Run the test to confirm the draft tests fail (existing think tests should still pass).
3. **Implement Minimal Code:** In `stripThinkingTags()`, update two places:
   - The XML-style regex alternation: change `(think|thinking|thought|reasoning|reflection|tool_call|search)` to `(think|thinking|thought|reasoning|reflection|tool_call|search|draft|draft_process)`
   - The bracket-style regex alternation: change `(THINK|THOUGHT|REASONING|TOOL_CALL)` to `(THINK|THOUGHT|REASONING|TOOL_CALL|DRAFT|DRAFT_PROCESS)`
4. **Verify:** Run the tests and `npm run check` to confirm everything passes.
5. **Commit:** Commit with message: `feat(cod): add draft/draft_process to stripThinkingTags regex`

---

### Task 3: Convert events module rules to CoD

**Objective:** Replace the `<thinking_process>` block in the events rules with a `<draft_process>` block that uses CoD framing (8-word limit, symbol conventions).

**Files to modify/create:**
- Modify: `src/prompts/events/rules.js` (Purpose: Replace `<thinking_process>` with `<draft_process>`)
- Test: No new test needed (no prompt-content tests per conventions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand CoD (especially Section 3 — the prompt structure and symbol conventions). Then read the full `src/prompts/events/rules.js` to see the current `<thinking_process>` block (starts around line 67).
2. **Implement Change:** Replace the `<thinking_process>...</thinking_process>` block with a `<draft_process>...</draft_process>` block. The new block must:
   - Open with: "Think step by step, but only keep a minimal draft for each step, with 8 words at most per step."
   - Add: "Use symbols: -> for causation/actions, + for conjunction, != for contrast."
   - Keep the same semantic steps (what to extract), but shorten their descriptions where possible
   - Keep the instruction to write inside `<think/>` tags
   - Keep the "VERY CONCISE — one line per step" directive but reframe it as a draft constraint
3. **Verify:** Run `npm run check` to confirm everything passes.
4. **Commit:** Commit with message: `feat(cod): convert events rules to draft_process`

---

### Task 4: Convert graph module rules to CoD

**Objective:** Replace the `<thinking_process>` block in graph rules with a `<draft_process>` block.

**Files to modify/create:**
- Modify: `src/prompts/graph/rules.js` (Purpose: Replace `<thinking_process>` with `<draft_process>`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand CoD. Then read the full `src/prompts/graph/rules.js` to see the current `<thinking_process>` block (starts around line 24).
2. **Implement Change:** Same pattern as Task 3:
   - Replace `<thinking_process>...</thinking_process>` with `<draft_process>...</draft_process>`
   - Open with the CoD instruction (8-word limit, symbol conventions)
   - Keep the same semantic steps (entity scan, type validation, relationship map, output) but shorten descriptions
   - The graph draft convention from the design doc: `Entity(type) + relationship`, e.g., `Anna(PERSON) + Boris(PERSON); rel: friends`
3. **Verify:** Run `npm run check` to confirm everything passes.
4. **Commit:** Commit with message: `feat(cod): convert graph rules to draft_process`

---

### Task 5: Convert reflection module rules to CoD

**Objective:** Replace the `<thinking_process>` block in reflection rules with a `<draft_process>` block.

**Files to modify/create:**
- Modify: `src/prompts/reflection/rules.js` (Purpose: Replace `<thinking_process>` with `<draft_process>`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand CoD. Then read the full `src/prompts/reflection/rules.js` to see the current `<thinking_process>` block (starts around line 11).
2. **Implement Change:** Same pattern as Task 3:
   - Replace `<thinking_process>...</thinking_process>` with `<draft_process>...</draft_process>`
   - Open with the CoD instruction (8-word limit, symbol conventions)
   - Keep the same semantic steps (pattern scan, causal chains, synthesis, evidence) but shorten descriptions
   - The reflection draft convention from the design doc: `Pattern -> trigger -> insight`, e.g., `Event 124 -> fear; insight: Vova fears dark`
3. **Verify:** Run `npm run check` to confirm everything passes.
4. **Commit:** Commit with message: `feat(cod): convert reflection rules to draft_process`

---

### Task 6: Convert communities and global synthesis rules to CoD

**Objective:** Replace both `<thinking_process>` blocks in `src/prompts/communities/rules.js` — one for `COMMUNITY_RULES` and one for `GLOBAL_SYNTHESIS_RULES` — with `<draft_process>` blocks.

**Files to modify/create:**
- Modify: `src/prompts/communities/rules.js` (Purpose: Replace both `<thinking_process>` blocks with `<draft_process>`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand CoD. Then read the full `src/prompts/communities/rules.js`. It contains two exported constants: `COMMUNITY_RULES` (with a `<thinking_process>` around lines 10-17) and `GLOBAL_SYNTHESIS_RULES` (with a `<thinking_process>` around lines 25-31).
2. **Implement Change:** Replace both blocks following the same CoD pattern:
   - `COMMUNITY_RULES` draft convention: `Group: name; members; dynamics`, e.g., `Group: Stalkers; leader: Krot; base: Dump`
   - `GLOBAL_SYNTHESIS_RULES` draft convention: `Community links; narrative arc`, e.g., `Stalkers <-> Traders; conflict over resources`
   - Both get the CoD framing (8-word limit, symbol conventions, `<draft_process>` wrapper)
3. **Verify:** Run `npm run check` to confirm everything passes.
4. **Commit:** Commit with message: `feat(cod): convert communities and global synthesis rules to draft_process`

---

### Task 7: Rewrite events example thinking fields to CoD drafts

**Objective:** Rewrite the `thinking` field in all 7 EN examples and all 7 RU examples in the events module to use CoD-style terse drafts (≤8 words per line, symbol-heavy).

**Files to modify/create:**
- Modify: `src/prompts/events/examples/en.js` (Purpose: Rewrite 7 `thinking` fields to CoD drafts)
- Modify: `src/prompts/events/examples/ru.js` (Purpose: Rewrite 7 `thinking` fields to CoD drafts)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` — especially Section 3 (the lollipop example showing Standard vs CoT vs CoD) and Section 4.1 (the few-shot rewriting rules). Then read the full `src/prompts/events/examples/en.js` and `src/prompts/events/examples/ru.js` to see all 14 examples.
2. **Rewriting rules** (from design doc):
   - Each line = one semantic step, ≤ 8 words
   - Symbols: `->` for actions/cause, `+` for conjunction, `()` for role/type labels, `=` for assignment
   - No articles ("the", "a"), no connective tissue ("therefore", "because", "we can see that")
   - Think blocks remain English-only (per `MIRROR_LANGUAGE_RULES`) — so RU examples get identical English think blocks as EN
   - Events draft convention: `Subject -> action -> object; emotion = X`, e.g., `Vova -> bought -> apples; Пятерочка`
3. **Implement:** For each of the 14 examples, rewrite the `thinking` field following the rules above. Keep the same semantic steps (extract, cross-reference, progression, format) but compress each to ≤8 words per line. The `input` and `output` fields stay completely unchanged.
4. **Verify:** Run `npm run check` to confirm everything passes.
5. **Commit:** Commit with message: `feat(cod): rewrite events examples to terse draft style`

---

### Task 8: Rewrite graph example thinking fields to CoD drafts

**Objective:** Rewrite the `thinking` field in all 4 EN examples and all 4 RU examples in the graph module to use CoD-style terse drafts.

**Files to modify/create:**
- Modify: `src/prompts/graph/examples/en.js` (Purpose: Rewrite 4 `thinking` fields to CoD drafts)
- Modify: `src/prompts/graph/examples/ru.js` (Purpose: Rewrite 4 `thinking` fields to CoD drafts)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` (Section 3 and 4.1). Then read the full `src/prompts/graph/examples/en.js` and `src/prompts/graph/examples/ru.js`.
2. **Rewriting rules:** Same as Task 7. Graph draft convention: `Entity(type) + relationship`, e.g., `Anna(PERSON) + Boris(PERSON); rel: friends`. Keep the same semantic steps (entity scan, type validation, relationship map, output) but compress each to ≤8 words per line.
3. **Implement:** Rewrite all 8 `thinking` fields. `input` and `output` fields unchanged.
4. **Verify:** Run `npm run check` to confirm everything passes.
5. **Commit:** Commit with message: `feat(cod): rewrite graph examples to terse draft style`

---

### Task 9: Rewrite reflection example thinking fields to CoD drafts

**Objective:** Rewrite the `thinking` field in all 5 EN examples and all 5 RU examples in the reflection module to use CoD-style terse drafts.

**Files to modify/create:**
- Modify: `src/prompts/reflection/examples/en.js` (Purpose: Rewrite 5 `thinking` fields to CoD drafts)
- Modify: `src/prompts/reflection/examples/ru.js` (Purpose: Rewrite 5 `thinking` fields to CoD drafts)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` (Section 3 and 4.1). Then read the full `src/prompts/reflection/examples/en.js` and `src/prompts/reflection/examples/ru.js`.
2. **Rewriting rules:** Same as Task 7. Reflection draft convention: `Pattern -> trigger -> insight`, e.g., `Event 124 -> fear; insight: Vova fears dark`. Keep the same semantic steps (pattern scan, causal chains, synthesis, evidence) but compress each to ≤8 words per line.
3. **Implement:** Rewrite all 10 `thinking` fields. `input` and `output` fields unchanged.
4. **Verify:** Run `npm run check` to confirm everything passes.
5. **Commit:** Commit with message: `feat(cod): rewrite reflection examples to terse draft style`

---

### Task 10: Rewrite communities and global synthesis example thinking fields to CoD drafts

**Objective:** Rewrite the `thinking` field in all community examples (3 EN + 3 RU) and all global synthesis examples (2 EN + 2 RU) to use CoD-style terse drafts.

**Files to modify/create:**
- Modify: `src/prompts/communities/examples/en.js` (Purpose: Rewrite 3 community + 2 global synthesis `thinking` fields to CoD drafts)
- Modify: `src/prompts/communities/examples/ru.js` (Purpose: Rewrite 3 community + 2 global synthesis `thinking` fields to CoD drafts)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` (Section 3 and 4.1). Then read the full `src/prompts/communities/examples/en.js` and `src/prompts/communities/examples/ru.js`. Note: these files export two arrays — `COMMUNITIES` and `GLOBAL_SYNTHESIS`.
2. **Rewriting rules:** Same as Task 7. Per-module conventions:
   - Communities: `Group: name; members; dynamics`, e.g., `Group: Stalkers; leader: Krot; base: Dump`
   - Global Synthesis: `Community links; narrative arc`, e.g., `Stalkers <-> Traders; conflict over resources`
3. **Implement:** Rewrite all 10 `thinking` fields (6 community + 4 global synthesis). `input` and `output` fields unchanged.
4. **Verify:** Run `npm run check` to confirm everything passes.
5. **Commit:** Commit with message: `feat(cod): rewrite communities and global synthesis examples to terse draft style`

---

### Task 11: Update prompts CLAUDE.md to reflect CoD conventions

**Objective:** Update the `<think/>` TAG ENFORCEMENT section in `src/prompts/CLAUDE.md` to reflect the new `<draft_process>` tag and CoD conventions.

**Files to modify/create:**
- Modify: `src/prompts/CLAUDE.md` (Purpose: Update tag enforcement docs to reference `<draft_process>` and CoD conventions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/prompts/CLAUDE.md` fully.
2. **Implement Change:** In the `<think/>` TAG ENFORCEMENT section:
   - Change the bullet about `<thinking_process>` to reference `<draft_process>` instead: "Wrap structural guidelines in `<draft_process>`. Use this XML tag in system rules to define the steps, and instruct the model to keep each draft step to 8 words max inside standard `<think/>` tags."
3. **Verify:** No code change — documentation only.
4. **Commit:** Commit with message: `docs(cod): update prompts CLAUDE.md for draft_process conventions`

---

### Task 12: Final validation

**Objective:** Run the full test suite and `npm run check` to verify no regressions from the CoD conversion.

**Files to modify/create:**
- None (validation only)

**Instructions for Execution Agent:**
1. Run `npm run check` — this runs sync-version, generate-types, lint, jsdoc, css, typecheck. All must pass.
2. Run `npx vitest run` to execute the full test suite. All tests must pass.
3. Verify no stray `thinking_process` strings remain in `src/prompts/`:
   - Grep for `thinking_process` in `src/prompts/` — should return zero results in source files (the CLAUDE.md reference should now say `draft_process`)
4. Verify `draft_process` appears in all 5 expected locations:
   - `src/prompts/events/rules.js`
   - `src/prompts/graph/rules.js`
   - `src/prompts/reflection/rules.js`
   - `src/prompts/communities/rules.js` (2 occurrences: COMMUNITY_RULES + GLOBAL_SYNTHESIS_RULES)
5. If all checks pass, no additional commit needed. If issues are found, fix and commit with: `fix(cod): resolve validation issues`
