import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps, setDeps } from '../../src/deps.js';
import {
    clearAllLocks,
    getSessionSignal,
    getWakeGeneration,
    incrementWakeGeneration,
    isSessionDisabled,
    isWorkerRunning,
    resetSessionController,
    setSessionDisabled,
    setWorkerRunning,
} from '../../src/state.js';

describe('Session AbortController', () => {
    it('getSessionSignal returns an AbortSignal', () => {
        const signal = getSessionSignal();
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
    });

    it('resetSessionController aborts the previous signal', () => {
        const oldSignal = getSessionSignal();
        resetSessionController();
        expect(oldSignal.aborted).toBe(true);
    });

    it('resetSessionController creates a fresh non-aborted signal', () => {
        resetSessionController();
        const newSignal = getSessionSignal();
        expect(newSignal.aborted).toBe(false);
    });

    it('each reset produces a distinct signal', () => {
        const signal1 = getSessionSignal();
        resetSessionController();
        const signal2 = getSessionSignal();
        expect(signal1).not.toBe(signal2);
        expect(signal1.aborted).toBe(true);
        expect(signal2.aborted).toBe(false);
    });
});

describe('Worker state', () => {
    afterEach(() => {
        setWorkerRunning(false);
    });

    it('isWorkerRunning returns false by default', () => {
        expect(isWorkerRunning()).toBe(false);
    });

    it('setWorkerRunning toggles the flag', () => {
        setWorkerRunning(true);
        expect(isWorkerRunning()).toBe(true);
        setWorkerRunning(false);
        expect(isWorkerRunning()).toBe(false);
    });

    it('incrementWakeGeneration increases the counter', () => {
        const before = getWakeGeneration();
        incrementWakeGeneration();
        expect(getWakeGeneration()).toBe(before + 1);
    });
});

describe('clearAllLocks', () => {
    beforeEach(() => {
        setDeps({ clearTimeout: vi.fn() });
    });
    afterEach(() => {
        setWorkerRunning(false);
        resetDeps();
    });

    it('resets worker running state', () => {
        setWorkerRunning(true);
        clearAllLocks();
        expect(isWorkerRunning()).toBe(false);
    });
});

describe('Session Kill-Switch', () => {
    afterEach(() => {
        setSessionDisabled(false);
    });

    it('isSessionDisabled returns false by default', () => {
        expect(isSessionDisabled()).toBe(false);
    });

    it('setSessionDisabled toggles the flag', () => {
        setSessionDisabled(true);
        expect(isSessionDisabled()).toBe(true);
        setSessionDisabled(false);
        expect(isSessionDisabled()).toBe(false);
    });
});
