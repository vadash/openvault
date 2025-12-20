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
1. Analyzes the current conversation context
2. Finds relevant memories (filtered by POV/witnesses)
3. Injects them as context within the token budget

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
