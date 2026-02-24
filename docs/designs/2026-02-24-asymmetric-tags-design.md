# Design: Asymmetric Embedding Prompts + Tag Taxonomy

## 1. Problem Statement

The BM25 alpha-blend scoring is fully implemented. What remains:

1. **No embedding asymmetry**: `getEmbedding(text)` uses a single prefix for both queries and documents. EmbeddingGemma-300M is an asymmetric model — benchmarks show symmetric prompts cause vector collapse and negative separation.
2. **No content tags**: Memories lack categorical metadata. Without tags, document embeddings have no structural signal to separate "combat scene" from "domestic scene" when the text alone is ambiguous.
3. **`event_type` is overloaded**: The 4-value enum (`action`, `revelation`, `emotion_shift`, `relationship_change`) conflates narrative function with content category. It's too coarse for embedding separation and adds LLM cognitive load without proportional value.

## 2. Goals & Non-Goals

### Must do
- Remove `event_type` from schema and all code paths (clean break, no migration)
- Add `tags` field to extraction schema (~30 content tags)
- Split `getEmbedding()` into `getQueryEmbedding()` and `getDocumentEmbedding()`
- Format document embeddings as `[TAG1] [TAG2] {summary}`
- Format query embeddings with search prefix
- Tags assigned by extraction LLM (not regex)
- Update all prompt examples to use `tags` instead of `event_type`

### Won't do
- Backward compatibility with old `event_type` field (user regenerates)
- Migration scripts for existing memories
- User-defined custom tags (fixed taxonomy for now)
- Regex-based auto-tagger

## 3. Tag Taxonomy (~30 Tags)

### 3a. Intimate (6 tags)

| Tag | Description | Anchor words |
|-----|-------------|-------------|
| `EXPLICIT` | Sexual acts, orgasms, anatomy | минет, куннилингус, оргазм, сперма, blowjob, フェラチオ |
| `BDSM` | Power exchange, bondage, pain play, D/s | верёвка, стоп-слово, шлёпать, приказ, collar, 縛り |
| `FETISH` | Specific kinks not covered by BDSM (feet, roleplay, voyeurism, exhibitionism) | фут-фетиш, подглядывание, костюм |
| `ROMANCE` | Affection without explicit sex — hugs, kisses, hand-holding, dates | объятия, поцелуй, свидание, hug, デート |
| `FLIRTING` | Light teasing, playful banter, suggestive hints | подмигнуть, дразнить, намёк, tease, wink |
| `SEDUCTION` | Deliberate sexual pursuit, building tension toward intimacy | соблазнить, раздеваться, шёпот, undress, 誘惑 |

### 3b. Conflict (5 tags)

| Tag | Description | Anchor words |
|-----|-------------|-------------|
| `COMBAT` | Fighting, violence, battle scenes | битва, удар, кровь, атаковать, sword, 戦い |
| `THREAT` | Intimidation, danger, warnings, menace | угроза, опасность, предупреждение, danger |
| `INJURY` | Wounds, pain, medical treatment, recovery | рана, кровотечение, бинт, перелом, wound |
| `BETRAYAL` | Broken trust, deception revealed, backstabbing | предательство, обман, ложь, betrayal |
| `HORROR` | Fear, dread, creepy/disturbing non-sexual content | ужас, кошмар, труп, жуть, nightmare |

### 3c. Slice-of-Life (6 tags)

| Tag | Description | Anchor words |
|-----|-------------|-------------|
| `DOMESTIC` | Daily routines, chores, home life | кухня, уборка, сон, утро, breakfast, 朝食 |
| `SOCIAL` | Conversations, meetings, parties, group dynamics | разговор, вечеринка, гости, знакомство, party |
| `TRAVEL` | Journeys, exploration, arriving at new places | путешествие, дорога, карта, прибытие, journey |
| `COMMERCE` | Shopping, trade, money, transactions | магазин, покупка, деньги, торговля, shop |
| `FOOD` | Meals, cooking, drinking, restaurants | ужин, готовить, рецепт, ресторан, dinner |
| `CELEBRATION` | Festivities, achievements, victories, gifts | праздник, подарок, победа, тост, gift |

### 3d. Character (7 tags)

| Tag | Description | Anchor words |
|-----|-------------|-------------|
| `LORE` | Backstory, world history, family history | детство, родители, история, прошлое, childhood |
| `SECRET` | Hidden information revealed, confessions | тайна, признание, скрывать, секрет, confession |
| `TRAUMA` | Past pain, psychological wounds, triggers | страх, нищета, насилие, кошмар, abuse |
| `GROWTH` | Character development, learning, overcoming | научиться, преодолеть, понять, впервые, overcome |
| `EMOTION` | Strong emotional moments, crying, rage, joy | слёзы, ярость, счастье, тоска, tears |
| `BONDING` | Trust-building, getting closer, vulnerability | доверие, близость, открыться, защитить, trust |
| `REUNION` | Meeting again after separation, recognition | встреча, узнать, вернуться, разлука, reunion |

