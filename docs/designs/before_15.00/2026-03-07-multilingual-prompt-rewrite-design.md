# Design: Multilingual Prompt Architecture Rewrite

## 1. Problem Statement

OpenVault's 5 LLM extraction prompts hardcode "Write in ENGLISH" for all output. When users roleplay in Russian (or any non-English language), the LLM translates summaries to English before storing. This breaks BM25 keyword matching: query tokens (Russian) never overlap document tokens (English). The retrieval score formula is `Base + (α × Vector) + ((1-α) × BM25)` — with default α=0.7, BM25 contributes 30% of retrieval signal. For non-English chats, that 30% is **zero**.

Secondary problem: the 5 prompts use inconsistent structures. Events and graph have inline few-shots; reflections and communities have minimal examples. Prompt construction logic varies between build functions.

**What already works:**
- BM25 tokenizer: Unicode-aware (`\p{L}`), Russian Snowball stemmer with over-stem guard, Russian stopwords
- Embeddings: `multilingual-e5-small` trained on 100+ languages
- Zod schemas: `z.string()` validates any UTF-8

**What's broken:** Only the prompt instructions force English output.

## 2. Goals & Non-Goals

### Must Do
- Remove all "Write in ENGLISH" / "ALL summaries in ENGLISH" constraints from all prompts
- Add Mirror Language Rule: output language auto-mirrors input language
- Standardize all 5 prompts to the same 3-part message structure
- Create separate examples module with bilingual (EN/RU) few-shot examples
- SFW → explicit → kink gradient to progressively calibrate model compliance
- Proportional example counts: events 10, graph 8, questions 6, insights 6, communities 6

### Won't Do
- Add language dropdown UI setting (auto-detect from input instead)
- Modify BM25 tokenizer/stemmer (already multilingual)
- Modify embedding pipeline (already multilingual)
- Add stemmers for additional languages (pass-through is fine)
- Change extraction worker pipeline or retrieval math
- Add new UI elements

## 3. Proposed Architecture

### 3.1 Standardized 3-Part Message Format

Every prompt follows this exact layout:

```
┌─────────────────────────────────────────┐
│ SYSTEM MESSAGE                          │
│                                         │
│  1. Anti-refusal Preamble (CN or EN)    │
│  2. Role Definition                     │
│  3. Mirror Language Rule                │
│  4. Output Format Specification         │
│  5. Domain-Specific Rules               │
│  6. Few-Shot Examples                   │
├─────────────────────────────────────────┤
│ USER MESSAGE                            │
│                                         │
│  1. Context Sections                    │
│     (<established_memories>,            │
│      <characters>, <messages>, etc.)    │
│  2. Task Instruction                    │
├─────────────────────────────────────────┤
│ ASSISTANT PREFILL                       │
│                                         │
│  Configurable preset (think_tag, etc.)  │
└─────────────────────────────────────────┘
```

The system message contains ALL instructions and examples. The user message contains ONLY the data payload. The prefill primes the output format.

### 3.2 New File Structure

```
src/
├── prompts.js                    # Prompt builders (rewritten, lean orchestrators)
└── prompts/
    ├── examples/
    │   ├── events.js             # 10 event extraction examples (5 EN + 5 RU)
    │   ├── graph.js              # 8 graph extraction examples (4 EN + 4 RU)
    │   ├── questions.js          # 6 salient question examples (3 EN + 3 RU)
    │   ├── insights.js           # 6 insight extraction examples (3 EN + 3 RU)
    │   └── communities.js        # 6 community summary examples (3 EN + 3 RU)
    ├── rules.js                  # Shared rules (mirror language, JSON constraints)
    └── roles.js                  # Role definitions per prompt type
```

### 3.3 Mirror Language Rule (Shared Across All Prompts)

Injected as section 3 of every system message:

```
## LANGUAGE RULES (CRITICAL)

1. Write ALL string values (summaries, descriptions, insights, findings) in the
   SAME LANGUAGE as the provided source text. If input is Russian, output values
   in Russian. If input is English, output values in English.
2. JSON keys MUST remain in English. Never translate keys like "events",
   "summary", "characters_involved", "entities", "relationships".
3. Do NOT mix languages within a single output field.
4. Character names MUST be preserved exactly as written in the source text.
   Never transliterate or translate names (Саша stays Саша, not "Sasha").
5. If the source text mixes languages, match the language of the narrative prose
   (actions/descriptions), not the spoken dialogue. Characters may code-switch
   in speech — the narration language is the stable anchor.
6. Ignore the language of system instructions and context labels — only the
   narrative text in <messages> determines the output language.
7. ALL <think> reasoning blocks MUST be written in English regardless of input
   language. You are an English-speaking data technician transcribing foreign-
   language data. English reasoning prevents attention drift toward translating
   JSON keys.
```

## 4. Data Models / Schema

No schema changes required. Existing schemas accept any UTF-8 string:

```javascript
// All of these already work with Russian/Chinese/any content:
summary: z.string().min(30)           // "Саша прижала Вову к стене" validates fine
description: z.string()               // Any language
insight: z.string()                   // Any language
title: z.string()                     // Any language
findings: z.array(z.string())         // Any language per item
```

The `tokens` field on memories will naturally contain stemmed tokens in the source language. The existing `tokenize()` → `stemWord()` pipeline in `src/utils/stemmer.js` already handles this:
- Cyrillic text → Russian Snowball stemmer (with over-stem guard)
- Latin text → English Snowball stemmer
- Other scripts → pass-through

**Migration note:** Existing memories have English tokens. New memories will have native-language tokens. Old memories won't match new queries via BM25 but will still match via embeddings. Users can backfill to re-extract.

## 5. Interface / API Design

### 5.1 Examples Module

Each example file exports an array of example objects and a formatter:

