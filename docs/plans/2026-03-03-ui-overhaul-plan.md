# Implementation Plan - UI Overhaul for Reflections & GraphRAG

> **Reference:** `docs/designs/2026-03-03-ui-overhaul-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Add New Settings Constants

**Goal:** Add `reflectionThreshold`, `worldContextBudget`, `communityDetectionInterval` to `defaultSettings` and `UI_DEFAULT_HINTS`.

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js`
- Add to existing test file:
```javascript
describe('new feature settings', () => {
    it('has reflectionThreshold default', () => {
        expect(defaultSettings.reflectionThreshold).toBe(30);
    });

    it('has worldContextBudget default', () => {
        expect(defaultSettings.worldContextBudget).toBe(2000);
    });

    it('has communityDetectionInterval default', () => {
        expect(defaultSettings.communityDetectionInterval).toBe(50);
    });
});

describe('UI_DEFAULT_HINTS for features', () => {
    it('has reflectionThreshold hint', () => {
        expect(UI_DEFAULT_HINTS.reflectionThreshold).toBe(30);
    });

    it('has worldContextBudget hint', () => {
        expect(UI_DEFAULT_HINTS.worldContextBudget).toBe(2000);
    });

    it('has communityDetectionInterval hint', () => {
        expect(UI_DEFAULT_HINTS.communityDetectionInterval).toBe(50);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — properties undefined

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- Action: Add to `defaultSettings` object, after the last existing key:
```javascript
    // Reflection settings
    reflectionThreshold: 30,
    // World context settings
    worldContextBudget: 2000,
    communityDetectionInterval: 50,
```
- Action: Add to `UI_DEFAULT_HINTS` object:
```javascript
    reflectionThreshold: defaultSettings.reflectionThreshold,
    worldContextBudget: defaultSettings.worldContextBudget,
    communityDetectionInterval: defaultSettings.communityDetectionInterval,
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add feature settings constants (reflection, world context, community)"`

---

### Task 2: Fix Type Filter — filterMemories()

**Goal:** Make `filterMemories()` actually apply the type filter parameter. Replace dead `_typeFilter` with working logic.

**Step 1: Write the Failing Test**
- File: `tests/ui-helpers.test.js`
- Add inside the existing `describe('filterMemories', ...)` block:
```javascript
        it('filters events only (excludes reflections)', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'] },
            ];
            const result = filterMemories(mems, 'event', '');
            expect(result).toHaveLength(2);
            expect(result.every(m => m.type !== 'reflection')).toBe(true);
        });

        it('filters reflections only', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'reflection', '');
            expect(result).toHaveLength(2);
            expect(result.every(m => m.type === 'reflection')).toBe(true);
        });

        it('combines type and character filter', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'reflection', 'Alice');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('treats unknown type filter as show all', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'action', '');
            expect(result).toHaveLength(2);
        });
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — `filterMemories` with 'event' filter still returns reflections (current code ignores `_typeFilter`)

**Step 3: Implementation (Green)**
- File: `src/ui/helpers.js`
- Action: Replace the `filterMemories` function body:
```javascript
export function filterMemories(memories, typeFilter, characterFilter) {
    return memories.filter((m) => {
        // Type filter
        if (typeFilter === 'event' && m.type === 'reflection') return false;
        if (typeFilter === 'reflection' && m.type !== 'reflection') return false;

        // Character filter
        if (characterFilter && !m.characters_involved?.includes(characterFilter)) return false;

        return true;
    });
}
```
- Also update the JSDoc above it — remove "DEPRECATED, ignored" from `typeFilter` param comment.

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "fix(ui): implement type filter in filterMemories (was dead code)"`

---

### Task 3: Wire Type Filter in renderMemoryList()

**Goal:** Pass the actual type filter value from the dropdown to `filterMemories()` instead of empty string.

**Step 1: No Unit Test Needed**
- This is a DOM wiring change in `render.js`. The logic was tested in Task 2.

**Step 2: Implementation**
- File: `src/ui/render.js`
- In `renderMemoryList()`, find:
```javascript
    const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

    let filteredMemories = filterMemories(memories, '', characterFilter);
```
- Replace with:
```javascript
    const typeFilter = $(SELECTORS.FILTER_TYPE).val();
    const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

    let filteredMemories = filterMemories(memories, typeFilter, characterFilter);
```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS (no regressions)

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): wire type filter dropdown to filterMemories in render"`

---

### Task 4: Replace Type Filter HTML Options

**Goal:** Replace dead dropdown options with All Memories / Events / Reflections.

**Step 1: No Unit Test Needed**
- HTML template change only.

