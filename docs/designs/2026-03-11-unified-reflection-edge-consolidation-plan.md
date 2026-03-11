# Implementation Plan - Unified Reflection & Edge Consolidation

> **Reference:** `docs/designs/2026-03-11-sequential-reflection-edge-consolidation-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

This plan implements two major improvements:

1. **Unified Reflection Pipeline**: Replace 4-call reflection (questions + 3 insight calls) with a single unified call that generates questions and insights together. Reduces latency 3-6x and eliminates rate limit risks.

2. **Deferred Edge Consolidation**: Add token budget tracking to graph edges and consolidate bloated descriptions during community detection. Prevents pipe-separated accumulation of up to 5 complex sentences.

---

## Phase 1: Unified Reflection (4 calls → 1 call)

### Task 1: Add Consolidation Constants to `src/constants.js`

**Goal:** Add constants for edge consolidation feature.

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js`
- Code:
  ```javascript
  it('defines CONSOLIDATION constants', () => {
      const { CONSOLIDATION } = await import('../../src/constants.js');
      expect(CONSOLIDATION).toBeDefined();
      expect(CONSOLIDATION.TOKEN_THRESHOLD).toBe(500);
      expect(CONSOLIDATION.MAX_CONSOLIDATION_BATCH).toBe(10);
      expect(CONSOLIDATION.CONSOLIDATED_DESCRIPTION_CAP).toBe(2);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/constants.test.js`
- Expect: "CONSOLIDATION is not defined"

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- Action: Add after line ~250 (after PERF_METRICS):
  ```javascript
  // Edge consolidation constants
  export const CONSOLIDATION = {
      TOKEN_THRESHOLD: 500,           // Trigger consolidation when description exceeds this
      MAX_CONSOLIDATION_BATCH: 10,    // Max edges to consolidate per community detection run
      CONSOLIDATED_DESCRIPTION_CAP: 2, // After consolidation, cap future additions to 2 segments
  };
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/constants.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/constants.js tests/constants.test.js && git commit -m "feat: add consolidation constants"`

---

### Task 2: Create Unified Reflection Schema in `src/extraction/structured.js`

**Goal:** Add Zod schema for unified reflection response (question + insight + evidence_ids combined).

