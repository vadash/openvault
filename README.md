# OpenVault

**True Long-Term Memory & Agentic Awareness for SillyTavern**

<table>
<tr>
<td><img src="https://github.com/user-attachments/assets/9c73f282-648b-49b5-89bc-40556742d01e" alt="Dashboard" /></td>
<td><img src="https://github.com/user-attachments/assets/2903287b-32af-44db-b0fe-26dd2905af0c" alt="Config" /></td>
<td><img src="https://github.com/user-attachments/assets/85cb3ea6-5f33-4e79-a263-69705844eda4" alt="Memory Browser" /></td>
</tr>
</table>

OpenVault transforms your characters from simple chatbots into aware participants. It gives them **narrative memory**: the ability to recall specific events, track relationship dynamics (Trust/Tension), and remember emotional shifts, all while respecting the character's Point of View

Unlike standard vector storage, OpenVault uses a **Smart Agentic Pipeline** to decide *what* is worth remembering and *when* to recall it

## 🌟 Key Features

*   **🧠 Intelligent Extraction:** Automatically analyzes your chat to save significant moments (Actions, Revelations, Emotions) while ignoring small talk
*   **👁️ POV-Aware:** No more meta-gaming. Characters only remember what they actually witnessed or were told
*   **❤️ Relationship Tracking:** Tracks **Trust** and **Tension** levels that evolve naturally based on your interactions
*   **🔎 Hybrid Search:** Combines **Semantic Search** (vibes/meaning) with **Keyword Search** (specific names/terms) to find the perfect memory
*   **📉 Narrative Decay:** Memories fade naturally over time unless they are highly important or reinforced
*   **🙈 Auto-Hide:** Keeps your prompt clean by hiding old messages, while OpenVault keeps the memories alive in the background
*   **🔒 100% Local & Private:** All data is stored in your chat file. Supports local embeddings (WASM/WebGPU) or Ollama

## 📥 Installation

1.  Open **SillyTavern**
2.  Navigate to **Extensions** > **Install Extension**
3.  Paste this URL: `https://github.com/vadash/openvault`
4.  Click **Install**
5.  Reload SillyTavern

## 🚀 Quick Start

1.  **Enable:** Go to the OpenVault tab (top of extensions list) and check **Enable OpenVault**
2.  **Configure LLM:** Select your **Extraction Profile** (what model writes the memories) and **Retrieval Profile** (what model picks memories, optional). *pick fast non reason model like glm air or free Nvidia NIM kimi k2*
3.  **Embeddings:** Choose **e5** or if you have modern gpu (RTX 2060 and above) try **gemma**
4.  **Chat:** Just roleplay! OpenVault works in the background
    *   **Before the AI replies**, OpenVault injects relevant memories
    *   **After the AI replies**, OpenVault analyzes the new messages for memories

## ⚙️ Configuration Guide

### The Dashboard
A visual overview of your memory health
*   **Status:** Shows if the system is Ready, Extracting, or Retrieving
*   **Quick Toggles:** Turn the system on/off or toggle Auto-Hide
*   **Extraction Progress:** Shows if there are backlog messages waiting to be processed

### Memory Bank
Browse everything your character remembers
*   **Search & Filter:** Find memories by specific characters or event types (Action, Emotion, etc.)
*   **Edit:** Fix incorrect details or change the importance rating (1-5 stars) of a memory
*   **Delete:** Remove memories that didn't happen or aren't wanted

### Settings & Tuning

#### 1. LLM Strategy
*   **Smart Retrieval:** Keeps the AI involved in the recall process. It reads the top potential memories and picks only the ones truly relevant to the current scene. *Try it with ON and OFF*

#### 2. Embeddings (The Search Engine)
Embeddings allow the AI to find memories based on meaning (e.g., searching "Fight" finds "Combat")
*   **Browser Models (Transformers.js):** Runs entirely in your browser
    *   *bge:* Best for English. Fast
    *   *gemma:* Very smart, but requires **WebGPU** (Chrome/Edge with hardware acceleration)
*   **Ollama:** Offload the work to your local LLM backend

#### 3. Pipeline Tuning (Advanced)
*   **Context Window Size:** How much past chat the LLM reads when writing new memories. Higher = better context, slower generation
*   **Pre-filter / Final Budget:** Controls how many tokens are used for memory processing vs. final injection into the prompt

#### 4. Scoring Weights
Fine-tune how the engine finds memories:
*   **Semantic Match Weight:** Turns up the "Vibes" search. Finds conceptually similar events
*   **Keyword Match Weight:** Turns up "Exact" search. Essential for finding specific names or proper nouns
*   **Semantic Threshold:** The strictness filter. Lower values let more "loosely related" memories through; higher values require exact matches

## 💡 How Auto-Hide Works
OpenVault can automatically "hide" messages older than a specific threshold (default: 50)
*   **Hidden messages** are removed from the prompt sent to the LLM, saving you money and tokens
*   **However**, OpenVault has already extracted the *memories* from those messages
*   **Result:** You can have a chat with 5,000 messages, but only send ~50 messages + ~10 relevant memories to the AI. Infinite context feel with zero token bloat

## 🛠️ Troubleshooting

**"WebGPU not available"**
*   WebGPU requires a secure context (HTTPS or Localhost). If accessing SillyTavern over a local network IP (e.g., `192.168.1.x`), you must enable "Insecure origins treated as secure" in your browser flags:

1. Go to `chrome://flags`
2. Enable `#enable-unsafe-webgpu`
3. Enable `#enable-webgpu-developer-features`
4. In `#unsafely-treat-insecure-origin-as-secure` add your SillyTavern URL
5. Restart browser

**"Ollama Connection Failed"**
*   Ensure your Ollama server is running with `OLLAMA_ORIGINS="*"` environment variable set to allow browser access

**"Extraction is skipped/stuck"**
*   Check the SillyTavern server console. Ensure your Main API is connected and not busy generating a reply

## License & Credits
**OpenVault** is Free & Open Source software licensed under **AGPL-3.0**
Created for the SillyTavern community

*Version 1.28*