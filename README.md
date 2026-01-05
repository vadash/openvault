# OpenVault

**Agentic Memory Extension for SillyTavern**

OpenVault provides POV-aware memory with witness tracking, relationship dynamics, and emotional continuity for roleplay conversations. All data is stored locally in chat metadata - no external services required.

## Features

- **Automatic Memory Extraction**: Analyzes conversations to extract significant events, emotions, and relationship changes
- **POV-Aware Retrieval**: Filters memories based on which characters witnessed events (no meta-gaming)
- **Character Context**: Uses character card and persona descriptions for more accurate memory extraction
- **Relationship Tracking**: Monitors and records relationship dynamics between characters
- **Emotional Continuity**: Tracks emotional states and shifts across conversations
- **Auto-Hide**: Automatically hides old messages from context while preserving their memories
- **Smart Retrieval**: Optional LLM-powered selection of the most relevant memories
- **Vector Embeddings**: Optional Ollama-powered semantic similarity for memory ranking
- **Memory Browser**: View, filter, and manage extracted memories
- **Backfill**: Extract memories from existing chat history

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

### Automatic Mode (Default)

When enabled, OpenVault automatically:
1. **Before AI response**: Retrieves relevant memories and injects them as context
2. **After AI response**: Extracts new memories from the conversation (every N messages)

### Manual Mode

Use the buttons in the settings panel:
- **Extract Memories**: Analyze recent messages for significant events
- **Retrieve Context**: Manually inject relevant memories into context
- **Backfill Chat History**: Extract memories from the entire chat history

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable OpenVault** | Toggle the extension on/off | On |
| **Automatic Mode** | Auto-extract and retrieve memories | On |
| **Extraction Profile** | LLM connection profile for extraction | Current |
| **Token Budget** | Max tokens for injected memory context | 1000 |
| **Messages per Extraction** | Messages to analyze per extraction | 5 |
| **Memory Context** | Memories shown to extraction LLM (-1 = All) | All |
| **Smart Retrieval** | Use LLM to select relevant memories | Off |
| **Ollama URL** | Ollama server URL for embeddings | - |
| **Embedding Model** | Ollama model for vector embeddings | - |
| **Similarity Threshold** | Minimum similarity for bonus (0-1) | 0.5 |
| **Similarity Weight** | Max bonus points for similarity | 15 |
| **Auto-hide old messages** | Hide messages beyond threshold | On |
| **Messages to keep visible** | Auto-hide threshold | 50 |

## How It Works

### Memory Extraction

OpenVault sends recent messages to an LLM with:
- Character descriptions (from character card)
- Persona description (your character)
- Existing memories (for consistency)

The LLM extracts structured events with:
- **Event type**: action, revelation, emotion_shift, relationship_change
- **Importance**: 1-5 scale
- **Summary**: Brief description
- **Characters involved**: Who participated
- **Witnesses**: Who observed (for POV filtering)
- **Location**: Where it happened
- **Emotional/Relationship impact**: How characters were affected

### Memory Retrieval

Before the AI responds, OpenVault:
1. Filters memories by POV/witnesses
2. Scores and ranks memories by relevance
3. Injects top memories as context within the token budget

### Memory Ranking Algorithm

OpenVault uses a two-part scoring system to select the most relevant memories:

#### 1. Forgetfulness Curve (Base Score)

Memories naturally decay over time using an exponential forgetfulness curve:

```
Score = Importance × e^(-λ × Distance)
```

- **Distance**: Number of messages since the memory was created (narrative time, not real time)
- **Importance**: Memory importance rating (1-5 scale)
- **λ (lambda)**: Decay rate, calculated as `0.05 / (importance²)`

This means:
- **Importance 5** memories decay very slowly (λ = 0.002) and have a floor score they never drop below
- **Importance 1** memories decay quickly (λ = 0.05) and fade from relevance faster
- Recent memories score higher than older ones of the same importance

#### 2. Vector Similarity Bonus (Optional)

When Ollama embeddings are configured, memories get a relevance boost based on semantic similarity:

1. The last 3 user messages are embedded (capped at 1000 chars) - user intent matters most for retrieval
2. Each memory's summary is compared using **cosine similarity**
3. If similarity exceeds the threshold (default 0.5), bonus points are added:

```
Bonus = ((similarity - threshold) / (1 - threshold)) × maxBonus
```

Default `maxBonus` is 15 points. This allows semantically relevant older memories to surface above recent but unrelated ones.

#### 3. Smart Retrieval (Alternative)

When Smart Retrieval is enabled, instead of the algorithm above, an LLM analyzes the memory list and current context to select the most relevant memories. This is more accurate but slower and uses additional tokens.

### Auto-Hide

When enabled, messages older than the threshold are hidden from context (in user-assistant pairs). The memories extracted from these messages are still retrieved and injected, effectively providing summaries of hidden content.

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

- **Delete Current Chat Memories**: Removes all OpenVault data for the current chat
- **Delete All Data**: Removes all OpenVault data across all chats

## Debug Mode

Enable debug mode to see detailed logs in the browser console (F12 > Console).

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

See [LICENSE](LICENSE) for details.

## Version

v0.2.0
