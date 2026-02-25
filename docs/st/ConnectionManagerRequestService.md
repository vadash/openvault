TL;DR: `ConnectionManagerRequestService` is a relatively new ST service (introduced ~1.15.0 via PR #4841) for making LLM requests through named Connection Profiles from extensions. Its `sendRequest` API is not yet formally documented, but structured output support follows the same `jsonSchema` object pattern as `generateRaw()`. Zod is compatible for schema generation only — ST does not natively integrate Zod.

***

## `ConnectionManagerRequestService` Overview

`ConnectionManagerRequestService` was added to facilitate extension use of Connection Profiles for LLM requests — allowing an extension to send a generation request through a *specific* named profile rather than only the currently active global API. It is exposed via `SillyTavern.getContext()`, consistent with ST's stable context API pattern.

The service is not yet covered by official dedicated documentation. The most authoritative source remains the source file at `public/scripts/connection-manager.js` in the [SillyTavern repo](pplx://action/navigate/28310a5d2b3d7ff4).

***

## `sendRequest` Parameters (Inferred)

No official parameter table exists in public docs as of February 2026. Based on the PR context and how ST's generation pipeline works, `sendRequest` accepts an options object broadly similar to `generateRaw()`. The following are the likely/confirmed parameters:

| Parameter | Type | Notes |
|---|---|---|
| `prompt` | `string \| ChatMessage[]` | Text or chat-format messages |
| `systemPrompt` | `string` | Optional system instruction |
| `prefill` | `string` | Optional assistant prefill |
| `jsonSchema` | `object` | Structured output schema (see below) |
| `profileId` / `profileName` | `string` | The connection profile to use |
| `signal` | `AbortSignal` | Optional cancellation |

**Always verify current parameters against source** — this service is under active development.

***

## Structured Output Support

ST's structured output support is **Chat Completion API only**, and availability depends on the underlying model/provider. The `jsonSchema` object shape passed to generation functions is:

```js
const jsonSchema = {
  name: 'MySchema',         // Required: schema identifier
  description: '...',       // Optional
  strict: true,             // Optional: enables strict mode (no extra fields)
  value: {                  // Required: JSON Schema Draft-04 definition
    '$schema': 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {
      field1: { type: 'string' },
      field2: { type: 'number' },
    },
    required: ['field1', 'field2'],
  },
};
```

This same object is passed to `generateRaw()`, `generateQuietPrompt()`, and by extension `sendRequest()` via the `jsonSchema` key.

***

## Zod Compatibility

**ST does not natively support Zod.** The official docs explicitly acknowledge Zod as a tool for *generating and validating* JSON schemas but state its use is out of scope. The practical integration pattern is:

```js
import { z } from 'zod'; // via your extension bundle
import { zodToJsonSchema } from 'zod-to-json-schema';

const MySchema = z.object({
  location: z.string(),
  plans: z.string(),
});

const jsonSchema = {
  name: 'MySchema',
  strict: true,
  value: zodToJsonSchema(MySchema, { target: 'jsonSchema4' }),
};
```

Then pass `jsonSchema` to `sendRequest()` / `generateRaw()`. **ST returns a raw stringified JSON string — you must call `JSON.parse()` and validate it yourself** (e.g., with `MySchema.safeParse()`), since ST does not validate outputs against the schema.

***

## Key Limitations

- Structured outputs **fail silently** — on unsupported models, ST returns `'{}'` rather than throwing
- `strict: true` maps to OpenAI-style strict mode; not all backends honor it
- Text Completion APIs do not support structured outputs at all
- `ConnectionManagerRequestService` source is the ground truth: `public/scripts/connection-manager.js` on the `release` branch