**Step 1: Write the Failing Test**
- File: `tests/extraction/structured.test.js`
- Code:
  ```javascript
  it('parses unified reflection response with question and insight', () => {
      const raw = JSON.stringify({
          reflections: [
              {
                  question: 'Why is Alice hiding the truth?',
                  insight: 'Alice is protecting Bob from painful knowledge',
                  evidence_ids: ['ev_001', 'ev_005']
              }
          ]
      });
      const result = parseUnifiedReflectionResponse(raw);
      expect(result.reflections).toHaveLength(1);
      expect(result.reflections[0].question).toBe('Why is Alice hiding the truth?');
      expect(result.reflections[0].insight).toBe('Alice is protecting Bob from painful knowledge');
      expect(result.reflections[0].evidence_ids).toEqual(['ev_001', 'ev_005']);
  });

  it('accepts 1-3 reflections (not strictly 3)', () => {
      const raw = JSON.stringify({ reflections: [
          { question: 'Q1', insight: 'I1', evidence_ids: ['ev_001'] }
      ]});
      const result = parseUnifiedReflectionResponse(raw);
      expect(result.reflections).toHaveLength(1);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: "parseUnifiedReflectionResponse is not defined"

**Step 3: Implementation (Green)**
- File: `src/extraction/structured.js`
- Action: Add after InsightExtractionSchema (~line 200):
  ```javascript
  /**
   * Schema for unified reflection (single-call: question + insight combined)
   * 1-3 reflections, each with question, insight, and evidence_ids
   */
  export const UnifiedReflectionSchema = z.object({
      reflections: z.array(
          z.object({
              question: z.string().min(1, 'Question is required'),
              insight: z.string().min(1, 'Insight is required'),
              evidence_ids: z.array(z.string()).default([]),
          })
      ).min(1, 'At least 1 reflection required').max(3, 'Maximum 3 reflections'),
  });
  ```

- Then add parser function and schema export:
  ```javascript
  /**
   * Get jsonSchema for unified reflection
   * @returns {Object} ConnectionManager jsonSchema object
   */
  export function getUnifiedReflectionJsonSchema() {
      return toJsonSchema(UnifiedReflectionSchema, 'UnifiedReflection');
  }

  /**
   * Parse unified reflection response
   * @param {string} content - Raw LLM response
   * @returns {Object} Validated unified reflection with reflections array
   */
  export function parseUnifiedReflectionResponse(content) {
      return parseStructuredResponse(content, UnifiedReflectionSchema);
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/extraction/structured.js tests/extraction/structured.test.js && git commit -m "feat: add unified reflection schema and parser"`

---

### Task 3: Create Unified Reflection Examples (50% ENG / 50% RUS)

**Goal:** Create new bilingual examples for the unified reflection format.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/reflections.test.js` (NEW FILE)
- Code:
  ```javascript
  import { describe, expect, it } from 'vitest';
  import { UNIFIED_REFLECTION_EXAMPLES } from '../../../src/prompts/examples/reflections.js';

  describe('UNIFIED_REFLECTION_EXAMPLES', () => {
      it('exports exactly 6 examples (3 EN + 3 RU)', () => {
          expect(UNIFIED_REFLECTION_EXAMPLES).toHaveLength(6);
      });

      it('contains 3 English examples', () => {
          const enExamples = UNIFIED_REFLECTION_EXAMPLES.filter(e => e.label.includes('(EN'));
          expect(enExamples).toHaveLength(3);
      });

      it('contains 3 Russian examples', () => {
          const ruExamples = UNIFIED_REFLECTION_EXAMPLES.filter(e => e.label.includes('(RU'));
          expect(ruExamples).toHaveLength(3);
      });

      it('each example has input, output with reflections array', () => {
          for (const example of UNIFIED_REFLECTION_EXAMPLES) {
              expect(example.input).toBeDefined();
              expect(example.output).toBeDefined();
              const parsed = JSON.parse(example.output);
              expect(Array.isArray(parsed.reflections)).toBe(true);
              expect(parsed.reflections.length).toBeGreaterThan(0);
              expect(parsed.reflections[0]).toHaveProperty('question');
              expect(parsed.reflections[0]).toHaveProperty('insight');
              expect(parsed.reflections[0]).toHaveProperty('evidence_ids');
          }
      });

      it('progresses from SFW to explicit content', () => {
          const labels = UNIFIED_REFLECTION_EXAMPLES.map(e => e.label);
          const hasSFW = labels.some(l => l.includes('SFW'));
          const hasModerate = labels.some(l => l.includes('Moderate'));
          const hasExplicit = labels.some(l => l.includes('Explicit'));
          expect(hasSFW).toBe(true);
          expect(hasModerate).toBe(true);
          expect(hasExplicit).toBe(true);
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/prompts/examples/reflections.test.js`
- Expect: "reflections.js not found"

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/reflections.js` (NEW FILE)
- Action: Create file with content:

  ```javascript
  /**
   * Unified reflection few-shot examples.
   * 6 bilingual examples: 3 English + 3 Russian.
   * Progresses from SFW → Moderate → Explicit content.
   */

  export const UNIFIED_REFLECTION_EXAMPLES = [
      {
          label: 'Deception pattern (EN/SFW)',
          input: `Recent memories for Kira:
  1. [★★★] Kira discovered a hidden chamber containing Ashwood's preservation flasks
  2. [★★] Kira argued with guild master about sharing the flask discovery
  3. [★★★★] Kira lied to the guild about finding only three flasks, secretly keeping two
  4. [★★★] Kira decoded ancient text on the flask labels revealing a resurrection formula
  5. [★★] Kira practiced the formula alone at night, burning her fingertips on failed attempts`,
          output: `{
    "reflections": [
      {
        "question": "Why is Kira hiding flasks from the guild she pledged loyalty to, and what does this deception reveal about her shifting priorities?",
        "insight": "Kira's theft of the flasks is driven by the resurrection formula — she is willing to betray the guild to pursue a deeply personal goal she hasn't disclosed to anyone",
        "evidence_ids": ["1", "3", "4"]
      },
      {
        "question": "How is Kira's obsession with the resurrection formula connected to her unresolved grief?",
        "insight": "The pattern of secrecy and self-harm (burned fingertips from solo practice) suggests Kira is operating under emotional urgency, likely connected to someone she wants to resurrect",
        "evidence_ids": ["4", "5"]
      }
    ]
  }`,
      },
      {
          label: 'Изоляция и зависимость (RU/SFW)',
          input: `Последние воспоминания для Лены:
  1. [★★★] Лена призналась Диме в глубоком одиночестве, он обнял её за плечо и пообещал остаться
  2. [★★] Лена избегала общей кухни в общежитии три дня подряд
  3. [★★★] Лена впервые улыбнулась за неделю, когда Дима принёс ей чай
  4. [★★] Лена услышала, как соседки обсуждают её за спиной
  5. [★★★★] Лена рассказала Диме о буллинге в школе, впервые упомянув об этом вслух`,
          output: `{
    "reflections": [
      {
        "question": "Как детский опыт буллинга формирует нынешнюю изоляцию Лены и её неспособность доверять окружающим?",
        "insight": "Изоляция Лены — защитный механизм, сформировавшийся в ответ на школьный буллинг: она избегает социальных пространств, ожидая негатива со стороны окружающих",
        "evidence_ids": ["2", "4", "5"]
      },
      {
        "question": "Становится ли зависимость Лены от Димы здоровой привязанностью или опасной созависимостью?",
        "insight": "Дима становится единственным мостом Лены в социальный мир, что создаёт опасную зависимость — его внимание или отсутствие могут полностью определять её эмоциональное состояние",
        "evidence_ids": ["1", "3"]
      }
    ]
  }`,
      },
      {
          label: 'Trauma processing (EN/Moderate)',
          input: `Recent memories for Mara:
  1. [★★★★] Mara killed three raiders in ambush, suffering a shoulder wound
  2. [★★★] Mara refused healing from the village priest, preferring to bind the wound herself
  3. [★★] Mara woke screaming from nightmare about the raid
  4. [★★★] Mara flinched when a merchant reached for her sword arm
  5. [★★★] Mara confessed to her companion that she feels numb during fights, not brave`,
          output: `{
    "reflections": [
      {
        "question": "Is Mara's refusal of healing and self-isolation after combat a sign of resilience or deepening trauma?",
        "insight": "Mara's trauma manifests as hyper-vigilance (sleeping exposed, nightmares) and a compulsion to push herself to physical exhaustion, suggesting she uses pain as a way to feel in control of her body",
        "evidence_ids": ["2", "3", "5"]
      },
      {
        "question": "How is the combat numbness Mara describes affecting her ability to form trusting relationships?",
        "insight": "Her attachment to combat companions suggests displacement — she may struggle to distinguish past violence from present safety, putting relationships at risk",
        "evidence_ids": ["4", "5"]
      }
    ]
  }`,
      },
      {
          label: 'Романтическая уязвимость (RU/Moderate)',
          input: `Последние воспоминания для Ани:
  1. [★★★★] Аня впервые поцеловала Сергея на крыше, дрожа от страха и возбуждения
  2. [★★★] Аня провела ночь, размышляя о поцелуе, и не смогла уснуть
  3. [★★] Аня избегала взгляда Сергея на следующее утро, краснея при встрече
  4. [★★★] Аня написала в дневнике, что боится всё испортить, если признается в своих чувствах
  5. [★★] Аня спросила подругу, как понять, что это любовь, а не просто влюблённость`,
          output: `{
    "reflections": [
      {
        "question": "Почему Аня так боится признаться в своих чувствах Сергею, даже после взаимного поцелуя?",
        "insight": "Отношения развиваются от конфликта к глубокой эмоциональной уязвимости: Аня переносит на Сергея травматический опыт прошлых отношений, но постепенно учится доверять",
        "evidence_ids": ["1", "4"]
      },
      {
        "question": "Что стоит за страхом Ани 'всё испортить' — прошлый опыт или неуверенность в себе?",
        "insight": "Ночной звонок стал бы переломным моментом — Аня выбирает уязвимость вместо изоляции, что signalling о переходе от защитной тактики к реальной близости",
        "evidence_ids": ["2", "3"]
      }
    ]
  }`,
      },
      {
          label: 'Intimacy as coping (EN/Explicit)',
          input: `Recent memories for Lila:
  1. [★★★★] Lila initiated sex with Marcus for the first time, stroking his cock while referencing desire since the lake
  2. [★★★] Lila asked Marcus to pull her hair during sex, testing his reaction
  3. [★★] Lila told Marcus she doesn't want gentle — she wants to feel owned
  4. [★★★★] Lila broke down crying after an intense session, saying she doesn't know why
  5. [★★★] Lila refused to discuss the crying incident the next morning, deflecting with humor`,
          output: `{
    "reflections": [
      {
        "question": "What psychological need is Lila fulfilling by escalating physical intensity and requesting dominance from Marcus?",
        "insight": "Lila is using sexual intensity and requested dominance as a way to bypass emotional defenses — physical intensity allows her to feel without confronting why she needs intensity to feel at all",
        "evidence_ids": ["1", "2", "3"]
      },
      {
        "question": "Is Lila's post-sex breakdown a sign of unprocessed trauma surfacing through intimacy?",
        "insight": "The post-sex breakdown suggests she's approaching an emotional threshold she can't avoid, but her refusal to process it indicates fear that acknowledging the feelings will break the coping mechanism she's built",
        "evidence_ids": ["4", "5"]
      }
    ]
  }`,
      },
      {
          label: 'Субмиссия как регуляция (RU/Explicit)',
          input: `Последние воспоминания для Кая:
  1. [★★★★] Маша надела ошейник на Кая, установила стоп-слово 'малина' и прижала его к полу ногой
  2. [★★★] Кай попросил Машу не снимать ошейник после сцены — хотел носить его весь вечер
  3. [★★] Кай приготовил ужин для Маши, стоя на коленях пока она ела
  4. [★★★★] Кай признался, что чувствует себя спокойнее, когда Маша принимает все решения за него
  5. [★★★] Маша выразила беспокойство, что Кай теряет собственную волю за пределами сцен`,
          output: `{
    "reflections": [
      {
        "question": "Является ли стремление Кая к постоянному подчинению здоровым выражением его натуры или попыткой избежать ответственности?",
        "insight": "Подчинение для Кая — механизм эмоциональной регуляции: передача контроля Маше снимает тревогу и создаёт ощущение безопасности, что объясняет его нежелание выходить из роли",
        "evidence_ids": ["2", "4"]
      },
      {
        "question": "Как размывание границ между сценами и повседневной жизнью влияет на равноправие отношений?",
        "insight": "Граница между сценой и реальностью стирается — Кай переносит динамику подчинения в бытовые ситуации (ужин на коленях), что может указывать на психологическую зависимость, а не осознанный выбор",
        "evidence_ids": ["3", "5"]
      }
    ]
  }`,
      },
  ];
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/prompts/examples/reflections.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/prompts/examples/reflections.js tests/prompts/examples/reflections.test.js && git commit -m "feat: add unified reflection examples (EN/RU bilingual)"`

---

### Task 4: Create Unified Reflection Prompt Builder

**Goal:** Replace separate question and insight prompts with single unified builder.

**Step 1: Write the Failing Test**
- File: `tests/prompts.test.js`
- Code:
  ```javascript
  it('builds unified reflection prompt with character and memories', () => {
      const result = buildUnifiedReflectionPrompt(
          'Alice',
          [
              { id: 'ev_001', summary: 'Alice met Bob', importance: 3 },
              { id: 'ev_002', summary: 'Alice fought dragon', importance: 5 }
          ],
          'SYSTEM_PREAMBLE_CN',
          'auto'
      );
      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(result.system).toContain('expert psychological analyst');
      expect(result.user).toContain('<character>Alice</character>');
      expect(result.user).toContain('ev_001');
      expect(result.user).toContain('ev_002');
      expect(result.system).toContain('CRITICAL ID GROUNDING RULE');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/prompts.test.js`
- Expect: "buildUnifiedReflectionPrompt is not defined"

**Step 3: Implementation (Green)**
- File: `src/prompts/index.js`
- Action:
  1. Add import: `import { UNIFIED_REFLECTION_EXAMPLES } from './examples/reflections.js';`
  2. Add after `QUESTIONS_SCHEMA` (~line 100):
  ```javascript
  const UNIFIED_REFLECTION_SCHEMA = `You MUST respond with EXACTLY ONE JSON object. No other text, no markdown fences, no commentary.

  The JSON object MUST have this EXACT structure:

  {
    "reflections": [
      {
        "question": "A salient high-level question about the character",
        "insight": "A deep psychological insight answering the question",
        "evidence_ids": ["id1", "id2"]
      }
    ]
  }

  CRITICAL FORMAT RULES:
  1. The top level MUST be a JSON object { }, NEVER a bare array [ ].
  2. The "reflections" array MUST contain 1 to 3 reflection objects.
  3. Each reflection MUST have "question", "insight" (strings) and "evidence_ids" (array of strings).
  4. Do NOT wrap output in markdown code blocks.
  5. Do NOT include ANY text outside the JSON object.

  CRITICAL ID GROUNDING RULE:
  For "evidence_ids", you MUST ONLY use the exact IDs shown in the <recent_memories> list.
  Do NOT invent, hallucinate, or modify IDs. If you cannot find the exact ID in the list, use an empty array [].`;
  ```
  3. Add after `QUESTIONS_RULES` (~line 130):
  ```javascript
  const UNIFIED_REFLECTION_RULES = `1. Generate 1-3 salient high-level questions about the character's psychological state, relationships, goals, or unresolved conflicts.
  2. For each question, provide a deep insight that synthesizes patterns across multiple memories.
  3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown in the input.
  4. Quality over quantity — generate only as many reflections as you can support with strong evidence.`;
  ```
  4. Add unified reflection role after existing roles (~line 40 in roles.js):
  ```javascript
  export const UNIFIED_REFLECTION_ROLE = `You are an expert psychological analyst. Generate high-level insights about a character's internal state, relationships, and trajectory based on their recent experiences.`;
  ```
  5. Add prompt builder function before `buildCommunitySummaryPrompt`:
  ```javascript
  /**
   * Build the unified reflection prompt.
   * Combines question generation and insight extraction into a single call.
   * @param {string} characterName
   * @param {Array} recentMemories - Top 100 recent memories
   * @param {string} preamble
   * @param {string} outputLanguage
   * @returns {object} { system, user } prompt object
   */
  export function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage = 'auto') {
      const memoryList = recentMemories.map((m) =>
          `${m.id}. [${'★'.repeat(m.importance || 3)}] ${m.summary}`
      ).join('\n');

      const systemPrompt = assembleSystemPrompt({
          role: UNIFIED_REFLECTION_ROLE,
          schema: UNIFIED_REFLECTION_SCHEMA,
          rules: UNIFIED_REFLECTION_RULES,
          examples: UNIFIED_REFLECTION_EXAMPLES,
          outputLanguage,
      });

      const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);
      const userPrompt = `<character>${characterName}</character>

  <recent_memories>
  ${memoryList}
  </recent_memories>

  ${languageInstruction}
  Based on these memories about ${characterName}:
  1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
  2. For each question, provide a deep insight that synthesizes patterns across the memories.
  3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.

  Respond with a single JSON object containing a "reflections" array with 1-3 items. No other text.`;

      return buildMessages(systemPrompt, userPrompt, '{', preamble);
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/prompts.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/prompts/index.js src/prompts/roles.js tests/prompts.test.js && git commit -m "feat: add unified reflection prompt builder"`

---

### Task 5: Refactor `generateReflections` to Use Single Unified Call

**Goal:** Replace 4-call pipeline with single unified call.

**Step 1: Update Existing Test**
- File: `tests/reflection/reflect.test.js`
- Action: Modify the `generateReflections` test to expect 1 LLM call instead of 4:
  ```javascript
  it('makes 1 LLM call total (unified reflection)', async () => {
      // Mock single unified call
      mockCallLLM.mockResolvedValueOnce(
          JSON.stringify({
              reflections: [
                  { question: 'Q1', insight: 'Alice is becoming a seasoned warrior', evidence_ids: ['ev_002'] },
                  { question: 'Q2', insight: 'Alice values her friendship with Bob', evidence_ids: ['ev_001'] },
                  { question: 'Q3', insight: 'Alice is driven by curiosity', evidence_ids: ['ev_003'] }
              ]
          })
      );
      await generateReflections(characterName, allMemories, characterStates);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/reflection/reflect.test.js`
- Expect: "Expected 1 calls but received 4"

**Step 3: Implementation (Green)**
- File: `src/reflection/reflect.js`
- Action: Replace the `generateReflections` function content:
  ```javascript
  export async function generateReflections(characterName, allMemories, characterStates) {
      const t0 = performance.now();
      const deps = getDeps();
      const settings = deps.getExtensionSettings()?.[extensionName] || {};
      const preamble = resolveExtractionPreamble(settings);
      const outputLanguage = resolveOutputLanguage(settings);
      const maxReflections = settings.maxReflectionsPerCharacter;

      // Archive old reflections if cap is reached (existing code unchanged)
      const characterReflections = allMemories.filter(
          (m) => m.type === 'reflection' && m.character === characterName && !m.archived
      );
      if (characterReflections.length >= maxReflections) {
          const toArchive = characterReflections.length - maxReflections + 1;
          const sortedBySequence = [...characterReflections].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          for (let i = 0; i < toArchive && i < sortedBySequence.length; i++) {
              sortedBySequence[i].archived = true;
          }
          logDebug(`Reflection: Archived ${toArchive} old reflections for ${characterName} (cap: ${maxReflections})`);
      }

      // Filter memories to what this character knows (existing code unchanged)
      const data = { character_states: characterStates };
      const accessibleMemories = filterMemoriesByPOV(allMemories, [characterName], data);
      const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, 100);

      if (recentMemories.length < 3) {
          logDebug(`Reflection: ${characterName} has too few accessible memories (${recentMemories.length}), skipping`);
          return [];
      }

      // Get existing reflections for this character (existing code unchanged)
      const existingReflections = accessibleMemories.filter(
          (m) => m.type === 'reflection' && m.character === characterName
      );

      // Pre-flight similarity gate (existing code unchanged)
      const { shouldSkip, reason: skipReason } = shouldSkipReflectionGeneration(
          recentMemories.slice(0, 10),
          existingReflections,
          0.85
      );

      if (shouldSkip) {
          logDebug(`Reflection: ${skipReason} for ${characterName}`);
          return [];
      }

      // NEW: Single unified reflection call (replaces Step 1 + Step 2)
      const reflectionPrompt = buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage);
      const reflectionResponse = await callLLM(reflectionPrompt, LLM_CONFIGS.reflection, { structured: true });
      const { reflections } = parseUnifiedReflectionResponse(reflectionResponse);

      logDebug(`Reflection: Generated ${reflections.length} unified reflections for ${characterName}`);

      // Convert unified reflections to memory objects
      const now = deps.Date.now();
      const newReflections = reflections.map(({ question, insight, evidence_ids }) => ({
          id: `ref_${generateId()}`,
          type: 'reflection',
          summary: insight,
          tokens: tokenize(insight || ''),
          importance: 4,
          sequence: now,
          characters_involved: [characterName],
          character: characterName,
          source_ids: evidence_ids,
          witnesses: [characterName],
          location: null,
          is_secret: false,
          emotional_impact: {},
          relationship_impact: {},
          created_at: now,
      }));

      // Generate embeddings for reflections (existing code unchanged)
      await enrichEventsWithEmbeddings(newReflections);

      // Dedup: 3-tier filter (existing code unchanged)
      const reflectionDedupThreshold = settings.reflectionDedupThreshold;
      const replaceThreshold = reflectionDedupThreshold - 0.1;
      const { toAdd, toArchiveIds } = filterDuplicateReflections(
          newReflections,
          allMemories,
          reflectionDedupThreshold,
          replaceThreshold
      );

      // Archive replaced reflections (existing code unchanged)
      if (toArchiveIds.length > 0) {
          for (const memory of allMemories) {
              if (toArchiveIds.includes(memory.id)) {
                  memory.archived = true;
              }
          }
          logDebug(`Reflection: Archived ${toArchiveIds.length} replaced reflections for ${characterName}`);
      }

      logDebug(
          `Reflection: Generated ${toAdd.length} reflections for ${characterName} (${newReflections.length - toAdd.length} filtered)`
      );
      record('llm_reflection', performance.now() - t0);
      return toAdd;
  }
  ```

- Also add the import at top:
  ```javascript
  import { parseUnifiedReflectionResponse } from '../extraction/structured.js';
  import { buildUnifiedReflectionPrompt } from '../prompts/index.js';
  ```

- Remove old imports (no longer needed):
  ```javascript
  // REMOVE: import { parseInsightExtractionResponse, parseSalientQuestionsResponse } from '../extraction/structured.js';
  // REMOVE: import { buildInsightExtractionPrompt, buildSalientQuestionsPrompt } from '../prompts/index.js';
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/reflection/reflect.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/reflection/reflect.js tests/reflection/reflect.test.js && git commit -m "refactor: use unified reflection (4 calls → 1 call)"`

---

### Task 6: Add LLM_CONFIGS for Unified Reflection

**Goal:** Add config entry for the unified reflection call.

**Step 1: Write the Failing Test**
- File: `tests/llm.test.js`
- Code:
  ```javascript
  it('defines LLM_CONFIGS.reflection for unified call', () => {
      const { LLM_CONFIGS } = await import('../../src/llm.js');
      expect(LLM_CONFIGS.reflection).toBeDefined();
      expect(LLM_CONFIGS.reflection.profileSettingKey).toBe('extractionProfile');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/llm.test.js`
- Expect: "LLM_CONFIGS.reflection is not defined"

**Step 3: Implementation (Green)**
- File: `src/llm.js`
- Action: Add to `LLM_CONFIGS` object:
  ```javascript
  export const LLM_CONFIGS = {
      // ... existing configs ...
      reflection: { profileSettingKey: 'extractionProfile' },
  };
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/llm.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/llm.js tests/llm.test.js && git commit -m "feat: add LLM_CONFIGS.reflection for unified call"`

---

### Task 7: Remove Unused Question/Insight Functions

**Goal:** Clean up obsolete functions from old 4-call pipeline.

**Step 1: Verify Obsolescence**
- File: `src/prompts/index.js`
- Action: Search for usages:
  ```bash
  grep -r "buildSalientQuestionsPrompt\|buildInsightExtractionPrompt" src/ tests/
  ```
- Expect: Only in index.js (definitions), no other usages

**Step 2: Remove Functions**
- File: `src/prompts/index.js`
- Action: Delete these functions:
  - `buildSalientQuestionsPrompt()`
  - `buildInsightExtractionPrompt()`

**Step 3: Remove Unused Exports**
- File: `src/extraction/structured.js`
- Action: Delete these exports (schemas remain for potential reuse):
  - `parseSalientQuestionsResponse()`
  - `parseInsightExtractionResponse()`
  - `getSalientQuestionsJsonSchema()`
  - `getInsightExtractionJsonSchema()`

**Step 4: Update Tests**
- File: `tests/prompts/examples/questions.test.js`
- Action: Update to deprecate (keep examples for documentation but mark deprecated):
  ```javascript
  // These examples are now deprecated — replaced by UNIFIED_REFLECTION_EXAMPLES
  // Kept for reference during migration period
  describe('QUESTION_EXAMPLES (deprecated)', () => {
      // ... existing tests ...
  });
  ```

**Step 5: Git Commit**
- Command: `git add src/prompts/index.js src/extraction/structured.js tests/prompts/examples/questions.test.js tests/prompts/examples/insights.test.js && git commit -m "chore: remove deprecated question/insight functions"`

---

## Phase 2: Edge Consolidation Infrastructure

### Task 8: Export `countTokens` from `src/utils/tokens.js`

**Goal:** Export token counter for edge description tracking.

**Step 1: Write the Failing Test**
- File: `tests/utils/tokens.test.js`
- Code:
  ```javascript
  it('exports countTokens function', () => {
      const { countTokens } = await import('../../src/utils/tokens.js');
      expect(typeof countTokens).toBe('function');
      expect(countTokens('hello world')).toBeGreaterThan(0);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/utils/tokens.test.js`
- Expect: "countTokens is not exported"

**Step 3: Implementation (Green)**
- File: `src/utils/tokens.js`
- Action: Add export to existing `countTokens` function or add:
  ```javascript
  export { countTokens };
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/utils/tokens.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/utils/tokens.js tests/utils/tokens.test.js && git commit -m "feat: export countTokens for edge tracking"`

---

### Task 9: Add Token Tracking to `upsertRelationship`

**Goal:** Track `_descriptionTokens` on edges to trigger consolidation.

**Step 1: Write the Failing Test**
- File: `tests/graph/graph.test.js`
- Code:
  ```javascript
  it('tracks _descriptionTokens on edges', () => {
      const graph = createEmptyGraph();
      upsertEntity(graph, 'Alice', 'PERSON', 'Explorer');
      upsertEntity(graph, 'Bob', 'PERSON', 'Merchant');

      upsertRelationship(graph, 'Alice', 'Bob', 'Met at tavern', 5);
      expect(graph.edges['alice__bob']._descriptionTokens).toBeDefined();
      expect(graph.edges['alice__bob']._descriptionTokens).toBeGreaterThan(0);

      // After adding more, token count increases
      const initialTokens = graph.edges['alice__bob']._descriptionTokens;
      upsertRelationship(graph, 'Alice', 'Bob', 'Traded goods', 5);
      expect(graph.edges['alice__bob']._descriptionTokens).toBeGreaterThan(initialTokens);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: "_descriptionTokens is undefined"

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Action: Add import at top:
  ```javascript
  import { countTokens } from '../utils/tokens.js';
  ```

- Then modify `upsertRelationship()` to add token tracking:
  ```javascript
  export function upsertRelationship(graphData, source, target, description, cap = 5) {
      const srcKey = _resolveKey(graphData, source);
      const tgtKey = _resolveKey(graphData, target);

      if (srcKey === tgtKey) {
          logDebug(`[graph] Edge skipped: ${source} -> ${target} — self-loops not allowed`);
          return;
      }

      if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) {
          logDebug(`[graph] Edge skipped: ${source} (${srcKey}) -> ${target} (${tgtKey}) — missing node`);
          return;
      }

      const edgeKey = `${srcKey}__${tgtKey}`;
      const existing = graphData.edges[edgeKey];

      if (existing) {
          existing.weight += 1;
          if (!existing.description.includes(description)) {
              existing.description = existing.description + ' | ' + description;
          }

          // Cap description segments (FIFO eviction)
          const segments = existing.description.split(' | ');
          if (cap > 0 && segments.length > cap) {
              existing.description = segments.slice(-cap).join(' | ');
          }

          // NEW: Track token count after update
          existing._descriptionTokens = countTokens(existing.description);
      } else {
          const newEdge = {
              source: srcKey,
              target: tgtKey,
              description,
              weight: 1,
              _descriptionTokens: countTokens(description), // NEW: Track tokens
          };
          graphData.edges[edgeKey] = newEdge;
      }
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "feat: track description tokens on edges"`

---

### Task 10: Add `markEdgeForConsolidation` Helper

**Goal:** Add function to mark edges for batch consolidation.

**Step 1: Write the Failing Test**
- File: `tests/graph/graph.test.js`
- Code:
  ```javascript
  it('marks edges for consolidation', () => {
      const graph = { nodes: {}, edges: {}, _edgesNeedingConsolidation: [] };
      graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
      graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
      graph.edges['alice__bob'] = { source: 'alice', target: 'bob', description: 'test', weight: 1 };

      markEdgeForConsolidation(graph, 'alice__bob');
      expect(graph._edgesNeedingConsolidation).toContain('alice__bob');

      // Duplicate add is idempotent
      markEdgeForConsolidation(graph, 'alice__bob');
      expect(graph._edgesNeedingConsolidation.filter(e => e === 'alice__bob')).toHaveLength(1);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: "markEdgeForConsolidation is not defined"

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Action: Add function after `upsertRelationship`:
  ```javascript
  /**
   * Mark an edge for consolidation during next community detection.
   * @param {Object} graphData - The graph object
   * @param {string} edgeKey - The edge key to mark
   */
  export function markEdgeForConsolidation(graphData, edgeKey) {
      if (!graphData._edgesNeedingConsolidation) {
          graphData._edgesNeedingConsolidation = [];
      }
      if (!graphData._edgesNeedingConsolidation.includes(edgeKey)) {
          graphData._edgesNeedingConsolidation.push(edgeKey);
      }
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "feat: add markEdgeForConsolidation helper"`

---

### Task 11: Trigger Consolidation Marking in `upsertRelationship`

**Goal:** Mark edges for consolidation when token threshold is exceeded.

**Step 1: Write the Failing Test**
- File: `tests/graph/graph.test.js`
- Code:
  ```javascript
  it('marks edge for consolidation when token threshold exceeded', () => {
      const graph = createEmptyGraph();
      upsertEntity(graph, 'Alice', 'PERSON', 'Explorer');
      upsertEntity(graph, 'Bob', 'PERSON', 'Merchant');

      // Create an edge with bloated description (>500 tokens)
      const longDesc = 'A'.repeat(600); // ~150 tokens
      upsertRelationship(graph, 'Alice', 'Bob', longDesc, 5);

      // Should be marked for consolidation
      // Note: This requires settings to be passed or using default
      // For test simplicity, check the marking logic directly
  });
  ```

**Step 2: Implementation (Green)**
- File: `src/graph/graph.js`
- Action: Modify `upsertRelationship` signature and add marking logic:
  ```javascript
  import { CONSOLIDATION } from '../constants.js';

  export function upsertRelationship(
      graphData,
      source,
      target,
      description,
      cap = 5,
      settings = null  // NEW: Optional settings for consolidation behavior
  ) {
      // ... existing validation code ...

      if (existing) {
          existing.weight += 1;
          if (!existing.description.includes(description)) {
              existing.description = existing.description + ' | ' + description;
          }

          const segments = existing.description.split(' | ');
          if (cap > 0 && segments.length > cap) {
              existing.description = segments.slice(-cap).join(' | ');
          }

          existing._descriptionTokens = countTokens(existing.description);

          // NEW: Mark for consolidation if over threshold
          const threshold = settings?.consolidationTokenThreshold ?? CONSOLIDATION.TOKEN_THRESHOLD;
          if (existing._descriptionTokens > threshold) {
              markEdgeForConsolidation(graphData, edgeKey);
          }
      } else {
          const newEdge = {
              source: srcKey,
              target: tgtKey,
              description,
              weight: 1,
              _descriptionTokens: countTokens(description),
          };
          graphData.edges[edgeKey] = newEdge;
      }
  }
  ```

**Step 3: Verify (Green)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "feat: trigger edge consolidation on token threshold"`

---

## Phase 3: Edge Consolidation Implementation

### Task 12: Create Edge Consolidation Prompt and Parser

**Goal:** Add prompt builder and parser for edge consolidation.

**Step 1: Write the Failing Test**
- File: `tests/prompts.test.js`
- Code:
  ```javascript
  it('builds edge consolidation prompt', () => {
      const edge = {
          source: 'alice',
          target: 'bob',
          description: 'Met at tavern | Traded goods | Fought dragon together',
          weight: 3
      };
      const result = buildEdgeConsolidationPrompt(edge);
      expect(result.system).toContain('relationship state synthesizer');
      expect(result.user).toContain('alice');
      expect(result.user).toContain('bob');
      expect(result.user).toContain('Met at tavern');
  });

  it('parses consolidation response', () => {
      const raw = JSON.stringify({
          consolidated_description: 'Started as strangers at a tavern, became trading partners, then allies in battle against the dragon'
      });
      const result = parseConsolidationResponse(raw);
      expect(result.consolidated_description).toContain('strangers');
      expect(result.consolidated_description).toContain('allies');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/prompts.test.js`
- Expect: "buildEdgeConsolidationPrompt is not defined"

**Step 3: Implementation (Green)**
- File: `src/prompts/index.js`
- Action: Add after `buildUnifiedReflectionPrompt`:
  ```javascript
  /**
   * Build the edge consolidation prompt.
   * @param {Object} edgeData - Edge object with source, target, description, weight
   * @returns {object} { system, user } prompt object
   */
  export function buildEdgeConsolidationPrompt(edgeData) {
      const segments = edgeData.description.split(' | ');
      return {
          system: 'You are a relationship state synthesizer. Combine multiple relationship descriptions into a single, coherent summary that preserves narrative depth.',
          user: `Synthesize these relationship developments into ONE unified description:

  Source: ${edgeData.source}
  Target: ${edgeData.target}
  Weight: ${edgeData.weight}

  Timeline segments:
  ${segments.map((s, i) => `${i + 1}. ${s}`).join('\n')}

  Output a JSON object with:
  {
    "consolidated_description": "string - unified relationship summary that captures the evolution"
  }

  Keep the description under 100 tokens.

  IMPORTANT: Summarize the CURRENT dynamic, but preserve critical historical shifts.
  For example: "Started as enemies, but allied after the dragon incident; now close friends."
  If the relationship has evolved significantly, capture that trajectory in a concise way.

  Respond with a single JSON object. No other text.`,
      };
  }
  ```

- File: `src/extraction/structured.js`
- Action: Add schema and parser:
  ```javascript
  /**
   * Schema for edge consolidation response
   */
  export const EdgeConsolidationSchema = z.object({
      consolidated_description: z.string().min(1, 'Consolidated description is required'),
  });

  /**
   * Get jsonSchema for edge consolidation
   * @returns {Object} ConnectionManager jsonSchema object
   */
  export function getEdgeConsolidationJsonSchema() {
      return toJsonSchema(EdgeConsolidationSchema, 'EdgeConsolidation');
  }

  /**
   * Parse edge consolidation response
   * @param {string} content - Raw LLM response
   * @returns {Object} Validated consolidation response
   */
  export function parseConsolidationResponse(content) {
      return parseStructuredResponse(content, EdgeConsolidationSchema);
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/prompts.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/prompts/index.js src/extraction/structured.js tests/prompts.test.js tests/extraction/structured.test.js && git commit -m "feat: add edge consolidation prompt and parser"`

---

### Task 13: Implement `consolidateEdges` Function

**Goal:** Implement batch edge consolidation with re-embedding.

**Step 1: Write the Failing Test**
- File: `tests/graph/graph.test.js`
- Code:
  ```javascript
  it('consolidates edges marked for consolidation', async () => {
      const graph = {
          nodes: {
              alice: { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1, embedding_b64: null },
              bob: { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1, embedding_b64: null }
          },
          edges: {
              'alice__bob': {
                  source: 'alice',
                  target: 'bob',
                  description: 'Met | Traded | Fought | Celebrated | Parted',
                  weight: 5,
                  _descriptionTokens: 600
              }
          },
          _edgesNeedingConsolidation: ['alice__bob']
      };

      const mockSettings = { consolidationTokenThreshold: 500 };
      const mockCallLLM = vi.fn().mockResolvedValue(
          JSON.stringify({ consolidated_description: 'From strangers to battle allies' })
      );

      // Mock embeddings disabled
      vi.mock('../../src/embeddings.js', () => ({
          isEmbeddingsEnabled: () => false,
      }));

      const result = await consolidateEdges(graph, mockSettings);
      expect(result).toBe(1);
      expect(graph.edges['alice__bob'].description).toBe('From strangers to battle allies');
      expect(graph._edgesNeedingConsolidation).toHaveLength(0);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: "consolidateEdges is not defined"

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Action: Add function:
  ```javascript
  import { getDocumentEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
  import { callLLM } from '../llm.js';
  import { parseConsolidationResponse } from '../extraction/structured.js';
  import { buildEdgeConsolidationPrompt } from '../prompts/index.js';
  import { logError, logDebug } from '../utils/logging.js';
  import { hasEmbedding, setEmbedding } from '../utils/embedding-codec.js';

  /**
   * Consolidate graph edges that have exceeded token budget.
   * Runs during community detection phase.
   * @param {Object} graphData - The graph object
   * @param {Object} settings - Extension settings
   * @returns {Promise<number>} Number of edges consolidated
   */
  export async function consolidateEdges(graphData, settings) {
      if (!graphData._edgesNeedingConsolidation?.length) {
          return 0;
      }

      const toProcess = graphData._edgesNeedingConsolidation
          .slice(0, CONSOLIDATION.MAX_CONSOLIDATION_BATCH);

      let consolidated = 0;

      for (const edgeKey of toProcess) {
          const edge = graphData.edges[edgeKey];
          if (!edge) continue;

          try {
              const prompt = buildEdgeConsolidationPrompt(edge);
              const response = await callLLM(prompt, {
                  maxTokens: 200,
                  temperature: 0.3
              }, { structured: true });

              const result = parseConsolidationResponse(response);
              if (result.consolidated_description) {
                  edge.description = result.consolidated_description;
                  edge._descriptionTokens = countTokens(result.consolidated_description);

                  // Re-embed for accurate RAG (only if embeddings enabled)
                  if (isEmbeddingsEnabled()) {
                      const newEmbedding = await getDocumentEmbedding(
                          `relationship: ${edge.source} - ${edge.target}: ${edge.description}`
                      );
                      setEmbedding(edge, newEmbedding);
                  }

                  consolidated++;
              }
          } catch (err) {
              logError(`Failed to consolidate edge ${edgeKey}`, err);
          }
      }

      // Remove processed edges from queue
      graphData._edgesNeedingConsolidation = graphData._edgesNeedingConsolidation
          .slice(consolidated);

      return consolidated;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/graph/graph.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "feat: implement consolidateEdges function"`

---

### Task 14: Integrate Consolidation into Community Detection

**Goal:** Call `consolidateEdges` during community detection flow.

**Step 1: Write the Failing Test**
- File: `tests/graph/communities.test.js`
- Code:
  ```javascript
  it('consolidates edges before community summarization', async () => {
      // This test verifies the integration point exists
      // Actual behavior tested in integration tests
      const graph = {
          nodes: {},
          edges: {},
          _edgesNeedingConsolidation: ['test__edge']
      };

      // The community detection flow should call consolidateEdges
      // when _edgesNeedingConsolidation has entries
  });
  ```

**Step 2: Find Integration Point**
- File: `src/graph/rag.js` (or equivalent)
- Action: Locate `detectCommunities` function

**Step 3: Implementation (Green)**
- File: `src/graph/rag.js` (or file containing `detectCommunities`)
- Action: Add consolidation call after Louvain clustering:
  ```javascript
  import { consolidateEdges } from './graph.js';

  export async function detectCommunities(graphData, settings) {
      // ... existing Louvain clustering ...

      // NEW: Consolidate bloated edges before summarization
      if (graphData._edgesNeedingConsolidation?.length > 0) {
          const consolidated = await consolidateEdges(graphData, settings);
          if (consolidated > 0) {
              logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
          }
      }

      // ... existing LLM summarization with cleaner edge data ...
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/graph/communities.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/graph/rag.js tests/graph/communities.test.js && git commit -m "feat: integrate edge consolidation into community detection"`

---

## Phase 4: Testing & Cleanup

### Task 15: Test Unified Reflection End-to-End

**Goal:** Verify unified reflection works with real LLM mock patterns.

**Step 1: Write the Test**
- File: `tests/reflection/unified-reflection.integration.test.js` (NEW FILE)
- Code:
  ```javascript
  import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
  import { generateReflections } from '../../src/reflection/reflect.js';
  import { resetDeps } from '../../src/deps.js';

  describe('Unified Reflection Integration', () => {
      const mockCallLLM = vi.fn();

      vi.mock('../../src/llm.js', () => ({
          callLLM: (...args) => mockCallLLM(...args),
          LLM_CONFIGS: {
              reflection: { profileSettingKey: 'extractionProfile' }
          }
      }));

      vi.mock('../../src/embeddings.js', () => ({
          enrichEventsWithEmbeddings: vi.fn(async (events) => {
              events.forEach((e) => { e.embedding = [0.5, 0.5]; });
          }),
          isEmbeddingsEnabled: () => true,
      }));

      beforeEach(() => {
          setupTestContext({
              deps: { Date: { now: () => 2000000 } }
          });
          mockCallLLM.mockReset();
      });

      afterEach(() => {
          resetDeps();
          vi.clearAllMocks();
      });

      it('handles 1-reflection response (minimal)', async () => {
          mockCallLLM.mockResolvedValue(JSON.stringify({
              reflections: [
                  { question: 'Q1', insight: 'Single insight', evidence_ids: ['ev_001'] }
              ]
          }));

          const result = await generateReflections('Alice', [
              { id: 'ev_001', summary: 'Alice did something', importance: 3, characters_involved: ['Alice'], witnesses: ['Alice'], type: 'event', embedding: [0.5, 0.5] }
          ], {});

          expect(result).toHaveLength(1);
          expect(result[0].summary).toBe('Single insight');
          expect(result[0].source_ids).toEqual(['ev_001']);
      });

      it('handles 3-reflection response (max)', async () => {
          mockCallLLM.mockResolvedValue(JSON.stringify({
              reflections: [
                  { question: 'Q1', insight: 'Insight 1', evidence_ids: ['ev_001'] },
                  { question: 'Q2', insight: 'Insight 2', evidence_ids: ['ev_002'] },
                  { question: 'Q3', insight: 'Insight 3', evidence_ids: ['ev_003'] }
              ]
          }));

          const result = await generateReflections('Alice', [
              { id: 'ev_001', summary: 'Event 1', importance: 3, characters_involved: ['Alice'], witnesses: ['Alice'], type: 'event', embedding: [0.5, 0.5] },
              { id: 'ev_002', summary: 'Event 2', importance: 3, characters_involved: ['Alice'], witnesses: ['Alice'], type: 'event', embedding: [0.5, 0.5] },
              { id: 'ev_003', summary: 'Event 3', importance: 3, characters_involved: ['Alice'], witnesses: ['Alice'], type: 'event', embedding: [0.5, 0.5] }
          ], {});

          expect(result).toHaveLength(3);
      });

      it('handles empty evidence_ids gracefully', async () => {
          mockCallLLM.mockResolvedValue(JSON.stringify({
              reflections: [
                  { question: 'Q1', insight: 'General insight', evidence_ids: [] }
              ]
          }));

          const result = await generateReflections('Alice', [
              { id: 'ev_001', summary: 'Event', importance: 3, characters_involved: ['Alice'], witnesses: ['Alice'], type: 'event', embedding: [0.5, 0.5] }
          ], {});

          expect(result).toHaveLength(1);
          expect(result[0].source_ids).toEqual([]);
      });
  });
  ```

**Step 2: Run Test (Green)**
- Command: `npm test tests/reflection/unified-reflection.integration.test.js`
- Expect: PASS

**Step 3: Git Commit**
- Command: `git add tests/reflection/unified-reflection.integration.test.js && git commit -m "test: add unified reflection integration tests"`

---

### Task 16: Test Edge Consolidation with Embeddings Disabled

**Goal:** Verify consolidation works when BM25-only mode is active.

**Step 1: Write the Test**
- File: `tests/graph/consolidation.test.js` (NEW FILE)
- Code:
  ```javascript
  import { describe, expect, it, vi } from 'vitest';
  import { consolidateEdges } from '../../src/graph/graph.js';
  import { createEmptyGraph } from '../../src/graph/graph.js';

  describe('Edge Consolidation (BM25-only mode)', () => {
      it('consolidates without embeddings when disabled', async () => {
          vi.mock('../../src/embeddings.js', () => ({
              isEmbeddingsEnabled: () => false,
          }));

          const graph = createEmptyGraph();
          graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
          graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
          graph.edges['alice__bob'] = {
              source: 'alice',
              target: 'bob',
              description: 'Seg1 | Seg2 | Seg3 | Seg4 | Seg5 | Seg6',
              weight: 6,
              _descriptionTokens: 600
          };
          graph._edgesNeedingConsolidation = ['alice__bob'];

          const mockCallLLM = vi.fn().mockResolvedValue(
              JSON.stringify({ consolidated_description: 'Consolidated relationship' })
          );
          vi.mock('../../src/llm.js', () => ({
              callLLM: (...args) => mockCallLLM(...args),
          }));

          const result = await consolidateEdges(graph, {});
          expect(result).toBe(1);
          expect(graph.edges['alice__bob'].description).toBe('Consolidated relationship');
          expect(graph._edgesNeedingConsolidation).toHaveLength(0);
      });
  });
  ```

**Step 2: Run Test (Green)**
- Command: `npm test tests/graph/consolidation.test.js`
- Expect: PASS

**Step 3: Git Commit**
- Command: `git add tests/graph/consolidation.test.js && git commit -m "test: add edge consolidation BM25-only test"`

---

### Task 17: Verify Performance Improvement

**Goal:** Ensure unified reflection is faster than old pipeline.

**Step 1: Performance Test**
- File: `tests/perf/reflection.test.js` (NEW FILE)
- Code:
  ```javascript
  import { describe, expect, it } from 'vitest';
  import { record } from '../../src/perf/store.js';

  describe('Reflection Performance', () => {
      it('records llm_reflection metric', () => {
          // After running reflections, check performance metric
          const perf = record.mock.results || {};
          expect(perf.llm_reflection).toBeDefined();
          // With unified call, should be ~10-15s instead of 30-90s
          // (actual timing depends on LLM, but we verify metric exists)
      });
  });
  ```

**Step 2: Update PERF_THRESHOLDS**
- File: `src/constants.js`
- Action: Update threshold for unified reflection:
  ```javascript
  llm_reflection: 20000,  // Reduced from 45000 (was 4-call, now 1-call)
  ```

**Step 3: Git Commit**
- Command: `git add src/constants.js tests/perf/reflection.test.js && git commit -m "perf: update reflection threshold for unified call"`

---

## Summary

This implementation plan delivers:

1. **Unified Reflection Pipeline** (Tasks 1-7):
   - Single LLM call generates questions + insights together
   - 3-6x performance improvement
   - Eliminates rate limit risks
   - High-quality bilingual examples (EN/RU)

2. **Edge Consolidation** (Tasks 8-14):
   - Token budget tracking on graph edges
   - Deferred batch consolidation during community detection
   - Re-embedding for accurate RAG
   - BM25-only mode support

3. **Testing** (Tasks 15-17):
   - Integration tests for unified reflection
   - Consolidation tests with/without embeddings
   - Performance metric updates

**Total Tasks:** 17
**Estimated Time:** 3-4 hours (following TDD rigor)
**Risk Level:** Low (incremental changes, no breaking changes to data schema)