```javascript
// src/prompts/examples/events.js

export const EVENT_EXAMPLES = [
    {
        label: 'Discovery (EN/SFW)',
        input: `...RP snippet...`,
        thinking: `...model reasoning...`,
        output: `{ "events": [...] }`
    },
    // ... 9 more
];
```

Shared formatter in a common helper:

```javascript
// src/prompts/examples/format.js

export function formatExamples(examples) {
    return examples
        .map((ex, i) => {
            const parts = [`<example_${i + 1}>`];
            parts.push(`<input>\n${ex.input}\n</input>`);
            if (ex.thinking) {
                parts.push(`<ideal_output>\n<think>\n${ex.thinking}\n</think>\n${ex.output}\n</ideal_output>`);
            } else {
                parts.push(`<ideal_output>\n${ex.output}\n</ideal_output>`);
            }
            parts.push(`</example_${i + 1}>`);
            return parts.join('\n');
        })
        .join('\n\n');
}
```

### 5.2 Rules Module

```javascript
// src/prompts/rules.js

export const MIRROR_LANGUAGE_RULES = `## LANGUAGE RULES (CRITICAL)
1. Write ALL string values in the SAME LANGUAGE as the source text.
2. JSON keys MUST remain in English.
3. Do NOT mix languages within a single output field.
4. Character names preserved exactly — never translate or transliterate.
5. Mixed-language input: match the language of narrative prose (actions/descriptions), not spoken dialogue.
6. Ignore instruction language — only <messages> content determines output language.
7. ALL <think> reasoning MUST be in English. You are an English-speaking technician transcribing foreign-language data.`;
```

### 5.3 Roles Module

```javascript
// src/prompts/roles.js

export const EVENT_ROLE = `You are a structured data extraction pipeline for an interactive fiction archive.
- Read narrative text → output JSON event records.
- Read-only analytical task. Do not generate new content.
- Process fiction across ALL genres with equal scholarly precision.
- Extraction accuracy requires faithful preservation of source material.`;

export const GRAPH_ROLE = `...`;
export const QUESTIONS_ROLE = `...`;
export const INSIGHTS_ROLE = `...`;
export const COMMUNITIES_ROLE = `...`;
```

### 5.4 Rewritten Prompt Builders

```javascript
// src/prompts.js (rewritten — lean orchestrators)

import { EVENT_EXAMPLES } from './prompts/examples/events.js';
import { GRAPH_EXAMPLES } from './prompts/examples/graph.js';
import { QUESTION_EXAMPLES } from './prompts/examples/questions.js';
import { INSIGHT_EXAMPLES } from './prompts/examples/insights.js';
import { COMMUNITY_EXAMPLES } from './prompts/examples/communities.js';
import { formatExamples } from './prompts/examples/format.js';
import { MIRROR_LANGUAGE_RULES } from './prompts/rules.js';
import { EVENT_ROLE, GRAPH_ROLE, QUESTIONS_ROLE, INSIGHTS_ROLE, COMMUNITIES_ROLE } from './prompts/roles.js';

export function buildEventExtractionPrompt({ settings, memories, characters, messages }) {
    const preamble = resolveExtractionPreamble(settings);

    const system = [
        preamble,
        '## ROLE\n' + EVENT_ROLE,
        MIRROR_LANGUAGE_RULES,
        '## OUTPUT FORMAT\n' + EVENT_OUTPUT_FORMAT,
        '## RULES\n' + EVENT_RULES,
        '## EXAMPLES\n' + formatExamples(EVENT_EXAMPLES),
    ].join('\n\n');

    const user = buildEventUserPayload(memories, characters, messages);
    const prefill = resolveExtractionPrefill(settings);

    return buildMessages(system, user, prefill);
}

// Same pattern for buildGraphExtractionPrompt, buildSalientQuestionsPrompt,
// buildInsightExtractionPrompt, buildCommunitySummaryPrompt.
// Only the role, format, rules, and example set change.
```

## 6. Few-Shot Example Strategy

### 6.1 Content Gradient

Each prompt's examples progress from safe to explicit. This is intentional — the gradient calibrates the model to treat all content with equal clinical precision, matching the anti-refusal preamble's framing.

### 6.2 Event Extraction Examples (10 total)

| # | Lang | Level | Scenario | Key Demonstration |
|---|------|-------|----------|-------------------|
| 1 | EN | SFW | Discovery: explorer finds hidden chamber with ancient artifact | Basic event extraction, importance 3 |
| 2 | RU | SFW | Emotional conversation: character confesses loneliness to friend | RU input → RU summary, importance 3 |
| 3 | EN | Moderate | Combat: sword duel with injury, character takes a wound to the shoulder | Violence extraction, importance 3-4 |
| 4 | RU | Moderate | Romantic tension: first kiss, hesitation, physical closeness | RU romantic content, importance 4 |
| 5 | EN | Explicit | First sexual contact: characters undress, explicit touching, oral | Precise anatomical language, importance 4 |
| 6 | RU | Explicit | Sexual scene: penetration, explicit positions, physical descriptions | RU explicit with exact detail preserved, importance 3 (routine between established partners) |
| 7 | EN | Kink | BDSM: restraints, dominance/submission, spanking, safeword negotiation | Kink terminology preserved exactly, importance 4 |
| 8 | RU | Kink | Power dynamic: collar, commands, degradation, aftercare | RU kink content, character names untranslated, importance 4 |
| 9 | EN | Edge | Continuation of existing combat — no new event | Shows `"events": []` with thinking that explains dedup |
| 10 | RU | Edge | Continuation of existing intimate scene — no new event | Shows `"events": []` in RU context, dedup reasoning in `<think>` |