**Step 2: Implementation**
- File: `templates/settings_panel.html`
- Find:
```html
                    <select id="openvault_filter_type" class="text_pole">
                        <option value="">All Types</option>
                        <option value="action">Actions</option>
                        <option value="revelation">Revelations</option>
                        <option value="emotion_shift">Emotion Shifts</option>
                        <option value="relationship_change">Relationship Changes</option>
                    </select>
```
- Replace with:
```html
                    <select id="openvault_filter_type" class="text_pole">
                        <option value="">All Memories</option>
                        <option value="event">Events</option>
                        <option value="reflection">Reflections</option>
                    </select>
```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): replace dead type filter options with Events/Reflections"`

---

### Task 5: Add Reflection & Evidence Badges to Memory Cards

**Goal:** Memory cards for `type=reflection` show a lightbulb badge and evidence count.

**Step 1: Write the Failing Test**
- File: `tests/ui-helpers.test.js` is for pure functions. Badge rendering lives in `templates.js` which produces HTML strings. Add a new test file.
- File: `tests/ui-templates.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { renderMemoryItem } from '../src/ui/templates.js';

describe('ui/templates', () => {
    describe('renderMemoryItem', () => {
        it('includes reflection badge for reflection memories', () => {
            const memory = {
                id: 'ref_001',
                type: 'reflection',
                summary: 'Alice has grown suspicious',
                importance: 4,
                characters_involved: ['Alice'],
                source_ids: ['ev_001', 'ev_002', 'ev_003'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).toContain('fa-lightbulb');
            expect(html).toContain('Reflection');
        });

        it('includes evidence count for reflection with source_ids', () => {
            const memory = {
                id: 'ref_001',
                type: 'reflection',
                summary: 'Alice has grown suspicious',
                importance: 4,
                characters_involved: ['Alice'],
                source_ids: ['ev_001', 'ev_002', 'ev_003'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).toContain('3 evidence');
        });

        it('does not include reflection badge for regular events', () => {
            const memory = {
                id: 'ev_001',
                summary: 'Alice entered the room',
                importance: 3,
                characters_involved: ['Alice'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).not.toContain('fa-lightbulb');
            expect(html).not.toContain('Reflection');
        });
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — rendered HTML has no `fa-lightbulb` or "Reflection"

**Step 3: Implementation (Green)**
- File: `src/ui/templates.js`
- In `buildBadges(memory)`, add after the `needsEmbed` badge block (before the `if (witnessText)` block):
```javascript
    if (memory.type === 'reflection') {
        badges.push(
            `<span class="openvault-memory-card-badge reflection"><i class="fa-solid fa-lightbulb"></i> Reflection</span>`
        );
        if (memory.source_ids?.length > 0) {
            badges.push(
                `<span class="openvault-memory-card-badge evidence"><i class="fa-solid fa-link"></i> ${memory.source_ids.length} evidence</span>`
            );
        }
    }
```

- File: `style.css`
- Add after the existing `.openvault-memory-card-badge.pending-embed` block:
```css
.openvault-memory-card-badge.reflection {
    color: #d4a017;
}
.openvault-memory-card-badge.evidence {
    color: #7b8ab8;
}
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add reflection and evidence badges to memory cards"`

---

### Task 6: Add Reflection Progress Template

**Goal:** Create `renderReflectionProgress()` that renders per-character importance counters.

**Step 1: Write the Failing Test**
- File: `tests/ui-templates.test.js`
- Add to existing file:
```javascript
import { renderReflectionProgress } from '../src/ui/templates.js';

describe('renderReflectionProgress', () => {
    it('renders counters for each character', () => {
        const state = {
            'King Aldric': { importance_sum: 22 },
            'Royal Guard': { importance_sum: 8 },
        };
        const html = renderReflectionProgress(state, 30);
        expect(html).toContain('King Aldric: 22/30');
        expect(html).toContain('Royal Guard: 8/30');
    });

    it('sorts characters alphabetically', () => {
        const state = {
            'Zelda': { importance_sum: 10 },
            'Alice': { importance_sum: 5 },
        };
        const html = renderReflectionProgress(state, 30);
        const aliceIdx = html.indexOf('Alice');
        const zeldaIdx = html.indexOf('Zelda');
        expect(aliceIdx).toBeLessThan(zeldaIdx);
    });

    it('returns placeholder for empty state', () => {
        const html = renderReflectionProgress({}, 30);
        expect(html).toContain('No reflection data yet');
    });

    it('returns placeholder for null state', () => {
        const html = renderReflectionProgress(null, 30);
        expect(html).toContain('No reflection data yet');
    });

    it('defaults importance_sum to 0', () => {
        const state = { 'Alice': {} };
        const html = renderReflectionProgress(state, 30);
        expect(html).toContain('Alice: 0/30');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — `renderReflectionProgress` is not exported from templates.js

**Step 3: Implementation (Green)**
- File: `src/ui/templates.js`
- Add at the bottom of the file, after `renderCharacterState`:
```javascript
/**
 * Render reflection progress counters for all characters.
 * @param {Object|null} reflectionState - charName → { importance_sum }
 * @param {number} threshold - Reflection threshold
 * @returns {string} HTML
 */
