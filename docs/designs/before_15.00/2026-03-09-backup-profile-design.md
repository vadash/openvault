# Design: Backup LLM Profile Failover

## 1. Problem Statement

When the primary extraction profile's API is down, rate-limited, or returning errors, all OpenVault extraction/reflection/community work halts. Users with multiple LLM providers have no automatic way to fall back to an alternative.

## 2. Goals & Non-Goals

**Must do:**
- Add a configurable backup profile (separate dropdown in UI).
- On any `callLLM()` failure, retry the same request with the backup profile.
- If backup also fails, throw the error (caller handles retries/backoff as before).
- Every `callLLM()` invocation always tries main first — no state tracking.
- If `extractionProfile` is unset, fall back to SillyTavern's `selectedProfile` (existing behavior, unchanged).
- If `backupProfile` is unset, no failover occurs (current behavior preserved).

**Won't do:**
- Circuit breaker / sticky failover (too complex, user chose KISS).
- Auto-assign backup from profile list (user wants explicit dropdown).
- Separate backup profiles per LLM_CONFIG (one backup for all).

## 3. Proposed Architecture

**Approach: Inline retry inside `callLLM()`**

Zero state, zero new files. The `callLLM()` catch block checks for a backup profile and retries once before re-throwing:

```
callLLM(messages, config, options)
  ├─ resolve mainProfileId (existing logic)
  ├─ try sendRequest(mainProfileId) → return on success
  └─ catch
       ├─ resolve backupProfileId from settings.backupProfile
       ├─ if !backupProfileId OR backupProfileId === mainProfileId → re-throw
       ├─ log("Falling back to backup profile: ...")
       ├─ try sendRequest(backupProfileId) → return on success
       └─ catch → re-throw backup error
```

**Why this approach:**
- Single touch-point: only `callLLM()` changes. All 5 LLM_CONFIGS (events, graph, questions, insights, community) get failover for free.
- The existing backoff loop in `extract.js:748-791` doesn't need changes — each iteration calls `callLLM()` which internally handles the main→backup attempt.
- No state management, no timers, no race conditions.

## 4. Data Models / Schema

### Settings addition (`defaultSettings` in `src/constants.js`)

```javascript
backupProfile: '',  // Profile ID string, empty = disabled
```

No changes to `chatMetadata.openvault` schema.

## 5. Interface / API Design

### `callLLM()` modification (`src/llm.js`)

No signature change. Internal behavior change only:

```javascript
// After the existing catch block (line 137):
catch (mainError) {
    // --- NEW: Backup profile failover ---
    const backupProfileId = settings.backupProfile;
    if (backupProfileId && backupProfileId !== profileId) {
        const profiles = extension_settings?.connectionManager?.profiles || [];
        const backupName = profiles.find(p => p.id === backupProfileId)?.name || backupProfileId;
        log(`${errorContext} failed on main profile, trying backup: ${backupName}`);
        try {
            const backupResult = await withTimeout(
                deps.connectionManager.sendRequest(
                    backupProfileId, messages, maxTokens,
                    { includePreset: true, includeInstruct: true, stream: false },
                    jsonSchema ? { jsonSchema } : {}
                ),
                timeoutMs || 120000,
                `${errorContext} API (backup)`
            );
            const backupContent = backupResult?.content || backupResult || '';
            logRequest(`${errorContext} (backup)`, { messages, maxTokens, profileId: backupProfileId, response: backupContent });
            if (!backupContent) throw new Error('Empty response from backup LLM');
            // Parse reasoning if present
            const context = deps.getContext();
            if (context.parseReasoningFromString) {
                const parsed = context.parseReasoningFromString(backupContent);
                return parsed ? parsed.content : backupContent;
            }
            return backupContent;
        } catch (backupError) {
            log(`${errorContext} backup also failed: ${backupError.message}`);
            // Fall through to throw main error
        }
    }
    // --- END backup failover ---

    // Existing error handling (toast + re-throw)
    const errorMessage = mainError.message || 'Unknown error';
    log(`${errorContext} LLM call error: ${errorMessage}`);
    if (!errorMessage.includes('timed out')) {
        showToast('error', `${errorContext} failed: ${errorMessage}`);
    }
    logRequest(errorContext, { messages, maxTokens, profileId, error: mainError });
    throw mainError;
}
```

### UI additions

**`templates/settings_panel.html`** — Add after the extraction profile dropdown:

```html
<label for="openvault_backup_profile">Backup Profile</label>
<select id="openvault_backup_profile" class="text_pole">
    <option value="">None (no failover)</option>
</select>
<small class="openvault-hint">Fallback profile if the main one fails</small>
```

**`src/ui/settings.js`** — Wire up:

```javascript
// Change handler (alongside existing extraction profile handler)
$('#openvault_backup_profile').on('change', function () {
    saveSetting('backupProfile', $(this).val());
});

// In populateProfileSelector():
populateProfileDropdown($('#openvault_backup_profile'), profiles, settings.backupProfile);
```

## 6. Risks & Edge Cases

| Scenario | Behavior |
|---|---|
| No backup profile selected | No change from current behavior. Single attempt, errors propagate. |
| Backup === Main profile | Skip retry (guard: `backupProfileId !== profileId`). |
| Main times out (120s) + backup times out (120s) | Worst case 240s per `callLLM()`. Acceptable: the backoff loop already expects long waits. |
| Backup succeeds but returns garbage | Post-call parsing (Zod schemas, JSON repair) handles this in `structured.js`. If parsing fails, the backoff loop retries. |
| Main profile unset, falls back to `selectedProfile` | Backup still works — `profileId` is the resolved main, `backupProfileId` is the explicit backup. |
| Both fail with different errors | Main error is thrown (it's the "canonical" profile). Backup error is logged. |

## 7. Files Changed

| File | Change |
|---|---|
| `src/constants.js` | Add `backupProfile: ''` to `defaultSettings` |
| `src/llm.js` | Add backup retry logic in `callLLM()` catch block |
| `src/ui/settings.js` | Add change handler + populate backup dropdown |
| `templates/settings_panel.html` | Add backup profile `<select>` element |
| `tests/llm.test.js` | Add tests for failover paths (if exists) |
