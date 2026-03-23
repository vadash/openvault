# Design: Settings UX Overhaul — Payload Calculator, Drawer Styling, Auto-Collapse

## 1. Problem Statement

Two usability issues with the current Settings panel:

**A) LLM payload is invisible.** The user sets Extraction Token Budget (16k) and Context Window Size / Rearview (12k) as two independent sliders. What they don't see is that the background LLM actually needs `budget + rearview + 8k output + ~2k prompt + ~2k buffer` — roughly 40k total context. If their extraction profile points at a 32k model, it silently truncates. There is no visual feedback telling them "you need a model with at least X context."

**B) Collapsible sections are invisible.** `<details class="openvault-details">` has no background, no border, no visual weight. The `<summary>` tag renders as flat gray text (`color: var(--SmartThemeEmColor, #888)`, `padding: 4px 0`). Users don't realize sections are clickable. 30+ sliders across tabs are all visible at once, inviting accidental bumps.

## 2. Goals & Non-Goals

### Must Do
- Add a **Payload Calculator** readout below the Extraction Budget + Rearview sliders showing total context needed, with color-coded severity and emoji.
- Restyle all `.openvault-details` as visually distinct **drawers** with accent stripe, tinted background, and animated chevron.
- **All** collapsible sections start **collapsed** by default (remove every `open` attribute on `<details>`).
- Break the monolithic "Extraction & Graph Rules" section (Tab 2) into 4 sub-groups.
- Break the "Retrieval & Injection" section (Tab 3) into 2 sub-groups.

### Won't Do
- Change the underlying settings keys or math (Option A "Total + Ratio" rejected).
- Change Tab 4 (Advanced) — it already has logical grouping.
- Touch Tab 1 (Dashboard & Connections) layout.

## 3. Proposed Architecture

### 3.1 Payload Calculator (Tab 2)

Group the two sliders in a visually distinct card titled **"Background LLM Payload"**. Below the sliders, render a live-calculated readout:

```
┌─────────────────────────────────────────────────────────┐
│ ▸ Background LLM Payload                                │
│                                                         │
│   Extraction Token Budget: ====●======  16,000 tokens   │
│   Context Window Size:     ===●========  12,000 tokens  │
│                                                         │
│   ✅ Estimated total: ~28,000 tokens                    │
│   (16k batch + 12k rearview + 8k output + 4k overhead) │
│   Ensure your Extraction Profile supports this size.    │
└─────────────────────────────────────────────────────────┘
```

**Calculation formula:**

```
total = extractionTokenBudget + extractionRearviewTokens + LLM_OUTPUT_TOKENS + PROMPT_OVERHEAD
```

All constants defined in **one place** in `constants.js`:

```javascript
/** Payload calculator constants — single source of truth */
export const PAYLOAD_CALC = {
    LLM_OUTPUT_TOKENS: 8000,   // Matches maxTokens in all LLM_CONFIGS
    PROMPT_ESTIMATE: 2000,     // Approximate system/user prompt template size
    SAFETY_BUFFER: 2000,       // Headroom for variance in prompt size
    /** Derived: total overhead added to user-controlled sliders */
    get OVERHEAD() { return this.LLM_OUTPUT_TOKENS + this.PROMPT_ESTIMATE + this.SAFETY_BUFFER; },
    /** Color thresholds for total context (sliders + OVERHEAD) */
    THRESHOLD_GREEN: 32000,    // ≤ this = safe (green ✅)
    THRESHOLD_YELLOW: 48000,   // ≤ this = caution (yellow ⚠️)
    THRESHOLD_ORANGE: 64000,   // ≤ this = warning (orange 🟠), above = danger (red 🔴)
};
```

**Color thresholds** (based on `total = budget + rearview + OVERHEAD`):

| Total | Color | Emoji | CSS Class |
|-------|-------|-------|-----------|
| ≤ 32k | green | ✅ | `.payload-safe` |
| 32k–48k | yellow | ⚠️ | `.payload-caution` |
| 48k–64k | orange | 🟠 | `.payload-warning` |
| > 64k | red | 🔴 | `.payload-danger` |

**Breakdown text** always shows the four components so the user understands where the tokens go:

```
(16k batch + 12k rearview + 8k output + 4k overhead)
```

### 3.2 Drawer CSS (All Tabs)

Replace the current flat `.openvault-details` styles with a drawer component:

