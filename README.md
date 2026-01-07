# OpenVault

**Agentic Memory Extension for SillyTavern**

OpenVault provides POV-aware memory with witness tracking, relationship dynamics, and emotional continuity for roleplay conversations. All data is stored locally in chat metadata - no external services required.

## Features

- **Automatic Memory Extraction**: Analyzes conversations to extract significant events, emotions, and relationship changes
- **POV-Aware Retrieval**: Filters memories based on which characters witnessed events (no meta-gaming)
- **Character Context**: Uses character card and persona descriptions for more accurate memory extraction
- **Relationship Tracking**: Monitors Trust/Tension dynamics between characters with automatic decay
- **Emotional Continuity**: Tracks emotional states and shifts across conversations
- **Three-Stage Retrieval Pipeline**: Algorithmic pre-filtering → Smart LLM selection → Token-budgeted injection
- **Local Vector Embeddings**: Browser-based semantic search via Transformers.js (WebGPU/WASM) or Ollama
- **Auto-Hide**: Automatically hides old messages from context while preserving their memories
- **Memory Browser**: View, filter, and manage extracted memories

## Installation

1. Open SillyTavern
2. Go to **Extensions** > **Install Extension**
3. Enter the repository URL: `https://github.com/vadash/openvault`
4. Click Install
5. Reload SillyTavern

Or manually clone into your extensions folder:
```bash
cd SillyTavern/data/<user>/extensions
git clone https://github.com/vadash/openvault
```

## Usage

When enabled, OpenVault automatically:
1. **Before AI response**: Retrieves relevant memories and injects them as context
2. **After AI response**: Extracts new memories from the conversation

## Settings

### Extraction

| Setting | Description | Default |
|---------|-------------|---------|
| **Extraction Profile** | LLM connection profile for memory extraction | Current |
| **Messages per Extraction** | Messages to analyze per extraction batch | 10 |
| **Extraction Rearview** | Token budget for past memories shown to extraction LLM | 12000 |

### Retrieval Pipeline

OpenVault uses a three-stage pipeline for memory selection:

| Setting | Description | Default |
|---------|-------------|---------|
| **Stage 1 - Pre-filter Budget** | Algorithmic filter using recency + vector similarity | 24000 tokens |
| **Stage 2 - Smart Retrieval** | LLM-powered selection of most relevant memories | On |
| **Retrieval Profile** | LLM profile for smart retrieval (can use faster model) | Current |
| **Stage 3 - Final Budget** | Maximum tokens injected into chat context | 12000 tokens |

### Vector & Storage

| Setting | Description | Default |
|---------|-------------|---------|
| **Embedding Model** | Model for semantic similarity (see below) | multilingual-e5-small |
| **Auto-hide old messages** | Hide messages beyond threshold | On |
| **Messages to keep visible** | Auto-hide threshold | 50 |
| **Backfill Rate Limit** | Max requests per minute during backfill | 30 RPM |

## Embedding Models

OpenVault supports browser-based embeddings via Transformers.js with automatic WebGPU detection:

### Multilingual
| Model | Description |
|-------|-------------|
| **multilingual-e5-small** | Best quality (100+ languages) |
| **paraphrase-multilingual-MiniLM** | Cross-lingual similarity (50+ languages) |
| **embeddinggemma-300m** | Google Gemma, 768 dimensions (WebGPU only) |

### English Only
| Model | Description |
|-------|-------------|
| **all-MiniLM-L6-v2** | Fastest load (~25MB) |
| **bge-small-en-v1.5** | Best RAG retrieval quality |

### External
| Model | Description |
|-------|-------------|
| **Ollama** | Custom server with any Ollama embedding model |

### WebGPU Acceleration

WebGPU provides 10-100x faster embeddings. It requires a **secure context** (HTTPS or localhost). For HTTP access:

1. Go to `chrome://flags` (or `brave://flags`)
2. Enable `#enable-unsafe-webgpu`
3. Enable `#enable-webgpu-developer-features`
4. In `#unsafely-treat-insecure-origin-as-secure` add your SillyTavern URL
5. Restart browser

If WebGPU is unavailable, OpenVault falls back to WASM (slower but universal).

## How It Works

### Memory Extraction

OpenVault sends recent messages to an LLM with:
- Character descriptions (from character card)
- Persona description (your character)
- Existing memories (within rearview token budget)

The LLM extracts structured events with:
- **Event type**: action, revelation, emotion_shift, relationship_change
- **Importance**: 1-5 scale
- **Summary**: Brief description
- **Characters involved**: Who participated
- **Witnesses**: Who observed (for POV filtering)
- **Location**: Where it happened
- **Emotional/Relationship impact**: How characters were affected

### Retrieval Pipeline

```
All Memories
     ↓
[Stage 1: Algorithmic Scoring]
  - Forgetfulness curve (exponential decay)
  - Vector similarity bonus (if embeddings enabled)
  - POV/witness filtering
  → Pre-filter budget (24000 tokens default)
     ↓
[Stage 2: Smart Selection] (optional)
  - LLM analyzes pre-filtered memories
  - Selects most relevant for current context
     ↓
[Stage 3: Token Budget]
  - Final context budget (12000 tokens default)
  → Injected into chat
```

### Forgetfulness Curve

Memories decay over narrative time using:
```
Score = Importance × e^(-λ × Distance)
```

- **Distance**: Messages since memory creation
- **λ (lambda)**: `0.05 / (importance²)` - higher importance decays slower
- **Importance 5**: Floor score ensures critical memories never fully fade

### Vector Similarity Bonus

When embeddings are enabled:
1. Last 3 user messages are embedded (capped at 1000 chars)
2. Each memory's summary is compared using cosine similarity
3. Memories above threshold get bonus points:
```
Bonus = ((similarity - 0.5) / 0.5) × 15
```

### Relationship Dynamics

OpenVault tracks two axes for every character pair:
- **Trust (0-10)**: How much characters rely on each other
- **Tension (0-10)**: Level of conflict or stress

**Decay Mechanics** (after 50 messages without interaction):
- Tension slowly decays toward 0
- High Trust (>5) decays toward neutral 5
- Low Trust (<5) is sticky and requires active repair

### Auto-Hide

Messages older than the threshold are hidden from context (in user-assistant pairs). Memories extracted from hidden messages are still retrieved, effectively providing summaries.

## Data Storage

All data is stored in `chatMetadata.openvault`:
- `memories`: Array of extracted memory events
- `character_states`: Current emotional states per character
- `relationships`: Relationship dynamics between characters

Data is per-chat and persists with the chat file.

## Memory Types

| Type | Description |
|------|-------------|
| **action** | Significant actions taken by characters |
| **revelation** | New information revealed or discovered |
| **emotion_shift** | Changes in emotional state |
| **relationship_change** | Changes in how characters relate to each other |

## Danger Zone

- **Delete Current Chat Memories**: Removes all OpenVault memory data for the current chat
- **Delete Current Chat Embeddings**: Removes only vector embeddings (keeps memories)

## Debug Mode

Enable debug mode to see detailed logs in the browser console (F12 > Console). Logs are tagged with `[OpenVault]`.

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

See [LICENSE](LICENSE) for details.

## Version

1.18
