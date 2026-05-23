import { describe, expect, it } from 'vitest';
import { hasSufficientTokenOverlap } from '../../src/graph/graph.js';

describe('hasSufficientTokenOverlap', () => {
    it('should accept 60%+ token overlap', async () => {
        const tokensA = new Set(['king', 'aldric', 'northern']);
        const tokensB = new Set(['king', 'aldric', 'southern']);

        // 2/3 = 0.67 ≥ 0.6 → passes
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6)).resolves.toBe(true);
    });

    it('should NOT merge бордовая свеча / бордовый дилдо (stem overlap 1/2=0.5 < 0.6)', async () => {
        const tokensA = new Set(['бордовая', 'свеча']);
        const tokensB = new Set(['бордовый', 'силиконовый', 'дилдо']);
        await expect(
            hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'бордовая свеча', 'бордовый силиконовый дилдо')
        ).resolves.toBe(false);
    });

    it('should NOT merge продуктовый магазин / цветочный магазин (token overlap 1/2=0.5 < 0.6)', async () => {
        const tokensA = new Set(['продуктовый', 'магазин']);
        const tokensB = new Set(['цветочный', 'магазин']);
        await expect(
            hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'продуктовый магазин', 'цветочный магазин')
        ).resolves.toBe(false);
    });

    it('should NOT merge силиконовое кольцо / силиконовый дилдо (stem overlap 1/2=0.5 < 0.6)', async () => {
        const tokensA = new Set(['силиконовое', 'кольцо']);
        const tokensB = new Set(['силиконовый', 'дилдо']);
        await expect(
            hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'силиконовое кольцо', 'силиконовый дилдо')
        ).resolves.toBe(false);
    });

    it('should still merge king aldric northern / king aldric southern at 0.6 ratio (2/3=0.67)', async () => {
        const tokensA = new Set(['king', 'aldric', 'northern']);
        const tokensB = new Set(['king', 'aldric', 'southern']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6)).resolves.toBe(true);
    });

    it('should NOT merge alice/alicia (different names, no stem match, LCS 0.8 < 0.85)', async () => {
        // alice/alicia are NOT morphological variants - different names
        // English stemmer: "alice" -> "alic", "alicia" -> "alicia" (no reduction)
        // LCS: "alic" = 4 chars, ratio = 4/5 = 0.8 < 0.85 threshold
        const keyA = 'alice';
        const keyB = 'alicia';

        await expect(hasSufficientTokenOverlap(new Set([keyA]), new Set([keyB]), 0.5, keyA, keyB)).resolves.toBe(false);
    });

    it('should match Russian morphological variants via stemming (ошейник/ошейником)', async () => {
        // "ошейник" (nominative) vs "ошейником" (instrumental) — same word, different case
        const tokensA = new Set(['ошейник']);
        const tokensB = new Set(['ошейником']);
        // keyA/keyB won't substring-match, tokens won't overlap, but stems should
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'ошейник', 'ошейником')).resolves.toBe(true);
    });

    it('should match short names via lowered LCS threshold (Кай/Каю)', async () => {
        // "Кай" (3 chars) and "Каю" (3 chars) — LCS "Ка" = 2/3 = 67% ≥ 60%
        // Currently skipped because length ≤ 3. After lowering to > 2, should match.
        const tokensA = new Set(['кай']);
        const tokensB = new Set(['каю']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'кай', 'каю')).resolves.toBe(true);
    });

    it('should NOT merge unrelated entities even with stem check', async () => {
        // "малина" (raspberry/safeword) vs "машина" (car) — different stems
        const tokensA = new Set(['малина']);
        const tokensB = new Set(['машина']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'малина', 'машина')).resolves.toBe(false);
    });

    it('should NOT merge расчёска/миска (short suffix "-ска" = 3 chars < 4 min)', async () => {
        const tokensA = new Set(['расчёска']);
        const tokensB = new Set(['миска']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'расчёска', 'миска')).resolves.toBe(false);
    });

    it('should NOT merge anything with воск (LCS 3 chars < 4 min)', async () => {
        const tokensA = new Set(['чёрный', 'кружевной', 'бюстгальтер', 'с', 'носками', 'в', 'чашках']);
        const tokensB = new Set(['воск']);
        await expect(
            hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'чёрный кружевной бюстгальтер с носками в чашках', 'воск')
        ).resolves.toBe(false);
    });

    it('should NOT merge кольцо/колокольчик (LCS "коль" 4/6=0.67 < 0.7)', async () => {
        const tokensA = new Set(['кольцо']);
        const tokensB = new Set(['колокольчик']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'кольцо', 'колокольчик')).resolves.toBe(false);
    });

    it('should still merge Свечи/Свеча (LCS "свеч" 4/5=0.8 ≥ 0.7)', async () => {
        const tokensA = new Set(['свечи']);
        const tokensB = new Set(['свеча']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'свечи', 'свеча')).resolves.toBe(true);
    });

    it('should still merge верёвки/верёвка (LCS "верёвк" 6/7=0.86 ≥ 0.7)', async () => {
        const tokensA = new Set(['верёвки']);
        const tokensB = new Set(['верёвка']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'верёвки', 'верёвка')).resolves.toBe(true);
    });

    // === TASK 1: Russian morphology stem-first tests ===

    it('should NOT merge плетка/плеточка (different base words, not morphological variants)', async () => {
        // плетка (small whip/cord) vs плеточка (diminutive of плеть, not плетка)
        // Russian stemmer: "плетка" -> "плетк", "плеточка" -> "плеточк" (different stems)
        // LCS: "плет" = 4 chars, ratio = 4/6 = 0.67 < 0.85 threshold
        const tokensA = new Set(['плетка']);
        const tokensB = new Set(['плеточка']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'плетка', 'плеточка')).resolves.toBe(false);
    });

    it('should merge Russian singular/plural via stem equality (ошейник/ошейники)', async () => {
        // Same stem — should merge immediately
        const tokensA = new Set(['ошейник']);
        const tokensB = new Set(['ошейники']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'ошейник', 'ошейники')).resolves.toBe(true);
    });

    it('should NOT merge false positives blocked by stricter LCS (таблеточки/плеточка)', async () => {
        // Different roots, shared suffix "леточк" (6 chars)
        // With LCS threshold 0.85, 6/9 = 0.67 < 0.85 → blocked
        const tokensA = new Set(['таблеточки']);
        const tokensB = new Set(['плеточка']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'таблеточки', 'плеточка')).resolves.toBe(false);
    });

    it('should still merge true positives via LCS at 0.85 (свечи/свеча)', async () => {
        // LCS "свеч" = 4 chars, minLen = 5, ratio = 0.8
        // Wait, 0.8 < 0.85 — this should now FAIL at LCS level
        // But stems should match: "свеч" for both
        const tokensA = new Set(['свечи']);
        const tokensB = new Set(['свеча']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'свечи', 'свеча')).resolves.toBe(true);
    });

    it('should still merge верёвки/верёвка via stem or LCS', async () => {
        // LCS "верёвк" = 6 chars, minLen = 7, ratio = 0.86 >= 0.85
        const tokensA = new Set(['верёвки']);
        const tokensB = new Set(['верёвка']);
        await expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'верёвки', 'верёвка')).resolves.toBe(true);
    });
});