```css
/* ── Drawer (collapsible details) ─────────────────────── */
.openvault-details {
    margin-top: 10px;
    border-left: 3px solid var(--SmartThemeQuoteColor, #4a90d9);
    border-radius: 4px;
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 40%, transparent);
    overflow: hidden;
}

.openvault-details summary {
    cursor: pointer;
    padding: 8px 12px;
    font-weight: 600;
    font-size: 0.9em;
    color: var(--SmartThemeBodyColor, #ccc);
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
    transition: background 0.15s ease;
}

.openvault-details summary:hover {
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 60%, transparent);
}

/* Chevron */
.openvault-details summary::after {
    content: '›';
    font-size: 1.2em;
    font-weight: bold;
    transition: transform 0.2s ease;
    margin-left: auto;
    padding-left: 8px;
}

.openvault-details[open] > summary::after {
    transform: rotate(90deg);
}

/* Content area */
.openvault-details > :not(summary) {
    padding: 8px 12px 12px;
}

/* Remove default browser disclosure triangle */
.openvault-details summary::-webkit-details-marker,
.openvault-details summary::marker {
    display: none;
    content: '';
}
```

**Key properties:**
- Left accent stripe: 3px solid `--SmartThemeQuoteColor` (adapts to theme)
- Background: 40% of `--SmartThemeBlurTintColor` (theme-aware tint)
- Chevron `›` rotates 90° on open via CSS `transform`
- Hover brightens background to 60%
- `user-select: none` prevents accidental text selection on click
- No FontAwesome dependency — uses unicode `›`

### 3.3 Sub-Grouping (Tab 2: Memory Bank)

The current single "Extraction & Graph Rules" `<details>` (12 sliders) breaks into 4 collapsed sub-groups:

#### Group 1: Background LLM Payload
- Extraction Token Budget (4k–64k, default 16k)
- Context Window Size / Rearview (1k–32k, default 12k)
- **Payload Calculator readout** (read-only)

#### Group 2: Reflection Engine
- Reflection Threshold (10–100, default 30)
- Max Insights per Reflection (1–5, default 3)
- Reflection Dedup Threshold (0.5–1.0, default 0.90) + 3-tier legend
- Max Reflections per Character (10–200, default 50)
- Reflection Decay Threshold (100–2000, default 750)

#### Group 3: Graph & Communities
- Entity Description Cap (1–10, default 3)
- Edge Description Cap (1–20, default 5)
- Community Detection Interval (10–200, default 50)
- Community Staleness Threshold (20–500, default 100)

#### Group 4: System Limits
- Backfill Rate Limit / RPM (1–600, default 30)

### 3.4 Sub-Grouping (Tab 3: World)

The current single "Retrieval & Injection" `<details>` breaks into 2 collapsed sub-groups:

#### Group 1: Prompt Injection Budgets
- Final Context Budget (1k–32k, default 12k)
- World Context Budget (500–5k, default 2k)
- Visible Chat Budget (4k–64k, default 16k)
- Budget indicator bars (existing)

#### Group 2: Entity Detection Rules
- Entity Window (3–20, default 10)
- Embedding Window (2–10, default 5)
- Top Entities (1–10, default 5)
- Entity Boost (0.5–15x, default 5.0)

### 3.5 Auto-Collapse Policy

**Every** `<details>` element in the settings panel starts closed. Remove all `open` attributes from HTML. No exceptions — the user must deliberately open a section.

Tabs affected:
- Tab 1: "Connection Settings" — already collapsed ✓
- Tab 2: 4 new sub-groups — all collapsed
- Tab 3: 2 new sub-groups — all collapsed
- Tab 4: Sections already distinct (no `<details>` to change)

## 4. Data Models / Schema

### New constants in `constants.js`

```javascript
/** Payload calculator constants — single source of truth */
export const PAYLOAD_CALC = {
    LLM_OUTPUT_TOKENS: 8000,
    PROMPT_ESTIMATE: 2000,
    SAFETY_BUFFER: 2000,
    get OVERHEAD() { return this.LLM_OUTPUT_TOKENS + this.PROMPT_ESTIMATE + this.SAFETY_BUFFER; },
    THRESHOLD_GREEN: 32000,
    THRESHOLD_YELLOW: 48000,
    THRESHOLD_ORANGE: 64000,
};
```

### Changed defaults in `constants.js`

```javascript
// BEFORE:
extractionTokenBudget: 16000,
extractionRearviewTokens: 12000,

// AFTER (sum = 20k, + 12k overhead = 32k = green):
extractionTokenBudget: 12000,
extractionRearviewTokens: 8000,
```

The calculator is read-only UI derived from existing settings + `PAYLOAD_CALC.OVERHEAD`.

## 5. Interface / API Design

### New HTML elements (settings_panel.html)

