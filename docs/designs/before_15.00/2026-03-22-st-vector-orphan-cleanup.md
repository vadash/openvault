# ST Vector Storage Orphan Cleanup

**Date**: 2026-03-22
**Status**: Approved

## Problem

When using `st_vector` (ST Vector Storage):
1. OpenVault stores vectors in collections named `openvault-{chatId}-st_vector`
2. ST only cleans up its own collections (`{chatId}`), not OpenVault's
3. "Delete Current Chat Memories" button doesn't purge ST vectors - they become orphaned
4. Previously deleted chats leave orphaned collections that accumulate over time

## Solution: Two-Part Cleanup

### Part 1: Lazy Orphan Detection (querySTVector)

Detect and clean orphaned collections when we try to access them.

**Implementation in `src/utils/data.js`:**

```javascript
// Cache of validated chats for this session
const validatedChats = new Set();

/**
 * Check if a chat still exists in ST
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function chatExists(chatId) {
    try {
        const { getContext, getRequestHeaders } = getDeps();
        const context = getContext();

        // Get character ID for individual chats
        const characterId = context.characterId;
        if (characterId !== undefined) {
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ character_id: characterId }),
            });
            const chats = await response.json();
            return chats.some(chat => chat.file_name.replace('.jsonl', '') === chatId);
        }

        // For group chats - check group data
        const groupId = context.groupId;
        if (groupId) {
            const response = await fetch('/api/groups/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: groupId }),
            });
            const group = await response.json();
            return group?.chats?.includes(chatId);
        }

        return false;
    } catch (err) {
        logWarn('Failed to validate chat existence', err);
        return true; // Assume exists on error to avoid false cleanup
    }
}

export async function querySTVector(query, topK, threshold, chatId) {
    // Check for orphans (with session cache)
    if (!validatedChats.has(chatId)) {
        const exists = await chatExists(chatId);
        if (!exists) {
            logWarn(`Detected orphaned ST collection for deleted chat: ${chatId}`);
            await purgeSTCollection(chatId);
            showToast('info', `Cleaned up orphaned vector storage for deleted chat`);
            return { hashes: [], metadata: [] };
        }
        validatedChats.add(chatId);
    }

    // ... rest of existing query logic
}
```

### Part 2: Delete Chat Data Should Clear ST Vectors

When user clicks "Delete Current Chat Memories", also purge ST collection if using `st_vector`.

**Implementation in `src/utils/data.js`:**

```javascript
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        logDebug('No chat metadata found');
        return false;
    }

    // Unhide all messages that were hidden by auto-hide
    const chat = context.chat || [];
    let unhiddenCount = 0;
    for (const msg of chat) {
        if (msg.is_system) {
            msg.is_system = false;
            unhiddenCount++;
        }
    }
    if (unhiddenCount > 0) {
        logDebug(`Unhid ${unhiddenCount} messages after memory clear`);
    }

    // NEW: Purge ST Vector Storage if using st_vector
    const settings = getDeps().getExtensionSettings()?.openvault;
    if (settings?.embeddingSource === 'st_vector') {
        const chatId = getCurrentChatId();
        if (chatId) {
            try {
                await purgeSTCollection(chatId);
                logInfo(`Purged ST Vector collection for cleared chat: ${chatId}`);
            } catch (err) {
                logWarn('Failed to purge ST collection during chat data deletion', err);
                // Don't fail the whole operation - OpenVault data is already cleared
            }
        }
    }

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    logDebug('Deleted all chat data');
    return true;
}
```

## Behavior Summary

| Scenario | Old Behavior | New Behavior |
|----------|--------------|--------------|
| Query orphaned collection | Returns empty/error | Detects orphan, purges, shows toast, returns empty |
| Delete chat memories | OpenVault data cleared only | OpenVault data + ST vectors cleared |
| Chat deleted outside ST | Collection orphaned forever | Detected on next query, cleaned up |

## Files Modified

- `src/utils/data.js` - Add `chatExists()`, `validatedChats` cache, modify `querySTVector()` and `deleteCurrentChatData()`

## Testing

### Test 1: Lazy Orphan Detection
1. Create chat with st_vector, generate memories
2. Manually delete chat JSONL file from filesystem
3. Send message (triggers query)
4. Verify: Toast appears, collection purged

### Test 2: Delete Chat Memories
1. Create chat with st_vector, generate memories
2. Click "Delete Current Chat Memories"
3. Verify: ST collection purged (check ST Vector Storage tab)

## Notes

- Session cache (`validatedChats`) avoids repeated validation for same chat
- On validation error, assume chat exists (fail-safe)
- ST purge errors during delete don't block OpenVault data clearing
