# OpenVault: Agentic Memory for SillyTavern

Long-term roleplays inevitably hit a wall. Context windows fill up, manual lorebooks become tedious to maintain, and characters start forgetting critical plot points. Worse, when you try to use standard vector databases, characters suddenly become omniscient—knowing secrets they were never present for simply because the text was retrieved into the prompt.

OpenVault is an autonomous, POV-aware memory extension for SillyTavern. It runs in the background while you chat, extracting events, mapping relationships, and generating psychological insights, all without requiring any external databases or complex local server setups.

## Images

<p align="center">
  <img width="32%" alt="Screenshot 2026-03-08 160107" src="https://github.com/user-attachments/assets/ae81565e-8745-4d86-b6d1-5b73d65d355a" />
  <img width="32%" alt="Screenshot 2026-03-08 160132" src="https://github.com/user-attachments/assets/34427dcf-1e5b-4342-a2c2-269faec722e8" />
  <img width="32%" alt="Screenshot 2026-03-08 160145" src="https://github.com/user-attachments/assets/792826e8-2855-44c5-853c-de9c614fb38f" />
</p>

## Core Features for Roleplayers

*   **Strict Point-of-View (POV):** Characters only remember what they witnessed, participated in, or were explicitly told. A secret conversation between you and character A will not be retrieved when you are talking alone with character B.
*   **Autonomous World Building:** OpenVault continuously extracts entities (People, Places, Organizations, Objects, Concepts) and the evolving relationships between them. It replaces the need to manually update lorebooks.
*   **Agentic Reflection Engine:** Inspired by the Stanford "Smallville" Generative Agents paper. When enough events happen to a character, OpenVault pauses to reflect, synthesizing raw memories into high-level psychological insights, subconscious drives, and shifting relationship dynamics.
*   **GraphRAG Communities:** The system periodically analyzes the relationship web, detecting social circles and summarizing the global state of the world to keep macro-level plots moving forward.
*   **Zero External Databases:** No ChromaDB, no Docker containers, no Python scripts. Everything is stored directly inside SillyTavern's native `chatMetadata`. Your data stays with your chat.
*   **100% Local Embeddings:** Semantic search is powered entirely in your browser via WebGPU/WASM (Transformers.js) or routed through your local Ollama instance.

## How It Works in Practice

OpenVault operates asynchronously. When you send a message, the extension doesn't freeze your UI. Instead, a background worker processes the chat history in batches:

1.  **Event Extraction:** Identifies specific actions, emotional shifts, and revelations. It rates their narrative importance (1 to 5 stars) and tracks exact witnesses.
2.  **Knowledge Graph:** Updates the state of the world. If two characters go from enemies to allies, the relationship edge is updated and consolidated.
3.  **Smart Retrieval:** Before the AI generates a response, OpenVault scores all memories using a custom algorithm. It blends an exponential forgetfulness curve (old trivial memories fade, critical memories stick), BM25 keyword matching, and Vector Similarity.
4.  **Context Injection:** Memories are woven seamlessly into the prompt context, chronologically sorted into:
    *   *The Story So Far*
    *   *Leading Up To This Moment*
    *   *Current Scene* (including present characters and current emotional states)
    *   *Subconscious Drives* (Hidden psychological truths that influence the character without them explicitly speaking about it).

## Interface & Controls

OpenVault integrates directly into the SillyTavern extensions menu with a clean, progressive UI designed around user intent rather than technical jargon.

*   **Dashboard:** Your control center. View extraction progress, system health, and a live Payload Calculator that tells you exactly how many tokens your background extraction model needs.
*   **Memories:** A fully searchable memory bank. View character states, filter events vs. reflections, and manually edit the importance or summary of any extracted memory.
*   **World:** A read-only viewer for your Knowledge Graph. Browse automatically detected communities, factions, and all extracted entities currently tracked in your roleplay.
*   **Advanced:** Expert tuning for the retrieval math. Adjust the Alpha-blend (vector vs. keyword bias), decay rates, and deduplication thresholds. 
*   **Perf:** Real-time performance metrics to ensure background extractions aren't bottlenecking your browser.

