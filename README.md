# OpenVault — Agentic Memory for SillyTavern

OpenVault is a memory extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) (v1.13.0+) that gives AI characters persistent, POV-aware recall across long conversations.

It runs entirely in the browser. No external databases, no cloud services, no setup beyond installing the extension. All data is stored inside your SillyTavern chat files.

## History

9.00 - good stable for single char RP

9.50 - fixing rewrite prompt structure for CN models + fix of group play (PoV)

10.00 - || requests (optional)

## What It Does

During a conversation, OpenVault silently works in the background:

1. **Extracts** structured events from new messages — who was there, what happened, how important it was.
2. **Builds a knowledge graph** of entities (people, places, objects) and their relationships.
3. **Generates reflections** — high-level psychological insights synthesized from accumulated events.
4. **Detects communities** — clusters of related entities (e.g., "The Royal Court", "The Rebel Camp") summarized as dynamic world context.
5. **Retrieves and injects** the most relevant memories into the prompt before each AI response.

Characters only remember what they witnessed or were told about. No meta-gaming.

## Images

<p align="center">
  <img width="32%" alt="Screenshot 2026-03-08 160107" src="https://github.com/user-attachments/assets/ae81565e-8745-4d86-b6d1-5b73d65d355a" />
  <img width="32%" alt="Screenshot 2026-03-08 160132" src="https://github.com/user-attachments/assets/34427dcf-1e5b-4342-a2c2-269faec722e8" />
  <img width="32%" alt="Screenshot 2026-03-08 160145" src="https://github.com/user-attachments/assets/792826e8-2855-44c5-853c-de9c614fb38f" />
</p>

## Research Foundations

OpenVault implements ideas from two papers:

- **GraphRAG** — Community detection and hierarchical summarization for query-focused retrieval.
  Park et al., *"From Local to Global: A Graph RAG Approach to Query-Focused Summarization"* ([arXiv:2404.16130](https://arxiv.org/abs/2404.16130))

- **Generative Agents** — Importance-weighted memory streams, reflection triggers, and the observation → reflection → retrieval loop.
  Park et al., *"Generative Agents: Interactive Simulacra of Human Behavior"* ([arXiv:2304.03442](https://arxiv.org/abs/2304.03442))

## Installation

1. Open SillyTavern.
2. Go to **Extensions** (puzzle icon).
3. Click **Install Extension** and paste:
   ```
   https://github.com/vadash/openvault
   ```
4. Reload SillyTavern.
5. You should also pick one of "stable_XXX" branches when installing

<img width="50%" alt="Screenshot 2026-03-08 160145" src="https://i.vgy.me/u1qEwx.png" />

## Setup

1. Open the **OpenVault** panel in the Extensions tab.
2. Select an **Extraction Profile** — this is the SillyTavern Connection Manager profile used for background event extraction. A mid-tier model works well; it doesn't need to be your main RP model.
3. Select a **Retrieval Profile** (usually the same profile).
4. Under **Embeddings**, pick a provider:
   - **WebGPU** (`multilingual-e5-small`) — runs locally on your GPU. Zero configuration.
   - **WASM** — CPU fallback if WebGPU is unavailable.
   - **Ollama** — connect to a local Ollama server with your preferred embedding model.
5. Start chatting. OpenVault activates automatically.

For existing chats, click **Backfill Chat History** to generate memories for past messages.

## How Retrieval Works

Before each AI response, OpenVault scores every candidate memory using three signals:

| Signal | What it measures |
|---|---|
| **Forgetfulness Curve** | Exponential decay by narrative distance. Higher-importance events decay slower. Importance-5 events have a soft floor so they never fully vanish. |
| **Vector Similarity** | Semantic closeness between the memory and recent conversation (last 3 user messages + extracted entities). Uses cosine similarity with a configurable threshold. |
| **BM25 Keywords** | TF-IDF keyword matching. Character names are automatically filtered as stopwords since they appear in nearly every memory. |

These are combined via an alpha-blend formula:

```
Score = Base + (α × VectorBonus) + ((1 - α) × BM25Bonus)
```

The top-scoring memories are formatted into temporal buckets ("The Story So Far", "Leading Up To This Moment") and injected into the prompt. Community summaries are injected separately as world context, higher in the prompt.

## Features

### POV-Aware Recall
Each memory tracks its witnesses. During retrieval, memories are filtered to only what the active character could know. Switch characters, and the available memory set changes.

### Character State Tracking
OpenVault tracks each character's current emotion and emotional intensity based on recent events. This is injected into the prompt alongside memories.

### Reflection Engine
Inspired by the Generative Agents paper. When enough important events accumulate for a character (importance sum ≥ 40), OpenVault triggers a reflection cycle:
- The LLM generates salient questions about recent events.
- For each question, it retrieves relevant memories and extracts insights.
- New insights are deduplicated against existing reflections (reject ≥90% similar, replace 80-89%, add <80%).

Reflections appear in the memory stream tagged with `❘insight❙` and are scored alongside regular events.

### GraphRAG Communities
Entity relationships are analyzed using the Louvain algorithm to detect clusters. Each community gets an LLM-generated summary injected as dynamic world context — giving the AI a high-level view of factions, locations, and social structures without consuming the memory budget.

### Semantic Entity Merging
When the LLM extracts "The King" and "King Aldric" as separate entities, OpenVault detects they're the same via embedding similarity (≥0.94) plus a token overlap guard that prevents false merges like "Burgundy panties" and "Burgundy candle".

### Local Embeddings
Runs `Transformers.js` with WebGPU acceleration directly in your browser. Falls back to WASM if GPU is unavailable. If embeddings fail entirely, retrieval degrades gracefully to BM25-only keyword matching.

## Slash Commands

| Command | Description |
|---|---|
| `/openvault-extract` | Manually trigger memory extraction on unprocessed messages |
| `/openvault-retrieve` | Manually fetch and inject context into the prompt |
| `/openvault-status` | Print current status and memory count |

## Architecture Overview

```
Background Path (on AI reply):
  MESSAGE_RECEIVED → Worker → Extract Events → Build Graph → Reflect → Detect Communities → Save

Critical Path (on Generate):
  Auto-hide old messages → Retrieve & score memories → Inject into prompt → Return to SillyTavern
```

All state lives in `chatMetadata.openvault` — memories, graph, communities, character states, and processing checkpoints. The extraction pipeline saves intermediate results after each phase, so a crash during reflection doesn't lose extracted events.

For full technical details, see [`include/ARCHITECTURE.md`](include/ARCHITECTURE.md).

## License

GNU AGPL v3.0

