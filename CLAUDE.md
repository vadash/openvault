# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenVault is a SillyTavern extension that provides POV-aware memory with witness tracking, relationship dynamics, and emotional continuity for roleplay conversations. All data is stored locally in chat metadata.

## Commands

- `npm run lint` - Run ESLint

## Architecture

### Entry Point
- `index.js` - Extension initialization, registers SillyTavern event listeners and slash commands

### Core Modules (src/)
- `constants.js` - All constants, default settings, and metadata keys
- `utils.js` - Core utility functions (data access, toast notifications, logging)
- `state.js` - Operation state management (locks, cooldowns)
- `events.js` - SillyTavern event handlers (generation, chat change, message received)
- `llm.js` - Unified LLM communication via SillyTavern's ConnectionManagerRequestService
- `pov.js` - POV-aware filtering (witness tracking, group chat handling)
- `auto-hide.js` - Auto-hide old messages functionality
- `backfill.js` - Extract memories from existing chat history

### Extraction Pipeline (src/extraction/)
- `extract.js` - Main extraction orchestration
- `prompts.js` - LLM prompt templates for extraction
- `parser.js` - Parse LLM responses, update character states and relationships
- `batch.js` - Batch extraction for backfill operations

### Retrieval Pipeline (src/retrieval/)
- `retrieve.js` - Main retrieval and context injection
- `scoring.js` - Relevance scoring (simple + optional LLM-based smart retrieval)
- `formatting.js` - Format memories for prompt injection

### UI (src/ui/)
- `settings.js` - Settings panel and user interactions
- `browser.js` - Memory browser with pagination and filtering
- `status.js` - Status indicator management

## Data Flow

1. **Extraction** (after AI responds): Messages → LLM extraction → Parse events → Store in chatMetadata.openvault
2. **Retrieval** (before AI generates): Filter by POV/recency → Score relevance → Format → Inject via setExtensionPrompt

## Key Patterns

- Uses SillyTavern's `eventSource` for event handling (GENERATION_AFTER_COMMANDS, MESSAGE_RECEIVED, etc.)
- Data stored in `context.chatMetadata.openvault` with keys: `memories`, `character_states`, `relationships`
- LLM calls use `ConnectionManagerRequestService.sendRequest()` with configurable profiles
- Operation locks prevent concurrent extraction/retrieval via `operationState` object
- Chat loading cooldown prevents extraction during chat load

## SillyTavern Globals

The code uses these SillyTavern globals (defined in eslint.config.js):
- `jQuery`/`$` - DOM manipulation
- `toastr` - Toast notifications
- Context from `getContext()` - chat, characters, settings