export function renderReflectionProgress(reflectionState, threshold) {
    if (!reflectionState || Object.keys(reflectionState).length === 0) {
        return '<p class="openvault-placeholder">No reflection data yet</p>';
    }

    const items = Object.entries(reflectionState)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, state]) => {
            const sum = state.importance_sum || 0;
            return `<span class="openvault-reflection-counter">${escapeHtml(name)}: ${sum}/${threshold}</span>`;
        })
        .join(' \u00b7 ');

    return `<div class="openvault-reflection-counters">${items}</div>`;
}
```

- File: `style.css`
- Add:
```css
.openvault-reflection-counters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 8px 0;
}
.openvault-reflection-counter {
    font-size: 0.85em;
    color: var(--SmartThemeEmColor, #888);
    white-space: nowrap;
}
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add renderReflectionProgress template function"`

---

### Task 7: Add Community Accordion Template

**Goal:** Create `renderCommunityAccordion()` for World tab.

**Step 1: Write the Failing Test**
- File: `tests/ui-templates.test.js`
- Add:
```javascript
import { renderCommunityAccordion } from '../src/ui/templates.js';

describe('renderCommunityAccordion', () => {
    it('renders community title and member count', () => {
        const community = {
            title: 'The Royal Court',
            summary: 'King Aldric rules from the Castle.',
            findings: ['The King is powerful', 'The Guard is loyal'],
            nodeKeys: ['king aldric', 'castle', 'royal guard'],
        };
        const html = renderCommunityAccordion('C0', community);
        expect(html).toContain('The Royal Court');
        expect(html).toContain('3 entities');
    });

    it('renders summary and findings', () => {
        const community = {
            title: 'Court',
            summary: 'A powerful court.',
            findings: ['Finding one', 'Finding two'],
            nodeKeys: ['a'],
        };
        const html = renderCommunityAccordion('C0', community);
        expect(html).toContain('A powerful court.');
        expect(html).toContain('Finding one');
        expect(html).toContain('Finding two');
        expect(html).toContain('<li>');
    });

    it('renders member list', () => {
        const community = {
            title: 'Test',
            summary: 'Test',
            findings: [],
            nodeKeys: ['alice', 'bob'],
        };
        const html = renderCommunityAccordion('C0', community);
        expect(html).toContain('alice');
        expect(html).toContain('bob');
    });

    it('uses community ID as fallback title', () => {
        const community = { summary: 'No title', findings: [], nodeKeys: [] };
        const html = renderCommunityAccordion('C5', community);
        expect(html).toContain('C5');
    });

    it('handles empty findings', () => {
        const community = { title: 'Test', summary: 'Test', findings: [], nodeKeys: [] };
        const html = renderCommunityAccordion('C0', community);
        expect(html).not.toContain('<ul');
    });

    it('shows 0 entities for empty nodeKeys', () => {
        const community = { title: 'Test', summary: 'Test', findings: [], nodeKeys: [] };
        const html = renderCommunityAccordion('C0', community);
        expect(html).toContain('0 entities');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — `renderCommunityAccordion` is not exported

**Step 3: Implementation (Green)**
- File: `src/ui/templates.js`
- Add after `renderReflectionProgress`:
```javascript
/**
 * Render a single community as an accordion item.
 * @param {string} id - Community ID (e.g., "C0")
 * @param {Object} community - { title, summary, findings, nodeKeys }
 * @returns {string} HTML
 */
export function renderCommunityAccordion(id, community) {
    const memberCount = community.nodeKeys?.length || 0;
    const findings = (community.findings || [])
        .map(f => `<li>${escapeHtml(f)}</li>`)
        .join('');
    const members = (community.nodeKeys || [])
        .map(k => escapeHtml(k))
        .join(', ');

    return `
        <details class="openvault-community-item">
            <summary>
                <span class="openvault-community-title">${escapeHtml(community.title || id)}</span>
                <span class="openvault-community-badge">${memberCount} entities</span>
            </summary>
            <div class="openvault-community-content">
                <p>${escapeHtml(community.summary || 'No summary')}</p>
                ${findings ? `<ul class="openvault-community-findings">${findings}</ul>` : ''}
                <small class="openvault-community-members">Members: ${members}</small>
            </div>
        </details>
    `;
}
```

- File: `style.css`
- Add:
```css
.openvault-community-item {
    border: 1px solid var(--SmartThemeBorderColor, #333);
    border-radius: 6px;
    margin-bottom: 8px;
    overflow: hidden;
}
.openvault-community-item summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    cursor: pointer;
    font-weight: 500;
}
.openvault-community-title {
    flex: 1;
}
.openvault-community-badge {
    font-size: 0.8em;
    color: var(--SmartThemeEmColor, #888);
    margin-left: 8px;
}
.openvault-community-content {
    padding: 0 12px 12px;
    font-size: 0.9em;
}
.openvault-community-content p {
    margin: 0 0 8px;
}
.openvault-community-findings {
    margin: 4px 0 8px;
    padding-left: 20px;
}
.openvault-community-findings li {
    margin-bottom: 4px;
}
.openvault-community-members {
    color: var(--SmartThemeEmColor, #888);
}
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add renderCommunityAccordion template function"`

---

### Task 8: Add Entity Card Template

**Goal:** Create `renderEntityCard()` for the World tab entity browser.

**Step 1: Write the Failing Test**
- File: `tests/ui-templates.test.js`
- Add:
```javascript
import { renderEntityCard } from '../src/ui/templates.js';

describe('renderEntityCard', () => {
    it('renders entity name and type badge', () => {
        const entity = { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler', mentions: 7 };
        const html = renderEntityCard(entity);
        expect(html).toContain('King Aldric');
        expect(html).toContain('PERSON');
        expect(html).toContain('person'); // lowercase class
    });

    it('renders mention count', () => {
        const entity = { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 3 };
        const html = renderEntityCard(entity);
        expect(html).toContain('3 mentions');
    });

    it('renders description', () => {
        const entity = { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 1 };
        const html = renderEntityCard(entity);
        expect(html).toContain('Ancient fortress');
    });

    it('handles missing description', () => {
        const entity = { name: 'Castle', type: 'PLACE', mentions: 1 };
        const html = renderEntityCard(entity);
        expect(html).toContain('Castle');
    });

    it('defaults mentions to 0', () => {
        const entity = { name: 'Castle', type: 'PLACE', description: '' };
        const html = renderEntityCard(entity);
        expect(html).toContain('0 mentions');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — `renderEntityCard` is not exported

**Step 3: Implementation (Green)**
- File: `src/ui/templates.js`
- Add after `renderCommunityAccordion`:
```javascript
/**
 * Render a single entity card.
 * @param {Object} entity - { name, type, description, mentions }
 * @returns {string} HTML
 */
export function renderEntityCard(entity) {
    return `
        <div class="openvault-entity-card">
            <div class="openvault-entity-header">
                <span class="openvault-entity-name">${escapeHtml(entity.name)}</span>
                <span class="openvault-entity-type-badge ${entity.type.toLowerCase()}">${escapeHtml(entity.type)}</span>
            </div>
            <div class="openvault-entity-description">${escapeHtml(entity.description || '')}</div>
            <small class="openvault-entity-mentions">${entity.mentions || 0} mentions</small>
        </div>
    `;
}
```

- File: `style.css`
- Add:
```css
.openvault-entity-card {
    border: 1px solid var(--SmartThemeBorderColor, #333);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 6px;
}
.openvault-entity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
}
.openvault-entity-name {
    font-weight: 500;
}
.openvault-entity-type-badge {
    font-size: 0.75em;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.openvault-entity-type-badge.person { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
.openvault-entity-type-badge.place { background: rgba(33, 150, 243, 0.15); color: #2196f3; }
.openvault-entity-type-badge.organization { background: rgba(255, 152, 0, 0.15); color: #ff9800; }
.openvault-entity-type-badge.object { background: rgba(156, 39, 176, 0.15); color: #9c27b0; }
.openvault-entity-type-badge.concept { background: rgba(233, 30, 99, 0.15); color: #e91e63; }
.openvault-entity-description {
    font-size: 0.9em;
    color: var(--SmartThemeEmColor, #888);
    margin-bottom: 4px;
}
.openvault-entity-mentions {
    color: var(--SmartThemeQuoteColor, #666);
}
.openvault-entity-list {
    max-height: 400px;
    overflow-y: auto;
}
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add renderEntityCard template function"`

---

### Task 9: Add Entity Filtering Helper

**Goal:** Add `filterEntities()` pure function for entity search and type filter.

**Step 1: Write the Failing Test**
- File: `tests/ui-helpers.test.js`
- Add:
```javascript
import { filterEntities } from '../src/ui/helpers.js';

describe('filterEntities', () => {
    const entities = [
        { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler', mentions: 7 },
        { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 3 },
        { name: 'Royal Guard', type: 'ORGANIZATION', description: 'Elite soldiers', mentions: 5 },
        { name: 'Magic Sword', type: 'OBJECT', description: 'Legendary blade', mentions: 2 },
    ];

    it('returns all entities when no filters', () => {
        expect(filterEntities(entities, '', '')).toHaveLength(4);
    });

    it('filters by type', () => {
        const result = filterEntities(entities, 'PERSON', '');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('King Aldric');
    });

    it('filters by search query (name)', () => {
        const result = filterEntities(entities, '', 'castle');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Castle');
    });

    it('filters by search query (description)', () => {
        const result = filterEntities(entities, '', 'legendary');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Magic Sword');
    });

    it('combines type and search filters', () => {
        const result = filterEntities(entities, 'PERSON', 'aldric');
        expect(result).toHaveLength(1);
    });

    it('returns empty for no matches', () => {
        expect(filterEntities(entities, '', 'nonexistent')).toHaveLength(0);
    });

    it('handles empty array', () => {
        expect(filterEntities([], '', '')).toHaveLength(0);
    });

    it('search is case-insensitive', () => {
        const result = filterEntities(entities, '', 'KING');
        expect(result).toHaveLength(1);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Fail — `filterEntities` is not exported

**Step 3: Implementation (Green)**
- File: `src/ui/helpers.js`
- Add after `filterMemories`:
```javascript
/**
 * Filter entities by type and search query.
 * @param {Array} entities - Array of { name, type, description, mentions }
 * @param {string} typeFilter - Entity type (PERSON, PLACE, etc.) or "" for all
 * @param {string} searchQuery - Text search on name/description (case-insensitive)
 * @returns {Array} Filtered entities
 */
export function filterEntities(entities, typeFilter, searchQuery) {
    const query = searchQuery.toLowerCase();
    return entities.filter((e) => {
        if (typeFilter && e.type !== typeFilter) return false;
        if (query) {
            const name = (e.name || '').toLowerCase();
            const desc = (e.description || '').toLowerCase();
            if (!name.includes(query) && !desc.includes(query)) return false;
        }
        return true;
    });
}
```

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add filterEntities helper function"`

---

### Task 10: Dashboard Stats — Add 3 New Stat Cards

**Goal:** Add Reflections, Entities, Communities stat cards to Dashboard and wire `refreshStats()`.

**Step 1: No Pure-Function Test**
- `refreshStats()` is DOM-dependent. The stat counting logic is trivial (`.filter()`, `Object.keys().length`).
- Verify via `npm test` for no regressions.

**Step 2: Implementation — HTML**
- File: `templates/settings_panel.html`
- Find the closing `</div>` of the last stat card (Embeddings):
```html
                    <div class="openvault-stat-card">
                        <div class="stat-icon"><i class="fa-solid fa-vector-square"></i></div>
                        <div class="stat-value" id="openvault_stat_embeddings">0</div>
                        <div class="stat-label">Embeddings</div>
                    </div>
```
- Add immediately after:
```html
                    <div class="openvault-stat-card">
                        <div class="stat-icon"><i class="fa-solid fa-lightbulb"></i></div>
                        <div class="stat-value" id="openvault_stat_reflections">0</div>
                        <div class="stat-label">Reflections</div>
                    </div>
                    <div class="openvault-stat-card">
                        <div class="stat-icon"><i class="fa-solid fa-diagram-project"></i></div>
                        <div class="stat-value" id="openvault_stat_entities">0</div>
                        <div class="stat-label">Entities</div>
                    </div>
                    <div class="openvault-stat-card">
                        <div class="stat-icon"><i class="fa-solid fa-circle-nodes"></i></div>
                        <div class="stat-value" id="openvault_stat_communities">0</div>
                        <div class="stat-label">Communities</div>
                    </div>
```

**Step 3: Implementation — JS**
- File: `src/ui/status.js`
- In `refreshStats()`, after the line `$('#openvault_stat_characters').text(charCount);`, add:
```javascript
    // New feature stats
    const reflectionCount = memories.filter(m => m.type === 'reflection').length;
    const entityCount = Object.keys(data.graph?.nodes || {}).length;
    const communityCount = Object.keys(data.communities || {}).length;

    $('#openvault_stat_reflections').text(reflectionCount);
    $('#openvault_stat_entities').text(entityCount);
    $('#openvault_stat_communities').text(communityCount);
```
- In the "no data" branch at the top of `refreshStats()`, add after `$('#openvault_stat_characters').text('0');`:
```javascript
    $('#openvault_stat_reflections').text('0');
    $('#openvault_stat_entities').text('0');
    $('#openvault_stat_communities').text('0');
```

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add reflection/entity/community stats to dashboard"`

---

### Task 11: Add World Tab HTML + Tab Button

**Goal:** Add the World tab button and content section to the HTML template.

**Step 1: No Unit Test Needed**
- Pure HTML template addition.

**Step 2: Implementation — Tab Button**
- File: `templates/settings_panel.html`
- Find the Config tab button:
```html
                <button class="openvault-tab-btn" data-tab="configuration">
                    <i class="fa-solid fa-sliders"></i> Config
                </button>
```
- Add **before** it (between Memory Bank and Config):
```html
                <button class="openvault-tab-btn" data-tab="world">
                    <i class="fa-solid fa-globe"></i> World
                </button>
```

**Step 3: Implementation — Tab Content**
- File: `templates/settings_panel.html`
- Find the Configuration tab content opening:
```html
            <!-- ================================================================
                 TAB 3: CONFIGURATION
```
- Add **before** it:
```html
            <!-- ================================================================
                 TAB: WORLD
                 ================================================================ -->
            <div class="openvault-tab-content" data-tab="world">
                <!-- Community Summaries -->
                <div class="openvault-card">
                    <div class="openvault-card-header">
                        <span class="openvault-card-title">
                            <i class="fa-solid fa-circle-nodes"></i> Communities
                        </span>
                        <span class="openvault-card-badge" id="openvault_community_count">0</span>
                    </div>
                    <div id="openvault_community_list" class="openvault-community-list">
                        <p class="openvault-placeholder">No communities detected yet</p>
                    </div>
                </div>

                <!-- Entity Browser -->
                <div class="openvault-card" style="margin-top: 15px;">
                    <div class="openvault-card-header">
                        <span class="openvault-card-title">
                            <i class="fa-solid fa-diagram-project"></i> Entities
                        </span>
                        <span class="openvault-card-badge" id="openvault_entity_count">0</span>
                    </div>
                    <div class="openvault-filters">
                        <div class="openvault-search-container" style="flex: 1;">
                            <i class="fa-solid fa-search"></i>
                            <input type="text" id="openvault_entity_search" class="openvault-search-input"
                                   placeholder="Search entities..." />
                        </div>
                        <select id="openvault_entity_type_filter" class="text_pole">
                            <option value="">All Types</option>
                            <option value="PERSON">Person</option>
                            <option value="PLACE">Place</option>
                            <option value="ORGANIZATION">Organization</option>
                            <option value="OBJECT">Object</option>
                            <option value="CONCEPT">Concept</option>
                        </select>
                    </div>
                    <div id="openvault_entity_list" class="openvault-entity-list">
                        <p class="openvault-placeholder">No entities extracted yet</p>
                    </div>
                </div>
            </div>
```

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add World tab HTML (communities + entity browser)"`

---

### Task 12: Add Reflection Progress HTML to Memory Bank

**Goal:** Add the collapsible Reflection Progress section after Character States in Memory Bank tab.

**Step 1: No Unit Test Needed**
- HTML template addition only.

**Step 2: Implementation**
- File: `templates/settings_panel.html`
- Find the closing `</div>` of the Character States inline-drawer (the one that ends Memory Bank tab content before `</div>` of `data-tab="memory-bank"`). Look for:
```html
                        <div id="openvault_character_states" class="openvault-character-list">
                            <p class="openvault-placeholder">No character data yet</p>
                        </div>
                    </div>
                </div>
```
- After that closing `</div></div>` pair (the inline-drawer), add:
```html

                <!-- Reflection Progress (collapsed) -->
                <div class="inline-drawer" style="margin-top: 15px;">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <span>Reflection Progress</span>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <div id="openvault_reflection_progress" class="openvault-reflection-progress">
                            <p class="openvault-placeholder">No reflection data yet</p>
                        </div>
                    </div>
                </div>
```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add reflection progress section to Memory Bank tab"`

---

### Task 13: Add Features Settings Group HTML to Config Tab

**Goal:** Add the Features settings group (threshold, budget, interval sliders) between LLM Strategy and Embeddings.

**Step 1: No Unit Test Needed**
- HTML template addition only.

**Step 2: Implementation**
- File: `templates/settings_panel.html`
- Find the Embedding Settings Group opening:
```html
                <!-- Embedding Settings Group -->
                <div class="openvault-settings-group">
                    <div class="openvault-settings-group-header">
                        <i class="fa-solid fa-vector-square"></i>
                        <span>Embeddings</span>
                    </div>
```
- Add **before** it:
```html
                <!-- Features Group -->
                <div class="openvault-settings-group">
                    <div class="openvault-settings-group-header">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span>Features</span>
                    </div>

                    <label for="openvault_reflection_threshold">
                        Reflection Threshold: <span id="openvault_reflection_threshold_value">30</span>
                        <small class="openvault-default-hint" data-default-key="reflectionThreshold"></small>
                    </label>
                    <input type="range" id="openvault_reflection_threshold" min="10" max="100" step="5" value="30" />
                    <small class="openvault-hint">Importance sum to trigger character reflection. Lower = more frequent.</small>

                    <div style="height: 8px;"></div>

                    <label for="openvault_world_context_budget">
                        World Context Budget: <span id="openvault_world_context_budget_value">2000</span> tokens
                        <small class="openvault-default-hint" data-default-key="worldContextBudget"></small>
                        <small class="openvault-words-hint">~<span id="openvault_world_context_budget_words">1500</span> words</small>
                    </label>
                    <input type="range" id="openvault_world_context_budget" min="500" max="5000" step="250" value="2000" />
                    <small class="openvault-hint">Token budget for community summaries injected as world context.</small>

                    <div style="height: 8px;"></div>

                    <label for="openvault_community_interval">
                        Community Detection Interval: <span id="openvault_community_interval_value">50</span> messages
                        <small class="openvault-default-hint" data-default-key="communityDetectionInterval"></small>
                    </label>
                    <input type="range" id="openvault_community_interval" min="10" max="200" step="10" value="50" />
                    <small class="openvault-hint">How often Louvain runs. Lower = fresher communities, more LLM calls.</small>
                </div>

```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): add Features settings group to Config tab"`

---

### Task 14: Bind New Settings in settings.js

**Goal:** Wire the 3 new feature sliders to save/load settings.

**Step 1: No Unit Test Needed**
- DOM binding code. Settings save/load is covered by `saveSetting` which is already tested.

**Step 2: Implementation — Bindings**
- File: `src/ui/settings.js`
- In `bindUIElements()`, after the extraction profile binding (`$('#openvault_extraction_profile').on('change', ...)`), add:
```javascript
    // Feature settings
    $('#openvault_reflection_threshold').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('reflectionThreshold', value);
        $('#openvault_reflection_threshold_value').text(value);
    });

    $('#openvault_world_context_budget').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('worldContextBudget', value);
        $('#openvault_world_context_budget_value').text(value);
        updateWordsDisplay(value, 'openvault_world_context_budget_words');
    });

    $('#openvault_community_interval').on('input', function () {
        const value = parseInt($(this).val(), 10);
        saveSetting('communityDetectionInterval', value);
        $('#openvault_community_interval_value').text(value);
    });
```

**Step 3: Implementation — Update UI**
- File: `src/ui/settings.js`
- In `updateUI()`, after the extraction profile section (`populateProfileSelector()`), add before `refreshAllUI()`:
```javascript
    // Feature settings
    $('#openvault_reflection_threshold').val(settings.reflectionThreshold ?? 30);
    $('#openvault_reflection_threshold_value').text(settings.reflectionThreshold ?? 30);

    $('#openvault_world_context_budget').val(settings.worldContextBudget ?? 2000);
    $('#openvault_world_context_budget_value').text(settings.worldContextBudget ?? 2000);
    updateWordsDisplay(settings.worldContextBudget ?? 2000, 'openvault_world_context_budget_words');

    $('#openvault_community_interval').val(settings.communityDetectionInterval ?? 50);
    $('#openvault_community_interval_value').text(settings.communityDetectionInterval ?? 50);
```

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(ui): bind feature settings sliders (reflection, world context, community)"`

---

### Task 15: Wire World Tab Renderers in render.js

**Goal:** Add `renderWorldTab()` that renders communities and entities into the World tab containers.

**Step 1: No Unit Test**
- DOM rendering orchestration. Template functions tested in Tasks 7-9.

**Step 2: Implementation**
- File: `src/ui/render.js`
- Add imports at the top (alongside existing template imports):
```javascript
import { renderCommunityAccordion, renderEntityCard } from './templates.js';
import { filterEntities } from './helpers.js';
```
  (Adjust existing import line from `./templates.js` to include new exports, and from `./helpers.js` to include `filterEntities`.)

- Add new state and functions before `initBrowser`:
```javascript
// =============================================================================
// World Tab State and Render
// =============================================================================

let entitySearchTimeout = null;

function renderCommunityList() {
    const $container = $('#openvault_community_list');
    const $count = $('#openvault_community_count');
    const data = getOpenVaultData();

    const communities = data?.communities || {};
    const ids = Object.keys(communities);

    $count.text(ids.length);

    if (ids.length === 0) {
        $container.html('<p class="openvault-placeholder">No communities detected yet</p>');
        return;
    }

    const html = ids.map(id => renderCommunityAccordion(id, communities[id])).join('');
    $container.html(html);
}

function renderEntityList() {
    const $container = $('#openvault_entity_list');
    const $count = $('#openvault_entity_count');
    const data = getOpenVaultData();

    const nodes = data?.graph?.nodes || {};
    const allEntities = Object.values(nodes);

    const typeFilter = $('#openvault_entity_type_filter').val() || '';
    const searchQuery = $('#openvault_entity_search').val()?.toLowerCase().trim() || '';

    const filtered = filterEntities(allEntities, typeFilter, searchQuery);

    $count.text(allEntities.length);

    if (filtered.length === 0) {
        const msg = searchQuery || typeFilter ? 'No entities match your filters' : 'No entities extracted yet';
        $container.html(`<p class="openvault-placeholder">${msg}</p>`);
        return;
    }

    const html = filtered.map(renderEntityCard).join('');
    $container.html(html);
}

function renderWorldTab() {
    renderCommunityList();
    renderEntityList();
}
```

- In `initBrowser()`, add after `renderCharacterStates()`:
```javascript
    renderWorldTab();

    // Entity browser events
    $('#openvault_entity_type_filter').on('change', renderEntityList);
    $('#openvault_entity_search').on('input', () => {
        clearTimeout(entitySearchTimeout);
        entitySearchTimeout = setTimeout(renderEntityList, 200);
    });
```

- In `refreshAllUI()`, add after `renderCharacterStates()`:
```javascript
    renderWorldTab();
```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): wire world tab renderers (communities + entities)"`

---

### Task 16: Wire Reflection Progress in render.js

**Goal:** Render reflection progress counters from `data.reflection_state` into Memory Bank.

**Step 1: No Unit Test**
- DOM rendering orchestration. Template function tested in Task 6.

**Step 2: Implementation**
- File: `src/ui/render.js`
- Add `renderReflectionProgress` to the templates import (adjust existing import line):
```javascript
import { renderCharacterState, renderMemoryEdit, renderMemoryItem, renderReflectionProgress, renderCommunityAccordion, renderEntityCard } from './templates.js';
```

- Add new function before `initBrowser`:
```javascript
function renderReflectionProgressSection() {
    const $container = $('#openvault_reflection_progress');
    if ($container.length === 0) return;

    const data = getOpenVaultData();
    const reflectionState = data?.reflection_state || {};

    const settings = getDeps().getExtensionSettings()['openvault'] || {};
    const threshold = settings.reflectionThreshold ?? 30;

    $container.html(renderReflectionProgress(reflectionState, threshold));
}
```

- In `refreshAllUI()`, add after `renderCharacterStates()` (and before or after `renderWorldTab()`):
```javascript
    renderReflectionProgressSection();
```

- Also add import for `getDeps` if not already imported. Check the existing imports — `getDeps` is imported in `render.js` via:
```javascript
import { getDeps } from '../deps.js';
```
(Already present in the file.)

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(ui): wire reflection progress section in Memory Bank"`

---

### Task 17: Backend Integration — Wire Settings to Backend

**Goal:** Make backend read `reflectionThreshold`, `worldContextBudget`, `communityDetectionInterval` from settings instead of hardcoded values.

**Step 1: Write Failing Tests**
- These tests verify the backend modules read from settings. Check the existing backend test files to confirm how they mock settings.

- File: `tests/reflection/reflect.test.js`
- Find where `shouldReflect` is tested. Add or modify a test that verifies it uses the threshold from settings:
```javascript
    it('uses custom threshold from parameter', () => {
        const state = { 'Alice': { importance_sum: 20 } };
        expect(shouldReflect(state, 'Alice', 20)).toBe(true);
        expect(shouldReflect(state, 'Alice', 30)).toBe(false);
    });
```

- File: `tests/retrieval/world-context.test.js`
- Add test that `retrieveWorldContext` respects `tokenBudget` parameter.

**Step 2: Run Test (Red)**
- Command: `npm test`
- Expect: Depends on current function signatures. If `shouldReflect` already takes a threshold param, this may pass. Check actual signatures first during execution.

**Step 3: Implementation (Green)**
- File: `src/reflection/reflect.js`
  - If `shouldReflect` uses a hardcoded `30`, change its signature to accept `threshold` parameter (default `30`).
  - Where it's called from `extract.js`, read `settings.reflectionThreshold ?? 30` and pass it.

- File: `src/retrieval/world-context.js`
  - `retrieveWorldContext` already takes `tokenBudget` as a parameter (per design). Where it's called from `retrieve.js`, read `settings.worldContextBudget ?? 2000` and pass it.

- File: `src/extraction/extract.js`
  - Where community detection trigger checks `graph_message_count % 50`, replace `50` with `settings.communityDetectionInterval ?? 50`.

**Note:** The exact changes depend on current function signatures in these files. The executor should read each file first, identify the hardcoded value, and parameterize it.

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: wire UI settings to backend (reflection threshold, world budget, community interval)"`

---

### Task 18: Lint & Final Verification

**Goal:** Run linter and full test suite. Fix any issues.

**Step 1: Run Lint**
- Command: `npm run lint`
- Fix any errors (likely formatting in new code).

**Step 2: Run Full Tests**
- Command: `npm test`
- Expect: All PASS.

**Step 3: Run Lint Fix if needed**
- Command: `npm run lint:fix`

**Step 4: Git Commit**
- Command: `git add . && git commit -m "chore: lint and format UI overhaul changes"`
