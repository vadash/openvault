# Implementation Plan - Asymmetric Embedding Prompts + Tag Taxonomy

> **Reference:** `docs/designs/2026-02-24-asymmetric-tags-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Replace `EventTypeEnum` with `TagEnum` in Schema

**Goal:** Remove `event_type` from the Zod schema and add the 31-tag `tags` field.

**Step 1: Write the Failing Test**
- File: `tests/extraction/schemas/event-schema.test.js`
- Action: Replace all existing tests with new tests validating `tags` field instead of `event_type`:
  ```js
  // Replace the EventTypeEnum import and all event_type tests with:
  import { TagEnum, EventSchema, ExtractionResponseSchema } from '../../../src/extraction/schemas/event-schema.js';

  describe('TagEnum', () => {
      it('accepts all 31 valid tags', () => {
          const allTags = [
              'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
              'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
              'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
              'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
              'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
              'NONE'
          ];
          for (const tag of allTags) {
              expect(TagEnum.parse(tag)).toBe(tag);
          }
      });

      it('rejects invalid tags', () => {
          expect(() => TagEnum.parse('INVALID')).toThrow();
          expect(() => TagEnum.parse('action')).toThrow();
      });
  });

  describe('EventSchema', () => {
      it('requires tags array with 1-3 elements', () => {
          const base = {
              summary: 'Test summary here',
              importance: 3,
              characters_involved: [],
              witnesses: [],
              location: null,
              is_secret: false,
          };

          // Valid: 1 tag
          expect(() => EventSchema.parse({ ...base, tags: ['COMBAT'] })).not.toThrow();
          // Valid: 3 tags
          expect(() => EventSchema.parse({ ...base, tags: ['COMBAT', 'INJURY', 'HORROR'] })).not.toThrow();
          // Invalid: 0 tags
          expect(() => EventSchema.parse({ ...base, tags: [] })).toThrow();
          // Invalid: 4 tags
          expect(() => EventSchema.parse({ ...base, tags: ['A', 'B', 'C', 'D'] })).toThrow();
      });

      it('defaults tags to ["NONE"] when omitted', () => {
          const result = EventSchema.parse({
              summary: 'Test summary here',
              importance: 3,
              characters_involved: [],
              witnesses: [],
              location: null,
              is_secret: false,
          });
          expect(result.tags).toEqual(['NONE']);
      });

      it('does NOT have event_type field', () => {
          const result = EventSchema.parse({
              summary: 'Test summary here',
              importance: 3,
              tags: ['DOMESTIC'],
              characters_involved: [],
              witnesses: [],
              location: null,
              is_secret: false,
          });
          expect(result.event_type).toBeUndefined();
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/extraction/schemas/event-schema.test.js`
- Expect: Fail — `TagEnum` not exported, `event_type` still required

**Step 3: Implementation (Green)**
- File: `src/extraction/schemas/event-schema.js`
- Action: Replace entire file content:
  ```js
  import { z } from 'https://esm.sh/zod@4';

  /**
   * Enum for content category tags assigned by extraction LLM.
   * 31 tags across 6 groups: Intimate, Conflict, Slice-of-life, Character, World, Fallback.
   */
  export const TagEnum = z.enum([
      // Intimate
      'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
      // Conflict
      'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
      // Slice-of-life
      'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
      // Character
      'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
      // World/Adventure
      'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
      // Fallback
      'NONE'
  ]);

  /**
   * Schema for relationship impact between characters
   * Maps "A->B" string to 1-3 word change description
   */
  export const RelationshipImpactSchema = z.record(z.string(), z.string());

  /**
   * Schema for a single memory event
   * Tags are required (1-3 per event) to categorize content for embedding separation.
   */
  export const EventSchema = z.object({
      summary: z.string().min(1, 'Summary is required'),
      importance: z.number().int().min(1).max(5).default(3),
      tags: z.array(TagEnum).min(1).max(3).default(['NONE']),
      characters_involved: z.array(z.string()).default([]),
      witnesses: z.array(z.string()).default([]),
      location: z.string().nullable().default(null),
      is_secret: z.boolean().default(false),
      emotional_impact: z.record(z.string(), z.string()).optional().default({}),
      relationship_impact: RelationshipImpactSchema.optional().default({}),
  });

  /**
   * Schema for the full extraction response from LLM (structured format)
   * Reasoning comes FIRST to enable chain-of-thought before committing to events
   */
  export const ExtractionResponseSchema = z.object({
      reasoning: z.string().nullable().default(null),
      events: z.array(EventSchema),
  });
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/schemas/event-schema.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: replace EventTypeEnum with TagEnum (31 content tags)"`

---

## Task 2: Update UI Constants — Remove `EVENT_TYPES` and `EVENT_TYPE_ICONS`

**Goal:** Replace the event-type-based UI constants with tag-based ones.

**Step 1: Write the Failing Test**
- File: `tests/ui-constants.test.js` (new file)
- Code:
  ```js
  import { TAG_LIST, TAG_ICONS } from '../src/ui/base/constants.js';

  describe('TAG_LIST', () => {
      it('contains all 31 tags', () => {
          expect(TAG_LIST).toHaveLength(31);
          expect(TAG_LIST).toContain('EXPLICIT');
          expect(TAG_LIST).toContain('NONE');
      });
  });

  describe('TAG_ICONS', () => {
      it('has a default icon', () => {
          expect(TAG_ICONS.default).toBeDefined();
      });
      it('has icons for key tags', () => {
          expect(TAG_ICONS.COMBAT).toBeDefined();
          expect(TAG_ICONS.ROMANCE).toBeDefined();
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/ui-constants.test.js`
- Expect: Fail — `TAG_LIST` and `TAG_ICONS` not exported

**Step 3: Implementation (Green)**
- File: `src/ui/base/constants.js`
- Action: Replace `EVENT_TYPES` and `EVENT_TYPE_ICONS` with:
  ```js
  // Tag configuration (replaces EVENT_TYPES)
  export const TAG_LIST = [
      'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
      'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
      'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
      'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
      'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
      'NONE'
  ];

  export const TAG_ICONS = {
      // Intimate
      EXPLICIT: 'fa-solid fa-fire',
      BDSM: 'fa-solid fa-link',
      FETISH: 'fa-solid fa-mask',
      ROMANCE: 'fa-solid fa-heart',
      FLIRTING: 'fa-solid fa-face-smile-wink',
      SEDUCTION: 'fa-solid fa-wine-glass',
      // Conflict
      COMBAT: 'fa-solid fa-bolt',
      THREAT: 'fa-solid fa-triangle-exclamation',
      INJURY: 'fa-solid fa-band-aid',
      BETRAYAL: 'fa-solid fa-heart-crack',
      HORROR: 'fa-solid fa-skull',
      // Slice-of-life
      DOMESTIC: 'fa-solid fa-house',
      SOCIAL: 'fa-solid fa-comments',
      TRAVEL: 'fa-solid fa-route',
      COMMERCE: 'fa-solid fa-cart-shopping',
      FOOD: 'fa-solid fa-utensils',
      CELEBRATION: 'fa-solid fa-champagne-glasses',
      // Character
      LORE: 'fa-solid fa-book',
      SECRET: 'fa-solid fa-user-secret',
      TRAUMA: 'fa-solid fa-cloud-rain',
      GROWTH: 'fa-solid fa-seedling',
      EMOTION: 'fa-solid fa-face-sad-tear',
      BONDING: 'fa-solid fa-handshake',
      REUNION: 'fa-solid fa-people-arrows',
      // World
      MYSTERY: 'fa-solid fa-magnifying-glass',
      MAGIC: 'fa-solid fa-wand-sparkles',
      STEALTH: 'fa-solid fa-eye-slash',
      POLITICAL: 'fa-solid fa-landmark',
      HUMOR: 'fa-solid fa-face-laugh',
      CRAFTING: 'fa-solid fa-hammer',
      // Fallback
      NONE: 'fa-solid fa-bookmark',
      default: 'fa-solid fa-bookmark'
  };
  ```
- Also delete the old `EVENT_TYPES` and `EVENT_TYPE_ICONS` exports.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/ui-constants.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: replace EVENT_TYPES/ICONS with TAG_LIST/TAG_ICONS"`

---

## Task 3: Update Memory Card Templates — Tags Instead of Event Type

**Goal:** Memory cards display tag badges instead of event_type header.

**Step 1: Write the Failing Test**
- File: `tests/memory-templates.test.js` (new file)
- Code:
  ```js
  import { renderMemoryItem, renderMemoryEdit } from '../src/ui/templates/memory.js';

  const mockMemory = {
      id: 'test-1',
      summary: 'Test summary',
      importance: 3,
      tags: ['COMBAT', 'INJURY'],
      characters_involved: ['Alice'],
      witnesses: [],
      location: null,
      is_secret: false,
      created_at: Date.now(),
  };

  describe('renderMemoryItem', () => {
      it('renders tag badges', () => {
          const html = renderMemoryItem(mockMemory);
          expect(html).toContain('COMBAT');
          expect(html).toContain('INJURY');
          expect(html).not.toContain('event_type');
          expect(html).not.toContain('action');
      });
  });

  describe('renderMemoryEdit', () => {
      it('renders tag checkboxes instead of event_type dropdown', () => {
          const html = renderMemoryEdit(mockMemory);
          expect(html).toContain('data-field="tags"');
          expect(html).not.toContain('data-field="event_type"');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/memory-templates.test.js`
- Expect: Fail — templates still reference `event_type`

**Step 3: Implementation (Green)**
- File: `src/ui/templates/memory.js`
- Action: Replace all `event_type` references:
  1. Replace `EVENT_TYPE_ICONS, EVENT_TYPES` import with `TAG_ICONS, TAG_LIST`
  2. Replace `getEventTypeIcon(eventType)` → use first tag from `memory.tags`
  3. Replace `getTypeClass(eventType)` → derive from first tag
  4. Replace `buildCardHeader` to show tags as badges instead of single event_type
  5. Replace `buildEventTypeOptions` with `buildTagCheckboxes` for edit mode
  6. Replace `buildEditFields` to use tag checkboxes instead of event_type dropdown
  - Specific changes:
    - `getEventTypeIcon(eventType)` → `getTagIcon(tag)` using `TAG_ICONS[tag] || TAG_ICONS.default`
    - `getTypeClass(eventType)` → `getTypeClass(tags)` using first tag lowercased
    - `buildCardHeader`: show `memory.tags.join(', ')` instead of `memory.event_type`
    - `buildEditFields`: replace event_type `<select>` with tag checkboxes `<div data-field="tags">` containing `<label><input type="checkbox" value="COMBAT"> COMBAT</label>` for each tag in TAG_LIST

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/memory-templates.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: memory cards display tags instead of event_type"`

---

## Task 4: Update MemoryList Component — Search/Filter by Tags

**Goal:** Search and filter use `tags` instead of `event_type`.

**Step 1: Write the Failing Test**
- File: `tests/ui-calculations.test.js`
- Action: Update existing `filterMemories` tests to use `tags` instead of `event_type`:
  ```js
  describe('filterMemories', () => {
      const memories = [
          { tags: ['COMBAT'], characters_involved: ['Alice'] },
          { tags: ['ROMANCE', 'DOMESTIC'], characters_involved: ['Bob'] },
          { tags: ['NONE'], characters_involved: ['Alice'] },
      ];

      it('filters by tag', () => {
          expect(filterMemories(memories, 'COMBAT', '')).toHaveLength(1);
      });

      it('filters by tag when memory has multiple tags', () => {
          expect(filterMemories(memories, 'DOMESTIC', '')).toHaveLength(1);
      });

      it('returns all when no filter', () => {
          expect(filterMemories(memories, '', '')).toHaveLength(3);
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/ui-calculations.test.js`
- Expect: Fail — `filterMemories` still checks `m.event_type`

**Step 3: Implementation (Green)**
- File: `src/ui/calculations.js`
- Line 17: Change `if (typeFilter && m.event_type !== typeFilter) return false;` to:
  ```js
  if (typeFilter && !m.tags?.includes(typeFilter)) return false;
  ```

- File: `src/ui/components/MemoryList.js`
- Line 113 (`_filterBySearch`): Change `const eventType = (m.event_type || '').toLowerCase();` to:
  ```js
  const tags = (m.tags || []).join(' ').toLowerCase();
  ```
  And update the return to use `tags.includes(query)` instead of `eventType.includes(query)`.

- Line 166 (`_saveEdit`): Change from reading `event_type` dropdown to reading tag checkboxes:
  ```js
  // OLD: const event_type = $card.find('[data-field="event_type"]').val();
  // NEW:
  const tags = [];
  $card.find('[data-field="tags"] input:checked').each(function() {
      tags.push($(this).val());
  });
  if (tags.length === 0) tags.push('NONE');
  ```

- Line 176: Change `updateMemoryAction(id, { summary, importance, event_type })` to:
  ```js
  updateMemoryAction(id, { summary, importance, tags })
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/ui-calculations.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: MemoryList filters/searches by tags"`

---

## Task 5: Update `updateMemory` Action — Allow `tags` Field

**Goal:** The `updateMemory` action accepts `tags` instead of `event_type`.

**Step 1: Write the Failing Test**
- File: `tests/memory-list.test.js`
- Action: Update mock memories and tests to use `tags` instead of `event_type`. Ensure updateMemory whitelists `tags`.

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/memory-list.test.js`
- Expect: Fail — `event_type` still in allowedFields

**Step 3: Implementation (Green)**
- File: `src/data/actions.js`
- Line 39: Change `const allowedFields = ['summary', 'importance', 'event_type', 'is_secret'];` to:
  ```js
  const allowedFields = ['summary', 'importance', 'tags', 'is_secret'];
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/memory-list.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: updateMemory allows tags field instead of event_type"`

---

## Task 6: Update Extraction Prompt — Add `<tags_field>`, Remove `event_type`

**Goal:** The extraction system prompt uses tags instead of event_type for all directives and examples.

**Step 1: Write the Failing Test**
- File: `tests/prompts.test.js`
- Action: Update tests to verify:
  ```js
  it('system prompt contains <tags_field> directive', () => {
      const prompt = buildExtractionPrompt({ messages: 'test', names: { char: 'A', user: 'B' } });
      expect(prompt[0].content).toContain('<tags_field>');
      expect(prompt[0].content).not.toContain('event_type');
  });

  it('examples include tags field', () => {
      const prompt = buildExtractionPrompt({ messages: 'test', names: { char: 'A', user: 'B' } });
      expect(prompt[0].content).toContain('"tags"');
  });

  it('formatEstablishedMemories uses tags', () => {
      const prompt = buildExtractionPrompt({
          messages: 'test',
          names: { char: 'A', user: 'B' },
          context: { memories: [{ summary: 'test', importance: 3, tags: ['COMBAT'] }] }
      });
      expect(prompt[1].content).toContain('[COMBAT]');
      expect(prompt[1].content).not.toContain('[event]');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/prompts.test.js`
- Expect: Fail — prompt still has `event_type`, no `<tags_field>`

**Step 3: Implementation (Green)**
- File: `src/prompts.js`
- Action: Three changes:

  **3a.** `formatEstablishedMemories` (line 19): Replace `[${m.event_type || 'event'}]` with:
  ```js
  `${i + 1}. [${(m.tags || ['NONE']).join(', ')}] [${m.importance} Star] ${m.summary}`
  ```

  **3b.** In the system prompt, replace the `<core_directives>` section point 3 ("EVENT TYPES"):
  - Remove the entire block about event_type (lines 72-76 equivalent)
  - Remove `event_type` from thinking_process step 4

  **3c.** Add `<tags_field>` directive after `</importance_scale>` — use the full directive text from the design document (Section 6b).

  **3d.** Update ALL examples: remove `"event_type": "..."` from every JSON output, add `"tags": [...]`:
  - combat example: `"tags": ["COMBAT"]`
  - intimate example: `"tags": ["EXPLICIT"]`
  - revelation_secret: `"tags": ["SECRET", "LORE"]`
  - revelation_desire: `"tags": ["FETISH", "EXPLICIT"]`
  - emotion_shift_anger: `"tags": ["EMOTION", "BETRAYAL"]`
  - emotion_shift_arousal_dedup: no events (empty array, no change needed)
  - relationship_change_alliance: `"tags": ["BONDING"]`
  - relationship_change_dynamic: `"tags": ["BDSM"]`
  - deduplication: no events (empty array, no change needed)

  **3e.** Update thinking_process: replace "determine event_type" with "assign 1-3 tags"

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/prompts.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: extraction prompt uses tags instead of event_type"`

---

## Task 7: Update Smart Retrieval Prompt — Tags in Numbered List

**Goal:** Smart retrieval displays tags instead of event_type in memory list.

**Step 1: Write the Failing Test**
- File: `tests/scoring.test.js`
- Action: Find tests that build the smart retrieval numbered list and update mock memories to use `tags`. Verify output contains tag names, not event_type.

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: Fail at smart retrieval formatting

**Step 3: Implementation (Green)**
- File: `src/retrieval/scoring.js`
- Line 256: Replace `const typeTag = \`[\${m.event_type || 'event'}]\`;` with:
  ```js
  const typeTag = `[${(m.tags || ['NONE']).join(', ')}]`;
  ```

- File: `src/prompts.js` — `buildSmartRetrievalPrompt`:
  - Update the examples in the smart retrieval system prompt to use tags instead of `[action]`, `[revelation]`, etc.
  - Replace all `[action]`, `[revelation]`, `[emotion_shift]`, `[relationship_change]` with appropriate tags in the numbered list examples.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: smart retrieval uses tags in memory list display"`

---

## Task 8: Add Asymmetric Embedding Settings to Constants

**Goal:** Add `embeddingQueryPrefix`, `embeddingDocPrefix`, `embeddingTagFormat` to default settings.

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js` (new or existing)
- Code:
  ```js
  import { defaultSettings } from '../src/constants.js';

  describe('asymmetric embedding settings', () => {
      it('has embeddingQueryPrefix', () => {
          expect(defaultSettings.embeddingQueryPrefix).toBe('search for similar scenes: ');
      });
      it('has embeddingDocPrefix', () => {
          expect(defaultSettings.embeddingDocPrefix).toBe('');
      });
      it('has embeddingTagFormat', () => {
          expect(defaultSettings.embeddingTagFormat).toBe('bracket');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: Fail — properties don't exist

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- Add after the `embeddingPrompt` line (around line 42):
  ```js
  embeddingQueryPrefix: 'search for similar scenes: ',  // Asymmetric: query-side prefix
  embeddingDocPrefix: '',                                // Asymmetric: doc-side prefix (tags handle it)
  embeddingTagFormat: 'bracket',                         // Tag format: 'bracket' = [TAG], 'none' = disable
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add asymmetric embedding settings to constants"`

---

## Task 9: Split Embedding Strategy — `getQueryEmbedding()` / `getDocumentEmbedding()`

**Goal:** `TransformersStrategy` and `OllamaStrategy` have asymmetric embedding methods.

**Step 1: Write the Failing Test**
- File: `tests/embeddings/strategies.test.js` (new or existing)
- Code:
  ```js
  describe('TransformersStrategy', () => {
      it('has getQueryEmbedding method', () => {
          expect(typeof strategy.getQueryEmbedding).toBe('function');
      });
      it('has getDocumentEmbedding method', () => {
          expect(typeof strategy.getDocumentEmbedding).toBe('function');
      });
  });

  describe('OllamaStrategy', () => {
      it('has getQueryEmbedding method', () => {
          expect(typeof ollamaStrategy.getQueryEmbedding).toBe('function');
      });
      it('has getDocumentEmbedding method', () => {
          expect(typeof ollamaStrategy.getDocumentEmbedding).toBe('function');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/embeddings/strategies.test.js`
- Expect: Fail — methods don't exist

**Step 3: Implementation (Green)**
- File: `src/embeddings/strategies.js`

  **3a.** Add to `EmbeddingStrategy` base class (after `getEmbedding`):
  ```js
  async getQueryEmbedding(_text) {
      throw new Error('getQueryEmbedding() must be implemented by subclass');
  }

  async getDocumentEmbedding(_text) {
      throw new Error('getDocumentEmbedding() must be implemented by subclass');
  }
  ```

  **3b.** In `TransformersStrategy`, modify `getEmbedding` to accept a type parameter and add convenience methods:
  ```js
  async getEmbedding(text, type = 'query') {
      if (!text || text.trim().length === 0) {
          return null;
      }
      try {
          const pipe = await this.#loadPipeline(this.#currentModelKey);
          const settings = getDeps().getExtensionSettings()[extensionName];

          let prefix = '';
          if (type === 'query') {
              prefix = settings?.embeddingQueryPrefix ?? 'search for similar scenes: ';
          } else if (type === 'doc') {
              prefix = settings?.embeddingDocPrefix ?? '';
          } else {
              // Legacy: use old embeddingPrompt setting
              prefix = settings?.embeddingPrompt || 'task: sentence similarity | query: ';
          }

          const input = prefix ? `${prefix}${text.trim()}` : text.trim();
          const output = await pipe(input, { pooling: 'mean', normalize: true });
          return Array.from(output.data);
      } catch (error) {
          log(`Transformers embedding error: ${error?.message || error || 'unknown'}`);
          return null;
      }
  }

  async getQueryEmbedding(text) {
      return this.getEmbedding(text, 'query');
  }

  async getDocumentEmbedding(text) {
      return this.getEmbedding(text, 'doc');
  }
  ```

  **3c.** In `OllamaStrategy`, add passthrough methods:
  ```js
  async getQueryEmbedding(text) {
      return this.getEmbedding(text);
  }

  async getDocumentEmbedding(text) {
      return this.getEmbedding(text);
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/embeddings/strategies.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add getQueryEmbedding/getDocumentEmbedding to strategies"`

---

## Task 10: Add `formatForEmbedding` Helper + Wire Document Embedding

**Goal:** New events get tag-prefixed text passed to `getDocumentEmbedding()`.

**Step 1: Write the Failing Test**
- File: `tests/embeddings.test.js` (add to existing)
- Code:
  ```js
  import { formatForEmbedding } from '../src/embeddings.js';

  describe('formatForEmbedding', () => {
      it('prepends bracket tags to summary', () => {
          expect(formatForEmbedding('Test summary', ['COMBAT', 'INJURY'], { embeddingTagFormat: 'bracket' }))
              .toBe('[COMBAT] [INJURY] Test summary');
      });

      it('skips NONE tag', () => {
          expect(formatForEmbedding('Test summary', ['NONE'], { embeddingTagFormat: 'bracket' }))
              .toBe('Test summary');
      });

      it('returns plain summary when format is none', () => {
          expect(formatForEmbedding('Test summary', ['COMBAT'], { embeddingTagFormat: 'none' }))
              .toBe('Test summary');
      });

      it('handles missing tags', () => {
          expect(formatForEmbedding('Test summary', null, {}))
              .toBe('Test summary');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/embeddings.test.js`
- Expect: Fail — `formatForEmbedding` not exported

**Step 3: Implementation (Green)**
- File: `src/embeddings.js`

  **3a.** Add `formatForEmbedding` function:
  ```js
  /**
   * Format memory text for document embedding with tag prefix
   * @param {string} summary - Memory summary text
   * @param {string[]|null} tags - Tags from extraction
   * @param {Object} settings - Extension settings
   * @returns {string} Formatted text for embedding
   */
  export function formatForEmbedding(summary, tags, settings) {
      const format = settings?.embeddingTagFormat ?? 'bracket';
      if (format === 'none' || !tags?.length) return summary;

      const tagPrefix = tags
          .filter(t => t !== 'NONE')
          .map(t => `[${t}]`)
          .join(' ');

      return tagPrefix ? `${tagPrefix} ${summary}` : summary;
  }
  ```

  **3b.** Update `enrichEventsWithEmbeddings` to use `formatForEmbedding` and `getDocumentEmbedding`:
  ```js
  export async function enrichEventsWithEmbeddings(events) {
      if (!isEmbeddingsEnabled()) return 0;

      const validEvents = events.filter(e => e.summary && !e.embedding);
      if (validEvents.length === 0) return 0;

      log(`Generating embeddings for ${validEvents.length} events`);

      const settings = getDeps().getExtensionSettings()[extensionName];
      const source = settings?.embeddingSource || 'multilingual-e5-small';
      const strategy = getStrategy(source);

      const embeddings = await processInBatches(validEvents, 5, async (e) => {
          const text = formatForEmbedding(e.summary, e.tags, settings);
          return strategy.getDocumentEmbedding(text);
      });

      let count = 0;
      for (let i = 0; i < validEvents.length; i++) {
          if (embeddings[i]) {
              validEvents[i].embedding = embeddings[i];
              validEvents[i].embedding_tags = validEvents[i].tags || ['NONE'];
              count++;
          }
      }

      return count;
  }
  ```

  **3c.** Update `generateEmbeddingsForMemories` similarly to use `getDocumentEmbedding` and `formatForEmbedding`.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/embeddings.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: tag-prefixed document embeddings via formatForEmbedding"`

---

## Task 11: Wire Query Embedding — Use `getQueryEmbedding` at Retrieval Time

**Goal:** Retrieval uses `getQueryEmbedding()` with the search prefix instead of plain `getEmbedding()`.

**Step 1: Write the Failing Test**
- File: `tests/scoring.test.js`
- Action: Add/update test that verifies the retrieval path calls `getQueryEmbedding`. This may require a spy/mock on the strategy.

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: Fail — still calls `getEmbedding`

**Step 3: Implementation (Green)**
- File: `src/embeddings.js`
- Add a new exported function:
  ```js
  /**
   * Get query embedding (with query prefix applied by strategy)
   * @param {string} text - Query text
   * @returns {Promise<number[]|null>} Embedding vector
   */
  export async function getQueryEmbedding(text) {
      if (!text) return null;

      // Check cache (query prefix is applied inside strategy, so cache on raw text + 'q:' prefix)
      const cacheKey = `q:${text}`;
      if (embeddingCache.has(cacheKey)) {
          const value = embeddingCache.get(cacheKey);
          embeddingCache.delete(cacheKey);
          embeddingCache.set(cacheKey, value);
          return value;
      }

      const settings = getDeps().getExtensionSettings()[extensionName];
      const source = settings?.embeddingSource || 'multilingual-e5-small';
      const strategy = getStrategy(source);
      const result = await strategy.getQueryEmbedding(text);

      if (embeddingCache.size >= MAX_CACHE_SIZE) {
          const firstKey = embeddingCache.keys().next().value;
          if (firstKey !== undefined) embeddingCache.delete(firstKey);
      }
      embeddingCache.set(cacheKey, result);
      return result;
  }
  ```

- File: `src/retrieval/scoring.js`
- In `selectRelevantMemoriesSimple`, change the embedding call:
  ```js
  // OLD:
  // import { getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
  // contextEmbedding = await getEmbedding(embeddingQuery);

  // NEW:
  // import { getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
  contextEmbedding = await getQueryEmbedding(embeddingQuery);
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: retrieval uses getQueryEmbedding with search prefix"`

---

## Task 12: Fix All Remaining Tests

**Goal:** All test files compile and pass with tags instead of event_type.

**Step 1: Identify Failures**
- Command: `npx vitest run`
- Action: Collect all failures related to `event_type` references

**Step 2: Fix Each Test File**
Update mock data in each failing test file:
- `tests/extract.test.js` — mock extraction results: add `tags`, remove `event_type`
- `tests/llm-structured.test.js` — schema test: verify `tags` field
- `tests/extraction/structured.test.js` — parsing tests: use `tags`
- `tests/extraction/stages/llm-executor-structured.test.js` — mock LLM responses: use `tags`
- `tests/integration/structured-extraction.test.js` — integration: use `tags`
- `tests/scoring.test.js` — mock memories: add `tags`, remove `event_type`
- `tests/memory-list.test.js` — mock memories: use `tags`
- `tests/events.test.js` — verify this file uses ST `event_types` (different concept), likely no change needed
- `tests/__mocks__/script.js` — uses ST `event_types`, NOT related, leave untouched

**Step 3: Verify All Pass**
- Command: `npx vitest run`
- Expect: ALL PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "test: update all tests for tags-based schema"`

---

## Task 13: Clean Sweep — Remove All `event_type` References

**Goal:** Zero references to `event_type` in source code (test mocks may retain for ST event system).

**Step 1: Search**
- Command: `grep -r "event_type" src/`
- Expect: Zero matches

**Step 2: Fix Any Remaining**
- Action: Delete any straggling `event_type` references found in source files.

**Step 3: Final Verification**
- Command: `npx vitest run`
- Expect: ALL PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "chore: remove all event_type references from source"`
