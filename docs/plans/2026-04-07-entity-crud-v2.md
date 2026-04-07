# Entity CRUD Implementation Plan

**Goal:** Implement entity editing, deletion, and alias management with tab restructure from "World" to "Entities" + "Communities".

**Architecture:** This feature adds user-editable entity cards with inline editing (matching the memory edit pattern). Aliases are stored in `node.aliases` (array of strings). Entity renames rewrite graph edges and update merge redirects. The tab restructure splits the World tab into two focused tabs: Entities (with CRUD) and Communities (read-only for now).

**Tech Stack:** ES modules running directly in-browser via SillyTavern extension, jQuery for DOM manipulation, Zod for validation.

---

## File Structure Overview

**Create:**
- `css/entity-crud.css` - Additional styles for entity cards, alias chips, edit forms (extends world.css)

**Modify:**
- `templates/settings_panel.html` - Replace World tab with Entities + Communities tabs
- `src/store/chat-data.js` - Add `updateEntity()`, `deleteEntity()` methods
- `src/ui/templates.js` - Update `renderEntityCard()`, add `renderEntityEdit()`
- `src/ui/render.js` - Add entity CRUD event bindings, update `renderEntityList()`
- `src/ui/helpers.js` - Update `filterEntities()` to search aliases
- `css/world.css` - Keep existing styles, entity CRUD styles go in new file
- `tests/store/chat-data-updateEntity.test.js` - Tests for updateEntity
- `tests/store/chat-data-deleteEntity.test.js` - Tests for deleteEntity
- `tests/ui/tab-structure.test.js` - Update tab selectors

---

## Task 1: Create CSS Styles for Entity CRUD

**Files:**
- Create: `css/entity-crud.css` (additions only - keep world.css intact)

**Purpose:** Add styles for entity cards with edit buttons, alias chips, edit form layout. Keep existing world.css for Communities tab styling.

**Common Pitfalls:**
- Do NOT delete or rename world.css - Communities tab still needs those styles
- Add new styles in separate file, include both in extension
- Use jQuery-compatible class names (kebab-case)
- Use correct ENTITY_TYPE values: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT

- [ ] Step 1: Read existing world.css to check existing styles

Run: `type css\world.css`
Expected: Shows existing community styles

- [ ] Step 2: Create entity-crud.css with new styles only

Create file `css/entity-crud.css`:

```css
/* Entity Card Styles */
.openvault-entity-card {
  position: relative;
  padding: 12px;
  border: 1px solid var(--st-color-border, #444);
  border-radius: 6px;
  margin-bottom: 8px;
  background: var(--st-color-bg-secondary, #2a2a2a);
}

.openvault-entity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.openvault-entity-name {
  font-weight: bold;
  font-size: 1.1em;
  flex: 1;
}

.openvault-entity-actions {
  display: flex;
  gap: 6px;
}

.openvault-entity-action-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.openvault-entity-action-btn:hover {
  opacity: 1;
}

.openvault-entity-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75em;
  font-weight: 500;
  text-transform: uppercase;
}

/* Type-specific badge colors - match existing ENTITY_TYPES */
.openvault-entity-type-badge[data-type="PERSON"] {
  background: #4a90d9;
  color: white;
}

.openvault-entity-type-badge[data-type="PLACE"] {
  background: #6b8e23;
  color: white;
}

.openvault-entity-type-badge[data-type="ORGANIZATION"] {
  background: #9b59b6;
  color: white;
}

.openvault-entity-type-badge[data-type="OBJECT"] {
  background: #7f8c8d;
  color: white;
}

.openvault-entity-type-badge[data-type="CONCEPT"] {
  background: #e67e22;
  color: white;
}

/* Pending embed badge */
.openvault-pending-embed {
  display: inline-flex;
  align-items: center;
  color: #f1c40f;
  font-size: 0.85em;
}

.openvault-pending-embed .icon {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Alias row */
.openvault-entity-aliases {
  font-size: 0.9em;
  color: var(--st-color-text-secondary, #888);
  margin-bottom: 6px;
  font-style: italic;
}

.openvault-entity-aliases::before {
  content: "aka: ";
}

/* Entity edit form */
.openvault-entity-edit {
  padding: 12px;
  border: 1px solid var(--st-color-border, #444);
  border-radius: 6px;
  background: var(--st-color-bg-tertiary, #333);
}

.openvault-entity-edit-row {
  margin-bottom: 10px;
}

.openvault-entity-edit-row label {
  display: block;
  font-size: 0.85em;
  margin-bottom: 4px;
  color: var(--st-color-text-secondary, #aaa);
}

.openvault-entity-edit-row input[type="text"],
.openvault-entity-edit-row select,
.openvault-entity-edit-row textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--st-color-border, #555);
  border-radius: 4px;
  background: var(--st-color-bg-primary, #1a1a1a);
  color: var(--st-color-text-primary, #fff);
  font-family: inherit;
}

.openvault-entity-edit-row textarea {
  min-height: 80px;
  resize: vertical;
}

/* Alias chips */
.openvault-alias-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.openvault-alias-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--st-color-bg-primary, #1a1a1a);
  border: 1px solid var(--st-color-border, #555);
  border-radius: 12px;
  font-size: 0.85em;
}

.openvault-alias-chip .remove {
  cursor: pointer;
  opacity: 0.6;
  font-weight: bold;
}

.openvault-alias-chip .remove:hover {
  opacity: 1;
}

.openvault-alias-input-row {
  display: flex;
  gap: 6px;
}

.openvault-alias-input-row input {
  flex: 1;
}

.openvault-alias-input-row button {
  padding: 6px 12px;
}

/* Edit form actions */
.openvault-entity-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.openvault-entity-edit-actions button {
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.openvault-entity-edit-actions .cancel {
  background: transparent;
  border: 1px solid var(--st-color-border, #555);
  color: var(--st-color-text-primary, #fff);
}

.openvault-entity-edit-actions .save {
  background: var(--st-color-primary, #4a90d9);
  border: 1px solid var(--st-color-primary, #4a90d9);
  color: white;
}

/* Entity description */
.openvault-entity-description {
  font-size: 0.9em;
  line-height: 1.4;
  color: var(--st-color-text-primary, #ddd);
}

.openvault-entity-mentions {
  font-size: 0.8em;
  color: var(--st-color-text-secondary, #888);
  margin-top: 6px;
}
```