### 3e. World/Adventure (6 tags)

| Tag | Description | Anchor words |
|-----|-------------|-------------|
| `MYSTERY` | Investigations, puzzles, unknown elements | загадка, расследование, улика, подозрение, clue |
| `MAGIC` | Supernatural powers, spells, enchantments | заклинание, магия, портал, проклятие, spell |
| `STEALTH` | Sneaking, espionage, disguises, deception ops | тайком, маскировка, шпион, прятаться, sneak |
| `POLITICAL` | Politics, factions, alliances, power plays | власть, альянс, фракция, переговоры, alliance |
| `HUMOR` | Comedy, jokes, absurd situations, pranks | шутка, смех, розыгрыш, абсурд, prank |
| `CRAFTING` | Building, creating, forging, inventing | ковать, строить, изобретать, мастерить, forge |

### 3f. Fallback

| Tag | Description |
|-----|-------------|
| `NONE` | Default when nothing else applies. Standalone only — never combine with other tags. |

**Total: 31 tags** (30 content + NONE fallback)

**Rules:**
- Assign 1–3 tags per memory
- Multiple tags allowed when content overlaps (e.g., `["BDSM", "EXPLICIT"]`)
- `NONE` is used alone, never combined
- Prefer specific over general (e.g., `SEDUCTION` over `ROMANCE` when deliberate pursuit)

## 4. Schema Changes

### 4a. Remove `event_type`, Add `tags`

```js
// OLD (remove entirely)
const EventTypeEnum = z.enum(['action', 'revelation', 'emotion_shift', 'relationship_change']);

// NEW
const TagEnum = z.enum([
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

const EventSchema = z.object({
    // event_type: REMOVED
    summary: z.string().min(8).max(200),
    importance: z.number().int().min(1).max(5),
    tags: z.array(TagEnum).min(1).max(3).default(['NONE']),  // NEW
    characters_involved: z.array(z.string()),
    witnesses: z.array(z.string()),
    location: z.string().nullable(),
    is_secret: z.boolean(),
    emotional_impact: z.record(z.string()),
    relationship_impact: z.record(z.string()),
});
```

### 4b. Memory Object (stored)

```js
{
    summary: "Саша повалила Вову на кровать...",
    importance: 4,
    tags: ["EXPLICIT", "BDSM"],           // NEW (replaces event_type)
    characters_involved: ["Саша", "Вова"],
    witnesses: [],
    location: null,
    is_secret: false,
    emotional_impact: { "Саша": "возбуждение" },
    relationship_impact: { "Саша->Вова": "физическая близость" },
    embedding: [0.234, -0.123, ...],
    embedding_tags: ["EXPLICIT", "BDSM"], // Track what was embedded (for re-embed detection)
    id: "uuid",
    created_at: 1234567890
}
```

### 4c. Settings Additions

```js
// New settings in constants.js:
embeddingQueryPrefix: 'search for similar scenes: ',  // Query-side prefix
embeddingDocPrefix: '',                                // Doc-side prefix (empty; tags handle it)
embeddingTagFormat: 'bracket',                         // 'bracket' = [TAG], 'none' = disable
```

## 5. Asymmetric Embedding Implementation

### 5a. Split `getEmbedding()` into Two Methods

```js
class TransformersStrategy extends EmbeddingStrategy {
    async getEmbedding(text, type = 'query') {
        const settings = getDeps().getExtensionSettings()[extensionName];

        let prefix = '';
        if (type === 'query') {
            prefix = settings?.embeddingQueryPrefix ?? 'search for similar scenes: ';
        } else {
            prefix = settings?.embeddingDocPrefix ?? '';
        }

        const input = prefix + text.trim();
        const output = await this.#loadPipeline(this.#currentModelKey)
            .then(pipe => pipe(input, { pooling: 'mean', normalize: true }));
        return Array.from(output.data);
    }

    async getQueryEmbedding(text) {
        return this.getEmbedding(text, 'query');
    }

    async getDocumentEmbedding(text) {
        return this.getEmbedding(text, 'doc');
    }
}
```

### 5b. Same for OllamaStrategy

```js
class OllamaStrategy extends EmbeddingStrategy {
    async getQueryEmbedding(text) {
        return this.getEmbedding(text);  // Ollama models may not support asymmetry
    }

    async getDocumentEmbedding(text) {
        return this.getEmbedding(text);
    }
}
```

