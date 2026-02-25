# OpenVault - Agentic Memory for SillyTavern

OpenVault is an advanced, POV-aware memory extension for SillyTavern (v1.13.0+). It automatically extracts narrative events, tracks character knowledge, and intelligently retrieves memories using a hybrid semantic/keyword scoring engine.

Unlike standard vector databases, OpenVault understands **who** knows **what**, ensuring characters only remember events they actually witnessed or were told about.

## ✨ Key Features
* **POV-Aware Recall**: Memories are filtered by the active character's point of view. No more meta-gaming AI.
* **Hybrid Retrieval Engine**: Combines Vector Embeddings (Semantic) + BM25 (Keyword) + Exponential Forgetfulness curves.
* **Local WebGPU Embeddings**: Zero-setup semantic search using `Transformers.js` running locally on your GPU/CPU, or plug in your own Ollama instance.
* **Structured Event Extraction**: Uses your main LLM to extract highly detailed, deduplicated JSON events in the background.
* **Character State Tracking**: Automatically tracks characters' current emotions and emotional intensity based on recent events.
* **Self-Contained**: No external databases required. All memories are saved safely inside your SillyTavern `chatMetadata`.

## 📦 Installation
1. Open SillyTavern.
2. Go to the **Extensions** menu (block puzzle icon).
3. Click **Install Extension** and paste this repository URL:
   `https://github.com/vadash/openvault`
4. Reload SillyTavern.

## 🚀 Quick Start
1. Go to the **OpenVault** settings panel in the Extensions tab.
2. Select an **Extraction Profile** and **Retrieval Profile** (this uses your existing SillyTavern Connection Manager profiles).
3. (Optional) Under Embeddings, select **WebGPU (multilingual-e5-small)** for local embeddings, or connect your **Ollama** server.
4. If you are adding OpenVault to an existing chat, click **Backfill Chat History** to generate memories for past messages.
5. Just chat! OpenVault will automatically extract memories in the background and inject them into the prompt seamlessly.

## 💬 Slash Commands
OpenVault integrates directly with SillyTavern's slash command system:
* `/openvault-extract` - Manually triggers a memory extraction on recent un-processed messages.
* `/openvault-retrieve` - Manually fetches relevant context and injects it into the prompt.
* `/openvault-status` - Prints the current status and memory count of the extension.

## ⚙️ How It Works
1. **Extraction**: Every few messages, OpenVault quietly asks your LLM to summarize new events, noting who was there and how important it was (1-5 stars).
2. **Embedding**: The event is converted into a mathematical vector (embedding) locally in your browser.
3. **Retrieval**: Before the AI generates a reply, OpenVault scans recent chat messages for keywords and semantic meaning. It fetches the most relevant memories the current character knows about and injects them seamlessly as `<scene_memory>`.

## 📜 License
This project is licensed under the GNU AGPL v3.0.