```html
<!-- Payload Calculator readout (inside Background LLM Payload group) -->
<div id="openvault_payload_calculator" class="openvault-payload-calc">
    <span id="openvault_payload_emoji">✅</span>
    <span>Estimated total: ~<span id="openvault_payload_total">28,000</span> tokens</span>
    <div class="openvault-payload-breakdown" id="openvault_payload_breakdown">
        (16k batch + 12k rearview + 8k output + 4k overhead)
    </div>
    <div class="openvault-payload-hint">
        Ensure your Extraction Profile supports this context size.
    </div>
</div>
```

### New CSS classes

| Class | Purpose |
|-------|---------|
| `.openvault-payload-calc` | Container for calculator readout |
| `.openvault-payload-breakdown` | Muted breakdown text |
| `.openvault-payload-hint` | Advice text below breakdown |
| `.payload-safe` | Green text color |
| `.payload-caution` | Yellow text color |
| `.payload-warning` | Orange text color |
| `.payload-danger` | Red text + bold |

### New JS function (settings.js)

```javascript
import { PAYLOAD_CALC } from '../constants.js';

/**
 * Update the payload calculator readout.
 * Reads current slider values, adds PAYLOAD_CALC.OVERHEAD,
 * sets emoji + color class on the calculator element.
 */
function updatePayloadCalculator() {
    const budget = Number($('#openvault_extraction_token_budget').val()) || 12000;
    const rearview = Number($('#openvault_extraction_rearview').val()) || 8000;
    const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;

    $('#openvault_payload_total').text(total.toLocaleString());

    // Breakdown text
    const bStr = Math.round(budget / 1000) + 'k';
    const rStr = Math.round(rearview / 1000) + 'k';
    const oStr = Math.round(PAYLOAD_CALC.OVERHEAD / 1000) + 'k';
    $('#openvault_payload_breakdown').text(
        `(${bStr} batch + ${rStr} rearview + ${oStr} overhead)`
    );

    // Color thresholds — all from PAYLOAD_CALC
    const calc = $('#openvault_payload_calculator');
    calc.removeClass('payload-safe payload-caution payload-warning payload-danger');
    let emoji;
    if (total <= PAYLOAD_CALC.THRESHOLD_GREEN) {
        calc.addClass('payload-safe');
        emoji = '✅';
    } else if (total <= PAYLOAD_CALC.THRESHOLD_YELLOW) {
        calc.addClass('payload-caution');
        emoji = '⚠️';
    } else if (total <= PAYLOAD_CALC.THRESHOLD_ORANGE) {
        calc.addClass('payload-warning');
        emoji = '🟠';
    } else {
        calc.addClass('payload-danger');
        emoji = '🔴';
    }
    $('#openvault_payload_emoji').text(emoji);
}
```

Called from: both slider `input` event handlers and `updateUI()`.

### Files modified

| File | Change |
|------|--------|
| `style.css` | Replace `.openvault-details` block (~20 lines → ~45 lines). Add `.openvault-payload-*` classes (~25 lines). |
| `templates/settings_panel.html` | Remove all `open` attributes. Split Tab 2's "Extraction & Graph Rules" into 4 `<details>`. Split Tab 3's "Retrieval & Injection" into 2 `<details>`. Add payload calculator HTML. |
| `src/ui/settings.js` | Add `updatePayloadCalculator()`. Call it from `updateUI()` and from both budget slider handlers. Import `PAYLOAD_CALC`. |
| `src/constants.js` | Export `PAYLOAD_CALC` object (thresholds, output tokens, overhead). Change `extractionTokenBudget` default to 12000, `extractionRearviewTokens` default to 8000. Update `UI_DEFAULT_HINTS` to match. |

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| Theme doesn't define `--SmartThemeQuoteColor` | Fallback: `#4a90d9` (blue). Already used in existing help-content borders. |
| Theme doesn't define `--SmartThemeBlurTintColor` | Fallback: transparent. Drawer still has accent stripe. |
| `color-mix()` not supported in old browsers | SillyTavern targets Chromium 114+, `color-mix()` shipped in 111. Safe. |
| User opens all 6 drawers at once | Fine — content is scrollable. No layout breakage. |
| Payload calculator shows 28k but user's model is 128k | Green ✅ — this is informational, not a hard block. User decides. |
| Payload calculator shows 72k but user has a 128k model | Red 🔴 still shows — color indicates cost/latency concern, not impossibility. Hint text says "ensure your profile supports this." |
| Removing `open` attributes loses user's preferred open state | `<details>` elements don't persist state across re-renders anyway. Consistent collapsed-on-load is predictable. |
