/**
 * OpenVault Auto-Hide
 *
 * Automatically hides old messages that have been extracted into memories.
 */

import { getDeps } from './deps.js';
import { getOpenVaultData, showToast, log, getExtractedMessageIds } from './utils.js';
import { extensionName } from './constants.js';

/**
 * Auto-hide old messages beyond the threshold
 * Hides messages in pairs (user-assistant) to maintain conversation coherence
 * Messages are marked with is_system=true which excludes them from context
 * IMPORTANT: Only hides messages that have already been extracted into memories
 */
export async function autoHideOldMessages() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    if (!settings.autoHideEnabled) return;

    const context = deps.getContext();
    const chat = context.chat || [];
    const threshold = settings.autoHideThreshold || 50;

    // Get messages that have been extracted into memories
    const data = getOpenVaultData();
    const extractedMessageIds = getExtractedMessageIds(data);

    // Get visible (non-hidden) messages with their original indices
    const visibleMessages = chat
        .map((m, idx) => ({ ...m, idx }))
        .filter(m => !m.is_system);

    // If we have fewer messages than threshold, nothing to hide
    if (visibleMessages.length <= threshold) return;

    // Calculate how many messages to hide
    const toHideCount = visibleMessages.length - threshold;

    // Round down to nearest even number (for pairs)
    const pairsToHide = Math.floor(toHideCount / 2);
    const messagesToHide = pairsToHide * 2;

    if (messagesToHide <= 0) return;

    // Hide the oldest messages, but ONLY if they've been extracted
    let hiddenCount = 0;
    let skippedCount = 0;
    for (let i = 0; i < messagesToHide && i < visibleMessages.length; i++) {
        const msgIdx = visibleMessages[i].idx;

        // Only hide if this message has been extracted into memories
        if (extractedMessageIds.has(msgIdx)) {
            chat[msgIdx].is_system = true;
            hiddenCount++;
        } else {
            skippedCount++;
        }
    }

    if (hiddenCount > 0) {
        await getDeps().saveChatConditional();
        log(`Auto-hid ${hiddenCount} messages (skipped ${skippedCount} not yet extracted) - threshold: ${threshold}`);
        showToast('info', `Auto-hid ${hiddenCount} old messages`);
    } else if (skippedCount > 0) {
        log(`Auto-hide: ${skippedCount} messages need extraction before hiding`);
    }
}
