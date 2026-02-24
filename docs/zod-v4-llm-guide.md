# Zod v4 + OpenAI-Compatible LLMs: Complete Guide

## Executive Summary

**Key Findings:**
1. **Zod v4 has a native `toJSONSchema()` method** - No external packages needed
2. **OpenAI structured outputs require Draft-7 compatibility** - Use `target: 'draft-7'`
3. **Markdown code block stripping IS required** - LLMs often wrap JSON in ```json blocks
4. **Zod v4 uses 2-argument `z.record()`** - Single-argument form was removed

---

## 1. Complete Workflow for Zod v4 + OpenAI Structured Outputs

### Step 1: Define Your Schema with Zod v4

```typescript
import { z } from 'zod';

// Define your schema
const ExtractSchema = z.object({
  reasoning: z.string().nullable().default(null),
  characters: z.array(
    z.object({
      canonicalName: z.string().min(1),
      variations: z.array(z.string().min(1)),
      gender: z.enum(['male', 'female', 'unknown']),
    })
  ).min(1),
});

// Type inference works automatically
type ExtractResponse = z.infer<typeof ExtractSchema>;
```

### Step 2: Convert Zod Schema to OpenAI Format

```typescript
import { z } from 'zod';

// OpenAI Structured Outputs format
type JSONSchemaFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

/**
 * Convert Zod schema to OpenAI Structured Outputs format
 * Uses Zod 4's native toJSONSchema() method
 */
function zodToJsonSchema<T>(
  schema: z.ZodType<T>,
  schemaName: string
): JSONSchemaFormat {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      strict: true,
      // CRITICAL: Use 'draft-7' target for OpenAI compatibility
      // Default Draft 2020-12 uses keywords like 'prefixItems' that OpenAI doesn't recognize
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}

// Usage
const openaiFormat = zodToJsonSchema(ExtractSchema, 'ExtractSchema');
```

### Step 3: Call OpenAI-Compatible API

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your-api-key',
  baseURL: 'https://api.openai.com/v1', // Or any compatible endpoint
});

async function callStructured<T>({
  prompt,
  schema,
  schemaName,
}: {
  prompt: { system: string; user: string };
  schema: z.ZodType<T>;
  schemaName: string;
}): Promise<T> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini', // or any model supporting structured outputs
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    response_format: zodToJsonSchema(schema, schemaName),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from LLM');
  }

  return parseStructuredResponse(content, schema);
}
```

### Step 4: Parse Response with Markdown Stripping

```typescript
/**
 * Parse JSON content and validate with Zod schema
 * CRITICAL: Strips markdown code blocks automatically
 */
function parseStructuredResponse<T>(
  content: string,
  schema: z.ZodType<T>
): T {
  let jsonContent = content.trim();

  // CRITICAL: Strip markdown code blocks
  // LLMs often wrap responses in ```json or ``` blocks
  const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    jsonContent = fenceMatch[1].trim();
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (error) {
    throw new Error(
      `JSON parse failed: ${(error as Error).message}\nContent: ${jsonContent}`
    );
  }

  // Validate with Zod
  try {
    return schema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Zod validation failed: ${(error as Error).message}`
    );
  }
}
```

---

## 2. Why Markdown Stripping is Necessary

**LLMs frequently wrap JSON responses in markdown code blocks:**

```
Here's the JSON you requested:

```json
{
  "characters": [
    {
      "canonicalName": "Alice",
      "variations": ["Alice", "Al"],
      "gender": "female"
    }
  ]
}
```

I hope this helps!
```

**Without markdown stripping, JSON.parse() will fail:**
```typescript
// This will throw SyntaxError
JSON.parse('```json\n{ "key": "value" }\n```');

// After stripping - works correctly
JSON.parse('{ "key": "value" }');
```

---

## 3. Zod v4 Breaking Changes from v3

### `z.record()` Now Requires 2 Arguments

**Zod v3 (old):**
```typescript
const schema = z.object({
  mappings: z.record(z.string()), // Single argument - inferred
});
```

**Zod v4 (new):**
```typescript
const schema = z.object({
  mappings: z.record(z.string(), z.string()), // Key and value types required
});
```

### Built-in `toJSONSchema()` Method

**Zod v3:**
```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'; // External package
const jsonSchema = zodToJsonSchema(schema);
```

**Zod v4:**
```typescript
// Built-in - no external package needed!
const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
```

---

## 4. Complete Working Example

```typescript
import { z } from 'zod';
import OpenAI from 'openai';