- [ ] Step 3: Verify entity-crud.css created

Run: `dir css\entity-crud.css`
Expected: Shows file exists

- [ ] Step 4: Commit

```bash
git add css/entity-crud.css
git commit -m "feat: add entity CRUD styles (keep world.css for Communities)"
```

.openvault-entity-edit-actions .cancel {
  background: transparent;
  border: 1px solid var(--st-color-border, #555);
  color: var(--st-color-text-primary, #fff);
}

.openvault-entity-edit-actions .save {
  background: var(--st-color-primary, #4a90d9);
  border: 1px solid var(--st-color-primary, #4a90d9);
  color: white;
}

/* Entity description */
.openvault-entity-description {
  font-size: 0.9em;
  line-height: 1.4;
  color: var(--st-color-text-primary, #ddd);
}

.openvault-entity-mentions {
  font-size: 0.8em;
  color: var(--st-color-text-secondary, #888);
  margin-top: 6px;
}
```

- [ ] Step 3: Delete old world.css

Run: `del css\world.css`
Expected: File removed

- [ ] Step 4: Verify entities.css exists

Run: `dir css\entities.css`
Expected: Shows file exists

- [ ] Step 5: Commit

```bash
git add css/entities.css
git rm css/world.css
git commit -m "feat: add entity CRUD styles, rename world.css to entities.css"
```

---

## Task 2: Update Settings Panel HTML for Tab Restructure

**Files:**
- Modify: `templates/settings_panel.html`

**Purpose:** Replace single "World" tab with two tabs: "Entities" (for CRUD) and "Communities" (read-only move of existing community section).

**Common Pitfalls:**
- Keep existing community HTML structure intact - just move it
- Update `data-tab` attributes from "world" to "entities" and "communities"
- Ensure entity list container has id `openvault_entity_list` for event binding
- Include count badges with ids `openvault_entity_count` and `openvault_community_count` for refreshStats()
- Use correct ENTITY_TYPES: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT (not EVENT, ORG, THING)

- [ ] Step 1: Read current settings_panel.html

Run: `type templates\settings_panel.html`
Expected: Shows current World tab structure

- [ ] Step 2: Replace World tab with Entities + Communities tabs

Replace the world tab section:

Find the section starting with:
```html
<li class="nav-item" role="presentation">
  <button class="nav-link" data-tab="world" ...
```

And the corresponding content div:
```html
<div class="tab-pane" data-tab="world" ...
```

Replace with:

```html
<!-- Entities Tab -->
<li class="nav-item" role="presentation">
  <button class="nav-link" data-tab="entities" type="button" role="tab" aria-selected="false">
    Entities
  </button>
</li>
<!-- Communities Tab -->
<li class="nav-item" role="presentation">
  <button class="nav-link" data-tab="communities" type="button" role="tab" aria-selected="false">
    Communities
  </button>
</li>
```

And the content:

```html
<!-- Entities Tab Content -->
<div class="tab-pane" data-tab="entities" role="tabpanel">
  <div id="openvault_entity_controls" class="openvault-controls">
    <div class="openvault-control-row">
      <input type="text" id="openvault_entity_search" class="text_pole" placeholder="Search entities (name, description, or alias)..."></input>
      <select id="openvault_entity_type_filter" class="text_pole">
        <option value="">All Types</option>
        <option value="PERSON">Person</option>
        <option value="PLACE">Place</option>
        <option value="ORGANIZATION">Organization</option>
        <option value="OBJECT">Object</option>
        <option value="CONCEPT">Concept</option>
      </select>
      <span class="openvault-card-badge" id="openvault_entity_count">0</span>
    </div>
  </div>
  <div id="openvault_entity_list" class="openvault-list">
    <!-- Entity cards rendered here -->
  </div>
</div>

<!-- Communities Tab Content -->
<div class="tab-pane" data-tab="communities" role="tabpanel">
  <div id="openvault_community_controls" class="openvault-controls">
    <span class="openvault-card-badge" id="openvault_community_count">0</span>
  </div>
  <div id="openvault_community_list" class="openvault-list">
    <!-- Community summaries rendered here -->
  </div>
</div>
```

- [ ] Step 3: Run UI structure test to verify tabs exist

Run: `npm test -- tests/ui/world-structure.test.js`
Expected: FAIL - tests expect old "world" tab

- [ ] Step 4: Commit

```bash
git add templates/settings_panel.html
git commit -m "feat: split World tab into Entities and Communities tabs"
```

---

## Task 3: Add updateEntity() to Store

**Files:**
- Create: `tests/store/chat-data-updateEntity.test.js`
- Modify: `src/store/chat-data.js`

**Purpose:** Implement entity update with rename handling - rewrites edges and updates merge redirects when key changes.

**Common Pitfalls:**
- Schema uses `data.graph` not `data.graphData` - access nodes/edges via `getOpenVaultData().graph`
- Normalize new name with same logic used elsewhere (check existing normalization)
- Check for collisions BEFORE making any changes (transaction-like)
- Rewrite edge keys properly: sourceKey__targetKey format
- Don't forget to delete old embedding via deleteEmbedding()
- For rename: must delete old hash from ST Vector DB if `_st_synced: true` to prevent orphan

- [ ] Step 1: Write failing test for updateEntity

Create `tests/store/chat-data-updateEntity.test.js`:

```js
// @ts-check
/* global describe, it, expect, beforeEach */
import { describe, it, expect, beforeEach } from 'vitest';
import { updateEntity, getOpenVaultData } from '../../src/store/chat-data.js';
import { setupTestContext } from '../setup.js';

describe('updateEntity', () => {
  beforeEach(() => {
    // Use setupTestContext per tests/CLAUDE.md - never vi.mock
    setupTestContext();
    // Reset graph data for each test (use .graph not .graphData)
    const data = getOpenVaultData();
    data.graph = {
      nodes: {},
      edges: {},
      _mergeRedirects: {},
    };
  });

  it('should update entity description without rename', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A former soldier',
      aliases: [],
    };

    const result = await updateEntity('marcus_hale', {
      description: 'A former soldier turned mercenary',
    });

    expect(result).toBe('marcus_hale');
    expect(data.graph.nodes['marcus_hale'].description).toBe('A former soldier turned mercenary');
  });

  it('should rename entity and rewrite edges', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: [],
    };
    data.graph.nodes['tavern'] = {
      name: 'The Tavern',
      type: 'PLACE',
      description: 'A pub',
      aliases: [],
    };
    data.graph.edges['marcus_hale__tavern'] = {
      source: 'marcus_hale',
      target: 'tavern',
      relation: 'frequents',
    };

    const result = await updateEntity('marcus_hale', {
      name: 'Marcus the Brave',
    });

    expect(result).toBe('marcus_the_brave');
    expect(data.graph.nodes['marcus_the_brave']).toBeDefined();
    expect(data.graph.nodes['marcus_hale']).toBeUndefined();
    expect(data.graph.edges['marcus_the_brave__tavern']).toBeDefined();
    expect(data.graph.edges['marcus_hale__tavern']).toBeUndefined();
    expect(data.graph._mergeRedirects['marcus_hale']).toBe('marcus_the_brave');
  });

  it('should block rename to existing entity name', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: [],
    };
    data.graph.nodes['john_doe'] = {
      name: 'John Doe',
      type: 'PERSON',
      description: 'Another person',
      aliases: [],
    };

    const result = await updateEntity('marcus_hale', {
      name: 'John Doe',
    });

    expect(result).toBeNull();
    expect(data.graph.nodes['marcus_hale']).toBeDefined();
  });

  it('should update aliases array', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: ['masked figure'],
    };

    await updateEntity('marcus_hale', {
      aliases: ['masked figure', 'the stranger'],
    });

    expect(data.graph.nodes['marcus_hale'].aliases).toEqual(['masked figure', 'the stranger']);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- tests/store/chat-data-updateEntity.test.js`
Expected: FAIL - "updateEntity is not exported" or "updateEntity is not a function"

- [ ] Step 3: Read existing chat-data.js to understand structure

Run: `type src\store\chat-data.js`
Expected: Shows existing store methods like updateMemory, deleteMemory

- [ ] Step 4: Implement updateEntity() function

Add to `src/store/chat-data.js` (after existing update/delete methods):

```js
import { deleteEmbedding } from '../utils/embedding-codec.js';

/**
 * Normalize entity name to graph key
 * @param {string} name - Entity name
 * @returns {string} Normalized key
 */
function normalizeEntityKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Update an entity's fields. Handles rename by rewriting edges and merge redirects.
 * @param {string} key - Current normalized entity key
 * @param {Object} updates - { name?, type?, description?, aliases? }
 * @returns {Promise<string|null>} New key if renamed, null on failure
 */
export async function updateEntity(key, updates) {
  const { saveChatConditional } = getDeps();
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData
  const node = graph.nodes[key];

  if (!node) {
    console.warn(`[OpenVault] Cannot update entity: ${key} not found`);
    return null;
  }

  // Determine if renaming
  const newName = updates.name ?? node.name;
  const newKey = normalizeEntityKey(newName);

  // If renaming, check for collision
  if (newKey !== key) {
    if (graph.nodes[newKey]) {
      console.warn(`[OpenVault] Cannot rename to '${newName}': entity already exists`);
      return null;
    }
  }

  if (newKey !== key) {
    // Create new node with updated fields
    graph.nodes[newKey] = {
      ...node,
      name: newName,
      type: updates.type ?? node.type,
      description: updates.description ?? node.description,
      aliases: updates.aliases ?? node.aliases ?? [],
    };

    // Delete old node
    delete graph.nodes[key];

    // Rewrite edges
    for (const [edgeKey, edge] of Object.entries(graph.edges)) {
      let needsRewrite = false;
      let newSource = edge.source;
      let newTarget = edge.target;

      if (edge.source === key) {
        newSource = newKey;
        needsRewrite = true;
      }
      if (edge.target === key) {
        newTarget = newKey;
        needsRewrite = true;
      }

      if (needsRewrite) {
        const newEdgeKey = `${newSource}__${newTarget}`;
        delete graph.edges[edgeKey];
        graph.edges[newEdgeKey] = {
          ...edge,
          source: newSource,
          target: newTarget,
        };
      }
    }

    // Set merge redirect
    graph._mergeRedirects[key] = newKey;

    // Invalidate embedding
    deleteEmbedding(graph.nodes[newKey]);

    await saveChatConditional();
    return newKey;
  } else {
    // Simple field update, no rename
    Object.assign(node, {
      type: updates.type ?? node.type,
      description: updates.description ?? node.description,
      aliases: updates.aliases ?? node.aliases ?? [],
    });

    // Invalidate embedding on description change
    if (updates.description !== undefined) {
      deleteEmbedding(node);
    }

    await saveChatConditional();
    return key;
  }
}
```

- [ ] Step 5: Run test to verify it passes

Run: `npm test -- tests/store/chat-data-updateEntity.test.js`
Expected: PASS - all tests pass

- [ ] Step 6: Commit

```bash
git add tests/store/chat-data-updateEntity.test.js src/store/chat-data.js
git commit -m "feat: add updateEntity() with rename and edge rewriting"
```

---

## Task 4: Add deleteEntity() to Store

**Files:**
- Create: `tests/store/chat-data-deleteEntity.test.js`
- Modify: `src/store/chat-data.js`

**Purpose:** Implement entity deletion with edge cleanup, merge redirect cleanup, and ST Vector orphan cleanup.

**Common Pitfalls:**
- Use `data.graph` not `data.graphData` for node/edge access
- Remove all edges where entity is source OR target
- Clean up merge redirects pointing to or from the deleted key
- Must delete from ST Vector DB if `_st_synced: true` to prevent orphan embeddings
- Return boolean to indicate success/failure

- [ ] Step 1: Write failing test for deleteEntity

Create `tests/store/chat-data-deleteEntity.test.js`:

```js
// @ts-check
/* global describe, it, expect, beforeEach */
import { describe, it, expect, beforeEach } from 'vitest';
import { deleteEntity, getOpenVaultData } from '../../src/store/chat-data.js';
import { setupTestContext } from '../setup.js';

describe('deleteEntity', () => {
  beforeEach(() => {
    // Use setupTestContext per tests/CLAUDE.md - never vi.mock
    setupTestContext();
    const data = getOpenVaultData();
    // Use .graph not .graphData
    data.graph = {
      nodes: {},
      edges: {},
      _mergeRedirects: {},
    };
  });

  it('should delete entity with no edges', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: [],
    };

    const result = await deleteEntity('marcus_hale');

    expect(result).toBe(true);
    expect(data.graph.nodes['marcus_hale']).toBeUndefined();
  });

  it('should delete entity and remove connected edges', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: [],
    };
    data.graph.nodes['tavern'] = {
      name: 'The Tavern',
      type: 'PLACE',
      description: 'A pub',
      aliases: [],
    };
    data.graph.edges['marcus_hale__tavern'] = {
      source: 'marcus_hale',
      target: 'tavern',
      relation: 'frequents',
    };
    data.graph.edges['tavern__marcus_hale'] = {
      source: 'tavern',
      target: 'marcus_hale',
      relation: 'patron',
    };

    const result = await deleteEntity('marcus_hale');

    expect(result).toBe(true);
    expect(data.graph.nodes['marcus_hale']).toBeUndefined();
    expect(data.graph.edges['marcus_hale__tavern']).toBeUndefined();
    expect(data.graph.edges['tavern__marcus_hale']).toBeUndefined();
  });

  it('should clean up merge redirects when deleting entity', async () => {
    const data = getOpenVaultData();
    data.graph.nodes['marcus_hale'] = {
      name: 'Marcus Hale',
      type: 'PERSON',
      description: 'A soldier',
      aliases: [],
    };
    data.graph._mergeRedirects = {
      'old_name': 'marcus_hale',
      'marcus_hale': 'new_name',
    };

    await deleteEntity('marcus_hale');

    expect(data.graph._mergeRedirects['old_name']).toBeUndefined();
    expect(data.graph._mergeRedirects['marcus_hale']).toBeUndefined();
  });

  it('should return false for non-existent entity', async () => {
    const result = await deleteEntity('non_existent');
    expect(result).toBe(false);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- tests/store/chat-data-deleteEntity.test.js`
Expected: FAIL - "deleteEntity is not exported"

- [ ] Step 3: Implement deleteEntity() function

Add to `src/store/chat-data.js` (after updateEntity):

```js
import { cyrb53 } from '../utils/hash.js'; // For calculating ST Vector hash

/**
 * Delete an entity and all its edges and merge redirects.
 * Also deletes from ST Vector storage if _st_synced to prevent orphan embeddings.
 * @param {string} key - Normalized entity key
 * @returns {Promise<{success: boolean, stChanges?: {toDelete: string[]}}>}
 */
export async function deleteEntity(key) {
  const { saveChatConditional } = getDeps();
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData

  const node = graph.nodes[key];
  if (!node) {
    console.warn(`[OpenVault] Cannot delete entity: ${key} not found`);
    return { success: false };
  }

  // Track ST Vector items to delete (prevent orphan embeddings)
  const toDelete = [];
  if (node._st_synced) {
    // Calculate hash using same format as insertion: [OV_ID:key] description
    const text = `[OV_ID:${key}] ${node.description || node.name}`;
    const hash = cyrb53(text).toString();
    toDelete.push(hash);
  }

  // Delete the node
  delete graph.nodes[key];

  // Remove all edges connected to this entity
  for (const [edgeKey, edge] of Object.entries(graph.edges)) {
    if (edge.source === key || edge.target === key) {
      delete graph.edges[edgeKey];
    }
  }

  // Clean up merge redirects
  for (const [redirectKey, redirectValue] of Object.entries(graph._mergeRedirects)) {
    if (redirectKey === key || redirectValue === key) {
      delete graph._mergeRedirects[redirectKey];
    }
  }

  await saveChatConditional();

  return {
    success: true,
    stChanges: toDelete.length > 0 ? { toDelete } : undefined
  };
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- tests/store/chat-data-deleteEntity.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add tests/store/chat-data-deleteEntity.test.js src/store/chat-data.js
git commit -m "feat: add deleteEntity() with edge, redirect, and ST Vector cleanup"
```

---

## Task 5: Update renderEntityCard() in Templates

**Files:**
- Modify: `src/ui/templates.js`

**Purpose:** Add edit/delete buttons, alias display, and pending-embed badge to entity cards.

**Common Pitfalls:**
- Use `data-key` attribute with the entity's normalized key
- Check for embedding using hasEmbedding() utility (import from embedding-codec.js)
- Only show aliases row if aliases array is non-empty
- Use existing icon patterns from memory cards

- [ ] Step 1: Read existing templates.js to understand current renderEntityCard

Run: `type src\ui\templates.js`
Expected: Shows current renderEntityCard function

- [ ] Step 2: Update renderEntityCard() function

Find and replace the `renderEntityCard` function:

```js
import { hasEmbedding } from '../utils/embedding-codec.js';
import { ENTITY_TYPES } from '../constants.js';

/**
 * Render an entity card in view mode
 * @param {Object} entity - Entity node with name, type, description, aliases
 * @param {string} key - Normalized entity key
 * @returns {string} HTML string
 */
export function renderEntityCard(entity, key) {
  const typeConfig = ENTITY_TYPES[entity.type] || ENTITY_TYPES.OBJECT;
  const aliasText = entity.aliases?.length > 0
    ? entity.aliases.join(', ')
    : '';
  const pendingBadge = !hasEmbedding(entity)
    ? '<span class="openvault-pending-embed"><span class="icon">↻</span> pending</span>'
    : '';

  return `
    <div class="openvault-entity-card" data-key="${key}">
      <div class="openvault-entity-header">
        <span class="openvault-entity-name">${escapeHtml(entity.name)}</span>
        <div class="openvault-entity-badges">
          <span class="openvault-entity-type-badge" data-type="${entity.type}">
            ${typeConfig}
          </span>
          ${pendingBadge}
        </div>
        <div class="openvault-entity-actions">
          <button class="openvault-entity-action-btn openvault-edit-entity" data-key="${key}" title="Edit">
            ✏️
          </button>
          <button class="openvault-entity-action-btn openvault-delete-entity" data-key="${key}" title="Delete">
            🗑️
          </button>
        </div>
      </div>
      ${aliasText ? `<div class="openvault-entity-aliases">${escapeHtml(aliasText)}</div>` : ''}
      <div class="openvault-entity-description">${escapeHtml(entity.description || '')}</div>
      <div class="openvault-entity-mentions">${entity.mentions || 0} mentions</div>
    </div>
  `;
}
```

Add helper if not present:

```js
/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] Step 3: Run templates test if exists

Run: `npm test -- tests/ui/templates.test.js 2>nul || echo "No templates test yet"`
Expected: Either runs tests or shows no test file

- [ ] Step 4: Commit

```bash
git add src/ui/templates.js
git commit -m "feat: update renderEntityCard with edit/delete buttons and aliases"
```

---

## Task 6: Add renderEntityEdit() in Templates

**Files:**
- Modify: `src/ui/templates.js`

**Purpose:** Create edit mode form following memory edit pattern - text inputs for name, type dropdown, description textarea, alias chips with add/remove.

**Common Pitfalls:**
- Pre-populate all fields with current values
- Use data-key for cancel/save buttons
- Include all 5 entity types in dropdown
- Alias chips need remove buttons with data-alias attribute

- [ ] Step 1: Add renderEntityEdit() function to templates.js

Add after renderEntityCard:

```js
/**
 * Render an entity card in edit mode
 * @param {Object} entity - Entity node with name, type, description, aliases
 * @param {string} key - Normalized entity key
 * @returns {string} HTML string
 */
export function renderEntityEdit(entity, key) {
  const aliasChips = (entity.aliases || [])
    .map(alias => `
      <span class="openvault-alias-chip">
        ${escapeHtml(alias)}
        <span class="remove openvault-remove-alias" data-key="${key}" data-alias="${escapeHtml(alias)}">×</span>
      </span>
    `).join('');

  const typeOptions = Object.entries(ENTITY_TYPES).map(([type, label]) => `
    <option value="${type}" ${entity.type === type ? 'selected' : ''}>
      ${label}
    </option>
  `).join('');

  return `
    <div class="openvault-entity-edit" data-key="${key}">
      <div class="openvault-entity-edit-row">
        <label>Name</label>
        <input type="text" class="openvault-edit-name" value="${escapeHtml(entity.name)}" data-key="${key}">
      </div>
      <div class="openvault-entity-edit-row">
        <label>Type</label>
        <select class="openvault-edit-type" data-key="${key}">
          ${typeOptions}
        </select>
      </div>
      <div class="openvault-entity-edit-row">
        <label>Description</label>
        <textarea class="openvault-edit-description" data-key="${key}" rows="3">${escapeHtml(entity.description || '')}</textarea>
      </div>
      <div class="openvault-entity-edit-row">
        <label>Aliases</label>
        <div class="openvault-alias-list" data-key="${key}">
          ${aliasChips}
        </div>
        <div class="openvault-alias-input-row">
          <input type="text" class="openvault-alias-input" placeholder="e.g. The Stranger, Masked Figure..." data-key="${key}">
          <button class="openvault-add-alias" data-key="${key}">Add</button>
        </div>
      </div>
      <div class="openvault-entity-edit-actions">
        <button class="cancel openvault-cancel-entity-edit" data-key="${key}">Cancel</button>
        <button class="save openvault-save-entity-edit" data-key="${key}">Save</button>
      </div>
    </div>
  `;
}
```

- [ ] Step 2: Export the new function if using named exports

Verify export statement includes `renderEntityEdit`:

```js
export { renderEntityCard, renderEntityEdit, /* other exports */ };
```

- [ ] Step 3: Commit

```bash
git add src/ui/templates.js
git commit -m "feat: add renderEntityEdit() for entity editing form"
```

---

## Task 7: Update filterEntities() to Search Aliases

**Files:**
- Modify: `src/ui/helpers.js`

**Purpose:** Include aliases in entity search matching so searching "masked figure" finds "Marcus Hale".

**Common Pitfalls:**
- Handle case-insensitive search
- Handle empty aliases array
- Don't break existing name/description search

- [ ] Step 1: Read existing helpers.js

Run: `type src\ui\helpers.js`
Expected: Shows current filterEntities function

- [ ] Step 2: Update filterEntities() to include aliases

Replace or update the filterEntities function:

```js
/**
 * Filter entities based on search query and type filter
 * @param {Object} graph - Graph object with nodes (from data.graph)
 * @param {string} query - Search query
 * @param {string} typeFilter - Entity type to filter by (or empty for all)
 * @returns {Array<[string, Object]>} Array of [key, entity] tuples
 */
export function filterEntities(graph, query, typeFilter) {
  const normalizedQuery = query.toLowerCase().trim();

  return Object.entries(graph?.nodes || {})
    .filter(([key, entity]) => {
      // Type filter
      if (typeFilter && entity.type !== typeFilter) {
        return false;
      }

      // Search query - check name, description, and aliases
      if (!normalizedQuery) {
        return true;
      }

      const name = (entity.name || '').toLowerCase();
      const desc = (entity.description || '').toLowerCase();
      const aliases = (entity.aliases || []).join(' ').toLowerCase();

      return name.includes(normalizedQuery) ||
             desc.includes(normalizedQuery) ||
             aliases.includes(normalizedQuery);
    })
    .sort((a, b) => (b[1].mentions || 0) - (a[1].mentions || 0));
}
```

- [ ] Step 3: Write test for alias search

Create `tests/ui/helpers-alias-search.test.js`:

```js
// @ts-check
import { describe, it, expect } from 'vitest';
import { filterEntities } from '../../src/ui/helpers.js';

describe('filterEntities alias search', () => {
  const mockGraph = {
    nodes: {
      'marcus_hale': {
        name: 'Marcus Hale',
        type: 'PERSON',
        description: 'A former soldier',
        aliases: ['masked figure', 'the stranger'],
        mentions: 5,
      },
      'tavern': {
        name: 'The Tavern',
        type: 'PLACE',
        description: 'A drinking establishment',
        aliases: [],
        mentions: 3,
      },
    },
  };

  it('should find entity by alias', () => {
    const results = filterEntities(mockGraph, 'masked figure', '');
    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('marcus_hale');
  });

  it('should find entity by second alias', () => {
    const results = filterEntities(mockGraph, 'stranger', '');
    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('marcus_hale');
  });

  it('should still find by name', () => {
    const results = filterEntities(mockGraph, 'Marcus', '');
    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('marcus_hale');
  });
});
```

- [ ] Step 4: Run test to verify

Run: `npm test -- tests/ui/helpers-alias-search.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add src/ui/helpers.js tests/ui/helpers-alias-search.test.js
git commit -m "feat: include aliases in entity search"
```

---

## Task 8: Add Event Bindings for Entity CRUD

**Files:**
- Modify: `src/ui/render.js`

**Purpose:** Wire up edit, delete, save, cancel, and alias add/remove buttons with event delegation following memory pattern.

**Common Pitfalls:**
- Use event delegation on the container, not individual elements
- Count edges before delete for confirm dialog
- Validate name is not empty before save
- Handle alias add on Enter key as well as button click

- [ ] Step 1: Read existing render.js to understand patterns

Run: `type src\ui\render.js`
Expected: Shows memory event binding patterns

- [ ] Step 2: Add imports for new store methods

At top of file, add:

```js
import { updateEntity, deleteEntity, getOpenVaultData } from '../store/chat-data.js';
import { renderEntityCard, renderEntityEdit } from './templates.js';
import { filterEntities } from './helpers.js';
import { deleteItemsFromST } from '../services/st-vector.js'; // For ST Vector cleanup
```

- [ ] Step 3: Add entity CRUD event bindings

Add to initialization function (where other event bindings are set up):

```js
/**
 * Initialize entity list event bindings
 * Called once during UI setup
 */
function initEntityEventBindings() {
  const $container = $('#openvault_entity_list');
  if ($container.length === 0) return;

  // Edit button - switch to edit mode
  $container.on('click', '.openvault-edit-entity', (e) => {
    const key = $(e.currentTarget).data('key');
    enterEntityEditMode(key);
  });

  // Delete button - confirm and delete
  $container.on('click', '.openvault-delete-entity', async (e) => {
    const key = $(e.currentTarget).data('key');
    await deleteEntityAction(key);
  });

  // Cancel button - revert to view mode
  $container.on('click', '.openvault-cancel-entity-edit', (e) => {
    const key = $(e.currentTarget).data('key');
    cancelEntityEdit(key);
  });

  // Save button - validate and save
  $container.on('click', '.openvault-save-entity-edit', async (e) => {
    const key = $(e.currentTarget).data('key');
    await saveEntityEdit(key, e.currentTarget);
  });

  // Remove alias button
  $container.on('click', '.openvault-remove-alias', (e) => {
    const key = $(e.currentTarget).data('key');
    const alias = $(e.currentTarget).data('alias');
    removeAliasChip(key, alias);
  });

  // Add alias button
  $container.on('click', '.openvault-add-alias', (e) => {
    const key = $(e.currentTarget).data('key');
    addAliasChip(key);
  });

  // Add alias on Enter key
  $container.on('keypress', '.openvault-alias-input', (e) => {
    if (e.which === 13) {
      const key = $(e.currentTarget).data('key');
      addAliasChip(key);
    }
  });
}
```

- [ ] Step 4: Add CRUD action functions

Add the action functions:

```js
// In-memory storage for edit form state
const entityEditState = new Map();

/**
 * Enter edit mode for an entity
 * @param {string} key - Entity key
 */
function enterEntityEditMode(key) {
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData
  const entity = graph.nodes[key];
  if (!entity) return;

  // Store current state for potential cancel
  entityEditState.set(key, { ...entity });

  // Replace card with edit form
  const $card = $(`.openvault-entity-card[data-key="${key}"]`);
  const editHtml = renderEntityEdit(entity, key);
  $card.replaceWith(editHtml);
}

/**
 * Cancel entity edit and revert to view mode
 * @param {string} key - Entity key
 */
function cancelEntityEdit(key) {
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData
  const entity = graph.nodes[key];
  if (!entity) return;

  entityEditState.delete(key);

  const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
  const viewHtml = renderEntityCard(entity, key);
  $edit.replaceWith(viewHtml);
}

/**
 * Save entity edit
 * @param {string} key - Entity key
 * @param {HTMLElement} btn - Save button element
 */
async function saveEntityEdit(key, btn) {
  const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
  const name = $edit.find('.openvault-edit-name').val()?.toString().trim();
  const type = $edit.find('.openvault-edit-type').val()?.toString();
  const description = $edit.find('.openvault-edit-description').val()?.toString().trim();

  // Validation
  if (!name) {
    alert('Entity name cannot be empty');
    return;
  }

  // Build aliases from chips
  const aliases = $edit.find('.openvault-alias-chip')
    .map((_, chip) => $(chip).text().replace('×', '').trim())
    .get();

  const updates = {
    name,
    type,
    description,
    aliases,
  };

  // Show loading state
  const $btn = $(btn);
  const originalText = $btn.text();
  $btn.prop('disabled', true).text('Saving...');

  try {
    const newKey = await updateEntity(key, updates);

    if (newKey === null) {
      alert('An entity with that name already exists. Merging will be available in a future update.');
      $btn.prop('disabled', false).text(originalText);
      return;
    }

    // Clear edit state
    entityEditState.delete(key);

    // Replace with updated view card (use newKey if renamed)
    const graph = getOpenVaultData().graph;  // Use .graph not .graphData
    const entity = graph.nodes[newKey];
    const viewHtml = renderEntityCard(entity, newKey);
    $edit.replaceWith(viewHtml);
  } catch (err) {
    console.error('[OpenVault] Failed to save entity:', err);
    $btn.prop('disabled', false).text(originalText);
  }
}

/**
 * Delete entity action with confirmation
 * @param {string} key - Entity key
 */
async function deleteEntityAction(key) {
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData
  const entity = graph.nodes[key];
  if (!entity) return;

  // Count connected edges
  const edgeCount = Object.values(graph.edges).filter(
    e => e.source === key || e.target === key
  ).length;

  const confirmMsg = edgeCount > 0
    ? `Delete "${entity.name}"? This will also remove ${edgeCount} connected relationship(s).`
    : `Delete "${entity.name}"?`;

  if (!confirm(confirmMsg)) return;

  const result = await deleteEntity(key);
  if (result.success) {
    // Remove from DOM
    $(`.openvault-entity-card[data-key="${key}"]`).remove();

    // Clean up ST Vector if needed
    if (result.stChanges?.toDelete?.length > 0) {
      const chatId = getCurrentChatId();
      if (chatId) {
        await deleteItemsFromST(result.stChanges.toDelete, chatId);
      }
    }
  }
}

/**
 * Remove alias chip from edit form
 * @param {string} key - Entity key
 * @param {string} alias - Alias to remove
 */
function removeAliasChip(key, alias) {
  const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
  $edit.find(`.openvault-remove-alias[data-alias="${alias}"]`)
    .closest('.openvault-alias-chip')
    .remove();
}

/**
 * Add alias chip to edit form
 * @param {string} key - Entity key
 */
function addAliasChip(key) {
  const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
  const $input = $edit.find('.openvault-alias-input');
  const alias = $input.val()?.toString().trim();

  if (!alias) return;

  // Check for duplicates (case-insensitive)
  const existingAliases = $edit.find('.openvault-alias-chip')
    .map((_, chip) => $(chip).text().replace('×', '').trim().toLowerCase())
    .get();

  if (existingAliases.includes(alias.toLowerCase())) {
    $input.val('');
    return;
  }

  // Add chip
  const chipHtml = `
    <span class="openvault-alias-chip">
      ${escapeHtml(alias)}
      <span class="remove openvault-remove-alias" data-key="${key}" data-alias="${escapeHtml(alias)}">×</span>
    </span>
  `;
  $edit.find('.openvault-alias-list').append(chipHtml);
  $input.val('');
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] Step 5: Call initEntityEventBindings in setup

Find where UI is initialized and add:

```js
initEntityEventBindings();
```

- [ ] Step 6: Commit

```bash
git add src/ui/render.js
git commit -m "feat: add entity CRUD event bindings and actions"
```

---

## Task 9: Update renderEntityList() for New Tab

**Files:**
- Modify: `src/ui/render.js`

**Purpose:** Update entity list rendering to use new container ID and work with tab restructure.

**Common Pitfalls:**
- Update container selector from world-specific to entities-specific
- Ensure it works with the new tab structure

- [ ] Step 1: Find and update renderEntityList function

Find the entity list rendering function and update container selector:

```js
/**
 * Render the entity list
 * @param {string} searchQuery - Current search query
 * @param {string} typeFilter - Current type filter
 */
export function renderEntityList(searchQuery = '', typeFilter = '') {
  const graph = getOpenVaultData().graph;  // Use .graph not .graphData
  const $container = $('#openvault_entity_list');

  if ($container.length === 0) return;

  const filtered = filterEntities(graph, searchQuery, typeFilter);

  if (filtered.length === 0) {
    $container.html('<div class="openvault-empty">No entities found</div>');
    return;
  }

  const html = filtered
    .map(([key, entity]) => renderEntityCard(entity, key))
    .join('');

  $container.html(html);
}
```

- [ ] Step 2: Update tab switching logic if needed

Find tab switching code and ensure it handles the new tabs:

```js
// In tab switch handler
$(document).on('click', '[data-tab="entities"]', () => {
  renderEntityList();
});

$(document).on('click', '[data-tab="communities"]', () => {
  renderCommunityList();
});
```

- [ ] Step 3: Commit

```bash
git add src/ui/render.js
git commit -m "feat: update entity list rendering for new tab structure"
```

---

## Task 10: Update UI Structure Tests

**Files:**
- Modify: `tests/ui/world-structure.test.js`

**Purpose:** Update test selectors from "world" to "entities" and "communities" tabs.

- [ ] Step 1: Read existing test file

Run: `type tests\ui\world-structure.test.js`
Expected: Shows current tests for World tab

- [ ] Step 2: Update test file

Replace references to "world" with "entities" and "communities":

```js
// @ts-check
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('UI Tab Structure', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../../templates/settings_panel.html'),
    'utf-8'
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;

  it('should have Entities tab', () => {
    const entitiesTab = document.querySelector('[data-tab="entities"]');
    expect(entitiesTab).toBeTruthy();
  });

  it('should have Communities tab', () => {
    const communitiesTab = document.querySelector('[data-tab="communities"]');
    expect(communitiesTab).toBeTruthy();
  });

  it('should not have old World tab', () => {
    const worldTab = document.querySelector('[data-tab="world"]');
    expect(worldTab).toBeFalsy();
  });

  it('should have entity list container', () => {
    const entityList = document.querySelector('#openvault_entity_list');
    expect(entityList).toBeTruthy();
  });

  it('should have community list container', () => {
    const communityList = document.querySelector('#openvault_community_list');
    expect(communityList).toBeTruthy();
  });

  it('should have entity search input', () => {
    const searchInput = document.querySelector('#openvault_entity_search');
    expect(searchInput).toBeTruthy();
  });

  it('should have entity type filter', () => {
    const typeFilter = document.querySelector('#openvault_entity_type_filter');
    expect(typeFilter).toBeTruthy();
  });
});
```

- [ ] Step 3: Rename test file

Run: `rename tests\ui\world-structure.test.js tests\ui\tab-structure.test.js`
Expected: File renamed

- [ ] Step 4: Run updated tests

Run: `npm test -- tests/ui/tab-structure.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add tests/ui/tab-structure.test.js
git rm tests/ui/world-structure.test.js 2>nul || git add tests/ui/world-structure.test.js
git commit -m "test: update UI structure tests for Entities/Communities tabs"
```

---

## Task 11: Final Integration Test

**Files:**
- Create: `tests/integration/entity-crud.test.js`

**Purpose:** Verify end-to-end entity CRUD workflow.

- [ ] Step 1: Create integration test

Create `tests/integration/entity-crud.test.js`:

```js
// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { updateEntity, deleteEntity, getOpenVaultData } from '../../src/store/chat-data.js';
import { renderEntityCard, renderEntityEdit } from '../../src/ui/templates.js';
import { filterEntities } from '../../src/ui/helpers.js';
import { setupTestContext } from '../setup.js';

describe('Entity CRUD Integration', () => {
  beforeEach(() => {
    // Use setupTestContext per tests/CLAUDE.md - never vi.mock
    setupTestContext();
    const data = getOpenVaultData();
    // Use .graph not .graphData
    data.graph = {
      nodes: {},
      edges: {},
      _mergeRedirects: {},
    };
  });

  it('should complete full entity workflow', async () => {
    const data = getOpenVaultData();

    // Create initial entity
    data.graph.nodes['masked_figure'] = {
      name: 'Masked Figure',
      type: 'PERSON',
      description: 'A mysterious person in a mask',
      aliases: ['the stranger'],
      mentions: 3,
    };

    // Render view card
    const viewHtml = renderEntityCard(data.graph.nodes['masked_figure'], 'masked_figure');
    expect(viewHtml).toContain('Masked Figure');
    expect(viewHtml).toContain('aka:');
    expect(viewHtml).toContain('the stranger');

    // Update with alias
    await updateEntity('masked_figure', {
      aliases: ['the stranger', 'shadow walker'],
    });

    expect(data.graph.nodes['masked_figure'].aliases).toContain('shadow walker');

    // Search by alias
    const results = filterEntities(data.graph, 'shadow walker', '');
    expect(results).toHaveLength(1);

    // Render edit form
    const editHtml = renderEntityEdit(data.graph.nodes['masked_figure'], 'masked_figure');
    expect(editHtml).toContain('shadow walker');
    expect(editHtml).toContain('openvault-alias-chip');

    // Rename entity
    const newKey = await updateEntity('masked_figure', { name: 'Marcus Hale' });
    expect(newKey).toBe('marcus_hale');
    expect(data.graphData.nodes['marcus_hale']).toBeDefined();
    expect(data.graphData.nodes['masked_figure']).toBeUndefined();

    // Delete entity
    const deleted = await deleteEntity('marcus_hale');
    expect(deleted).toBe(true);
    expect(data.graphData.nodes['marcus_hale']).toBeUndefined();
  });
});
```

- [ ] Step 2: Run integration test

Run: `npm test -- tests/integration/entity-crud.test.js`
Expected: PASS

- [ ] Step 3: Run full test suite

Run: `npm test`
Expected: All tests pass

- [ ] Step 4: Commit

```bash
git add tests/integration/entity-crud.test.js
git commit -m "test: add entity CRUD integration tests"
```

---

## Task 12: Verify ENTITY_TYPES Import

**Files:**
- Modify: `src/ui/templates.js` (verify import)

**Purpose:** Ensure ENTITY_TYPES constant is imported correctly. The constant already exists in `src/constants.js` with values: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.

- [ ] Step 1: Verify ENTITY_TYPES import in templates.js

Ensure import exists:

```js
import { ENTITY_TYPES } from '../constants.js';
```

Note: ENTITY_TYPES is a simple frozen object where values are strings (not objects with label/color properties). Access directly: `ENTITY_TYPES.PERSON` returns `"PERSON"`.

- [ ] Step 2: Commit (if import was missing)

```bash
git add src/ui/templates.js 2>nul && git commit -m "fix: ensure ENTITY_TYPES import in templates" || echo "Import already present"
```

---

## Task 13: Final Verification and Commit

**Files:**
- All modified files

**Purpose:** Run typecheck and lint, verify all changes are complete.

- [ ] Step 1: Run typecheck

Run: `npm run typecheck`
Expected: No errors

- [ ] Step 2: Run lint

Run: `npm run lint`
Expected: No errors

- [ ] Step 3: Run all tests

Run: `npm test`
Expected: All tests pass

- [ ] Step 4: Stage all changes

Run: `git add -A`
Expected: All new and modified files staged

- [ ] Step 5: Final commit

```bash
git commit -m "feat: implement entity CRUD - edit, delete, alias management

- Split World tab into Entities and Communities tabs
- Add edit/delete buttons to entity cards
- Implement inline entity editing with name, type, description
- Add alias management with chip UI (add/remove)
- Implement entity rename with edge rewriting
- Add deleteEntity with edge and merge redirect cleanup
- Update search to include aliases
- Add pending embed badge to cards
- Add comprehensive tests for all operations

Refs: docs/designs/2026-04-07-entity-crud.md"
```

---

## Summary

This implementation plan covers the complete Entity CRUD feature:

1. **Task 1:** CSS styles for cards, edit forms, alias chips
2. **Task 2:** HTML tab restructure (World → Entities + Communities)
3. **Task 3:** `updateEntity()` store method with edge rewriting
4. **Task 4:** `deleteEntity()` store method with cleanup
5. **Task 5:** Updated `renderEntityCard()` with buttons and aliases
6. **Task 6:** New `renderEntityEdit()` for edit mode
7. **Task 7:** Updated `filterEntities()` to search aliases
8. **Task 8:** Event bindings for all CRUD actions
9. **Task 9:** Updated `renderEntityList()` for new structure
10. **Task 10:** Updated UI structure tests
11. **Task 11:** Integration tests
12. **Task 12:** Constants verification
13. **Task 13:** Final verification and commit

Each task follows TDD red-green methodology with explicit commands and expected outputs.