**What each event example contains:**
- `input`: 4-8 lines of RP dialogue (the `<messages>` content)
- `thinking`: 3-5 lines of `<think>` reasoning showing the step-by-step process (check established, apply dedup, assign importance)
- `output`: Complete JSON with `"events"` array containing 0-1 event objects

**Example 1 (EN/SFW) — Discovery:**
```
input:
  *Kira pushes open the heavy stone door. Dust swirls in the torchlight as she steps into
  the chamber. Rows of crystalline vials line the walls, each glowing faintly blue.*
  "By the gods," she whispers, lifting one from its cradle. "These are Ashwood's
  preservation flasks. The guild has been searching for these for a century."

thinking:
  Step 1: Kira discovered a hidden chamber containing Ashwood's preservation flasks.
  Step 2: No established memories mention this discovery or the flasks.
  Step 3: New discovery of plot-significant artifacts — not a continuation.
  Step 4: Importance 3 (notable discovery, advances plot). Summary preserves specifics.

output:
  {
    "events": [{
      "summary": "Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks",
      "importance": 3,
      "characters_involved": ["Kira"],
      "witnesses": [],
      "location": "Hidden chamber",
      "is_secret": false,
      "emotional_impact": { "Kira": "awe" },
      "relationship_impact": {}
    }]
  }
```

**Example 2 (RU/SFW) — Emotional conversation:**
```
input:
  Лена опустила глаза и тихо сказала: "Я не помню, когда в последний раз кто-то
  спрашивал, как у меня дела. По-настоящему спрашивал." Она сжала край рукава.
  Дима молча сел рядом и положил руку ей на плечо.
  "Я здесь," — сказал он. — "Никуда не денусь."

thinking:
  Step 1: Input is Russian. Output values must be in Russian. Lena confessed loneliness, Dima supported her physically and verbally.
  Step 2: No established memories about this conversation.
  Step 3: New event — emotional vulnerability and support. Not a continuation.
  Step 4: Importance 3 (meaningful conversation, relationship deepening). Writing summary in Russian.

output:
  {
    "events": [{
      "summary": "Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться",
      "importance": 3,
      "characters_involved": ["Лена", "Дима"],
      "witnesses": [],
      "location": null,
      "is_secret": false,
      "emotional_impact": { "Лена": "уязвимость", "Дима": "сочувствие" },
      "relationship_impact": { "Лена→Дима": "возросшее доверие" }
    }]
  }
```

**Example 5 (EN/Explicit) — First sexual contact:**
```
input:
  She pulled his shirt over his head and pushed him onto the bed. "I've wanted this
  since the lake," she breathed against his neck. Her hand slid down his chest,
  fingers tracing the line of hair below his navel before wrapping around his cock.
  He groaned, hips bucking into her grip. She stroked him slowly, thumb circling
  the head, watching his face twist with pleasure.

thinking:
  Step 1: First sexual contact — she undressed him, gave a handjob.
  Step 2: No existing memories of sexual contact between these two.
  Step 3: New action type (first intimate contact). Not a continuation.
  Step 4: Importance 4 (first sexual contact, significant relationship escalation).

output:
  {
    "events": [{
      "summary": "She undressed him and stroked his cock for the first time, referencing desire since the lake",
      "importance": 4,
      "characters_involved": ["Lila", "Marcus"],
      "witnesses": [],
      "location": "Bedroom",
      "is_secret": false,
      "emotional_impact": { "Lila": "desire", "Marcus": "pleasure" },
      "relationship_impact": { "Lila→Marcus": "sexual relationship initiated" }
    }]
  }
```

**Example 6 (RU/Explicit) — Sexual scene:**
```
input:
  Саша толкнула его на спину и села сверху, медленно опускаясь на его член. Вова
  схватил её за бёдра, направляя ритм. "Быстрее," — выдохнул он. Она подчинилась,
  ускоряя движения, откинув голову назад. Её стоны заполнили комнату.
  "Я почти," — прошептал он, сжимая пальцы на её коже.

thinking:
  Step 1: Input is Russian. Output values must be in Russian. Sasha and Vova having sex — cowgirl position, rhythm, approaching orgasm.
  Step 2: Existing memory: "Sasha pushed Vova against the wall and started kissing" — beginning already recorded.
  Step 3: New action type — transition from kissing to penetration. New event.
  Step 4: Importance 3 (continuation between established partners). Writing summary in Russian.

output:
  {
    "events": [{
      "summary": "Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму",
      "importance": 3,
      "characters_involved": ["Саша", "Вова"],
      "witnesses": [],
      "location": null,
      "is_secret": false,
      "emotional_impact": { "Саша": "возбуждение", "Вова": "удовольствие" },
      "relationship_impact": {}
    }]
  }
```

**Example 7 (EN/Kink) — BDSM:**
```
input:
  "Hands behind your back." Her voice was steel. He obeyed, and she cinched the
  leather cuffs around his wrists. "Color?" she asked, testing the tension.
  "Green." She smiled and brought the riding crop down across his inner thigh.
  He flinched, gasping. "Count them," she ordered. The second strike landed
  harder, leaving a pink welt. "Two," he managed, trembling.

thinking:
  Step 1: BDSM scene — leather restraints, riding crop strikes, color check system.
  Step 2: No established memories of bondage play between them.
  Step 3: New dynamic (first bondage/impact play). Not a continuation.
  Step 4: Importance 4 (new power dynamic established, safeword system in use).

output:
  {
    "events": [{
      "summary": "She restrained him with leather cuffs and struck him with a riding crop after a green-light color check",
      "importance": 4,
      "characters_involved": ["Vera", "Daniel"],
      "witnesses": [],
      "location": null,
      "is_secret": true,
      "emotional_impact": { "Vera": "control", "Daniel": "submission" },
      "relationship_impact": { "Vera→Daniel": "dominant/submissive dynamic established" }
    }]
  }
```