// 1. Define schema
const CharacterSchema = z.object({
  reasoning: z.string().nullable().default(null),
  characters: z.array(
    z.object({
      name: z.string().describe('Character name'),
      age: z.number().int().positive().describe('Character age'),
      gender: z.enum(['male', 'female', 'other']).describe('Character gender'),
      traits: z.array(z.string()).describe('Personality traits'),
    })
  ).min(1).describe('List of characters'),
});

type CharacterResponse = z.infer<typeof CharacterSchema>;

// 2. Convert to OpenAI format
function toOpenAISchema<T>(
  schema: z.ZodType<T>,
  name: string
) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name,
      strict: true,
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}

// 3. Call LLM
async function extractCharacters(text: string): Promise<CharacterResponse> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Extract character information from the given text.',
      },
      {
        role: 'user',
        content: text,
      },
    ],
    response_format: toOpenAISchema(CharacterSchema, 'CharacterExtraction'),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in response');

  // 4. Parse with markdown stripping
  return parseWithMarkdownStrip(content, CharacterSchema);
}

// 5. Parse with markdown stripping
function parseWithMarkdownStrip<T>(
  content: string,
  schema: z.ZodType<T>
): T {
  let jsonContent = content.trim();

  // Strip ```json or ``` code blocks
  const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    jsonContent = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonContent);
  return schema.parse(parsed);
}

// Usage
const result = await extractCharacters(`
  Alice is a 25-year-old woman who is brave and curious.
  Bob is a 30-year-old man who is cautious and analytical.
`);

console.log(result.characters);
// [
//   { name: 'Alice', age: 25, gender: 'female', traits: ['brave', 'curious'] },
//   { name: 'Bob', age: 30, gender: 'male', traits: ['cautious', 'analytical'] }
// ]
```

---

## 5. Best Practices

### 5.1 Always Use `.default()` for Nullable Fields

OpenAI structured outputs may omit nullable fields entirely:

```typescript
// Good - provides default when omitted
const schema = z.object({
  reasoning: z.string().nullable().default(null),
});

// Bad - may cause validation errors when field is omitted
const schema = z.object({
  reasoning: z.string().nullable(),
});
```

### 5.2 Use `.describe()` for Better LLM Understanding

```typescript
const schema = z.object({
  // The description helps the LLM understand what to generate
  summary: z.string().describe('A brief 2-3 sentence summary'),
  sentiment: z.enum(['positive', 'negative', 'neutral'])
    .describe('Overall emotional tone of the text'),
});
```

### 5.3 Handle Errors Gracefully

```typescript
function safeParseLLMResponse<T>(
  content: string,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = parseWithMarkdownStrip(content, schema);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### 5.4 Use Retry Logic for API Calls

```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## 6. Summary: The Complete Workflow

```
1. Define Zod Schema → z.object({...})
                      ↓
2. Convert to OpenAI Format → z.toJSONSchema(schema, { target: 'draft-7' })
                      ↓
3. Call LLM API → client.chat.completions.create({...})
                      ↓
4. Get Response → response.choices[0].message.content
                      ↓
5. Strip Markdown → Remove ```json code blocks if present
                      ↓
6. Parse JSON → JSON.parse(content)
                      ↓
7. Validate → schema.parse(parsed)
                      ↓
8. Get Typed Result → Type-safe T
```

---

## Key Takeaways

1. **Zod v4 has built-in `toJSONSchema()`** - No external packages needed
2. **Always use `target: 'draft-7'`** for OpenAI compatibility
3. **Markdown stripping is essential** - LLMs wrap JSON in code blocks
4. **`z.record()` requires 2 arguments** in Zod v4
5. **Use `.default()` for nullable fields** to handle OpenAI omissions
6. **`.describe()` helps LLMs** understand what to generate

---

## Sources

- [Zod v4 Documentation](https://zod.dev)
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [zod-to-json-schema Library](https://github.com/StefanTerdell/zod-to-json-schema)
