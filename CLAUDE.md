## Project Context: OpenVault
OpenVault is a **Retrieval-Augmented Generation (RAG)** extension for **SillyTavern**. It provides semantic long-term memory to characters by:
1.  **Extraction:** Automatically parsing chat messages into structured JSON "events" (memories) via an LLM in the background.
2.  **Storage:** Saving these events into SillyTavern's chat metadata.
3.  **Retrieval:** Scoring and selecting relevant memories based on the current conversation context.
4.  **Injection:** inserting these memories into the system prompt before the AI generates a reply.

## Architecture & Map
The codebase uses ES Modules located in `src/`. No build step is required; SillyTavern loads `index.js`

### Core Modules
*   **Bridge (`src/deps.js`):** **CRITICAL.** All interactions with SillyTavern globals (`extension_settings`, `getContext`, `saveChatConditional`) and browser globals (`fetch`, `toastr`) MUST go through this file. This allows for dependency injection and testing.
*   **Events (`src/events.js`):** Handles SillyTavern hooks (`MESSAGE_RECEIVED`, `GENERATION_AFTER_COMMANDS`). Orchestrates the flow.
*   **State (`src/state.js`):** Manages locking mechanisms to prevent concurrent extraction/generation.

### Logic Flows
*   **Extraction (`src/extraction/`):**
    *   `extract.js`: Main logic. Calls LLM to parse text into JSON.
    *   `parser.js`: Validates JSON and updates character relationships/emotional states.
    *   `batch.js`: Handles bulk backfilling of old chat history.
*   **Retrieval (`src/retrieval/`):**
    *   `retrieve.js`: Main entry point. Decides what to fetch.
    *   `scoring.js`: Algorithms for relevance (Forgetfulness curve + Vector Similarity).
    *   `worker.js`: Web Worker that runs heavy scoring math off the main thread.
    *   `formatting.js`: Formats selected memories for prompt injection.
*   **Vector Database (`src/embeddings.js`):** Handles local embedding generation via Ollama.

### UI
*   **Interface (`src/ui/`):** Handles settings panels, the memory browser, and status indicators. Uses jQuery.

## Development Rules

### 1. Dependency Injection
**NEVER** access SillyTavern globals (like `SillyTavern.getContext`) directly in source files.
*   **Correct:** Import `getDeps` from `src/deps.js` and use `getDeps().getContext()`.
*   **Why:** Ensures the codebase remains testable and decoupled from the specific SillyTavern version implementation details.

### 2. Async & Locking
*   The extension runs background LLM tasks while the user interacts.
*   Check `src/state.js` before initiating operations.
*   Respect `operationState.generationInProgress` and `operationState.extractionInProgress`.
*   Use `src/utils.js` -> `withTimeout` for any LLM operations to prevent hanging the UI.

### 3. Data Persistence
*   Data is stored in `context.chatMetadata['openvault']`.
*   Access this via `getOpenVaultData()` in `src/utils.js`.
*   Save changes using `saveOpenVaultData()` (wraps `saveChatConditional`).

### 4. Tech Stack & Style
*   **Runtime:** Browser-based JavaScript (ESM).
*   **UI Library:** jQuery (Standard for SillyTavern extensions).
*   **Styling:** FontAwesome for icons, Toastr for notifications.
*   **Formatting:** Follow existing patterns. Do not refactor imports/exports unless necessary for functionality.

## Verification
Since this is a browser extension without a CLI test runner:
1.  **Console:** Check browser console for `[OpenVault]` tagged logs.
2.  **Status:** The UI status indicator (`src/ui/status.js`) reflects the internal state machine.
3.  **Debug Mode:** Enable "Debug Mode" in extension settings to see verbose logging of extraction/retrieval steps.

## Testing

Tests are in `tests/` using Vitest with jsdom environment. SillyTavern dependencies are mocked via path aliases in `vitest.config.js` pointing to `tests/__mocks__/`.