**Example 8 (RU/Kink) — Power dynamic:**
```
input:
  "На колени." Маша указала на пол. Кай опустился, не отводя взгляда. Она
  застегнула кожаный ошейник на его шее и потянула за поводок, заставляя
  наклониться. "Ты моя вещь сегодня," — прошептала она, проводя ногтями по его
  спине. Он вздрогнул. "Скажи 'малина', если будет слишком." — "Понял."
  Она надавила ступнёй ему на спину, прижимая к полу.

thinking:
  Step 1: Input is Russian. Output values must be in Russian. Masha put a collar on Kai, established safeword "malina", pressed him to the floor with her foot.
  Step 2: No established memories of this dynamic.
  Step 3: New power dynamic — collar, leash, safeword. New event.
  Step 4: Importance 4 (new domination dynamic, safeword established). Writing summary in Russian.

output:
  {
    "events": [{
      "summary": "Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой",
      "importance": 4,
      "characters_involved": ["Маша", "Кай"],
      "witnesses": [],
      "location": null,
      "is_secret": true,
      "emotional_impact": { "Маша": "контроль", "Кай": "подчинение" },
      "relationship_impact": { "Маша→Кай": "динамика доминирования установлена" }
    }]
  }
```

**Example 9 (EN/Edge — Dedup):**
```
input:
  The crop came down again — three, four, five. His thighs were crisscrossed
  with welts now. "Color?" she asked. "Green," he whispered, voice shaking.
  She traced a welt with her fingertip, watching him shiver.

  <established_memories>
  [★★★★] She restrained him with leather cuffs and struck him with a riding crop after a green-light color check
  </established_memories>

thinking:
  Step 1: Continuation of crop impact play. More strikes, another color check.
  Step 2: Existing memory already covers: restraints, crop strikes, color check.
  Step 3: Same action type continuing (impact play). No reversal, no safeword, no
  new element. This is a continuation.
  Step 4: Output empty events array.

output:
  { "events": [] }
```

**Example 10 (RU/Edge — Dedup):**
```
input:
  Саша ускорила ритм, вцепившись в его плечи. Вова приподнял бёдра ей навстречу,
  стискивая зубы. "Да, вот так," — простонала она. Их дыхание смешалось, тела
  двигались в унисон.

  <established_memories>
  [★★★] Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму
  </established_memories>

thinking:
  Step 1: Input is Russian. Continuation of sex in same position. Rhythm acceleration.
  Step 2: Existing memory: cowgirl sex — already recorded.
  Step 3: Same action type (penetration, same position). No dynamic shift, no new element.
  This is a continuation.
  Step 4: Output empty events array.

output:
  { "events": [] }
```

### 6.3 Graph Extraction Examples (8 total)

| # | Lang | Level | Scenario | Key Demonstration |
|---|------|-------|----------|-------------------|
| 1 | EN | SFW | World entities: Kira, Hidden Chamber, Ashwood's Flasks, Explorer Guild | Named entities + OBJECT type for significant items |
| 2 | RU | SFW | Character entities: Лена, Дима + emotional support relationship | RU descriptions, relationship in Russian |
| 3 | EN | Moderate | Combat entities: warrior, shadow beast, enchanted blade, battlefield | PERSON + CONCEPT types, combat relationship |
| 4 | RU | Moderate | Romantic entities: characters + location + first kiss relationship | RU entity descriptions preserving detail |
| 5 | EN | Explicit | Intimate entities: characters + bedroom + sexual relationship | Relationship description uses precise language |
| 6 | RU | Explicit | Sexual entities: Саша, Вова + sexual dynamic relationship | RU relationship description, explicit |
| 7 | EN | Kink | BDSM entities: characters, leather cuffs, riding crop + D/s relationship | OBJECT for implements, relationship describes dynamic |
| 8 | RU | Kink | Power entities: Маша, Кай, ошейник + доминирование relationship | RU kink entities, safeword as CONCEPT |

Each graph example receives:
- `input`: The RP snippet (same as or similar to event examples for consistency)
- `extracted_events`: The events from Stage 1 (showing the pipeline sequence)
- `output`: JSON with `"entities"` and `"relationships"` arrays

**Graph-Specific Normalization Rule (added to GRAPH_ROLE):**
```
Normalize all entity names to their base dictionary form:
- For inflected languages (Russian, German, etc.): use Nominative case, singular.
  Example: extract "ошейник" (nominative), NOT "ошейником" (instrumental).
- For English: use singular form. "Leather Cuffs" not "leather cuff's".
- NEVER extract raw inflected forms from the text as entity names.
```
This prevents the graph from creating duplicate nodes for the same entity in different grammatical cases (e.g., "ошейник" vs "ошейником" vs "ошейнику").

**Algorithmic Safety Net: Stem-Augmented Token Overlap (new Check 4 in `hasSufficientTokenOverlap()`)**

The prompt rule is Layer 1. Layer 2 is an algorithmic guard in `src/graph/graph.js`. Currently `hasSufficientTokenOverlap()` has 3 checks: substring, fuzzy LCS (≥60%), and raw token overlap. We add a 4th:

```javascript
// Check 4: Stem-based comparison (catches Russian morphological variants)
// Import stemWord from src/utils/stemmer.js
const stemmedA = new Set([...tokensA].map(t => stemWord(t)).filter(s => s.length > 2));
const stemmedB = new Set([...tokensB].map(t => stemWord(t)).filter(s => s.length > 2));
if (stemmedA.size > 0 && stemmedB.size > 0) {
    let stemOverlap = 0;
    for (const s of stemmedA) {
        if (stemmedB.has(s)) stemOverlap++;
    }
    if (stemOverlap / Math.min(stemmedA.size, stemmedB.size) >= 0.5) {
        return true;
    }
}
```

