/**
 * Tests for src/ui/formatting.js
 */
import { describe, it, expect } from 'vitest';
import {
    formatMemoryImportance,
    formatMemoryDate,
    formatWitnesses,
    getStatusText,
    formatEmotionSource,
    formatHiddenMessagesText,
    formatMemoryContextCount,
} from '../src/ui/formatting.js';

describe('ui/formatting', () => {
    describe('formatMemoryImportance', () => {
        it('formats importance 1 as one filled star and four empty', () => {
            expect(formatMemoryImportance(1)).toBe('\u2605\u2606\u2606\u2606\u2606');
        });

        it('formats importance 5 as five filled stars', () => {
            expect(formatMemoryImportance(5)).toBe('\u2605\u2605\u2605\u2605\u2605');
        });

        it('formats importance 3 as three filled and two empty', () => {
            expect(formatMemoryImportance(3)).toBe('\u2605\u2605\u2605\u2606\u2606');
        });

        it('defaults to 3 when undefined', () => {
            expect(formatMemoryImportance(undefined)).toBe('\u2605\u2605\u2605\u2606\u2606');
        });

        it('clamps values below 1 to 1', () => {
            expect(formatMemoryImportance(0)).toBe('\u2605\u2606\u2606\u2606\u2606');
            expect(formatMemoryImportance(-5)).toBe('\u2605\u2606\u2606\u2606\u2606');
        });

        it('clamps values above 5 to 5', () => {
            expect(formatMemoryImportance(10)).toBe('\u2605\u2605\u2605\u2605\u2605');
        });
    });

    describe('formatMemoryDate', () => {
        it('formats valid timestamp as localized date', () => {
            const timestamp = new Date('2024-06-15').getTime();
            const result = formatMemoryDate(timestamp);
            // Result depends on locale, just check it's not 'Unknown'
            expect(result).not.toBe('Unknown');
            expect(result).toContain('2024');
        });

        it('returns Unknown for null timestamp', () => {
            expect(formatMemoryDate(null)).toBe('Unknown');
        });

        it('returns Unknown for undefined timestamp', () => {
            expect(formatMemoryDate(undefined)).toBe('Unknown');
        });

        it('returns Unknown for zero timestamp', () => {
            expect(formatMemoryDate(0)).toBe('Unknown');
        });
    });

    describe('formatWitnesses', () => {
        it('formats array of witnesses as comma-separated string', () => {
            expect(formatWitnesses(['Alice', 'Bob', 'Charlie'])).toBe('Witnesses: Alice, Bob, Charlie');
        });

        it('formats single witness', () => {
            expect(formatWitnesses(['Alice'])).toBe('Witnesses: Alice');
        });

        it('returns empty string for empty array', () => {
            expect(formatWitnesses([])).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(formatWitnesses(undefined)).toBe('');
        });

        it('returns empty string for null', () => {
            expect(formatWitnesses(null)).toBe('');
        });
    });

    describe('getStatusText', () => {
        it('returns Ready for ready status', () => {
            expect(getStatusText('ready')).toBe('Ready');
        });

        it('returns Extracting... for extracting status', () => {
            expect(getStatusText('extracting')).toBe('Extracting...');
        });

        it('returns Retrieving... for retrieving status', () => {
            expect(getStatusText('retrieving')).toBe('Retrieving...');
        });

        it('returns Error for error status', () => {
            expect(getStatusText('error')).toBe('Error');
        });

        it('returns input as-is for unknown status', () => {
            expect(getStatusText('custom')).toBe('custom');
        });
    });

    describe('formatEmotionSource', () => {
        it('formats same min and max as single message', () => {
            expect(formatEmotionSource({ min: 5, max: 5 })).toBe(' (msg 5)');
        });

        it('formats different min and max as range', () => {
            expect(formatEmotionSource({ min: 10, max: 15 })).toBe(' (msgs 10-15)');
        });

        it('returns empty string for undefined', () => {
            expect(formatEmotionSource(undefined)).toBe('');
        });

        it('returns empty string for null', () => {
            expect(formatEmotionSource(null)).toBe('');
        });
    });

    describe('formatHiddenMessagesText', () => {
        it('formats positive count with parentheses', () => {
            expect(formatHiddenMessagesText(5)).toBe(' (5 hidden)');
        });

        it('returns empty string for zero', () => {
            expect(formatHiddenMessagesText(0)).toBe('');
        });

        it('returns empty string for negative', () => {
            expect(formatHiddenMessagesText(-1)).toBe('');
        });
    });

    describe('formatMemoryContextCount', () => {
        it('returns All for negative values', () => {
            expect(formatMemoryContextCount(-1)).toBe('All');
            expect(formatMemoryContextCount(-10)).toBe('All');
        });

        it('returns string number for positive values', () => {
            expect(formatMemoryContextCount(5)).toBe('5');
            expect(formatMemoryContextCount(100)).toBe('100');
        });

        it('returns 0 for zero', () => {
            expect(formatMemoryContextCount(0)).toBe('0');
        });
    });
});
