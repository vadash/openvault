TL;DR: `graphology` + `graphology-communities-louvain` are your two core packages. Import via `esm.sh` for browser-ESM compatibility. The full workflow is: build graph from extracted entities → serialize to chatMetadata → deserialize → run Louvain → group communities → embed summaries.

***

## Import Strategy (Browser/ESM)

Since OpenVault is a SillyTavern browser extension with no build step, import directly via `esm.sh`:

```js
// src/graph/graph.js
import Graph from 'https://esm.sh/graphology';
import louvain from 'https://esm.sh/graphology-communities-louvain';
import { subgraph } from 'https://esm.sh/graphology-operators';
import { bidirectional } from 'https://esm.sh/graphology-shortest-path';
```

> **Pin your versions** to avoid breaking changes: `https://esm.sh/graphology@0.25.4`.

***

## Graph Initialization

`graphology` supports directed, undirected, and mixed graphs. For GraphRAG you want a **directed** graph (relationships have direction: Character → Castle) but **undirected** communities. Use `MultiDirectedGraph` to allow parallel edges (same entity pair, different relationship types):

```js
import { MultiDirectedGraph } from 'https://esm.sh/graphology';

// One graph per chat session, reconstructed from chatMetadata on load
export function createGraph() {
  return new MultiDirectedGraph({ allowSelfLoops: false });
}
```

***

## Node Operations (Entity Management)

Each entity is a node with attributes. The merge pattern is critical for deduplication:

```js
// ADD or UPDATE an entity node — core merge logic for GraphRAG extraction
export function upsertEntity(graph, name, { type, description }) {
  const key = name.toLowerCase().trim(); // normalize key

  if (graph.hasNode(key)) {
    // Merge: append new description, increment mentions
    const existing = graph.getNodeAttributes(key);
    graph.setNodeAttribute(key, 'description', existing.description + ' | ' + description);
    graph.setNodeAttribute(key, 'mentions', existing.mentions + 1);
  } else {
    graph.addNode(key, {
      name,           // display name (original casing)
      type,           // "PERSON" | "PLACE" | "ITEM" | "CONCEPT"
      description,
      mentions: 1,
    });
  }
}
```

**Key node API methods:**

| Method | Purpose |
|---|---|
| `graph.addNode(key, attrs)` | Add new node with attributes |
| `graph.hasNode(key)` | Check existence before add |
| `graph.getNodeAttributes(key)` | Read all attributes |
| `graph.setNodeAttribute(key, attr, val)` | Update single attribute |
| `graph.mergeNode(key, attrs)` | Add or merge-update in one call |
| `graph.forEachNode((key, attrs) => {})` | Iterate all nodes  |
| `graph.order` | Total node count |

***

## Edge Operations (Relationship Management)

Edges carry `weight` — the relationship strength counter, which Louvain uses directly:

```js
export function upsertRelationship(graph, source, target, description) {
  const srcKey = source.toLowerCase().trim();
  const tgtKey = target.toLowerCase().trim();

  // Ensure nodes exist first
  if (!graph.hasNode(srcKey) || !graph.hasNode(tgtKey)) return;

  // Check for existing edge between this specific pair with same description
  const edgeKey = `${srcKey}__${tgtKey}`;

  if (graph.hasEdge(edgeKey)) {
    // Increment weight on repeated relationship
    const w = graph.getEdgeAttribute(edgeKey, 'weight');
    graph.setEdgeAttribute(edgeKey, 'weight', w + 1);
  } else {
    graph.addEdgeWithKey(edgeKey, srcKey, tgtKey, {
      description,
      weight: 1,
    });
  }
}
```

**Key edge API methods:**