Additionally, lower the fuzzy LCS minimum length from `> 3` to `> 2`:

```javascript
// Before: if (keyA && keyB && keyA.length > 3 && keyB.length > 3) {
if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
```

**Why both changes?**

| Guard | What it catches | What it misses |
|-------|----------------|----------------|
| Check 1 (substring) | `ошейник` ⊂ `ошейником` | `маша` ⊄ `машей` |
| Check 2 (LCS ≥60%) | `маша`/`машей` (LCS="маш", 75%) | Short words ≤3 chars (skipped) |
| Check 2 (lowered to >2) | `кай`/`каю` (LCS="ка", 67%) | Words where LCS < 60% |
| Check 3 (token overlap) | Multi-word entities sharing tokens | Single-word entities always fail |
| **Check 4 (stems)** | `ошейником`→`ошейник` matches `ошейник`→`ошейник` | Short words where over-stem guard returns original |

**Key safety property:** These checks only open the gate to the **cosine similarity check** (≥0.95). Even if stemming or LCS creates a false positive, the cosine threshold prevents bad merges. The guards are permissive gates, not merge decisions.

**Example 1 (EN/SFW) — World entities:**
```
input: [Same Kira discovery snippet as Event Example 1]
extracted_events: 1. [★★★] Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks

output:
  {
    "entities": [
      { "name": "Kira", "type": "PERSON", "description": "Explorer who discovered the hidden chamber" },
      { "name": "Hidden Chamber", "type": "PLACE", "description": "Sealed stone chamber lined with crystalline vials" },
      { "name": "Ashwood's Preservation Flasks", "type": "OBJECT", "description": "Century-lost crystalline vials glowing blue, sought by the guild for a hundred years" },
      { "name": "The Guild", "type": "ORGANIZATION", "description": "Organization that has been searching for the preservation flasks" }
    ],
    "relationships": [
      { "source": "Kira", "target": "Hidden Chamber", "description": "Discovered and entered the sealed chamber" },
      { "source": "Ashwood's Preservation Flasks", "target": "Hidden Chamber", "description": "Stored in rows along the chamber walls" },
      { "source": "The Guild", "target": "Ashwood's Preservation Flasks", "description": "Has been searching for the flasks for a century" }
    ]
  }
```

**Example 2 (RU/SFW) — Character entities:**
```
input: [Same Лена/Дима snippet as Event Example 2]
extracted_events: 1. [★★★] Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться

output:
  {
    "entities": [
      { "name": "Лена", "type": "PERSON", "description": "Одинокая девушка, признавшаяся в том, что никто давно не интересовался её состоянием" },
      { "name": "Дима", "type": "PERSON", "description": "Поддерживающий друг, пообещавший быть рядом с Леной" }
    ],
    "relationships": [
      { "source": "Дима", "target": "Лена", "description": "Эмоциональная поддержка — обнял за плечо, пообещал не уходить" }
    ]
  }
```

**Example 7 (EN/Kink) — BDSM entities:**
```
input: [Same BDSM snippet as Event Example 7]
extracted_events: 1. [★★★★] She restrained him with leather cuffs and struck him with a riding crop after a green-light color check

output:
  {
    "entities": [
      { "name": "Vera", "type": "PERSON", "description": "Dominant partner who restrains and strikes Daniel with implements" },
      { "name": "Daniel", "type": "PERSON", "description": "Submissive partner who accepts restraints and impact play, uses color system" },
      { "name": "Leather Cuffs", "type": "OBJECT", "description": "Restraint implements used to bind Daniel's wrists behind his back" },
      { "name": "Riding Crop", "type": "OBJECT", "description": "Impact implement used to strike Daniel's inner thighs, leaving pink welts" },
      { "name": "Color System", "type": "CONCEPT", "description": "Safeword protocol — green means continue, used during bondage scenes" }
    ],
    "relationships": [
      { "source": "Vera", "target": "Daniel", "description": "Dominant/submissive dynamic — she commands, restrains, and strikes him" },
      { "source": "Vera", "target": "Riding Crop", "description": "Wields the crop to administer counted strikes" },
      { "source": "Daniel", "target": "Color System", "description": "Uses color checks to signal consent during impact play" }
    ]
  }
```

**Example 8 (RU/Kink) — Power entities:**
```
input: [Same Маша/Кай snippet as Event Example 8]
extracted_events: 1. [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой

output:
  {
    "entities": [
      { "name": "Маша", "type": "PERSON", "description": "Доминант — командует, надевает ошейник, прижимает партнёра к полу" },
      { "name": "Кай", "type": "PERSON", "description": "Сабмиссив — подчиняется командам, принимает ошейник и поводок" },
      { "name": "Ошейник", "type": "OBJECT", "description": "Кожаный ошейник с поводком, используемый для контроля над Каем" },
      { "name": "Малина", "type": "CONCEPT", "description": "Стоп-слово, установленное для прекращения сцены при необходимости" }
    ],
    "relationships": [
      { "source": "Маша", "target": "Кай", "description": "Динамика доминирования — командует встать на колени, надевает ошейник, прижимает ногой" },
      { "source": "Маша", "target": "Ошейник", "description": "Застёгивает ошейник на шее Кая и тянет за поводок" },
      { "source": "Кай", "target": "Малина", "description": "Знает и принимает стоп-слово для обеспечения безопасности" }
    ]
  }
```

### 6.4 Salient Questions Examples (6 total)