### 5c. Tag Formatting for Document Embedding

```js
function formatForEmbedding(summary, tags, settings) {
    const format = settings?.embeddingTagFormat ?? 'bracket';
    if (format === 'none' || !tags?.length) return summary;

    const tagPrefix = tags
        .filter(t => t !== 'NONE')
        .map(t => `[${t}]`)
        .join(' ');

    return tagPrefix ? `${tagPrefix} ${summary}` : summary;
}
```

### 5d. Embedding Call Sites

**Memory creation** (after LLM extraction):
```js
const embedText = formatForEmbedding(event.summary, event.tags, settings);
const embedding = await strategy.getDocumentEmbedding(embedText);
// Store: { ...event, embedding, embedding_tags: event.tags }
```

**Retrieval** (query time):
```js
const queryText = userMessage;  // prefix added inside getQueryEmbedding()
const queryEmbedding = await strategy.getQueryEmbedding(queryText);
```

## 6. Prompt Changes

### 6a. Remove `event_type` References

Delete all `<event_type>` sections, examples, and instructions from `src/prompts.js`.

### 6b. Add `<tags_field>` Directive

Insert after `<importance_scale>` section:

```
<tags_field>
After writing each event's summary, assign 1-3 category tags.

INTIMATE:
- EXPLICIT: Sexual acts (минет, куннилингус, оргазм, blowjob, フェラチオ)
- BDSM: Power exchange, bondage, D/s (верёвка, стоп-слово, collar, 縛り)
- FETISH: Specific kinks — feet, voyeurism, exhibitionism, cosplay
- ROMANCE: Affection without explicit sex (поцелуй, объятия, свидание, hug)
- FLIRTING: Light teasing, playful banter (подмигнуть, дразнить, tease)
- SEDUCTION: Deliberate sexual pursuit, undressing, tension (соблазнить, 誘惑)

CONFLICT:
- COMBAT: Fighting, violence (битва, удар, кровь, sword, 戦い)
- THREAT: Intimidation, danger, warnings (угроза, опасность)
- INJURY: Wounds, pain, medical (рана, бинт, перелом, wound)
- BETRAYAL: Broken trust, deception (предательство, обман)
- HORROR: Fear, dread, disturbing (ужас, кошмар, nightmare)

SLICE-OF-LIFE:
- DOMESTIC: Daily routines, chores (кухня, уборка, утро, breakfast)
- SOCIAL: Conversations, parties (вечеринка, гости, знакомство)
- TRAVEL: Journeys, exploration (путешествие, дорога, journey)
- COMMERCE: Shopping, trade, money (магазин, покупка, shop)
- FOOD: Meals, cooking (ужин, готовить, ресторан, dinner)
- CELEBRATION: Festivities, gifts (праздник, подарок, победа)

CHARACTER:
- LORE: Backstory, family history (детство, родители, childhood)
- SECRET: Hidden info revealed (тайна, признание, confession)
- TRAUMA: Past pain, triggers (страх, насилие, abuse)
- GROWTH: Development, learning (научиться, преодолеть, overcome)
- EMOTION: Strong emotional moments (слёзы, ярость, tears)
- BONDING: Trust-building, vulnerability (доверие, открыться, trust)
- REUNION: Meeting after separation (встреча, вернуться, reunion)

WORLD:
- MYSTERY: Investigations, puzzles (загадка, улика, clue)
- MAGIC: Supernatural, spells (заклинание, магия, spell)
- STEALTH: Sneaking, espionage (тайком, маскировка, sneak)
- POLITICAL: Factions, alliances, power (альянс, переговоры)
- HUMOR: Comedy, jokes, pranks (шутка, смех, prank)
- CRAFTING: Building, forging, inventing (ковать, строить, forge)

- NONE: Default. Use alone, never combine.

Rules:
- 1-3 tags per event. Multiple allowed when content overlaps.
- Prefer specific: SEDUCTION > ROMANCE when deliberate pursuit.
- NONE only when nothing else fits. Never combine NONE with other tags.

Examples:
- "Suzy сделала минет" → ["EXPLICIT"]
- "Связал и заставил сосать" → ["BDSM", "EXPLICIT"]
- "Пошли в магазин за бельём" → ["DOMESTIC", "COMMERCE"]
- "Рассказала о детстве в нищете" → ["LORE", "TRAUMA"]
- "Поцеловал её щёку" → ["ROMANCE"]
- "Он подмигнул и дразнил её" → ["FLIRTING"]
- "Медленно расстёгивала пуговицы, глядя в глаза" → ["SEDUCTION"]
- "Орки атаковали деревню" → ["COMBAT"]
- "Нашёл записку со странными символами" → ["MYSTERY"]
- "Произнёс заклинание огня" → ["MAGIC"]
</tags_field>
```

