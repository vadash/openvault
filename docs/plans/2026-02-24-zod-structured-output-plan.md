# Implementation Plan - Zod v4 Structured Outputs

> **Reference:** `docs/designs/2026-02-24-zod-structured-output-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

Add Zod v4 schema validation and structured output support to reduce LLM JSON hallucinations.

---

## Task 1: Create Zod Schema Module

**Goal:** Define Zod schemas for memory extraction events.

### Step 1: Write the Failing Test
- File: `tests/extraction/schemas/event-schema.test.js`
- Code:
  ```javascript
  import { describe, it, expect } from 'vitest';
  import {
      EventSchema,
      ExtractionResponseSchema,
  } from '../../src/extraction/schemas/event-schema.js';

  describe('EventSchema', () => {
      it('validates a correct event object', () => {
          const result = EventSchema.safeParse({
              summary: 'Alice smiled at Bob',
              importance: 3,
              characters_involved: ['Alice', 'Bob'],
          });
          expect(result.success).toBe(true);
      });

      it('rejects missing summary', () => {
          const result = EventSchema.safeParse({
              importance: 3,
              characters_involved: ['Alice'],
          });
          expect(result.success).toBe(false);
      });

      it('rejects importance outside 1-5 range', () => {
          const result = EventSchema.safeParse({
              summary: 'Test',
              importance: 10,
              characters_involved: ['Alice'],
          });
          expect(result.success).toBe(false);
      });

      it('applies defaults for optional fields', () => {
          const result = EventSchema.safeParse({
              summary: 'Test',
              importance: 3,
              characters_involved: [],
          });
          if (result.success) {
              expect(result.data.witnesses).toEqual([]);
              expect(result.data.location).toBe(null);
              expect(result.data.is_secret).toBe(false);
          } else {
              throw new Error('Should succeed with defaults');
          }
      });

      it('accepts full event with all fields', () => {
          const result = EventSchema.safeParse({
              summary: 'Full event',
              importance: 4,
              characters_involved: ['Alice'],
              witnesses: ['Bob'],
              location: 'garden',
              is_secret: true,
              emotional_impact: { Alice: 'happy' },
              relationship_impact: {
                  'Alice-Bob': { change: 'improved', new_dynamic: 'friends' }
              },
          });
          expect(result.success).toBe(true);
      });
  });

  describe('ExtractionResponseSchema', () => {
      it('validates response with events array', () => {
          const result = ExtractionResponseSchema.safeParse({
              events: [
                  { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
              ],
              reasoning: 'Because something happened',
          });
          expect(result.success).toBe(true);
      });

      it('allows null reasoning', () => {
          const result = ExtractionResponseSchema.safeParse({
              events: [
                  { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
              ],
              reasoning: null,
          });
          expect(result.success).toBe(true);
      });

      it('requires at least one event', () => {
          const result = ExtractionResponseSchema.safeParse({
              events: [],
          });
          expect(result.success).toBe(false);
      });
  });
  ```

### Step 2: Run Test (Red)
- Command: `node scripts/test.js tests/extraction/schemas/event-schema.test.js`
- Expect: "Error: Cannot find module 'src/extraction/schemas/event-schema.js'"

### Step 3: Implementation (Green)
- File: `src/extraction/schemas/event-schema.js`
- Action: Create directory and file with exact code:
  ```javascript
  import { z } from 'https://esm.sh/zod@4';

  /**
   * Schema for relationship impact between characters
   */
  export const RelationshipImpactSchema = z.record(
      z.string(),
      z.object({
          change: z.enum(['improved', 'worsened', 'unchanged']),
          new_dynamic: z.string().optional(),
      })
  );

  /**
   * Schema for a single memory event
   */
  export const EventSchema = z.object({
      summary: z.string().min(1, 'Summary is required'),
      importance: z.number().int().min(1).max(5).default(3),
      characters_involved: z.array(z.string()).default([]),
      witnesses: z.array(z.string()).default([]),
      location: z.string().nullable().default(null),
      is_secret: z.boolean().default(false),
      emotional_impact: z.record(z.string(), z.string()).optional().default({}),
      relationship_impact: RelationshipImpactSchema.optional().default({}),
  });

  /**
   * Schema for the full extraction response from LLM
   */
  export const ExtractionResponseSchema = z.object({
      events: z.array(EventSchema).min(1, 'At least one event is required'),
      reasoning: z.string().nullable().default(null),
  });
  ```

### Step 4: Verify (Green)
- Command: `node scripts/test.js tests/extraction/schemas/event-schema.test.js`
- Expect: All tests PASS

### Step 5: Git Commit
- Command: `git add . && git commit -m "feat: add Zod schema definitions for event extraction"`

---

## Task 2: Create Structured Parser Module

**Goal:** Build JSON Schema converter and markdown-stripping parser.

### Step 1: Write the Failing Test
- File: `tests/extraction/structured.test.js`
- Code:
  ```javascript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import {
      getExtractionJsonSchema,
      parseExtractionResponse,
      parseEvent,
  } from '../../src/extraction/structured.js';

  describe('getExtractionJsonSchema', () => {
      it('returns ConnectionManager-compatible jsonSchema', () => {
          const schema = getExtractionJsonSchema();

          expect(schema).toMatchObject({
              name: 'MemoryExtraction',
              strict: true,
              value: expect.any(Object),
          });

          expect(schema.value).toHaveProperty('type', 'object');
          expect(schema.value).toHaveProperty('properties');
          expect(schema.value.properties).toHaveProperty('events');
      });

      it('generates valid JSON Schema Draft-04 structure', () => {
          const schema = getExtractionJsonSchema();

          // Check required fields exist in events property
          const eventsProp = schema.value.properties.events;
          expect(eventsProp).toHaveProperty('type', 'array');

          // Check that items schema has properties
          expect(eventsProp.items).toHaveProperty('type', 'object');
          expect(eventsProp.items).toHaveProperty('properties');
      });
  });

  describe('parseExtractionResponse', () => {
      it('parses valid JSON response', () => {
          const json = JSON.stringify({
              events: [
                  { summary: 'Test event', importance: 3, characters_involved: ['Alice'] }
              ],
              reasoning: null,
          });

          const result = parseExtractionResponse(json);
          expect(result.events).toHaveLength(1);
          expect(result.events[0].summary).toBe('Test event');
      });

      it('strips markdown code blocks', () => {
          const content = '```json\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```';
          const result = parseExtractionResponse(content);
          expect(result.events).toHaveLength(1);
          expect(result.events[0].summary).toBe('Test');
      });

      it('strips markdown without json language tag', () => {
          const content = '```\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```';
          const result = parseExtractionResponse(content);
          expect(result.events).toHaveLength(1);
      });

      it('throws on invalid JSON', () => {
          expect(() => parseExtractionResponse('not json')).toThrow('JSON parse failed');
      });

      it('throws on schema validation failure', () => {
          const invalid = JSON.stringify({
              events: [
                  { importance: 3, characters_involved: [] } // missing summary
              ]
          });
          expect(() => parseExtractionResponse(invalid)).toThrow('Schema validation failed');
      });

      it('applies defaults from schema', () => {
          const minimal = JSON.stringify({
              events: [
                  { summary: 'Test' }
              ]
          });
          const result = parseExtractionResponse(minimal);
          expect(result.events[0].importance).toBe(3);
          expect(result.events[0].witnesses).toEqual([]);
          expect(result.events[0].location).toBe(null);
      });
  });

  describe('parseEvent', () => {
      it('parses single event without wrapper', () => {
          const json = JSON.stringify({
              summary: 'Single event',
              importance: 4,
              characters_involved: ['Bob'],
          });

          const result = parseEvent(json);
          expect(result.summary).toBe('Single event');
      });

      it('strips markdown for single event', () => {
          const content = '```json\n{"summary": "Event", "importance": 3, "characters_involved": []}\n```';
          const result = parseEvent(content);
          expect(result.summary).toBe('Event');
      });
  });
  ```

### Step 2: Run Test (Red)
- Command: `node scripts/test.js tests/extraction/structured.test.js`
- Expect: "Error: Cannot find module 'src/extraction/structured.js'"

### Step 3: Implementation (Green)
- File: `src/extraction/structured.js`
- Action: Create file with exact code:
  ```javascript
  import { z } from 'https://esm.sh/zod@4';
  import { ExtractionResponseSchema, EventSchema } from './schemas/event-schema.js';

  /**
   * Convert Zod schema to ConnectionManager jsonSchema format
   * Uses Zod v4's native toJSONSchema with jsonSchema4 target
   *
   * @param {z.ZodType} zodSchema - The Zod schema to convert
   * @param {string} schemaName - Name for the JSON schema
   * @returns {Object} ConnectionManager-compatible jsonSchema object
   */
  function toJsonSchema(zodSchema, schemaName) {
      const draft = z.toJSONSchema(zodSchema, { target: 'jsonSchema4' });

      return {
          name: schemaName,
          strict: true,
          value: draft,
      };
  }

  /**
   * Strip markdown code blocks from content
   * Handles both ```json and ``` variants
   *
   * @param {string} content - Content that may contain markdown
   * @returns {string} Content with markdown stripped
   */
  function stripMarkdown(content) {
      const trimmed = content.trim();
      const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return fenceMatch ? fenceMatch[1].trim() : trimmed;
  }

  /**
   * Parse LLM response with markdown stripping and Zod validation
   *
   * @param {string} content - Raw LLM response
   * @param {z.ZodType} schema - Zod schema to validate against
   * @returns {Object} Validated parsed data
   * @throws {Error} If JSON parsing or validation fails
   */
  function parseStructuredResponse(content, schema) {
      let jsonContent = stripMarkdown(content);

      let parsed;
      try {
          parsed = JSON.parse(jsonContent);
      } catch (e) {
          throw new Error(`JSON parse failed: ${e.message}`);
      }

      const result = schema.safeParse(parsed);
      if (!result.success) {
          throw new Error(`Schema validation failed: ${result.error.message}`);
      }

      return result.data;
  }

  /**
   * Get jsonSchema for ConnectionManager sendRequest
   * For use in structured output mode
   *
   * @returns {Object} ConnectionManager jsonSchema object
   */
  export function getExtractionJsonSchema() {
      return toJsonSchema(ExtractionResponseSchema, 'MemoryExtraction');
  }

  /**
   * Parse extraction response with full validation
   *
   * @param {string} content - Raw LLM response
   * @returns {Object} Validated extraction response
   */
  export function parseExtractionResponse(content) {
      return parseStructuredResponse(content, ExtractionResponseSchema);
  }

  /**
   * Parse single event (for backfill/retry scenarios)
   *
   * @param {string} content - Raw LLM response for single event
   * @returns {Object} Validated event object
   */
  export function parseEvent(content) {
      return parseStructuredResponse(content, EventSchema);
  }

  /**
   * Strip markdown from content (exported for testing)
   * @param {string} content
   * @returns {string}
   */
  export function _testStripMarkdown(content) {
      return stripMarkdown(content);
  }
  ```

### Step 4: Verify (Green)
- Command: `node scripts/test.js tests/extraction/structured.test.js`
- Expect: All tests PASS

### Step 5: Git Commit
- Command: `git add . && git commit -m "feat: add structured parser with markdown stripping and Zod validation"`

---

## Task 3: Modify llm.js to Support Structured Output

**Goal:** Pass jsonSchema to ConnectionManager's 5th parameter.

### Step 1: Write the Failing Test
- File: `tests/llm-structured.test.js`
- Code:
  ```javascript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { setDeps, resetDeps } from '../src/deps.js';
  import { extensionName } from '../src/constants.js';
  import { callLLMForExtraction } from '../src/llm.js';

  describe('callLLMForExtraction with structured output', () => {
      let mockConnectionManager;

      beforeEach(() => {
          mockConnectionManager = {
              sendRequest: vi.fn().mockResolvedValue({ content: '{"events": [], "reasoning": null}' }),
          };

          setDeps({
              connectionManager: mockConnectionManager,
              getExtensionSettings: () => ({
                  [extensionName]: { extractionProfile: 'test-profile' },
                  connectionManager: {
                      profiles: [{ id: 'test-profile', name: 'Test Profile' }],
                      selectedProfile: 'test-profile',
                  },
              }),
              getContext: () => ({
                  parseReasoningFromString: null,
              }),
          });
      });

      afterEach(() => {
          resetDeps();
      });

      it('passes jsonSchema when structured option is true', async () => {
          await callLLMForExtraction('test prompt', { structured: true });

          const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
          expect(callArgs[4]).toHaveProperty('jsonSchema');
          expect(callArgs[4].jsonSchema).toMatchObject({
              name: 'MemoryExtraction',
              strict: true,
          });
      });

      it('does not pass jsonSchema when structured option is false', async () => {
          await callLLMForExtraction('test prompt', { structured: false });

          const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
          expect(callArgs[4]).toEqual({});
      });

      it('does not pass jsonSchema when structured option is omitted', async () => {
          await callLLMForExtraction('test prompt');

          const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
          expect(callArgs[4]).toEqual({});
      });

      it('jsonSchema contains valid structure', async () => {
          await callLLMForExtraction('test prompt', { structured: true });

          const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
          const jsonSchema = callArgs[4].jsonSchema;

          expect(jsonSchema.value).toHaveProperty('type');
          expect(jsonSchema.value).toHaveProperty('properties');
          expect(jsonSchema.value.properties).toHaveProperty('events');
      });
  });
  ```

### Step 2: Run Test (Red)
- Command: `node scripts/test.js tests/llm-structured.test.js`
- Expect: Tests FAIL - jsonSchema not passed

### Step 3: Implementation (Green)
- File: `src/llm.js`
- Action: Modify file:

  1. Add import at top:
     ```javascript
     import { getExtractionJsonSchema } from './extraction/structured.js';
     ```

  2. Modify `callLLM` function to accept options parameter:
     ```javascript
     export async function callLLM(prompt, config, options = {}) {
         const { profileSettingKey, maxTokens, errorContext } = config;
         // ... existing code ...

         const jsonSchema = options.structured ? getExtractionJsonSchema() : undefined;

         const result = await deps.connectionManager.sendRequest(
             profileId,
             messages,
             maxTokens,
             {
                 includePreset: true,
                 includeInstruct: true,
                 stream: false
             },
             jsonSchema ? { jsonSchema } : {}  // 5th parameter
         );

         // ... rest of existing code ...
     }
     ```

  3. Modify `callLLMForExtraction` to pass options:
     ```javascript
     export function callLLMForExtraction(prompt, options = {}) {
         return callLLM(prompt, LLM_CONFIGS.extraction, options);
     }

     export function callLLMForRetrieval(prompt, options = {}) {
         return callLLM(prompt, LLM_CONFIGS.retrieval, options);
     }
     ```

### Step 4: Verify (Green)
- Command: `node scripts/test.js tests/llm-structured.test.js`
- Expect: All tests PASS

### Step 5: Git Commit
- Command: `git add . && git commit -m "feat: add structured output support to LLM calls"`

---

## Task 4: Update llm-executor.js to Use Structured Parsing

**Goal:** Replace safeParseJSON with Zod-validated parseExtractionResponse.

### Step 1: Write the Failing Test
- File: `tests/extraction/stages/llm-executor-structured.test.js`
- Code:
  ```javascript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { setDeps, resetDeps } from '../../../src/deps.js';
  import { extensionName, MEMORIES_KEY } from '../../../src/constants.js';
  import { executeLLM } from '../../../src/extraction/stages/llm-executor.js';
  import { generateId } from '../../../src/utils.js';

  // Mock generateId for deterministic tests
  vi.mock('../../../src/utils.js', () => ({
      generateId: vi.fn(() => 'test-id-123'),
  }));

  describe('executeLLM with structured parsing', () => {
      let mockData;
      let mockContext;

      beforeEach(() => {
          mockData = { [MEMORIES_KEY]: [] };
          mockContext = {
              name2: 'Alice',
              name1: 'User',
          };

          setDeps({
              getContext: () => mockContext,
              console: {
                  log: vi.fn(),
                  warn: vi.fn(),
                  error: vi.fn(),
              },
              getExtensionSettings: () => ({
                  [extensionName]: { enabled: true },
              }),
          });

          // Mock callLLMForExtraction
          vi.doMock('../../../src/llm.js', () => ({
              callLLMForExtraction: vi.fn(),
          }));
      });

      afterEach(() => {
          resetDeps();
          vi.doUnmock('../../../src/llm.js');
      });

      it('uses structured output mode', async () => {
          const { callLLMForExtraction } = await import('../../../src/llm.js');

          callLLMForExtraction.mockResolvedValue(
              JSON.stringify({
                  events: [
                      {
                          summary: 'Alice greeted Bob',
                          importance: 3,
                          characters_involved: ['Alice', 'Bob'],
                      }
                  ],
                  reasoning: null,
              })
          );

          const messages = [
              { id: 1, mes: 'Hello Bob!' },
              { id: 2, mes: 'Hi Alice!' },
          ];

          const events = await executeLLM('test prompt', messages, mockContext, 'batch-1', mockData);

          // Verify structured mode was used
          expect(callLLMForExtraction).toHaveBeenCalledWith(
              'test prompt',
              { structured: true }
          );

          // Verify parsed events
          expect(events).toHaveLength(1);
          expect(events[0].summary).toBe('Alice greeted Bob');
          expect(events[0].characters_involved).toEqual(['Alice', 'Bob']);
      });

      it('handles validation errors gracefully', async () => {
          const { callLLMForExtraction } = await import('../../../src/llm.js');

          // Return invalid JSON (missing required field)
          callLLMForExtraction.mockResolvedValue(
              JSON.stringify({
                  events: [
                      { importance: 3 }  // missing summary
                  ]
              })
          );

          const messages = [{ id: 1, mes: 'test' }];

          await expect(
              executeLLM('test', messages, mockContext, 'batch-1', mockData)
          ).rejects.toThrow('Schema validation failed');
      });
  });
  ```

### Step 2: Run Test (Red)
- Command: `node scripts/test.js tests/extraction/stages/llm-executor-structured.test.js`
- Expect: Tests FAIL - structured mode not used

### Step 3: Implementation (Green)
- File: `src/extraction/stages/llm-executor.js`
- Action: Modify file:

  1. Replace import:
     ```javascript
     import { callLLMForExtraction } from '../../llm.js';
     import { parseExtractionResponse } from '../structured.js';
     import { parseExtractionResult } from '../parser.js';
     ```

  2. Modify `executeLLM` function:
     ```javascript
     export async function executeLLM(prompt, messages, context, batchId, data) {
         // Call LLM with structured output enabled
         const extractedJson = await callLLMForExtraction(prompt, { structured: true });

         let events;
         try {
             // Parse with Zod validation
             const validated = parseExtractionResponse(extractedJson);
             events = validated.events;
         } catch (error) {
             // Fallback to old parser if validation fails
             console.warn('[OpenVault] Structured validation failed, falling back to legacy parser:', error.message);
             const characterName = context.name2;
             const userName = context.name1;
             events = parseExtractionResult(extractedJson, messages, characterName, userName, batchId);

             // Return early since parseExtractionResult already handles enrichment
             const processedIds = messages.map(m => m.id);
             data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
             data[PROCESSED_MESSAGES_KEY].push(...processedIds);
             return events;
         }

         // ... rest of existing enrichment code ...
         const characterName = context.name2;
         const userName = context.name1;

         const enrichedEvents = events.map((event, index) => ({
             // ... existing enrichment logic ...
         }));

         // ... existing processed IDs tracking ...
         return enrichedEvents;
     }
     ```

### Step 4: Verify (Green)
- Command: `node scripts/test.js tests/extraction/stages/llm-executor-structured.test.js`
- Expect: All tests PASS

### Step 5: Git Commit
- Command: `git add . && git commit -m "feat: use structured parsing in llm-executor with fallback"`

---

## Task 5: Update Mocks and Test Utilities

**Goal:** Ensure tests work with new Zod imports and structured mode.

### Step 1: Verify Existing Tests
- Command: `node scripts/test.js`
- Expect: All tests PASS

### Step 2: Fix Any Breaking Changes
- Action: If any tests fail due to import changes or mock updates, fix them:
  - Update `tests/__mocks__/shared.js` if needed for ConnectionManager
  - Update test imports to point to new structured module

### Step 3: Git Commit
- Command: `git add . && git commit -m "test: update mocks and fix tests for structured output"`

---

## Task 6: Add End-to-End Integration Test

**Goal:** Verify full extraction pipeline works with structured output.

### Step 1: Write the Integration Test
- File: `tests/integration/structured-extraction.test.js`
- Code:
  ```javascript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { setDeps, resetDeps } from '../../src/deps.js';
  import { extensionName } from '../../src/constants.js';
  import { extractMemories } from '../../src/extraction/extract.js';

  describe('Structured extraction integration', () => {
      beforeEach(() => {
          setDeps({
              getContext: () => ({
                  name2: 'Alice',
                  name1: 'User',
                  chat: [
                      { id: 1, mes: 'Hello Alice!', name: 'User' },
                      { id: 2, mes: 'Hi there!', name: 'Alice' },
                  ],
              }),
              connectionManager: {
                  sendRequest: vi.fn().mockResolvedValue({
                      content: JSON.stringify({
                          events: [
                              {
                                  summary: 'User greeted Alice',
                                  importance: 2,
                                  characters_involved: ['User', 'Alice'],
                                  witnesses: ['Alice'],
                              }
                          ],
                          reasoning: 'Initial greeting established',
                      })
                  }),
              },
              getExtensionSettings: () => ({
                  [extensionName]: {
                      enabled: true,
                      extractionProfile: 'test-profile',
                  },
                  connectionManager: {
                      profiles: [{ id: 'test-profile' }],
                  },
              }),
              console: {
                  log: vi.fn(),
                  warn: vi.fn(),
                  error: vi.fn(),
              },
          });
      });

      afterEach(() => {
          resetDeps();
      });

      it('extracts memories using structured output', async () => {
          const result = await extractMemories();

          expect(result.status).toBe('success');
          expect(result.events_created).toBe(1);
      });

      it('handles markdown-wrapped responses', async () => {
          const { connectionManager } = await import('../../src/deps.js').then(m => m.getDeps());

          connectionManager.sendRequest.mockResolvedValue({
              content: '```json\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```'
          });

          const result = await extractMemories();
          expect(result.status).toBe('success');
      });
  });
  ```

### Step 2: Run Test (Red then Green)
- Command: `node scripts/test.js tests/integration/structured-extraction.test.js`
- Expect: PASS

### Step 3: Git Commit
- Command: `git add . && git commit -m "test: add integration test for structured extraction"`

---

## Task 7: Documentation

**Goal:** Document usage and requirements.

### Step 1: Update README
- File: `README.md`
- Action: Add section:
  ```markdown
  ## Structured Output

  OpenVault uses Zod v4 schemas for validated LLM responses. This reduces JSON hallucinations
  by sending a JSON Schema to compatible models (OpenAI, some others).

  ### Requirements

  - Zod v4 is loaded via CDN (esm.sh) - no build step required
  - Works with any LLM provider that supports OpenAI-style structured outputs
  - Automatically falls back to unstructured parsing for unsupported models

  ### Disabling Structured Output

  If you encounter issues with structured output, set `structured: false` in the extraction call.
  ```

### Step 2: Git Commit
- Command: `git add README.md && git commit -m "docs: document structured output feature"`

---

## Task 8: Verify All Tests Pass

### Step 1: Run Full Test Suite
- Command: `node scripts/test.js`

### Step 2: Verify Output
- Expect: All tests PASS, no failures

### Step 3: Git Commit
- Command: `git add . && git commit -m "test: all tests passing with structured output"`

---

## Completion Checklist

- [ ] Task 1: Zod schema module created
- [ ] Task 2: Structured parser module created
- [ ] Task 3: llm.js modified to pass jsonSchema
- [ ] Task 4: llm-executor.js uses structured parsing
- [ ] Task 5: Tests updated and passing
- [ ] Task 6: Integration test passing
- [ ] Task 7: Documentation updated
- [ ] Task 8: All tests passing

## Rollback Plan

If structured output causes issues:
1. Set `structured: false` in `llm-executor.js` call to `callLLMForExtraction`
2. Parser will automatically fall back to legacy `safeParseJSON` path