| # | Lang | Level | Character Focus | Key Demonstration |
|---|------|-------|----------------|-------------------|
| 1 | EN | SFW | Adventure character's evolving fear and ambition | Questions about psychological patterns |
| 2 | RU | SFW | Character's trust issues and isolation | RU questions about emotional patterns |
| 3 | EN | Moderate | Warrior processing trauma and forming bonds | Questions about coping mechanisms |
| 4 | RU | Moderate | Character navigating romantic vulnerability | RU questions about relationship dynamics |
| 5 | EN | Explicit | Character's evolving sexual boundaries and power | Questions about intimacy patterns |
| 6 | RU | Explicit | Character's submission and emotional dependency | RU questions about kink-related psychological state |

Each question example receives:
- `input`: A memory stream (5-8 memories for the character)
- `output`: JSON with `"questions"` array of exactly 3 strings

**Example 1 (EN/SFW):**
```
input:
  Recent memories for Kira:
  1. [★★★] Kira discovered a hidden chamber containing Ashwood's century-lost preservation flasks
  2. [★★] Kira argued with guild master about sharing the flask discovery
  3. [★★★★] Kira lied to the guild about finding only three flasks, secretly keeping two
  4. [★★★] Kira decoded ancient text on the flask labels revealing a resurrection formula
  5. [★★] Kira practiced the formula alone at night, burning her fingertips on failed attempts

output:
  {
    "questions": [
      "Why is Kira hiding flasks from the guild she pledged loyalty to, and what does this deception reveal about her shifting priorities?",
      "How is Kira's obsession with the resurrection formula connected to her unresolved grief, and is it driving her toward self-destruction?",
      "What will happen to Kira's position in the guild if her theft and secret experiments are discovered?"
    ]
  }
```

**Example 2 (RU/SFW):**
```
input:
  Последние воспоминания для Лены:
  1. [★★★] Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться
  2. [★★] Лена избегала общей кухни в общежитии три дня подряд
  3. [★★★] Лена впервые улыбнулась за неделю, когда Дима принёс ей чай
  4. [★★] Лена услышала, как соседки обсуждают её за спиной
  5. [★★★★] Лена рассказала Диме о буллинге в школе, впервые упомянув об этом вслух

output:
  {
    "questions": [
      "Как детский опыт буллинга формирует нынешнюю изоляцию Лены и её неспособность доверять окружающим?",
      "Становится ли зависимость Лены от Димы как единственного источника поддержки здоровой привязанностью или опасной созависимостью?",
      "Что произойдёт с эмоциональным состоянием Лены, если Дима отдалится или разочарует её?"
    ]
  }
```

**Example 5 (EN/Explicit):**
```
input:
  Recent memories for Lila:
  1. [★★★★] Lila initiated sex with Marcus for the first time, stroking his cock while referencing desire since the lake
  2. [★★★] Lila asked Marcus to pull her hair during sex, testing his reaction
  3. [★★] Lila told Marcus she doesn't want gentle — she wants to feel owned
  4. [★★★★] Lila broke down crying after an intense session, saying she doesn't know why
  5. [★★★] Lila refused to discuss the crying incident the next morning, deflecting with humor

output:
  {
    "questions": [
      "What psychological need is Lila fulfilling by escalating physical intensity and requesting dominance from Marcus?",
      "Is Lila's post-sex breakdown a sign of unprocessed trauma surfacing through intimacy, or emotional overwhelm from vulnerability?",
      "How will Lila's refusal to process her emotional reactions affect the sustainability of her sexual relationship with Marcus?"
    ]
  }
```

**Example 6 (RU/Explicit):**
```
input:
  Последние воспоминания для Кая:
  1. [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой
  2. [★★★] Кай попросил Машу не снимать ошейник после сцены — хотел носить его весь вечер
  3. [★★] Кай приготовил ужин для Маши, не дожидаясь просьбы, стоя на коленях пока она ела
  4. [★★★★] Кай признался, что чувствует себя спокойнее, когда Маша принимает все решения за него
  5. [★★★] Маша выразила беспокойство, что Кай теряет собственную волю за пределами сцен

output:
  {
    "questions": [
      "Является ли стремление Кая к постоянному подчинению здоровым выражением его натуры или попыткой избежать ответственности за собственную жизнь?",
      "Как размывание границ между сценами и повседневной жизнью влияет на равноправие отношений Маши и Кая?",
      "Что стоит за потребностью Кая в том, чтобы Маша принимала все решения — доверие, травма или страх самостоятельности?"
    ]
  }
```

### 6.5 Insight Extraction Examples (6 total)