### 6c. Update All Examples

Every example in the extraction prompt replaces `event_type` with `tags`:

```js
// OLD
{
  "event_type": "action",
  "summary": "Саша повалила Вову на кровать...",
  ...
}

// NEW
{
  "summary": "Саша повалила Вову на кровать...",
  "tags": ["EXPLICIT"],
  ...
}
```

## 7. Code Removal: `event_type`

All references to `event_type` must be deleted from:

| Location | What to remove |
|----------|---------------|
| `src/extraction/schemas/event-schema.js` | `EventTypeEnum`, `event_type` field from schema |
| `src/prompts.js` | `<event_type>` directive, all examples referencing it |
| `src/retrieval/formatting.js` | `[${m.event_type}]` in memory display format |
| `src/retrieval/scoring.js` | Any `event_type` references in smart retrieval display |
| Anywhere else | Search for `event_type` across codebase, delete all |

Replace `[${m.event_type}]` in formatting with tag-based display:
```js
// OLD
`[${m.event_type}] [★★★] ${summary}`

// NEW
`[${m.tags?.join(', ') || 'NONE'}] [★★★] ${summary}`
```

## 8. Implementation Order

### Phase 1: Schema + Prompt
1. Remove `EventTypeEnum` and `event_type` from `event-schema.js`
2. Add `TagEnum` and `tags` field
3. Add `<tags_field>` directive to `src/prompts.js`
4. Remove `<event_type>` directive from prompts
5. Update all extraction examples to use `tags`

### Phase 2: Embedding Asymmetry
1. Add `getQueryEmbedding()` / `getDocumentEmbedding()` to `TransformersStrategy`
2. Add same to `OllamaStrategy` (passthrough)
3. Add `embeddingQueryPrefix`, `embeddingDocPrefix`, `embeddingTagFormat` to `constants.js`
4. Add `formatForEmbedding()` helper

### Phase 3: Wire Up
1. Memory creation: extract tags → format → `getDocumentEmbedding()`
2. Retrieval: `getQueryEmbedding()` with prefix
3. Update memory formatting to show tags instead of event_type
4. Remove all `event_type` references from codebase

### Phase 4: Verify
1. Run extraction on sample text, verify tags appear
2. Generate embeddings, verify asymmetric prefixes applied
3. User regenerates all memories

## 9. Files to Modify

| File | Changes |
|------|---------|
| `src/extraction/schemas/event-schema.js` | Remove `event_type`, add `TagEnum` + `tags` field |
| `src/prompts.js` | Remove `<event_type>`, add `<tags_field>`, update all examples |
| `src/embeddings/strategies.js` | Add `getQueryEmbedding()`, `getDocumentEmbedding()`, prefix logic |
| `src/constants.js` | Add `embeddingQueryPrefix`, `embeddingDocPrefix`, `embeddingTagFormat` |
| `src/retrieval/formatting.js` | Replace `event_type` display with `tags` display |
| `src/retrieval/scoring.js` | Replace `event_type` references with `tags` |
| Memory creation flow | Wire tag extraction → `formatForEmbedding()` → `getDocumentEmbedding()` |
| All files with `event_type` | Delete references (clean break) |

## 10. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| 31 tags overwhelm LLM | Grouped by theme with anchor words. LLMs handle structured enums well. Max 3 per event limits output. |
| LLM ignores tags / always picks NONE | Zod `.min(1)` enforces at least one. Examples show diverse tags. |
| Overlapping tags (ROMANCE vs FLIRTING vs SEDUCTION) | Clear hierarchy: FLIRTING=playful, SEDUCTION=deliberate, ROMANCE=affectionate. Prompt examples disambiguate. |
| LLM censors EXPLICIT/BDSM tags | Multilingual anchor words (минет, blowjob, フェラチオ) bypass token-level filters. |
| Old memories have event_type, no tags | User regenerates. No migration. |
| Re-embed needed for tag changes | `embedding_tags` field tracks what was embedded. Detect drift, re-embed on demand. |
| Asymmetric prefix hurts non-asymmetric models | `embeddingQueryPrefix` defaults to `'search for similar scenes: '` but is configurable. Set to `''` for symmetric models. |
| Too many tags dilute embedding signal | Tags are short tokens; 1-3 tag prefixes add minimal noise. Benchmarks showed improvement with even 1 tag prefix. |

## 11. Not Doing

- ~~Migration scripts~~ — clean break
- ~~Backward compat for event_type~~ — user regenerates
- ~~Custom user tags~~ — fixed taxonomy for now
- ~~Regex auto-tagger~~ — LLM does it
- ~~Settings UI for tags~~ — future work
