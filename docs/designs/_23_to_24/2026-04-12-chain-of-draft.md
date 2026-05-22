# Chain of Draft: Replace CoT with CoD

Replace verbose Chain-of-Thought reasoning in all prompt modules with Chain of Draft — concise, symbol-heavy drafts with an 8-word-per-step limit. Based on [Xu et al., 2025](https://arxiv.org/abs/2503.09575).

## Context

Current prompts use `<thinking_process>` blocks with step-by-step instructions and verbose few-shot examples. The model generates long reasoning traces inside `<think/>` tags before outputting JSON. This costs tokens and latency — the paper shows 80%+ token reduction is achievable with comparable accuracy.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | All 4 prompt modules + global synthesis | Consistency; avoid mixed signals |
| Word limit | 8 words per draft step | Relaxed from paper's 5 to accommodate qualitative reasoning |
| Think tags | Keep `<think/>` | Preserves existing parsing pipeline |
| Rules + examples | Rewrite both | Paper shows CoD needs aligned instruction + examples |
| Approach | Full conversion, single pass | Avoid phased inconsistency |

## Changes

### 1. Rules: `<thinking_process>` → `<draft_process>`

Each module's `rules.js` gets its `<thinking_process>` block replaced with a `<draft_process>` block.

**New block structure:**
```
<draft_process>
Think step by step, but only keep a minimal draft for each step, with 8 words at most per step.
Use symbols: -> for causation/actions, + for conjunction, != for contrast.
Steps:
1. [existing semantic step, shortened where possible]
2. ...
</draft_process>
```

The semantic steps (what to extract) stay the same. Only the framing and verbosity constraint change.

**Affected files:**
- `src/prompts/events/rules.js`
- `src/prompts/graph/rules.js`
- `src/prompts/reflection/rules.js`
- `src/prompts/communities/rules.js`
- `src/prompts/global_synthesis/rules.js`

### 2. Few-Shot Examples: Verbose → Terse Drafts

All 42 few-shot examples across 10 example files have their `thinking` field rewritten.

**Rewriting rules:**
- Each line = one semantic step, ≤ 8 words
- Symbols: `->` for actions/cause, `+` for conjunction, `()` for role/type labels, `=` for assignment
- No articles ("the", "a"), no connective tissue ("therefore", "because", "we can see that")
- Think blocks remain English-only (per `MIRROR_LANGUAGE_RULES`)
- RU and EN examples get identical draft content (since think blocks are English-only)

**Per-module draft conventions:**

| Module | Draft Focus | Example |
|--------|------------|---------|
| Events | Subject -> action -> object; emotion = X | `Vova -> bought -> apples; Пятерочка` |
| Graph | Entity(type) + relationship | `Anna(PERSON) + Boris(PERSON); rel: friends` |
| Reflection | Pattern -> trigger -> insight | `Event 124 -> fear; insight: Vova fears dark` |
| Communities | Group: name; members; dynamics | `Group: Stalkers; leader: Krot; base: Dump` |
| Global Synthesis | Community links; narrative arc | `Stalkers <-> Traders; conflict over resources` |

**Affected files:**
- `src/prompts/events/examples/en.js` (7 examples)
- `src/prompts/events/examples/ru.js` (7 examples)
- `src/prompts/graph/examples/en.js` (4 examples)
- `src/prompts/graph/examples/ru.js` (4 examples)
- `src/prompts/reflection/examples/en.js` (5 examples)
- `src/prompts/reflection/examples/ru.js` (5 examples)
- `src/prompts/communities/examples/en.js` (3 examples)
- `src/prompts/communities/examples/ru.js` (3 examples)
- `src/prompts/global_synthesis/examples/en.js` (2 examples)
- `src/prompts/global_synthesis/examples/ru.js` (2 examples)

### 3. EXECUTION_TRIGGER Update

**File:** `src/prompts/formatters.js`

**Current:**
```
Step 1: Write your reasoning in plain text inside <think/> tags.
```

**New:**
```
Step 1: Write concise draft notes inside <think/> tags. Limit each step to 8 words max.
```

Steps 2-3 unchanged.

### 4. stripThinkingTags() Safety Addition

**File:** `src/utils/text.js`

Add `draft` and `draft_process` to the tag name alternation in both regex patterns as a defensive measure against model echo:

```javascript
// Current:
/(think|thinking|thought|reasoning|reflection|tool_call|search)/
// Updated:
/(think|thinking|thought|reasoning|reflection|tool_call|search|draft|draft_process)/
```

### 5. No Changes Needed

- `src/prompts/shared/rules.js` — `THINK BLOCKS = ENGLISH ONLY` already correct for CoD
- `stripThinkingTags()` core logic — no structural changes, just regex additions
- Zod schemas — structured output format unchanged
- Builder files — tag wrapping logic unchanged

## Files Changed Summary

| # | File | Change |
|---|------|--------|
| 1 | `src/prompts/events/rules.js` | `<thinking_process>` → `<draft_process>` |
| 2 | `src/prompts/graph/rules.js` | Same |
| 3 | `src/prompts/reflection/rules.js` | Same |
| 4 | `src/prompts/communities/rules.js` | Same |
| 5 | `src/prompts/global_synthesis/rules.js` | Same |
| 6 | `src/prompts/events/examples/en.js` | Rewrite `thinking` to CoD drafts |
| 7 | `src/prompts/events/examples/ru.js` | Same |
| 8 | `src/prompts/graph/examples/en.js` | Same |
| 9 | `src/prompts/graph/examples/ru.js` | Same |
| 10 | `src/prompts/reflection/examples/en.js` | Same |
| 11 | `src/prompts/reflection/examples/ru.js` | Same |
| 12 | `src/prompts/communities/examples/en.js` | Same |
| 13 | `src/prompts/communities/examples/ru.js` | Same |
| 14 | `src/prompts/global_synthesis/examples/en.js` | Same |
| 15 | `src/prompts/global_synthesis/examples/ru.js` | Same |
| 16 | `src/prompts/formatters.js` | `EXECUTION_TRIGGER` wording |
| 17 | `src/utils/text.js` | Add `draft`/`draft_process` to regex |

## Testing Strategy

1. **Unit tests:** Existing prompt-building tests must pass (they test structure, not content length)
2. **Pre-commit:** `npm run check` — lint, typecheck, generate-types must pass
3. **Manual A/B:** Feed identical chat messages through old and new prompts, compare output quality
4. **Perf metrics:** Monitor `llm_extraction` latency (ms) and token count from perf store — expect 50-80% reduction
5. **Accuracy gate:** Schema validation pass rate must not regress below current baseline

## Risks

| Risk | Mitigation |
|------|-----------|
| Accuracy regression on qualitative tasks | Manual A/B testing; per-module rollback possible |
| Model ignores 8-word constraint | Paper shows models largely comply with few-shot examples as guidance |
| Small models (<3B) perform worse with CoD | Paper confirms this; not a concern if targeting flagship models only |
| RU examples lose nuance in compressed drafts | Think blocks are English-only; RU nuance preserved in JSON values |