## Injection Positions

OpenVault allows you to customize where retrieved memories and world info are injected into the prompt. This is useful for controlling how the AI prioritizes different context sources.

### Configuring Positions

1. Open SillyTavern Settings → Extensions → OpenVault
2. Scroll to the "Injection Positions" section
3. Choose a position for each content type:
   - **Memory Position**: Where retrieved memories are injected
   - **World Info Position**: Where world context is injected

### Available Positions

| Position | Label | Description |
|----------|-------|-------------|
| ↑Char | Before character definitions | Injected before the character card |
| ↓Char | After character definitions | Injected after the character card (recommended) |
| ↑AN | Before author's note | Injected at the top of the author's note |
| ↓AN | After author's note | Injected at the bottom of the author's note |
| In-chat | At message depth | Injected at a specific message depth |
| **Custom** | Use macro manually | No auto-injection; use macros below |

### Custom Position (Manual Macros)

When "Custom" is selected, content is **not automatically injected**. Instead, you can manually place macros anywhere in your prompt:

- `{{openvault_memory}}` — Retrieves the memory context
- `{{openvault_world}}` — Retrieves the world context

**Example usage in character card or prompt:**
```
{{openvault_memory}}

[Your custom instructions here]

{{openvault_world}}
```

### Inline Position Display

The main OpenVault panel shows current injection positions as badges:
- `[↓Char | ↑AN]` — Memory at ↓Char, World at ↑AN
- `[📋 {{openvault_memory}} | ↓Char]` — Memory uses custom macro, World at ↓Char

Click on a macro badge to copy it to your clipboard.

### Default Behavior

By default, both memory and world content are injected at **↓Char** (after character definitions), which is the recommended setting for most use cases.

## Requirements & Setup

*   **SillyTavern 1.13.0+**
*   **Main RP Model:** Any model with a decent context window (handling the injected memories).
*   **Extraction Model:** You need an LLM to process the background memories. Mid-tier models work exceptionally well. OpenVault is optimized for structured JSON output and uses specific "prefills" to force compliance.
*   **Embeddings:** By default, OpenVault downloads a lightweight, multilingual embedding model (`multilingual-e5-small`) that runs directly in your browser. Alternatively, you can point it to a local Ollama embedding model.

## Multilingual Support

OpenVault is built from the ground up to support non-English roleplay without breaking JSON extraction. It features heuristic script detection, custom stemming algorithms, and cross-script character deduplication (automatically recognizing that a character's name written in different alphabets refers to the same entity in the Knowledge Graph). 

## Note on Privacy

Because OpenVault relies on your SillyTavern client and optionally your local Ollama instance, your roleplay data remains entirely on your machine unless you explicitly configure the extraction profile to use a cloud API. The in-browser vector database ensures no text is ever sent to third-party embedding services.

## License

GNU AGPL v3.0

## Research Foundations

OpenVault implements ideas from two papers:

- **GraphRAG** — Community detection and hierarchical summarization for query-focused retrieval.
  Park et al., *"From Local to Global: A Graph RAG Approach to Query-Focused Summarization"* ([arXiv:2404.16130](https://arxiv.org/abs/2404.16130))

- **Generative Agents** — Importance-weighted memory streams, reflection triggers, and the observation → reflection → retrieval loop.
  Park et al., *"Generative Agents: Interactive Simulacra of Human Behavior"* ([arXiv:2304.03442](https://arxiv.org/abs/2304.03442))

## History

9.00 - good stable for single char RP

9.50 - fixing rewrite prompt structure for CN models + fix of group play (PoV)

10.00 - || requests (optional)

10.50 - fixed hairball cluster bug (ie 3 communities goes down to 1)

11.00 - refactored tests (easier to maintain), prep for more lang

11.50 - fixed memory balance (old / mid / new memories distribution), faster graph generation, less delay after send before llm answers 

12.00 - UI revamp, need to protect users from themselves. I can see oneguy changes the Jaccard threshold to 0.1, their graph will turn to mush, and they will submit a bug report saying "your extension sucks."

12.50 - Customize injection position