| Method | Purpose |
|---|---|
| `graph.addEdge(src, tgt, attrs)` | Add auto-keyed edge |
| `graph.addEdgeWithKey(key, src, tgt, attrs)` | Add edge with explicit key (needed for dedup) |
| `graph.hasEdge(key)` | Check by edge key |
| `graph.getEdgeAttributes(key)` | Read edge attrs |
| `graph.forEachEdge((key, attrs, src, tgt) => {})` | Iterate all edges |
| `graph.neighbors(node)` | Get all neighbor nodes |
| `graph.size` | Total edge count |

***

## Serialization ↔ chatMetadata

This is the most critical integration point. `graphology` has built-in `export()`/`import()` that map to plain JSON — perfect for `chatMetadata` storage:

```js
// SAVE: call before context.saveSettingsDebounced()
export function serializeGraph(graph) {
  return graph.export(); 
  // Returns: { attributes:{}, nodes:[{key, attributes}], edges:[{key, source, target, attributes}] }
}

// LOAD: call when reconstructing from chatMetadata on chat switch
export function deserializeGraph(serialized) {
  const graph = new MultiDirectedGraph({ allowSelfLoops: false });
  if (serialized) graph.import(serialized);
  return graph;
}

// Usage in your state.js
const state = context.chatMetadata[METADATA_KEY];
const graph = deserializeGraph(state.graph);
// ... do operations ...
state.graph = serializeGraph(graph);
saveSettingsDebounced();
```

The `export()` format is a plain object — no special serializer needed, just dump it into your metadata object.

***

## Community Detection (Louvain)

Run this every 50 newly processed messages via your scheduler:

```js
import louvain from 'https://esm.sh/graphology-communities-louvain';
import { UndirectedGraph } from 'https://esm.sh/graphology';
import { toUndirected } from 'https://esm.sh/graphology-operators';

export function detectCommunities(graph) {
  // Louvain won't run on mixed graphs — cast to undirected first
  const undirected = toUndirected(graph);

  // detailed() gives you modularity score + full dendrogram for diagnostics
  const details = louvain.detailed(undirected, {
    getEdgeWeight: 'weight',   // use your relationship weight attribute
    resolution: 1.0,           // increase (e.g. 1.5) for more communities
    randomWalk: true,
    fastLocalMoves: true,      // 45x faster than jlouvain at 1000 nodes [web:6]
  });

  // details.communities = { "castle": 0, "king": 0, "guard": 0, "tavern": 1, ... }
  // details.count = number of communities found
  // details.modularity = quality score (higher = better separation)

  return details;
}

// Group node keys by community ID
export function groupByCommunity(communityPartition, graph) {
  const groups = {};
  for (const [nodeKey, communityId] of Object.entries(communityPartition)) {
    if (!groups[communityId]) groups[communityId] = [];
    groups[communityId].push({
      key: nodeKey,
      ...graph.getNodeAttributes(nodeKey),
    });
  }
  return groups; // { 0: [{key, name, type, description}...], 1: [...] }
}
```

**Performance benchmark** on a 1000-node/9724-edge graph: `52ms` for graphology vs `2368ms` for the next best JS alternative. Your roleplay graph will rarely exceed a few hundred nodes — this runs in single-digit milliseconds.

***

## Subgraph Extraction (Per-Community LLM Summarization)

To build the community summary prompt, extract the subgraph for each community cluster:

```js
import { subgraph } from 'https://esm.sh/graphology-operators';

export function buildCommunityPromptData(graph, nodeKeys) {
  const sub = subgraph(graph, nodeKeys);
  
  const nodes = [];
  sub.forEachNode((key, attrs) => {
    nodes.push(`- ${attrs.name} (${attrs.type}): ${attrs.description}`);
  });

  const edges = [];
  sub.forEachEdge((key, attrs, src, tgt) => {
    const srcName = graph.getNodeAttribute(src, 'name');
    const tgtName = graph.getNodeAttribute(tgt, 'name');
    edges.push(`- ${srcName} → ${tgtName}: ${attrs.description} [weight: ${attrs.weight}]`);
  });

  return { nodes, edges };
  // Feed directly into your community summarization LLM prompt
}
```

