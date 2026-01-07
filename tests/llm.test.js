/**
 * Tests for src/llm.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { callLLM, callLLMForExtraction, callLLMForRetrieval, LLM_CONFIGS } from '../src/llm.js';
import { extensionName } from '../src/constants.js';

describe('llm', () => {
    let mockConsole;
    let mockConnectionManager;
    let mockContext;
    let mockSettings;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        mockConnectionManager = {
            sendRequest: vi.fn().mockResolvedValue({ content: 'LLM response content' }),
        };

        mockContext = {
            chatMetadata: {},
            chatId: 'test-chat-123',
            parseReasoningFromString: null,
        };

        mockSettings = {
            enabled: true,
            debugMode: true,
            extractionProfile: 'extraction-profile-123',
            retrievalProfile: 'retrieval-profile-456',
        };

        setDeps({
            console: mockConsole,
            connectionManager: mockConnectionManager,
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: mockSettings,
                connectionManager: {
                    selectedProfile: 'default-profile',
                    profiles: [{ id: 'default-profile', name: 'Default' }],
                },
            }),
            showToast: vi.fn(),
        });
    });

    afterEach(() => {
        resetDeps();
    });

    describe('LLM_CONFIGS', () => {
        it('has extraction config', () => {
            expect(LLM_CONFIGS.extraction).toBeDefined();
            expect(LLM_CONFIGS.extraction.profileSettingKey).toBe('extractionProfile');
            expect(LLM_CONFIGS.extraction.maxTokens).toBe(4000);
            expect(LLM_CONFIGS.extraction.errorContext).toBe('Extraction');
        });

        it('has retrieval config', () => {
            expect(LLM_CONFIGS.retrieval).toBeDefined();
            expect(LLM_CONFIGS.retrieval.profileSettingKey).toBe('retrievalProfile');
            expect(LLM_CONFIGS.retrieval.maxTokens).toBe(4000);
            expect(LLM_CONFIGS.retrieval.errorContext).toBe('Smart retrieval');
        });
    });

    describe('callLLM', () => {
        it('calls connectionManager.sendRequest with correct parameters', async () => {
            await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'extraction-profile-123',
                [
                    { role: 'user', content: 'test prompt' },
                ],
                4000,
                {
                    includePreset: true,
                    includeInstruct: true,
                    stream: false,
                },
                {}
            );
        });

        it('returns content from LLM response object', async () => {
            mockConnectionManager.sendRequest.mockResolvedValue({ content: 'response text' });

            const result = await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(result).toBe('response text');
        });

        it('returns string response directly if not object', async () => {
            mockConnectionManager.sendRequest.mockResolvedValue('plain string response');

            const result = await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(result).toBe('plain string response');
        });

        it('falls back to connectionManager selected profile when no profile set', async () => {
            mockSettings.extractionProfile = '';

            await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'default-profile',
                expect.any(Array),
                expect.any(Number),
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('logs fallback profile usage', async () => {
            mockSettings.extractionProfile = '';

            await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(mockConsole.log).toHaveBeenCalledWith(
                expect.stringContaining('No extractionProfile set')
            );
        });

        it('throws error when no profile available', async () => {
            mockSettings.extractionProfile = '';
            setDeps({
                console: mockConsole,
                connectionManager: mockConnectionManager,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: mockSettings,
                    connectionManager: {
                        selectedProfile: null,
                        profiles: [],
                    },
                }),
                showToast: vi.fn(),
            });

            await expect(callLLM('test prompt', LLM_CONFIGS.extraction))
                .rejects.toThrow('No connection profile available for extraction');
        });

        it('throws error on empty LLM response', async () => {
            // Mock returns empty string directly (not object with content)
            mockConnectionManager.sendRequest.mockResolvedValue('');

            await expect(callLLM('test prompt', LLM_CONFIGS.extraction))
                .rejects.toThrow('Empty response from LLM');
        });

        it('throws error on null LLM response', async () => {
            mockConnectionManager.sendRequest.mockResolvedValue(null);

            await expect(callLLM('test prompt', LLM_CONFIGS.extraction))
                .rejects.toThrow('Empty response from LLM');
        });

        it('shows toast and logs on error', async () => {
            const mockShowToast = vi.fn();
            setDeps({
                console: mockConsole,
                connectionManager: mockConnectionManager,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: mockSettings,
                }),
                showToast: mockShowToast,
            });

            const error = new Error('Network error');
            mockConnectionManager.sendRequest.mockRejectedValue(error);

            await expect(callLLM('test prompt', LLM_CONFIGS.extraction))
                .rejects.toThrow('Network error');

            // showToast in utils.js calls getDeps().showToast with 4 args (type, message, title, options)
            expect(mockShowToast).toHaveBeenCalledWith(
                'error',
                'Extraction failed: Network error',
                'OpenVault',
                {}
            );
        });

        it('parses reasoning from response when parseReasoningFromString available', async () => {
            mockContext.parseReasoningFromString = vi.fn().mockReturnValue({
                reasoning: 'thinking...',
                content: 'actual response',
            });
            mockConnectionManager.sendRequest.mockResolvedValue({
                content: '<thinking>thinking...</thinking>actual response',
            });

            const result = await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(mockContext.parseReasoningFromString).toHaveBeenCalled();
            expect(result).toBe('actual response');
        });

        it('returns original content if parseReasoningFromString returns null', async () => {
            mockContext.parseReasoningFromString = vi.fn().mockReturnValue(null);
            mockConnectionManager.sendRequest.mockResolvedValue({
                content: 'response without reasoning',
            });

            const result = await callLLM('test prompt', LLM_CONFIGS.extraction);

            expect(result).toBe('response without reasoning');
        });

        it('uses retrieval config maxTokens correctly', async () => {
            await callLLM('test prompt', LLM_CONFIGS.retrieval);

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                4000, // retrieval maxTokens
                expect.any(Object),
                expect.any(Object)
            );
        });
    });

    describe('callLLMForExtraction', () => {
        it('uses extraction config', async () => {
            await callLLMForExtraction('extract this');

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'extraction-profile-123',
                expect.arrayContaining([
                    expect.objectContaining({ role: 'user', content: 'extract this' }),
                ]),
                4000,
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('reads extractionProfile from settings', async () => {
            mockSettings.extractionProfile = 'custom-extraction-profile';

            await callLLMForExtraction('test');

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'custom-extraction-profile',
                expect.any(Array),
                expect.any(Number),
                expect.any(Object),
                expect.any(Object)
            );
        });
    });

    describe('callLLMForRetrieval', () => {
        it('uses retrieval config', async () => {
            await callLLMForRetrieval('select memories');

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'retrieval-profile-456',
                expect.arrayContaining([
                    expect.objectContaining({ role: 'user', content: 'select memories' }),
                ]),
                4000,
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('reads retrievalProfile from settings', async () => {
            mockSettings.retrievalProfile = 'custom-retrieval-profile';

            await callLLMForRetrieval('test');

            expect(mockConnectionManager.sendRequest).toHaveBeenCalledWith(
                'custom-retrieval-profile',
                expect.any(Array),
                expect.any(Number),
                expect.any(Object),
                expect.any(Object)
            );
        });
    });
});
