# Remove Relationship Counters Design

## Summary

Remove trust/tension counters and relationship classification from scene memory output. The emotional annotations already convey relationship dynamics more effectively.

## What We're Removing

| Component | Location | Reason |
|-----------|----------|--------|
| Trust counter (0-10) | `parser.js` | Crude keyword matching, redundant with emotional annotations |
| Tension counter (0-10) | `parser.js` | Same as above |
| Relationship type field | `parser.js` | Never updated, always 'acquaintance' |
| Decay system | `simulation.js` | No counters = no decay needed |
| Relationship classification output | `formatting.js` | Replaced by simpler "Present: X, Y" |

## Code Changes

### Files to Modify

1. **`src/extraction/parser.js`** - Remove relationship creation/update logic, remove `RELATIONSHIPS_KEY` handling
2. **`src/simulation.js`** - Delete `applyRelationshipDecay()` function
3. **`src/constants.js`** - Remove `relationshipDecayInterval`, `tensionDecayRate`, `trustDecayRate`
4. **`src/retrieval/formatting.js`** - Remove relationship classification block, change to `Present: Alice, Bob`
5. **`src/ui/calculations.js`** - Remove `buildRelationshipData()` or strip relationship fields
6. **`src/extraction/stages/result-committer.js`** - Remove call to `applyRelationshipDecay()`

### Tests to Update

- `tests/parser.test.js` - Remove relationship update/clamping tests
- `tests/formatting.test.js` - Update "Current Scene" assertions

## Output Format Change

### Before
```
## Current Scene
Emotional state: nervous excitement
Relationships with present characters:
- Alice: acquaintance (moderate trust)
- Bob: acquaintance (high trust, some tension)

[memories...]
```

### After
```
## Current Scene
Emotional state: nervous excitement
Present: Alice, Bob

[memories...]
```

## Benefits

- Fewer tokens in context
- No misleading static classifications
- Emotional annotations (💔 format) already capture dynamics better
- Simpler codebase
