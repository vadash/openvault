# OpenVault

**Agentic Memory Extension for SillyTavern**

<table>
<tr>
<td><img src="https://github.com/user-attachments/assets/9c73f282-648b-49b5-89bc-40556742d01e" alt="Dashboard" /></td>
<td><img src="https://github.com/user-attachments/assets/2903287b-32af-44db-b0fe-26dd2905af0c" alt="Config" /></td>
<td><img src="https://github.com/user-attachments/assets/85cb3ea6-5f33-4e79-a263-69705844eda4" alt="Memory Browser" /></td>
</tr>
</table>

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

| Setting | Description | Range | Default |
|---------|-------------|-------|---------|
| **Extraction Profile** | LLM connection profile for memory extraction | - | Current |
| **Messages per Extraction** | Messages to analyze per extraction batch | 10-50 | 10 |
| **Extraction Rearview** | Token budget for past memories shown to extraction LLM | 1k-32k | 12000 |

### Retrieval Pipeline

OpenVault uses a three-stage pipeline for memory selection:

| Setting | Description | Range | Default |
|---------|-------------|-------|---------|
| **Stage 1 - Pre-filter Budget** | Algorithmic filter using recency + vector similarity | 1k-32k tokens | 24000 |
| **Stage 2 - Smart Retrieval** | LLM-powered selection of most relevant memories | On/Off | On |
| **Retrieval Profile** | LLM profile for smart retrieval (can use faster model) | - | Current |
| **Stage 3 - Final Budget** | Maximum tokens injected into chat context | 1k-32k tokens | 12000 |

### Scoring Weights

Balance how memories are ranked during retrieval. Available in Advanced Parameters:

| Setting | Description | Range | Default |
|---------|-------------|-------|---------|
| **Semantic Match Weight** | Bonus for vector similarity (finds "vibes" like "Canine" → "Dog") | 0-30 | 15 |
| **Keyword Match Weight** | Multiplier for BM25 exact keyword matching | 0-3 | 1.0 |
| **Semantic Threshold** | Minimum similarity before semantic bonus applies | 0-1 | 0.5 |

### Vector & Storage

| Setting | Description | Range | Default |
|---------|-------------|-------|---------|
| **Embedding Model** | Model for semantic similarity (see below) | - | multilingual-e5-small |
| **Auto-hide old messages** | Hide messages beyond threshold | On/Off | On |
| **Messages to keep visible** | Auto-hide threshold | 10-200 | 50 |
| **Backfill Rate Limit** | Max requests per minute during backfill | 1-600 | 30 RPM |

## Embedding Models

OpenVault supports browser-based embeddings via Transformers.js with automatic WebGPU detection:

### Multilingual
| Model | Description |
|-------|-------------|
| **multilingual-e5-small** | 384d · 118M params · 100+ langs · MTEB: 55.8 |
| **embeddinggemma-300m** | 768d · 300M params · 100+ langs · MTEB: 61.2 (WebGPU only) |

### English Only
| Model | Description |
|-------|-------------|
| **bge-small-en-v1.5** | 384d · 133MB · MTEB: 62.17 · SOTA RAG |

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
Bonus = ((similarity - threshold) / (1 - threshold)) × Semantic Weight
```

Where `threshold` is the Semantic Threshold (default 0.5) and `Semantic Weight` is the Semantic Match Weight (default 15).

### BM25 Keyword Matching

OpenVault also uses BM25 for exact keyword matching:
- Tokenizes query and memory summaries
- Calculates term frequency-inverse document frequency (TF-IDF)
- Multiplies result by Keyword Match Weight (default 1.0, range 0-3)

This complements semantic search by catching exact names, places, and specific terms.

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