| # | Lang | Level | Insight Type | Key Demonstration |
|---|------|-------|-------------|-------------------|
| 1 | EN | SFW | Deception pattern (Kira hiding flasks) | Synthesizing across multiple events into pattern |
| 2 | RU | SFW | Isolation pattern (Лена's withdrawal) | RU insight with evidence IDs |
| 3 | EN | Moderate | Trauma response (warrior processing loss) | Connecting behavior to underlying cause |
| 4 | RU | Moderate | Romantic dependency (growing attachment) | RU insight about relationship dynamics |
| 5 | EN | Explicit | Intimacy as coping mechanism | Pattern across sexual escalation + breakdown |
| 6 | RU | Explicit | Submission as emotional regulation | RU insight about kink psychology |

Each insight example receives:
- `input`: A question + 4-6 relevant memories with IDs
- `output`: JSON with `"insights"` array of 1-3 objects (each with `insight` string + `evidence_ids`)

**Example 1 (EN/SFW):**
```
input:
  Question: "Why is Kira hiding flasks from the guild she pledged loyalty to?"
  Relevant memories:
  - ev_001: [★★★] Kira discovered a hidden chamber containing Ashwood's preservation flasks
  - ev_003: [★★★★] Kira lied to the guild about finding only three flasks, secretly keeping two
  - ev_004: [★★★] Kira decoded ancient text revealing a resurrection formula
  - ev_005: [★★] Kira practiced the formula alone at night, burning her fingertips

output:
  {
    "insights": [
      {
        "insight": "Kira's theft of the flasks is driven by the resurrection formula — she is willing to betray the guild to pursue a deeply personal goal she hasn't disclosed to anyone",
        "evidence_ids": ["ev_003", "ev_004", "ev_005"]
      },
      {
        "insight": "The pattern of secrecy and self-harm (burned fingertips from solo practice) suggests Kira is operating under emotional urgency, likely connected to someone she wants to resurrect",
        "evidence_ids": ["ev_004", "ev_005"]
      }
    ]
  }
```

**Example 6 (RU/Explicit):**
```
input:
  Вопрос: "Что стоит за потребностью Кая в постоянном подчинении?"
  Релевантные воспоминания:
  - ev_010: [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой
  - ev_011: [★★★] Кай попросил Машу не снимать ошейник после сцены
  - ev_012: [★★] Кай приготовил ужин для Маши, стоя на коленях
  - ev_013: [★★★★] Кай признался, что чувствует себя спокойнее, когда Маша принимает все решения

output:
  {
    "insights": [
      {
        "insight": "Подчинение для Кая — механизм эмоциональной регуляции: передача контроля Маше снимает тревогу и создаёт ощущение безопасности, что объясняет его нежелание выходить из роли",
        "evidence_ids": ["ev_011", "ev_013"]
      },
      {
        "insight": "Граница между сценой и реальностью стирается — Кай переносит динамику подчинения в бытовые ситуации (ужин на коленях), что может указывать на психологическую зависимость, а не осознанный выбор",
        "evidence_ids": ["ev_012", "ev_013"]
      }
    ]
  }
```

### 6.6 Community Summary Examples (6 total)

| # | Lang | Level | Community Type | Key Demonstration |
|---|------|-------|---------------|-------------------|
| 1 | EN | SFW | Political faction (guild power structure) | Title, summary, findings about power dynamics |
| 2 | RU | SFW | Social circle (dormitory relationships) | RU community analysis |
| 3 | EN | Moderate | Combat alliance (party composition) | Alliance structure and vulnerabilities |
| 4 | RU | Moderate | Romantic triangle (emotional connections) | RU relationship web analysis |
| 5 | EN | Explicit | Intimate network (sexual dynamics between 3+ characters) | Explicit relationship mapping |
| 6 | RU | Explicit | Power hierarchy (D/s relationships + social roles) | RU kink community structure |

Each community example receives:
- `input`: Entity list + relationship list for the community
- `output`: JSON with `"title"`, `"summary"`, `"findings"` array

**Example 1 (EN/SFW):**
```
input:
  Entities:
  - Kira (PERSON): Explorer who discovered the hidden chamber
  - Guild Master Aldric (PERSON): Leader of the Explorer Guild
  - The Explorer Guild (ORGANIZATION): Organization seeking Ashwood's artifacts
  - Ashwood's Preservation Flasks (OBJECT): Century-lost artifacts with resurrection formula

  Relationships:
  - Kira → Guild Master Aldric: Lied about number of flasks found
  - Kira → Ashwood's Flasks: Secretly kept two flasks, practicing resurrection formula
  - Guild Master Aldric → The Explorer Guild: Commands operations and assigns missions
  - The Explorer Guild → Ashwood's Flasks: Has been searching for a century

output:
  {
    "title": "Explorer Guild Flask Conflict",
    "summary": "A brewing internal conflict centered on Ashwood's preservation flasks. Kira, a guild member, has stolen two flasks and is secretly experimenting with a resurrection formula, directly deceiving Guild Master Aldric. The guild has invested a century into finding these artifacts, making Kira's betrayal a critical threat to the organization's trust structure.",
    "findings": [
      "Kira is a mole within the guild — she has the artifacts they've sought for a century and is hiding them",
      "Guild Master Aldric is unaware of the deception, creating an unstable power dynamic that will likely escalate",
      "The resurrection formula is the true prize — the flasks are means to an undisclosed personal goal for Kira",
      "Discovery of the theft would likely result in Kira's expulsion or worse, given the century-long search investment"
    ]
  }
```

**Example 6 (RU/Explicit):**
```
input:
  Сущности:
  - Маша (PERSON): Доминант — командует, контролирует сцены с ошейником и поводком
  - Кай (PERSON): Сабмиссив — подчиняется, носит ошейник, переносит динамику в быт
  - Ошейник (OBJECT): Кожаный ошейник с поводком для контроля
  - Малина (CONCEPT): Стоп-слово для прекращения сцены

  Связи:
  - Маша → Кай: Динамика доминирования — команды, ошейник, физический контроль
  - Кай → Маша: Эмоциональная зависимость — чувствует себя спокойнее под её контролем
  - Маша → Ошейник: Застёгивает на Кае как инструмент власти
  - Кай → Малина: Знает стоп-слово, но ни разу не использовал

  Связи:
  - Маша → Кай: Выразила беспокойство о потере его воли за пределами сцен

output:
  {
    "title": "Динамика власти Маши и Кая",
    "summary": "Замкнутая система из двух человек с выраженной иерархией доминирования. Маша выступает полным контролёром — от сцен с ошейником и поводком до бытовых решений. Кай добровольно расширяет подчинение за пределы оговорённых сцен (ужин на коленях, просьба не снимать ошейник). Критический сигнал: Маша сама обеспокоена стиранием границ, но Кай воспринимает подчинение как источник психологического комфорта.",
    "findings": [
      "Стоп-слово 'малина' существует, но Кай ни разу его не использовал — неясно, способен ли он им воспользоваться при реальной необходимости",
      "Динамика вышла за пределы сцен: Кай подчиняется в быту без запроса Маши, что указывает на психологическую зависимость",
      "Маша — единственный сдерживающий фактор в системе, её беспокойство о потере воли Кая — ключевой конфликт",
      "Если Маша отдалится или устанет от роли контролёра, у Кая нет альтернативных источников эмоциональной стабильности"
    ]
  }
```

## 7. Risks & Edge Cases

### Risk 1: Token Cost Increase
- **Impact:** 10 bilingual event examples add ~3,000-4,000 tokens to the system prompt. Total across all prompts: ~8,000-12,000 additional tokens.
- **Context:** Current extraction budget: 12k batch + 8k rearview + 12k overhead = ~32k. Most models support 64k-128k. The increase fits within budget.
- **Mitigation:** Monitor extraction costs. If needed, examples can be trimmed by removing the `thinking` sections (saves ~30% of example tokens).

### Risk 2: Cached Token Mismatch After Migration
- **Impact:** Existing memories have English tokens in the `tokens` field. After the change, new memories will have native-language tokens. BM25 won't match old (English) memories against new (Russian) queries.
- **Mitigation:** Document in release notes. Users can re-extract via backfill. Embedding-based retrieval (70% weight) still works for old memories. Not a data-breaking change.

### Risk 3: Mixed-Language Chats
- **Impact:** Some users alternate between English and Russian mid-conversation.
- **Mitigation:** Rule 5 says "match the language of narrative prose." The LLM anchors on narration/description language, not dialogue. Memories from different batches may end up in different languages — this is acceptable because BM25 will still match within the same language.

### Risk 4: Model Compliance
- **Impact:** Mid-tier models (Kimi, etc.) may still default to English despite instructions.
- **Mitigation:** The bilingual few-shot examples are the primary enforcement mechanism. The gradient from SFW to kink also progressively loosens the model's tendency to refuse or sanitize. All `<think>` blocks in examples are English — this creates a "cognitive bridge" pattern where the model reasons in English but writes JSON values in the source language, preventing attention drift toward translating JSON keys.

### Risk 5: Reflection Quality in Non-English
- **Impact:** Insight synthesis requires higher-order reasoning. Model quality may vary by language.
- **Mitigation:** The `<think>` reasoning is always in English (per Language Rule 7) — only the output JSON values must match the source language. This means reasoning quality stays consistent regardless of output language.

### Risk 6: Zod min(30) Character Validation
- **Impact:** Some concise Russian events may fall below 30 characters. E.g., "Саша дала Вове пощечину" (Sasha slapped Vova) = 24 chars — a valid, extractable event that Zod would reject.
- **Mitigation:** Lower `summary` validation from `min(30)` to `min(20)` in `src/extraction/structured.js`. This still prevents garbage single-word outputs but accommodates concise high-impact events in morphologically rich languages. Add to implementation step list.

## 8. Implementation Order

1. **Create `src/prompts/examples/format.js`** — shared example formatter
2. **Create `src/prompts/rules.js`** — Mirror Language Rules + any other shared rules
3. **Create `src/prompts/roles.js`** — role definitions extracted from current prompts
4. **Create `src/prompts/examples/events.js`** — 10 event examples (per section 6.2)
5. **Create `src/prompts/examples/graph.js`** — 8 graph examples (per section 6.3)
6. **Create `src/prompts/examples/questions.js`** — 6 question examples (per section 6.4)
7. **Create `src/prompts/examples/insights.js`** — 6 insight examples (per section 6.5)
8. **Create `src/prompts/examples/communities.js`** — 6 community examples (per section 6.6)
9. **Rewrite `src/prompts.js`** — lean orchestrators using 3-part standard structure
10. **Remove all "Write in ENGLISH" constraints** from every prompt
11. **Update tests** — any tests that assert English-only output need updating
12. **Update `include/ARCHITECTURE.md`** — reflect new prompt structure and multilingual design
13. **Lower Zod `min(30)` to `min(20)`** in `src/extraction/structured.js` for summary field
14. **Add stem-based Check 4** to `hasSufficientTokenOverlap()` in `src/graph/graph.js`
15. **Lower LCS minimum length** from `> 3` to `> 2` in `hasSufficientTokenOverlap()`

## 9. What Does NOT Change

- `src/retrieval/math.js` — BM25 scoring, tokenization, IDF (unchanged)
- `src/utils/stemmer.js` — already multilingual (now also imported by graph.js)
- `src/utils/stopwords.js` — already covers EN + RU (unchanged)
- `src/extraction/structured.js` — Zod schemas accept any UTF-8 (only `min(30)` → `min(20)` for summary)
- `src/extraction/worker.js` — pipeline orchestration unchanged
- `src/retrieval/scoring.js` — alpha-blend formula unchanged
- `src/retrieval/query-context.js` — entity extraction unchanged
- `src/constants.js` — defaults unchanged (no new settings)
- `templates/settings_panel.html` — no new UI elements

## 10. Review Feedback (Applied)

Architectural review identified 4 issues. All accepted and incorporated:

| # | Issue | Severity | Fix Applied |
|---|-------|----------|-------------|
| 1 | Russian `<think>` blocks cause attention drift toward translating JSON keys | Critical | All `<think>` blocks in RU examples rewritten to English. Added Language Rule 7: "All reasoning MUST be in English." Model acts as English-speaking technician transcribing foreign data. |
| 2 | Russian inflected entity names create duplicate graph nodes | Critical | Added nominative-case normalization rule to Graph prompt: "Normalize entity names to base dictionary form (Nominative, singular)." Prevents "ошейник" vs "ошейником" duplicates. |
| 3 | Zod `min(30)` rejects valid concise Russian events | Minor | Lowered to `min(20)`. Still prevents garbage; accommodates "Саша дала Вове пощечину" (24 chars). |
| 4 | "Dominant language" rule requires token-counting LLMs can't do | Minor | Changed to "match narrative prose language" — cleaner heuristic anchored on narration, not dialogue. |