***

## Traversal Utilities

For context retrieval — e.g., finding all entities connected to active characters in a scene:

```js
import { bfsFromNode } from 'https://esm.sh/graphology-traversal';
import { bidirectional } from 'https://esm.sh/graphology-shortest-path';

// Get all entities within 2 hops of a character node (local context expansion)
export function getLocalContext(graph, characterKey, maxDepth = 2) {
  const visited = new Set();
  bfsFromNode(graph, characterKey, (nodeKey, attrs, depth) => {
    if (depth > maxDepth) return true; // stop BFS
    visited.add(nodeKey);
  });
  return [...visited];
}

// Find the relationship path between two entities
export function getRelationshipPath(graph, entityA, entityB) {
  return bidirectional(graph, entityA.toLowerCase(), entityB.toLowerCase());
  // Returns: ["castle", "king", "guard"] or null if no path
}
```

***

## Complete Integration Pattern for OpenVault

```js
// src/graph/index.js — the full lifecycle wired to your existing state system

import { MultiDirectedGraph } from 'https://esm.sh/graphology';
import louvain from 'https://esm.sh/graphology-communities-louvain';
import { toUndirected } from 'https://esm.sh/graphology-operators';

const COMMUNITY_TRIGGER_INTERVAL = 50; // messages

export async function processExtractedEntities(state, entities, relationships) {
  const graph = deserializeGraph(state.graph);

  for (const entity of entities) {
    upsertEntity(graph, entity.name, entity);
  }
  for (const rel of relationships) {
    upsertRelationship(graph, rel.source, rel.target, rel.description);
  }

  state.graph = serializeGraph(graph);
  state.graphMessageCount = (state.graphMessageCount ?? 0) + 1;

  // Trigger community detection + summarization every N messages
  if (state.graphMessageCount % COMMUNITY_TRIGGER_INTERVAL === 0) {
    await rebuildCommunities(state, graph); // async LLM call — use operationState lock
  }
}

async function rebuildCommunities(state, graph) {
  if (graph.order < 3) return; // not enough nodes yet

  const undirected = toUndirected(graph);
  const { communities, count } = louvain.detailed(undirected, {
    getEdgeWeight: 'weight',
    resolution: 1.0,
  });

  const groups = groupByCommunity(communities, graph);
  const newCommunities = {};

  for (const [communityId, nodes] of Object.entries(groups)) {
    const { nodes: nodeLines, edges: edgeLines } = buildCommunityPromptData(graph, nodes.map(n => n.key));
    
    // callLLM via your LLM_CONFIGS.graph config
    const report = await callLLM(LLM_CONFIGS.graph, buildCommunityPrompt(nodeLines, edgeLines));
    const embedding = await embedText(report.summary); // WebGPU pipeline

    newCommunities[`C${communityId}`] = {
      level: 0,
      nodes: nodes.map(n => n.key),
      title: report.title,
      summary: report.summary,
      findings: report.findings,
      embedding, // for cosine similarity retrieval
    };
  }

  state.communities = newCommunities;
}
```

***

## Package Reference

| Package | `esm.sh` URL | Purpose |
|---|---|---|
| `graphology` | `https://esm.sh/graphology` | Core graph structure  |
| `graphology-communities-louvain` | `https://esm.sh/graphology-communities-louvain` | Community detection  |
| `graphology-operators` | `https://esm.sh/graphology-operators` | `toUndirected`, `subgraph`, `union`  |
| `graphology-traversal` | `https://esm.sh/graphology-traversal` | BFS/DFS for local context  |
| `graphology-shortest-path` | `https://esm.sh/graphology-shortest-path` | Dijkstra / bidirectional path  |
| `graphology-metrics` | `https://esm.sh/graphology-metrics` | Modularity, centrality, density  |

No WASM, no build pipeline, no Node.js native modules. All packages are pure JavaScript and confirmed ESM-importable via `esm.sh`.